import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { hashPassword } from "../../src/auth/password";
import { signIn } from "../../src/auth/session";
import { fixedClock } from "../../src/domain/kernel/clock";
import { migrate } from "../../src/db/migrate";
import { SESSION_COOKIE } from "../../src/lib/session-cookie";
import { makeBookWithCopies, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";
import { testDatabaseUrl } from "../support/env";

/**
 * `requestBorrowAction` and `cancelRequestAction` — "Xin mượn" and "Huỷ yêu
 * cầu", the two writes that make the borrow queue reachable at all.
 *
 * **What had been missing.** `createBorrowRequest` and `cancelOwnRequest`
 * shipped in C2, fully implemented and tested against their invariants, and
 * were called from nowhere for two slices;
 * `every-domain-command-has-a-caller.test.ts` carried both by name. The visible
 * corner was a `disabled` "Xin mượn" under an apologetic sentence, but the
 * larger one was `/quan-ly/yeu-cau-muon`: approve, reject and handover all
 * wired and tested over a queue no reader could put a row in, and a
 * **Yêu cầu mượn** badge that could only ever read zero.
 *
 * The commands' own tests already cover the rules. What is new and untested is
 * the seam: which command each button posts, which fields cross the boundary,
 * and where a refusal lands. Those are stringly typed on both sides — rename a
 * hidden input and the architecture test still passes while the button silently
 * posts `""`.
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

const { requestBorrowAction, cancelRequestAction } =
  await import("../../src/app/tu-sach/[shelf]/(doc-gia)/ho-so/reader-actions");
const { pool } = await import("../../src/db/client");

const clock = fixedClock("2026-08-11T03:00:00Z");

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

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

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

async function signInAs(bookshelfId: string, role: string, username: string) {
  const [user] = await sql<{ id: string }[]>`
    insert into users (full_name, father_name, mother_name, phone, username, password_hash)
    values ('Giuse Trần Minh', 'A', 'B', '0900000002', ${username},
            ${await hashPassword("x")})
    returning id
  `;
  const [membership] = await sql<{ id: string }[]>`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${bookshelfId}, ${user.id}, ${role}, 'active')
    returning id
  `;
  const { token } = await signIn(sql, { username, password: "x", clock });
  session.token = token;
  return { userId: user.id, membershipId: membership.id };
}

async function aShelfWithABook() {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const [book] = await sql<{ slug: string }[]>`
    select slug from books where id = ${bookId}
  `;
  return { shelf, bookId, copyIds, bookSlug: book.slug };
}

test("a reader joins the queue, and lands back on the book with a named marker", async () => {
  const { shelf, bookId, bookSlug } = await aShelfWithABook();
  const { userId, membershipId } = await signInAs(shelf.id, "reader", "bandoc");

  const target = await redirectedTo(
    requestBorrowAction(
      form({
        "tu-sach": "dong-thap",
        sach: bookSlug,
        "sach-id": bookId,
        "thanh-vien": membershipId,
      }),
    ),
  );

  // `xin-muon`, not a bare `1`: the comment box lands on this same URL, and a
  // marker that cannot say which form was sent confirms the wrong thing.
  expect(target).toBe(`/tu-sach/dong-thap/sach/${bookSlug}?da-gui=xin-muon`);

  const [row] = await sql<
    { status: string; member_id: string; bookshelf_id: string }[]
  >`select status, member_id, bookshelf_id from borrow_requests`;
  expect(row.status).toBe("pending");
  // `borrow_requests.member_id` holds a `users(id)` despite its name — the
  // command's docstring explains why, and writing the membership id there
  // instead would leave INV-3's holder comparison permanently false.
  expect(row.member_id).toBe(userId);
  expect(row.bookshelf_id).toBe(shelf.id);
});

test("a copy sitting on the shelf does not block a request", async () => {
  // `createBorrowRequest` reads no `book_copies` at all, deliberately: OPS §4.2
  // covers a reader who "wants to queue even when copies exist". The factory
  // leaves its copy `available`, so this is that case — and it is the one a
  // screen-level gate would most plausibly get wrong by adding a check the
  // domain refused to make.
  const { shelf, bookId, bookSlug } = await aShelfWithABook();
  const { membershipId } = await signInAs(shelf.id, "reader", "bandoc");

  const target = await redirectedTo(
    requestBorrowAction(
      form({
        "tu-sach": "dong-thap",
        sach: bookSlug,
        "sach-id": bookId,
        "thanh-vien": membershipId,
      }),
    ),
  );

  expect(target).toBe(`/tu-sach/dong-thap/sach/${bookSlug}?da-gui=xin-muon`);
  expect(await sql`select 1 from borrow_requests`).toHaveLength(1);
});

test("a second tap is a sentence on the page, not a second place in the queue", async () => {
  const { shelf, bookId, bookSlug } = await aShelfWithABook();
  const { membershipId } = await signInAs(shelf.id, "reader", "bandoc");
  const fields = {
    "tu-sach": "dong-thap",
    sach: bookSlug,
    "sach-id": bookId,
    "thanh-vien": membershipId,
  };

  await redirectedTo(requestBorrowAction(form(fields)));
  const again = await redirectedTo(requestBorrowAction(form(fields)));

  expect(again).toBe(`/tu-sach/dong-thap/sach/${bookSlug}?loi=duplicate_request`);
  expect(await sql`select 1 from borrow_requests`).toHaveLength(1);
});

test("posting somebody else's membership is refused", async () => {
  // The hidden `thanh-vien` field is a convenience; this is the assertion that
  // it is not a trust boundary. Another real, active membership of the same
  // shelf is the strongest form of the forgery — without the command's own
  // check, one child would be put in a queue under another child's name.
  const { shelf, bookId, bookSlug } = await aShelfWithABook();
  const [other] = await sql<{ id: string }[]>`
    insert into users (full_name, father_name, mother_name, phone)
    values ('Maria Nguyễn Thị Lan', 'A', 'B', '0900000003')
    returning id
  `;
  const [otherMembership] = await sql<{ id: string }[]>`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${shelf.id}, ${other.id}, 'reader', 'active')
    returning id
  `;
  await signInAs(shelf.id, "reader", "bandoc");

  const target = await redirectedTo(
    requestBorrowAction(
      form({
        "tu-sach": "dong-thap",
        sach: bookSlug,
        "sach-id": bookId,
        "thanh-vien": otherMembership.id,
      }),
    ),
  );

  expect(target).toBe(`/tu-sach/dong-thap/sach/${bookSlug}?loi=not_permitted`);
  expect(await sql`select 1 from borrow_requests`).toHaveLength(0);
});

test("cancelling from the book page comes back there; from the dashboard, there", async () => {
  const { shelf, bookId, bookSlug } = await aShelfWithABook();
  const { membershipId } = await signInAs(shelf.id, "reader", "bandoc");
  const request = {
    "tu-sach": "dong-thap",
    sach: bookSlug,
    "sach-id": bookId,
    "thanh-vien": membershipId,
  };

  await redirectedTo(requestBorrowAction(form(request)));
  const [first] = await sql<{ id: string }[]>`select id from borrow_requests`;

  const fromBook = await redirectedTo(
    cancelRequestAction(
      form({ "tu-sach": "dong-thap", sach: bookSlug, "yeu-cau": first.id }),
    ),
  );
  expect(fromBook).toBe(`/tu-sach/dong-thap/sach/${bookSlug}?da-huy=1`);
  const [cancelled] = await sql<{ status: string }[]>`
    select status from borrow_requests where id = ${first.id}
  `;
  expect(cancelled.status).toBe("cancelled");

  // No `sach` field is how "Sách em đang chờ" on the reader's own dashboard
  // posts it, and it must not be sent to a book page it did not come from.
  await redirectedTo(requestBorrowAction(form(request)));
  const [second] = await sql<{ id: string }[]>`
    select id from borrow_requests where status = 'pending'
  `;
  const fromDashboard = await redirectedTo(
    cancelRequestAction(form({ "tu-sach": "dong-thap", "yeu-cau": second.id })),
  );
  expect(fromDashboard).toBe("/tu-sach/dong-thap/ho-so/tong-quan?da-huy=1");
});

test("a cancellation releases the copy a manager had already set aside", async () => {
  // OPS §4.2 lists this under the command's invariants, and it is the half a
  // screen could not see: a request left `approved` goes on naming the copy, so
  // `copies_borrowable` keeps excluding it for the rest of `hold_days` while
  // the book sits on the shelf and every public surface tells the next child
  // there is none free.
  const { shelf, bookId, copyIds, bookSlug } = await aShelfWithABook();
  const { membershipId } = await signInAs(shelf.id, "reader", "bandoc");

  await redirectedTo(
    requestBorrowAction(
      form({
        "tu-sach": "dong-thap",
        sach: bookSlug,
        "sach-id": bookId,
        "thanh-vien": membershipId,
      }),
    ),
  );
  const [request] = await sql<{ id: string }[]>`select id from borrow_requests`;

  // The state a manager's approval leaves behind, written directly so this test
  // stays about the cancellation rather than about the approval flow.
  await sql`
    update borrow_requests set status = 'approved', copy_id = ${copyIds[0]}
     where id = ${request.id}
  `;
  await sql`update book_copies set state = 'held' where id = ${copyIds[0]}`;

  await redirectedTo(
    cancelRequestAction(form({ "tu-sach": "dong-thap", "yeu-cau": request.id })),
  );

  const [copy] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${copyIds[0]}
  `;
  expect(copy.state).toBe("available");
});

test("a malformed request id is a sentence, not a 22P02 from inside the transaction", async () => {
  const { shelf } = await aShelfWithABook();
  await signInAs(shelf.id, "reader", "bandoc");

  const target = await redirectedTo(
    cancelRequestAction(
      form({ "tu-sach": "dong-thap", "yeu-cau": "khong-phai-uuid" }),
    ),
  );

  expect(target).toBe("/tu-sach/dong-thap/ho-so/tong-quan?loi=validation_failed");
});
