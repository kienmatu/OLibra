import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { hashPassword, verifyPassword } from "../../src/auth/password";
import { signIn } from "../../src/auth/session";
import { fixedClock } from "../../src/domain/kernel/clock";
import {
  setPasswordHasher,
  setPasswordVerifier,
} from "../../src/domain/kernel/crypto";
import { runCommand } from "../../src/domain/kernel/unit-of-work";
import { proposeProfileChange } from "../../src/domain/members/commands/propose-profile-change";
import { migrate } from "../../src/db/migrate";
import { SESSION_COOKIE } from "../../src/lib/session-cookie";
import { makeBookWithCopies, makeMember, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";
import { testDatabaseUrl } from "../support/env";

/**
 * U3 wave 2's eight server actions, against a real database.
 *
 * **What this file is for is the same distinction `lending-actions.test.ts`
 * exists for**, plus the two questions that are specific to this wave:
 *
 * 1. **Which command each screen posts to.** `quan-ly/nguoi-doc/moi` is the one
 *    the plan named wrongly, and the three candidates differ only in what they
 *    write — a page pointed at `managerRegisterReader` instead would render
 *    identically, redirect identically, and silently skip the approval step BR
 *    §4's assumption 3 makes the consent for holding a minor's data. Nothing but
 *    a row assertion catches that.
 * 2. **That a missing reason is a sentence and not a fault.** Four of these
 *    commands raise `ValidationFailed` for a blank reason, which `attempt` does
 *    not catch. The actions check their own field for exactly that reason, and
 *    deleting the check turns a volunteer's empty textarea into an HTTP 500.
 */

/**
 * `cookies()` is the only thing here with no meaning outside a request.
 * `redirect()` is deliberately *not* mocked — see `redirectedTo` below.
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
  approveMembershipAction,
  rejectMembershipAction,
  approveProfileChangeAction,
  rejectProfileChangeAction,
  createBookAction,
  registerReaderOnBehalfAction,
  markCopyFoundAction,
  retireCopyAction,
  pinAnnouncementAction,
  unpinAnnouncementAction,
} = await import("../../src/app/tu-sach/[shelf]/quan-ly/actions");
const { pool } = await import("../../src/db/client");

const clock = fixedClock("2026-08-09T03:00:00Z");

let previousUrl: string | undefined;

beforeAll(async () => {
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  delete (globalThis as { [k: symbol]: unknown })[Symbol.for("olibra.db.pool")];
  // The registration path reaches `findExistingPerson`, which calls the injected
  // verifier whenever a username is supplied. Wired here the way every other
  // members test wires it — and the fact that the *application* wires neither is
  // exactly why `quan-ly/nguoi-doc/moi` ships no credentials fields; that page's
  // docstring holds the argument.
  setPasswordHasher(hashPassword);
  setPasswordVerifier(verifyPassword);
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
    insert into users (saint_name, full_name, father_name, mother_name, phone, username, password_hash)
    values ('Maria', 'Maria Nguyễn Thị Lan', 'A', 'B', '0900000001', ${username},
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

/**
 * Where a `redirect()` aimed, query string and all — read off the digest Next.js
 * actually throws, for `lending-actions.test.ts`' stated reason: a test that
 * mocked `redirect` would pass against an action that never redirected.
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

async function shelfWithManager() {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await signInAs(shelf.id, "manager", "lan.nguyen");
  return { shelf, manager };
}

/**
 * One row of the global `categories` table.
 *
 * `resetDatabase` truncates it with everything else, and DATABASE.md §4.3's
 * fixed list is written by `src/db/seed.ts` rather than by a migration — so a
 * test about `CreateBook` has to supply the category it names, exactly as it
 * supplies the shelf.
 */
async function makeCategory(
  slug = "van-hoc-thieu-nhi",
  name = "Văn học thiếu nhi",
) {
  await sql`
    insert into categories (name, slug, sort_order) values (${name}, ${slug}, 1)
    on conflict (slug) do nothing
  `;
  return slug;
}

async function statusOf(membershipId: string) {
  const [row] = await sql<
    {
      status: string;
      approved_by: string | null;
      rejection_reason: string | null;
    }[]
  >`
    select status, approved_by, rejection_reason
    from memberships where id = ${membershipId}
  `;
  return row;
}

// — the registration queue —

test("approving a registration activates it and names the manager who did", async () => {
  const { shelf, manager } = await shelfWithManager();
  const applicant = await makeMember(sql, shelf.id, { status: "pending" });

  const target = await redirectedTo(
    approveMembershipAction(
      form({ "tu-sach": "dong-thap", "thanh-vien": applicant.id }),
    ),
  );

  expect(target).toBe("/tu-sach/dong-thap/quan-ly/dang-ky-cho-duyet");
  const row = await statusOf(applicant.id);
  expect(row.status).toBe("active");
  // BR §4's assumption 3: the approving manager is on the row, not only in the
  // audit log, so an active membership never looks as though it approved itself.
  expect(row.approved_by).toBe(manager.userId);
});

test("approving an already-decided application is a sentence, not a crash", async () => {
  const { shelf } = await shelfWithManager();
  const member = await makeMember(sql, shelf.id, { status: "active" });

  const target = await redirectedTo(
    approveMembershipAction(
      form({ "tu-sach": "dong-thap", "thanh-vien": member.id }),
    ),
  );

  // `registration_not_pending` — "Đơn đăng ký này đã được xử lý." The second tap
  // on a card two managers were both looking at.
  expect(refusalIn(target)).toBe("registration_not_pending");
});

test("rejecting with no reason is a refusal in words, not a ValidationFailed", async () => {
  // `rejectMembership` raises `ValidationFailed("reject_reason_required")` for a
  // blank reason, and `attempt` catches only `RuleViolated` — so without the
  // action's own check this is an uncaught `DomainError` and an HTTP 500 for a
  // volunteer who left a textarea empty. Deleting the check in
  // `rejectMembershipAction` turns this test red rather than turning it green
  // by another route.
  const { shelf } = await shelfWithManager();
  const applicant = await makeMember(sql, shelf.id, { status: "pending" });

  const target = await redirectedTo(
    rejectMembershipAction(
      form({ "tu-sach": "dong-thap", "thanh-vien": applicant.id, "ly-do": "   " }),
    ),
  );

  expect(refusalIn(target)).toBe("reject_reason_required");
  // And nothing moved.
  expect((await statusOf(applicant.id)).status).toBe("pending");
});

test("rejecting with a reason keeps the row, with the reason on it", async () => {
  // BR §2: nothing is deleted, and the reason is retained so the person may
  // re-apply. G10.
  const { shelf } = await shelfWithManager();
  const applicant = await makeMember(sql, shelf.id, { status: "pending" });

  await redirectedTo(
    rejectMembershipAction(
      form({
        "tu-sach": "dong-thap",
        "thanh-vien": applicant.id,
        "ly-do": "Gia đình đã chuyển sang giáo xứ khác",
      }),
    ),
  );

  const row = await statusOf(applicant.id);
  expect(row.status).toBe("rejected");
  expect(row.rejection_reason).toBe("Gia đình đã chuyển sang giáo xứ khác");
});

test("a reader posting to a manager action is refused by code, not by a 404", async () => {
  // U1 §3.4 and `submitCommand`'s own docstring: `loadPage` turns
  // `not_permitted` into a 404 because a *page* has to decide what a reader who
  // typed a manager URL sees. An action does not — the refusal comes back as the
  // sentence "Bạn không có quyền thực hiện việc này."
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const applicant = await makeMember(sql, shelf.id, { status: "pending" });
  await signInAs(shelf.id, "reader", "minh.tran");

  const target = await redirectedTo(
    approveMembershipAction(
      form({ "tu-sach": "dong-thap", "thanh-vien": applicant.id }),
    ),
  );

  expect(refusalIn(target)).toBe("not_permitted");
  expect((await statusOf(applicant.id)).status).toBe("pending");
});

// — the profile-change queue —

async function pendingChange(bookshelfId: string) {
  const reader = await makeMember(sql, bookshelfId);
  const ctx = {
    bookshelfId,
    actor: {
      userId: reader.userId,
      membershipId: reader.id,
      role: "reader" as const,
    },
    clock,
  };
  await runCommand(sql, ctx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0912345999" },
  });
  const [row] = await sql<{ id: string }[]>`
    select id from profile_change_requests where user_id = ${reader.userId}
  `;
  return { reader, requestId: row.id };
}

