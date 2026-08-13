import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { hashPassword } from "../../src/auth/password";
import { signIn } from "../../src/auth/session";
import { fixedClock } from "../../src/domain/kernel/clock";
import { migrate } from "../../src/db/migrate";
import { SESSION_COOKIE } from "../../src/lib/session-cookie";
import { makeShelf, makeUser } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";
import { testDatabaseUrl } from "../support/env";

/**
 * `back()`'s query-string joining, against a real database — the fix from the
 * Task 5 (QA remediation) review round that found it.
 *
 * `admin-actions.ts`'s `back(path, code)` used to append `?loi=<code>`
 * unconditionally, which is correct only when `path` carries no query string
 * of its own. `updateBookshelfSettingsAction` has redirected to a
 * `?tu-sach=`-bearing `path` since this file was written, and a refusal from
 * it — reachable any day a manager types a negative loan period — produced
 * `/quan-tri/tu-sach?tu-sach=<id>?loi=<code>`: two `?` in one URL, where
 * everything after the *first* is one query string, so `?loi=` there is four
 * literal characters inside the value of `tu-sach` rather than a second
 * parameter. The refusal banner silently never rendered. `assignManagerAction`
 * was given the identical shape by this same review round (`?tu-sach=` on its
 * own redirect target, so appointing several readers of one parish in a row
 * does not make the administrator re-pick the shelf each time) — which would
 * have carried the same defect into a second action rather than only fixing
 * the first.
 *
 * **Why this file tests `updateBookshelfSettingsAction`'s refusal rather than
 * `assignManagerAction`'s**, even though the latter is the action this
 * defect was caught while changing. `assignManager` (`src/domain/admin
 * /commands/managers.ts`) has exactly three throw sites: one
 * `ValidationFailed("validation_failed", "role")` that `assignManagerAction`
 * makes structurally unreachable (`field(form, "quyen") === "admin" ? "admin"
 * : "manager"` can never produce a third value), and two `NotFound`s that
 * `submitAdminCommand` (`src/lib/page-data.ts`) translates to `notFound()`
 * *before* `back()` is ever reached — a 404, not a `?loi=` redirect. So
 * there is no input, malformed or otherwise, that drives
 * `assignManagerAction`'s own `code` to a non-null value through `back()`.
 * `updateBookshelfSettingsAction` is the sibling action that already shared
 * `back()`'s exact hazard (a `?`-bearing target) and can genuinely refuse (a
 * negative loan period), which is what makes it the real, exercised proof
 * that the join logic itself is correct — `assignManagerAction`'s own success
 * path is covered below for the shape of its target, and the third test pins
 * that a `path` with **no** existing `?` still gets exactly one, so no
 * caller's ordinary case moved.
 */

const session = vi.hoisted(() => ({ token: null as string | null }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && session.token
        ? { name, value: session.token }
        : undefined,
  }),
}));

const {
  assignManagerAction,
  revokeManagerAction,
  updateBookshelfSettingsAction,
  updateSiteContactAction,
  updateSystemDefaultsAction,
} = await import("../../src/app/quan-tri/admin-actions");
// `contactsFromForm` moved out of `admin-actions.ts` on 2026-08-12 (PO
// feedback round 1, Task 13's final check): a `"use server"` file may only
// export async functions, and this pure form-parsing helper is not one.
const { contactsFromForm } =
  await import("../../src/app/quan-tri/contacts-from-form");
const { pool } = await import("../../src/db/client");

const clock = fixedClock("2026-08-10T03:00:00Z");

let previousUrl: string | undefined;

beforeAll(async () => {
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  delete (globalThis as { [k: symbol]: unknown })[Symbol.for("olibra.db.pool")];
  await migrate(sql);
});

beforeEach(async () => {
  session.token = null;
  await resetDatabase();
});

afterAll(async () => {
  await pool().end();
  delete (globalThis as { [k: symbol]: unknown })[Symbol.for("olibra.db.pool")];
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  await closeAll();
});

/**
 * A signed-in `super_admin` — `adminContextFor`'s (`src/auth/guards.ts`) one
 * requirement is `users.is_super_admin`, not a membership of any shelf, so
 * this creates no `memberships` row at all, the same way `db/seed.ts`'s own
 * `admin` account carries none.
 */
