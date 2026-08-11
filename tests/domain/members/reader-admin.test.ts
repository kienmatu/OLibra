import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { hashPassword } from "../../../src/auth/password";
import { landingShelfFor } from "../../../src/auth/guards";
import { signIn } from "../../../src/auth/session";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { migrate } from "../../../src/db/migrate";
import { SESSION_COOKIE } from "../../../src/lib/session-cookie";
import { makeMember, makePerson, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";
import { testDatabaseUrl } from "../../support/env";

/**
 * The five reader-administration server actions (Task 4, QA remediation) —
 * `setReaderCredentialsAction`, `suspendMembershipAction`,
 * `reactivateMembershipAction`, `markMembershipLeftAction`,
 * `updateReaderProfileAction` — in `src/app/tu-sach/[shelf]/quan-ly/actions.ts`.
 *
 * **What this file is for, and what it deliberately is not for.** Every one
 * of the five domain commands behind these actions already has thorough,
 * direct coverage — `credentials.test.ts`, `membership-lifecycle.test.ts`,
 * `update-reader-profile.test.ts` — including every refusal each command can
 * raise on its own terms. Re-proving `not_active_cannot_suspend` or
 * `empty_proposal` at the command level here would be a second copy of a
 * fact those files already hold. What is new with Task 4, and what nothing
 * else exercises, is the *wiring*: FormData in, a redirect with `?loi=` or a
 * successful trip back to the reader's own page out — the same distinction
 * `tests/lib/lending-actions.test.ts` exists for on the circulation actions,
 * and this file follows its shape for exactly that reason, run against a
 * real database rather than a mocked `runCommand`.
 *
 * Two things are genuinely new here rather than restated: the "Đặt lại mật
 * khẩu" disclosure's silent username round-trip (the UI never shows a
 * username box for a reset, yet `setReaderCredentials` needs one — see
 * `nguoi-doc/[id]/page.tsx`'s `CredentialsDisclosure`), and
 * `suspension_reason_required` — a refusal this *screen* invents because
 * `suspendMembership` itself treats the reason as optional.
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
  setReaderCredentialsAction,
  suspendMembershipAction,
  reactivateMembershipAction,
  markMembershipLeftAction,
  updateReaderProfileAction,
} = await import("../../../src/app/tu-sach/[shelf]/quan-ly/actions");
const { pool } = await import("../../../src/db/client");

const clock = fixedClock("2026-08-10T03:00:00Z");

let previousUrl: string | undefined;

beforeAll(async () => {
  // Same trade as `lending-actions.test.ts`: the seam reaches Postgres
  // through `pool()`, which reads `DATABASE_URL`, so the suite points that at
  // its own database rather than giving the seam a parameter production
  // would never pass.
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

async function signInAs(bookshelfId: string, role: string, username: string) {
  const [user] = await sql<{ id: string }[]>`
    insert into users (full_name, father_name, mother_name, phone, username, password_hash)
    values ('Maria Nguyễn Thị Lan', 'A', 'B', '0900000001', ${username},
            ${await hashPassword("x")})
    returning id
  `;
  await sql`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${bookshelfId}, ${user.id}, ${role}, 'active')
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

/** Where a `redirect()` aimed, query string and all — see `lending-actions.test.ts` for the full reasoning behind reading the digest rather than mocking `redirect`. */
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

async function shelfWithManager() {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await signInAs(shelf.id, "manager", "lan.nguyen");
  return { shelf, manager };
}

async function userRow(userId: string) {
  const [row] = await sql<
    { username: string | null; password_hash: string | null }[]
  >`select username, password_hash from users where id = ${userId}`;
  return row;
}

test("granting a login lets a reader with none sign in and land on their own shelf", async () => {
  const { shelf } = await shelfWithManager();
  const reader = await makeMember(sql, shelf.id, { status: "active" });

  const target = await redirectedTo(
    setReaderCredentialsAction(
      form({
        "tu-sach": "dong-thap",
        "thanh-vien": reader.id,
        "ten-dang-nhap": "minh.tran",
        "mat-khau": "matkhau123",
      }),
    ),
  );

  expect(target).toBe(`/tu-sach/dong-thap/quan-ly/nguoi-doc/${reader.id}`);

  const row = await userRow(reader.userId);
  expect(row.username).toBe("minh.tran");
  expect(row.password_hash).not.toBeNull();

  // The end-to-end claim the brief's own manual check makes: the reader can
  // now actually sign in, and lands on this one shelf.
  const { userId } = await signIn(sql, {
    username: "minh.tran",
    password: "matkhau123",
    clock,
  });
  expect(userId).toBe(reader.userId);
  expect(await landingShelfFor(sql, userId)).toBe("dong-thap");
});

test("a username already taken by someone else comes back as the catalogue's sentence, not a raw 23505", async () => {
  const { shelf } = await shelfWithManager();
  const first = await makeMember(sql, shelf.id, { status: "active" });
  const second = await makeMember(sql, shelf.id, { status: "active" });

  await redirectedTo(
    setReaderCredentialsAction(
      form({
        "tu-sach": "dong-thap",
        "thanh-vien": first.id,
        "ten-dang-nhap": "an.nguyen",
        "mat-khau": "matkhau123",
      }),
    ),
  );

  // Case-insensitively, matching `users_username_unique_ci`.
  const target = await redirectedTo(
    setReaderCredentialsAction(
      form({
        "tu-sach": "dong-thap",
        "thanh-vien": second.id,
        "ten-dang-nhap": "AN.NGUYEN",
        "mat-khau": "matkhau456",
      }),
    ),
  );

  expect(target.split("?")[0]).toBe(
    `/tu-sach/dong-thap/quan-ly/nguoi-doc/${second.id}`,
  );
  expect(refusalIn(target)).toBe("username_in_use");
  const row = await userRow(second.userId);
  expect(row.username).toBeNull();
});

test("resetting a password keeps the username unchanged and ends every existing session", async () => {
  const { shelf } = await shelfWithManager();
  const reader = await makeMember(sql, shelf.id, { status: "active" });
  await redirectedTo(
    setReaderCredentialsAction(
      form({
        "tu-sach": "dong-thap",
        "thanh-vien": reader.id,
        "ten-dang-nhap": "minh.tran",
        "mat-khau": "matkhau123",
      }),
    ),
  );
  await signIn(sql, { username: "minh.tran", password: "matkhau123", clock });
  expect(
    await sql`select 1 from sessions where user_id = ${reader.userId}`,
  ).toHaveLength(1);

  // The "Đặt lại mật khẩu" disclosure shows the manager only a password box —
  // `reader.username` travels as a hidden field, exactly as this test posts it.
  await redirectedTo(
    setReaderCredentialsAction(
      form({
        "tu-sach": "dong-thap",
        "thanh-vien": reader.id,
        "ten-dang-nhap": "minh.tran",
        "mat-khau": "matkhaumoi789",
      }),
    ),
  );

  const row = await userRow(reader.userId);
  expect(row.username).toBe("minh.tran");
  // BR §2's revocability argument, from the action's own caller: the old
  // session is gone, in the same request that changed the password.
  expect(
    await sql`select 1 from sessions where user_id = ${reader.userId}`,
  ).toHaveLength(0);

  await expect(
    signIn(sql, { username: "minh.tran", password: "matkhaumoi789", clock }),
  ).resolves.toMatchObject({ userId: reader.userId });
});

test("suspending with no reason is refused by this screen, before the domain ever sees it", async () => {
  const { shelf } = await shelfWithManager();
  const reader = await makeMember(sql, shelf.id, { status: "active" });

  const target = await redirectedTo(
    suspendMembershipAction(
      form({ "tu-sach": "dong-thap", "thanh-vien": reader.id, "ly-do": "" }),
    ),
  );

  expect(refusalIn(target)).toBe("suspension_reason_required");
  const [row] = await sql<{ status: string }[]>`
    select status from memberships where id = ${reader.id}
  `;
  expect(row.status).toBe("active");
});

test("suspending with a reason records it, and the reader can still authenticate but no longer lands on this shelf", async () => {
  // BR §2/INV-4: suspension blocks *borrowing*, not signing in — the password
  // hash is untouched by this command. What actually changes for a suspended
  // reader who still knows their password is `landingShelfFor`
  // (`tests/auth/guards.test.ts` pins the same fact directly): their one
  // membership is no longer `active`, so `signIn` still succeeds but they no
  // longer land on this shelf. Pinned here because the brief for this task's
  // manual verification describes it more strongly, as "sign-in refused" —
  // this is the actual, narrower shape, and it is `src/auth/session.ts`'s
  // behaviour rather than anything this task's files control.
  const { shelf } = await shelfWithManager();
  const reader = await makeMember(sql, shelf.id, { status: "active" });
  await redirectedTo(
    setReaderCredentialsAction(
      form({
        "tu-sach": "dong-thap",
        "thanh-vien": reader.id,
        "ten-dang-nhap": "minh.tran",
        "mat-khau": "matkhau123",
      }),
    ),
  );

  const target = await redirectedTo(
    suspendMembershipAction(
      form({
        "tu-sach": "dong-thap",
        "thanh-vien": reader.id,
        "ly-do": "Gia đình xin tạm dừng một thời gian",
      }),
    ),
  );

  expect(target).toBe(`/tu-sach/dong-thap/quan-ly/nguoi-doc/${reader.id}`);
  const [row] = await sql<{ status: string; suspension_reason: string }[]>`
    select status, suspension_reason from memberships where id = ${reader.id}
  `;
  expect(row.status).toBe("suspended");
  expect(row.suspension_reason).toBe("Gia đình xin tạm dừng một thời gian");

  const { userId } = await signIn(sql, {
    username: "minh.tran",
    password: "matkhau123",
    clock,
  });
  expect(await landingShelfFor(sql, userId)).toBeNull();
});

test("reactivating clears the suspension reason and status together", async () => {
  const { shelf } = await shelfWithManager();
  const reader = await makeMember(sql, shelf.id, { status: "suspended" });
  await sql`update memberships set suspension_reason = 'cũ' where id = ${reader.id}`;

  const target = await redirectedTo(
    reactivateMembershipAction(
      form({ "tu-sach": "dong-thap", "thanh-vien": reader.id }),
    ),
  );

  expect(target).toBe(`/tu-sach/dong-thap/quan-ly/nguoi-doc/${reader.id}`);
  const [row] = await sql<{ status: string; suspension_reason: string | null }[]>`
    select status, suspension_reason from memberships where id = ${reader.id}
  `;
  expect(row.status).toBe("active");
  expect(row.suspension_reason).toBeNull();
});

test("marking a reader left is blocked while a book is still out, and succeeds once it is not", async () => {
  const { shelf } = await shelfWithManager();
  const reader = await makeMember(sql, shelf.id, { status: "active" });
  const [book] = await sql<{ id: string }[]>`
    insert into books (bookshelf_id, title, author, slug, is_published)
    values (${shelf.id}, 'Dế Mèn Phiêu Lưu Ký', 'Tô Hoài', 'de-men', true)
    returning id
  `;
  const [copy] = await sql<{ id: string }[]>`
    insert into book_copies (bookshelf_id, book_id, code, state, condition)
    values (${shelf.id}, ${book.id}, 'DT-0001', 'on_loan', 'perfect')
    returning id
  `;
  await sql`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status)
    values (${shelf.id}, ${copy.id}, ${book.id}, ${reader.userId}, ${reader.userId}, '2026-08-24', 'active')
  `;

  const blocked = await redirectedTo(
    markMembershipLeftAction(
      form({ "tu-sach": "dong-thap", "thanh-vien": reader.id }),
    ),
  );
  expect(refusalIn(blocked)).toBe("member_has_active_loans");

  await sql`
    update loans set status = 'returned', return_condition = 'perfect'
    where copy_id = ${copy.id}
  `;

  const target = await redirectedTo(
    markMembershipLeftAction(
      form({ "tu-sach": "dong-thap", "thanh-vien": reader.id }),
    ),
  );
  expect(target).toBe(`/tu-sach/dong-thap/quan-ly/nguoi-doc/${reader.id}`);
  const [row] = await sql<{ status: string }[]>`
    select status from memberships where id = ${reader.id}
  `;
  expect(row.status).toBe("left");
});

test("correcting a reader's profile writes the change, and resubmitting unchanged is refused", async () => {
  const { shelf } = await shelfWithManager();
  const person = await makePerson(sql, { fullName: "Giuse Trần Minh" });
  const [membership] = await sql<{ id: string }[]>`
    insert into memberships (bookshelf_id, user_id, status)
    values (${shelf.id}, ${person.id}, 'active')
    returning id
  `;

  const fields = {
    "tu-sach": "dong-thap",
    "thanh-vien": membership.id,
    "ten-thanh": "",
    "ho-ten": "Giuse Trần Minh",
    "ngay-sinh": "2015-04-02",
    "ten-cha": "Giuse Trần Văn A",
    "ten-me": "Maria Nguyễn Thị B",
    "dien-thoai": "0912345678",
    email: "",
  };

  const target = await redirectedTo(updateReaderProfileAction(form(fields)));
  expect(target).toBe(`/tu-sach/dong-thap/quan-ly/nguoi-doc/${membership.id}`);
  const [row] = await sql<{ phone: string | null }[]>`
    select phone from users where id = ${person.id}
  `;
  expect(row.phone).toBe("0912345678");

  // Same seven values a second time — nothing differs from what is now on
  // file, so `updateReaderProfile` itself refuses with `empty_proposal`.
  const again = await redirectedTo(updateReaderProfileAction(form(fields)));
  expect(refusalIn(again)).toBe("empty_proposal");
});

test("a reader posting to a reader-administration action is refused by code, not a 404", async () => {
  // U1 §3.4 draws the 404/refusal line at *pages*; an action is the other
  // side of it — see `lending-actions.test.ts`'s identical test for the full
  // reasoning. `suspendMembershipAction` stands in for all five here: every
  // one of them opens the same `requireManager` gate and would behave
  // identically.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const reader = await makeMember(sql, shelf.id, { status: "active" });
  await signInAs(shelf.id, "reader", "ban.doc");

  const target = await redirectedTo(
    suspendMembershipAction(
      form({ "tu-sach": "dong-thap", "thanh-vien": reader.id, "ly-do": "vì" }),
    ),
  );

  expect(refusalIn(target)).toBe("not_permitted");
  const [row] = await sql<{ status: string }[]>`
    select status from memberships where id = ${reader.id}
  `;
  expect(row.status).toBe("active");
});

test("an incomplete form is a refusal in words, not a 22P02", async () => {
  await shelfWithManager();

  const target = await redirectedTo(
    reactivateMembershipAction(form({ "tu-sach": "dong-thap", "thanh-vien": "" })),
  );

  expect(target.split("?")[0]).toBe("/tu-sach/dong-thap/quan-ly/nguoi-doc/");
  expect(refusalIn(target)).toBe("validation_failed");
});