test("approving a profile change writes the value onto the person", async () => {
  // BR §7.4's diagram: `pending ──► approved (values written to the person)`.
  // The assertion is on `users`, not on the request's status, because the whole
  // point of the queue is that the proposal takes effect — a command that only
  // moved the request row would satisfy a status assertion perfectly.
  const { shelf } = await shelfWithManager();
  const { reader, requestId } = await pendingChange(shelf.id);

  const target = await redirectedTo(
    approveProfileChangeAction(
      form({ "tu-sach": "dong-thap", "yeu-cau": requestId }),
    ),
  );

  expect(target).toBe("/tu-sach/dong-thap/quan-ly/doi-thong-tin");
  const [person] = await sql<{ phone: string }[]>`
    select phone from users where id = ${reader.userId}
  `;
  expect(person.phone).toBe("0912345999");
  const [request] = await sql<{ status: string }[]>`
    select status from profile_change_requests where id = ${requestId}
  `;
  expect(request.status).toBe("approved");
});

test("rejecting a profile change leaves the person untouched", async () => {
  // "There was never anything to undo, because `ProposeProfileChange` never
  // wrote them" — the existing value is still the one in force, which is what
  // the card promises beneath every row.
  const { shelf } = await shelfWithManager();
  const { reader, requestId } = await pendingChange(shelf.id);
  const [before] = await sql<{ phone: string }[]>`
    select phone from users where id = ${reader.userId}
  `;

  await redirectedTo(
    rejectProfileChangeAction(
      form({
        "tu-sach": "dong-thap",
        "yeu-cau": requestId,
        "ly-do": "Cần xác minh lại với gia đình",
      }),
    ),
  );

  const [after] = await sql<{ phone: string }[]>`
    select phone from users where id = ${reader.userId}
  `;
  expect(after.phone).toBe(before.phone);
  const [request] = await sql<{ status: string; rejection_reason: string }[]>`
    select status, rejection_reason from profile_change_requests where id = ${requestId}
  `;
  expect(request.status).toBe("rejected");
  expect(request.rejection_reason).toBe("Cần xác minh lại với gia đình");
});