async function signInAsSuperAdmin() {
  const username = `admin-${Math.random().toString(36).slice(2, 10)}`;
  const [user] = await sql<{ id: string }[]>`
    insert into users (
      saint_name, full_name, father_name, mother_name, username, password_hash,
      is_super_admin
    )
    values ('', 'Quản trị viên', '', '', ${username}, ${await hashPassword("x")}, true)
    returning id
  `;
  const { token } = await signIn(sql, { username, password: "x", clock });
  session.token = token;
  return { userId: user.id };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

/**
 * Where a `redirect()` aimed, query string and all — read off the digest
 * Next.js actually throws, the same helper `manager-actions.test.ts` and
 * `lending-actions.test.ts` use and for the identical reason: a test that
 * mocked `redirect` would pass against an action that built the wrong string
 * and never actually redirected there.
 */
async function redirectedTo(run: Promise<void>): Promise<string> {
  try {
    await run;
  } catch (err) {
    const digest = (err as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) {
      return digest.split(";")[2];
    }
    throw err;
  }
  throw new Error("the action returned without redirecting");
}

/** The `?loi=` code a refusal came back with, or null. */
function refusalIn(target: string): string | null {
  return new URLSearchParams(target.split("?")[1] ?? "").get("loi");
}

test("assigning a manager redirects back carrying the chosen shelf, not just the base path", async () => {
  await signInAsSuperAdmin();
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const reader = await makeUser(sql, { fullName: "Bạn đọc mới" });
  await sql`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${shelf.id}, ${reader.id}, 'reader', 'active')
  `;

  const target = await redirectedTo(
    assignManagerAction(form({ "tu-sach": shelf.id, "nguoi-dung": reader.id })),
  );

  // Exactly `?tu-sach=<id>` — a single `?`, no `&loi=` tacked on, since this
  // is the success path. The whole point of carrying the shelf forward:
  // reselecting it is what a second appointment for the same parish would
  // otherwise force.
  expect(target).toBe(`/quan-tri/quan-ly-vien?tu-sach=${shelf.id}`);
  expect(refusalIn(target)).toBeNull();
});

test("a refusal on a target that already carries a query string joins with '&', not a second '?'", async () => {
  await signInAsSuperAdmin();
  const shelf = await makeShelf(sql, { slug: "dong-thap" });

  const target = await redirectedTo(
    updateBookshelfSettingsAction(
      form({
        "tu-sach": shelf.id,
        // QA remediation T27: `?tu-sach=` on `/quan-tri/tu-sach` names a
        // slug now, not this shelf's id — `updateBookshelfSettingsAction`
        // still needs the id (above) to find the row, but redirects using
        // this second field. Omitting it here is exactly the gap that broke
        // this test the day T27 landed: `field(form, "tu-sach-slug")` reads
        // `""` from a `FormData` that never set it, silently.
        "tu-sach-slug": shelf.slug,
        ten: "Tủ sách Đồng Tháp",
        "so-ngay-muon": "-1", // updateBookshelfSettings refuses a negative loan period.
      }),
    ),
  );

  // Before the fix this was `/quan-tri/tu-sach?tu-sach=<id>?loi=validation_failed`
  // — two `?`, and `refusalIn` (the same parse `search-params.ts`'s own
  // `param`/`refusalFrom` do against a real request) finds nothing, because
  // everything after the *first* `?` is one query string and `loi` is buried
  // inside the value of `tu-sach`.
  //
  // `loan_days_out_of_range`, not `validation_failed`: QA remediation
  // Task 15 gave a negative (or otherwise out-of-range) `loanDays` its own
  // code, via `checkPolicyBound` (`src/domain/admin/policy.ts`). This test is
  // about the `?`-joining, not the refusal code, so it only needed updating
  // to keep matching the command's real behaviour.
  //
  // `shelf.slug`, not `shelf.id` (QA remediation T27): the admin shelf list
  // and its editor now resolve `?tu-sach=` against a slug — see
  // `quan-tri/tu-sach/page.tsx`'s own docstring for why.
  expect(target).toBe(
    `/quan-tri/tu-sach?tu-sach=${shelf.slug}&loi=loan_days_out_of_range`,
  );
  expect(refusalIn(target)).toBe("loan_days_out_of_range");
});

test("a refusal on a target with no existing query string still gets exactly one '?'", async () => {
  // The unaffected case, pinned so the fix above cannot regress it: most
  // `back()` callers pass a bare path, and this confirms the ordinary
  // `?loi=` shape is untouched by the `&`-joining branch.
  await signInAsSuperAdmin();
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const reader = await makeUser(sql, { fullName: "Bạn đọc" });
  const [membership] = await sql<{ id: string }[]>`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${shelf.id}, ${reader.id}, 'reader', 'active')
    returning id
  `;
  // Already a reader — `revokeManager` refuses demoting somebody with no
  // manager role to demote (`bookshelves-and-managers.test.ts` pins the
  // identical refusal at the domain layer, "twice is refused").
  const target = await redirectedTo(
    revokeManagerAction(form({ "thanh-vien": membership.id, "tu-sach": shelf.id })),
  );

  expect(target).toBe("/quan-tri/quan-ly-vien?loi=not_permitted");
});

// Task 17 (2026-08-10 QA remediation), carried over from Task 16's review
// round: `updateSiteContactAction` and `updateSystemDefaultsAction` used to
// redirect to `/quan-tri/cai-dat` with no `done` marker at all, saving as
// silently as the three flows Task 16 fixed everywhere else. Both land on the
// identical path, so `back`'s third argument has to be a *value*
// (`"lien-he"`/`"mac-dinh"`), not the bare `?da-luu=1`
// `updateBookshelfSettingsAction` above can afford — see `back`'s own
// docstring for why.
test("saving the contact block redirects with its own done-value, not the bare marker", async () => {
  await signInAsSuperAdmin();

  const target = await redirectedTo(
    updateSiteContactAction(
      form({
        "ten-lien-he": "Thầy Sáu Giuse",
        "dien-thoai": "0900000000",
        "gio-lien-he": "Sau lễ Chúa nhật",
      }),
    ),
  );

  expect(target).toBe("/quan-tri/cai-dat?da-luu=lien-he");
  expect(refusalIn(target)).toBeNull();
});

test("saving the system defaults redirects with its own done-value, distinct from the contact form's", async () => {
  await signInAsSuperAdmin();

  const target = await redirectedTo(
    updateSystemDefaultsAction(
      form({
        "so-ngay-muon": "14",
        "so-sach-cung-luc": "3",
        // QA remediation Task 23: these three joined the three above — see
        // `updateSystemDefaultsAction`'s own comment on why an empty box for
        // any of them (unlike `so-lan-gia-han`, whose floor is 0) now reaches
        // a real refusal rather than a silent default.
        "so-lan-gia-han": "1",
        "so-ngay-gia-han": "7",
        "so-ngay-giu-cho": "2",
        "so-ngay-bao-truoc": "3",
      }),
    ),
  );

  expect(target).toBe("/quan-tri/cai-dat?da-luu=mac-dinh");
});

test("a refusal on either system-settings form still reports through `?loi=`, not `?da-luu=`", async () => {
  await signInAsSuperAdmin();

  // updateSystemDefaults refuses a loan period out of `checkPolicyBound`'s
  // 1–365 range (`src/domain/admin/policy.ts`) — the same family of refusal
  // `updateBookshelfSettingsAction`'s own test above exercises.
  const target = await redirectedTo(
    updateSystemDefaultsAction(
      form({
        "so-ngay-muon": "0",
        "so-sach-cung-luc": "3",
        "so-ngay-giu-cho": "2",
      }),
    ),
  );

  expect(target).toBe("/quan-tri/cai-dat?loi=loan_days_out_of_range");
  expect(target).not.toContain("da-luu");
});

test("contactsFromForm reads three blocks and drops the empty ones", () => {
  const form = new FormData();
  form.set("lien-he-1-ten", "Maria Nguyễn Thị Lan");
  form.set("lien-he-1-sdt", "0912345678");
  form.set("lien-he-1-vai-tro", "Người giữ chìa khoá");
  form.set("lien-he-2-ten", "  ");
  form.set("lien-he-2-sdt", "");
  form.set("lien-he-3-ten", "Giuse Trần Minh");
  form.set("lien-he-3-sdt", "0987654321");

  expect(contactsFromForm(form)).toEqual([
    {
      position: 1,
      name: "Maria Nguyễn Thị Lan",
      phone: "0912345678",
      roleLabel: "Người giữ chìa khoá",
    },
    // Block 3's contact keeps position 3. Renumbering it to 2 would silently
    // move a volunteer a super admin deliberately left in the third slot.
    { position: 3, name: "Giuse Trần Minh", phone: "0987654321", roleLabel: null },
  ]);
});

test("contactsFromForm reads a present-but-empty phone as null, not an empty string", () => {
  // A block that survives (has a name) but whose phone box was submitted
  // empty — distinct from block 2 in the test above, which is dropped
  // entirely because its *name* is blank. `optional()` already turns `""`
  // into `null`; this pins that `contactsFromForm` does not undo it, because
  // an empty string in the `phone` column renders a `PhoneLink` that dials
  // nothing rather than showing no phone at all.
  const form = new FormData();
  form.set("lien-he-1-ten", "Maria Nguyễn Thị Lan");
  form.set("lien-he-1-sdt", "");
  form.set("lien-he-1-vai-tro", "Người giữ chìa khoá");

  expect(contactsFromForm(form)).toEqual([
    {
      position: 1,
      name: "Maria Nguyễn Thị Lan",
      phone: null,
      roleLabel: "Người giữ chìa khoá",
    },
  ]);
});