test("rejecting a profile change with no reason is a sentence too", async () => {
  const { shelf } = await shelfWithManager();
  const { requestId } = await pendingChange(shelf.id);

  const target = await redirectedTo(
    rejectProfileChangeAction(
      form({ "tu-sach": "dong-thap", "yeu-cau": requestId, "ly-do": "" }),
    ),
  );

  expect(refusalIn(target)).toBe("reject_reason_required");
});

// — registering on behalf —

test("the on-behalf form creates a pending application, never an active member", async () => {
  // **The decision this wave had to make, asserted as a row.** The plan named
  // `RegisterMembership`, which is the guest's own registration and has no
  // manager gate. Of the two on-behalf commands, BR §16.1 chooses this one:
  // "registering on behalf still creates a pending application rather than an
  // active member, so the approval step and its audit record are never skipped."
  //
  // A page pointed at `managerRegisterReader` instead renders identically and
  // redirects identically. `status` is the only thing that tells them apart, and
  // getting it wrong would skip the consent step BR §4's assumption 3 describes
  // — for a child's record, silently.
  const { shelf } = await shelfWithManager();

  const target = await redirectedTo(
    registerReaderOnBehalfAction(
      form({
        "tu-sach": "dong-thap",
        "ten-thanh": "Maria",
        "ho-ten": "Nguyễn Thị Lan",
        "ngay-sinh": "2015-05-12",
        "ten-cha": "Giuse Nguyễn Văn Hoà",
        "ten-me": "Anna Trần Thị Mai",
        "dien-thoai": "0912345678",
      }),
    ),
  );

  expect(target).toBe("/tu-sach/dong-thap/quan-ly/dang-ky-cho-duyet");
  const [row] = await sql<{ status: string; approved_by: string | null }[]>`
    select m.status, m.approved_by
    from memberships m
    join users u on u.id = m.user_id
    where m.bookshelf_id = ${shelf.id} and u.full_name = 'Nguyễn Thị Lan'
  `;
  expect(row.status).toBe("pending");
  // And nobody approved it, because nobody has.
  expect(row.approved_by).toBeNull();
});

test("a date a volunteer typed the Vietnamese way is a sentence, not a wrong birthday", async () => {
  // `assertStorableDate`'s measured cases: '02/04/2015' stores 2015-02-03
  // through this driver, and 'hôm qua' comes back a RangeError. This form posts
  // `type="date"`, so the shape is `YYYY-MM-DD` — but the action is reachable
  // without the form, and `ValidationFailed` here is a volunteer's own mistake
  // rather than a fault, which is why this action catches it at all.
  const { shelf } = await shelfWithManager();

  const target = await redirectedTo(
    registerReaderOnBehalfAction(
      form({
        "tu-sach": "dong-thap",
        "ten-thanh": "Maria",
        "ho-ten": "Nguyễn Thị Lan",
        "ngay-sinh": "02/04/2015",
        "ten-cha": "Giuse Nguyễn Văn Hoà",
        "ten-me": "Anna Trần Thị Mai",
        "dien-thoai": "0912345678",
      }),
    ),
  );

  expect(refusalIn(target)).toBe("validation_failed");
  const [{ count }] = await sql<{ count: string }[]>`
    select count(*) from memberships where bookshelf_id = ${shelf.id} and status = 'pending'
  `;
  expect(Number(count)).toBe(0);
});

test("a parish unit from another shelf is refused, not written", async () => {
  // The parish rule is checked in the same transaction as the write and not by a
  // constraint (OPS §4.3, verified live: the composite FK proves the unit is on
  // this shelf and nothing more). A hand-edited `<select>` posting a stranger's
  // unit id is the shape this refuses.
  const { shelf } = await shelfWithManager();
  const other = await makeShelf(sql, { slug: "vinh-long" });
  const [unit] = await sql<{ id: string }[]>`
    insert into parish_units (bookshelf_id, level, name, sort_order)
    values (${other.id}, 1, 'Giáo họ Thánh Tâm', 1)
    returning id
  `;

  const target = await redirectedTo(
    registerReaderOnBehalfAction(
      form({
        "tu-sach": "dong-thap",
        "ten-thanh": "Maria",
        "ho-ten": "Nguyễn Thị Lan",
        "ngay-sinh": "2015-05-12",
        "ten-cha": "Giuse Nguyễn Văn Hoà",
        "ten-me": "Anna Trần Thị Mai",
        "dien-thoai": "0912345678",
        parishUnitL1Id: unit.id,
      }),
    ),
  );

  expect(refusalIn(target)).toBe("parish_unit_l1_not_found");
  const [{ count }] = await sql<{ count: string }[]>`
    select count(*) from memberships where bookshelf_id = ${shelf.id} and status = 'pending'
  `;
  expect(Number(count)).toBe(0);
});

// — the catalogue —

test("creating a book writes the title and its copies, and lands on the list", async () => {
  const { shelf } = await shelfWithManager();
  await makeCategory();

  const target = await redirectedTo(
    createBookAction(
      form({
        "tu-sach": "dong-thap",
        "ten-sach": "Dế Mèn Phiêu Lưu Ký",
        "tac-gia": "Tô Hoài",
        "the-loai": "van-hoc-thieu-nhi",
        "so-ban": "3",
        "hien-thi": "on",
      }),
    ),
  );

  expect(target).toBe("/tu-sach/dong-thap/quan-ly/sach");
  const [book] = await sql<{ id: string; slug: string; is_published: boolean }[]>`
    select id, slug, is_published from books where bookshelf_id = ${shelf.id}
  `;
  expect(book.slug).toBe("de-men-phieu-luu-ky");
  expect(book.is_published).toBe(true);
  const copies = await sql<{ code: string }[]>`
    select code from book_copies where book_id = ${book.id} order by code
  `;
  expect(copies).toHaveLength(3);
});

test("an unchecked visibility box creates a draft, not a published title", async () => {
  // An unchecked checkbox posts nothing at all — `form.get("hien-thi") !== null`
  // is what makes that mean `is_published = false` rather than "the field was
  // omitted, so default to true", which is what `input.published ?? true` inside
  // the command would otherwise do.
  const { shelf } = await shelfWithManager();
  await makeCategory();

  await redirectedTo(
    createBookAction(
      form({
        "tu-sach": "dong-thap",
        "ten-sach": "Hoàng Tử Bé",
        "tac-gia": "Antoine de Saint-Exupéry",
        "the-loai": "van-hoc-thieu-nhi",
        "so-ban": "1",
      }),
    ),
  );

  const [book] = await sql<{ is_published: boolean }[]>`
    select is_published from books where bookshelf_id = ${shelf.id}
  `;
  expect(book.is_published).toBe(false);
});

test("a copy count that is not a number is the command's own sentence", async () => {
  const { shelf } = await shelfWithManager();
  await makeCategory();

  const target = await redirectedTo(
    createBookAction(
      form({
        "tu-sach": "dong-thap",
        "ten-sach": "Hoàng Tử Bé",
        "tac-gia": "Antoine de Saint-Exupéry",
        "the-loai": "van-hoc-thieu-nhi",
        "so-ban": "ba cuốn",
      }),
    ),
  );

  expect(refusalIn(target)).toBe("copy_count_invalid");
  const [{ count }] = await sql<{ count: string }[]>`
    select count(*) from books where bookshelf_id = ${shelf.id}
  `;
  expect(Number(count)).toBe(0);
});

test("a category that names nothing is a sentence, and no half-created book", async () => {
  const { shelf } = await shelfWithManager();

  const target = await redirectedTo(
    createBookAction(
      form({
        "tu-sach": "dong-thap",
        "ten-sach": "Hoàng Tử Bé",
        "tac-gia": "Antoine de Saint-Exupéry",
        "the-loai": "khong-co-the-loai-nay",
        "so-ban": "1",
      }),
    ),
  );

  expect(refusalIn(target)).toBe("category_not_found");
  const [{ count }] = await sql<{ count: string }[]>`
    select count(*) from books where bookshelf_id = ${shelf.id}
  `;
  expect(Number(count)).toBe(0);
});

// — the lost-copies screen, and the two exits BR §7.1 draws out of `lost` —

async function lostCopyOn(bookshelfId: string) {
  const { copyIds } = await makeBookWithCopies(sql, bookshelfId, 1);
  await sql`update book_copies set state = 'lost' where id = ${copyIds[0]}`;
  return copyIds[0];
}

test("marking a copy found puts it back on the shelf", async () => {
  // BR:559's whole reason for this screen, as written: "Báo mất" appears in
  // three places in the built interface, and marking a copy found appears in
  // none of them.
  const { shelf } = await shelfWithManager();
  const copyId = await lostCopyOn(shelf.id);

  const target = await redirectedTo(
    markCopyFoundAction(form({ "tu-sach": "dong-thap", ban: copyId })),
  );

  expect(target).toBe("/tu-sach/dong-thap/quan-ly/sach/mat");
  const [copy] = await sql<{ state: string; lost_reported_at: Date | null }[]>`
    select state, lost_reported_at from book_copies where id = ${copyId}
  `;
  expect(copy.state).toBe("available");
  expect(copy.lost_reported_at).toBeNull();
});

test("marking a copy found twice is a sentence, not a crash", async () => {
  const { shelf } = await shelfWithManager();
  const copyId = await lostCopyOn(shelf.id);
  await redirectedTo(
    markCopyFoundAction(form({ "tu-sach": "dong-thap", ban: copyId })),
  );

  const target = await redirectedTo(
    markCopyFoundAction(form({ "tu-sach": "dong-thap", ban: copyId })),
  );

  // "Bản sách này hiện không ở trạng thái đã mất." — two volunteers on the same
  // list, or one double tap.
  expect(refusalIn(target)).toBe("not_lost");
});

test("retiring a copy needs a reason, and the reason is not huỷ's", async () => {
  // `retire_reason_required`, not `reason_required`: *huỷ* is cancelling
  // something, not taking a book off the shelf for good. The command raises it
  // as a `ValidationFailed`, which `attempt` does not catch — so the action's own
  // check is what makes an empty box a sentence rather than a 500.
  const { shelf } = await shelfWithManager();
  const copyId = await lostCopyOn(shelf.id);

  const target = await redirectedTo(
    retireCopyAction(form({ "tu-sach": "dong-thap", ban: copyId, "ly-do": " " })),
  );

  expect(refusalIn(target)).toBe("retire_reason_required");
  const [copy] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${copyId}
  `;
  expect(copy.state).toBe("lost");
});

test("retiring a copy with a reason withdraws it for good", async () => {
  const { shelf } = await shelfWithManager();
  const copyId = await lostCopyOn(shelf.id);

  await redirectedTo(
    retireCopyAction(
      form({
        "tu-sach": "dong-thap",
        ban: copyId,
        "ly-do": "Gia đình đã chuyển đi, sách không quay lại",
      }),
    ),
  );

  const [copy] = await sql<{ state: string; retired_reason: string }[]>`
    select state, retired_reason from book_copies where id = ${copyId}
  `;
  expect(copy.state).toBe("retired");
  expect(copy.retired_reason).toBe("Gia đình đã chuyển đi, sách không quay lại");
});

// — faults stay faults —

test("a fault is not swallowed into a friendly refusal", async () => {
  // U1 §3.3, restated for this file's two *wider* catches. `attemptTyped`
  // catches `ValidationFailed` as well as `RuleViolated`, which is a real
  // widening — so it has to be shown that it did not become "catch everything".
  // A malformed uuid reaches Postgres as a failed cast and comes back `22P02`,
  // which is a `PostgresError` and not a `DomainError`: it must propagate.
  await shelfWithManager();
  await makeCategory();

  await expect(
    createBookAction(
      form({
        "tu-sach": "dong-thap",
        "ten-sach": "Hoàng Tử Bé",
        "tac-gia": "Antoine de Saint-Exupéry",
        "the-loai": "van-hoc-thieu-nhi",
        "so-ban": "1",
        donorMembershipId: "khong-phai-uuid",
      }),
    ),
  ).rejects.toMatchObject({ code: "22P02" });
});

test("a post to a shelf that does not exist is a 404, not a refusal", async () => {
  const { shelf } = await shelfWithManager();
  const applicant = await makeMember(sql, shelf.id, { status: "pending" });

  await expect(
    approveMembershipAction(
      form({ "tu-sach": "khong-co-tu-sach-nay", "thanh-vien": applicant.id }),
    ),
  ).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
});

test("a membership id from another shelf is a 404, not a bare 500", async () => {
  // RLS filtered the select to zero rows; nobody compared two shelf ids.
  // `approveMembership` raises `NotFound("membership_not_found")` and
  // `submitCommand` turns it into a 404 — OPS §2's third shape, never a raw
  // exception.
  await shelfWithManager();
  const other = await makeShelf(sql, { slug: "vinh-long" });
  const theirs = await makeMember(sql, other.id, { status: "pending" });

  await expect(
    approveMembershipAction(
      form({ "tu-sach": "dong-thap", "thanh-vien": theirs.id }),
    ),
  ).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  expect((await statusOf(theirs.id)).status).toBe("pending");
});

test("an incomplete form is a refusal in words, not a 22P02", async () => {
  // `complete()`'s case: remove a `disabled` attribute in an inspector and the
  // form posts an empty id, which reaches Postgres as a failed uuid cast. The
  // action refuses presence, not shape — see its own docstring for why that line
  // is where it is.
  await shelfWithManager();

  const target = await redirectedTo(
    approveMembershipAction(form({ "tu-sach": "dong-thap", "thanh-vien": "" })),
  );

  expect(refusalIn(target)).toBe("validation_failed");
});

// — pinning an announcement —

/**
 * One row in `announcements`, inserted directly rather than through
 * `createAnnouncement` — `pinAnnouncement`/`unpinAnnouncement` only need the
 * row to exist, the same reason `soft-delete-aware-uniqueness-round-2.test.ts`
 * seeds this table by hand rather than through the command.
 */
async function anAnnouncement(bookshelfId: string) {
  const [row] = await sql<{ id: string }[]>`
    insert into announcements (bookshelf_id, title, slug, body, body_text)
    values (${bookshelfId}, 'Thánh lễ Chúa nhật', 'thanh-le-chua-nhat',
            'Thánh lễ lúc 8 giờ sáng Chúa nhật này.',
            'Thánh lễ lúc 8 giờ sáng Chúa nhật này.')
    returning id
  `;
  return row.id;
}

async function isPinned(announcementId: string) {
  const [row] = await sql<{ is_pinned: boolean }[]>`
    select is_pinned from announcements where id = ${announcementId}
  `;
  return row.is_pinned;
}

test("a manager pins an announcement, and pinning again unpins it", async () => {
  const { shelf } = await shelfWithManager();
  const announcementId = await anAnnouncement(shelf.id);

  await redirectedTo(
    pinAnnouncementAction(
      form({ "tu-sach": "dong-thap", "thong-bao": announcementId }),
    ),
  );
  expect(await isPinned(announcementId)).toBe(true);

  await redirectedTo(
    unpinAnnouncementAction(
      form({ "tu-sach": "dong-thap", "thong-bao": announcementId }),
    ),
  );
  expect(await isPinned(announcementId)).toBe(false);
});

test("a reader may not pin an announcement", async () => {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const announcementId = await anAnnouncement(shelf.id);
  await signInAs(shelf.id, "reader", "minh.tran");

  const target = await redirectedTo(
    pinAnnouncementAction(
      form({ "tu-sach": "dong-thap", "thong-bao": announcementId }),
    ),
  );

  // `pinAnnouncement` carries its own `requireManager`, and the action adds
  // no second rule — this is that check, exercised from the surface rather
  // than from the command's own test.
  expect(refusalIn(target)).toBe("not_permitted");
  expect(await isPinned(announcementId)).toBe(false);
});
