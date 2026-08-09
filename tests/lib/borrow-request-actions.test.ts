import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { hashPassword } from "../../src/auth/password";
import { signIn } from "../../src/auth/session";
import { fixedClock } from "../../src/domain/kernel/clock";
import { migrate } from "../../src/db/migrate";
import { SESSION_COOKIE } from "../../src/lib/session-cookie";
import { makeBookWithCopies, makeMember, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";
import { testDatabaseUrl } from "../support/env";

/**
 * C2's four server actions against a real database — the three on the queue
 * screen, and `receiveReturnAction`'s newly-wired `holdForRequestId`.
 *
 * **What is worth pinning here, over and above the command tests.** The
 * commands are covered by `tests/domain/circulation/borrow-requests.test.ts`;
 * these are the three things only a *surface* can get wrong:
 *
 * 1. **Which field name reaches which input.** `giu-cho` → `holdForRequestId`
 *    is the one that had never been sent at all, and a form that posts a field
 *    an action does not read looks exactly like a form that works.
 * 2. **That "no hold" is a real answer.** The radio group posts `""` for
 *    *Không giữ chỗ, trả về kệ*, and the copy must go back on the shelf with
 *    the queue untouched. Measured: swapping `optional()` for `field()` in the
 *    action does *not* break this, because `receiveReturn` branches on the
 *    truthiness of `holdForRequestId` and an empty string never reaches
 *    `resolveHold` — so `optional()` there is belt-and-braces rather than the
 *    thing standing between a volunteer and a `22P02`. What this test pins is
 *    the outcome, which is what a manager experiences, and it does bite: it
 *    goes red the moment the default stops being "no hold".
 * 3. **That an approval with no free copy is a sentence, not a fault.** The
 *    page renders the button disabled and posts `ban=""`; the `complete()`
 *    guard turns that into `validation_failed` rather than a failed cast.
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
  approveBorrowRequestAction,
  handoverRequestAction,
  receiveReturnAction,
  rejectBorrowRequestAction,
} = await import("../../src/app/tu-sach/[shelf]/quan-ly/actions");
const { pool } = await import("../../src/db/client");
const { runCommand } = await import("../../src/domain/kernel/unit-of-work");
const { createBorrowRequest } =
  await import("../../src/domain/circulation/commands/create-borrow-request");
const { lendCopy } =
  await import("../../src/domain/circulation/commands/lend-copy");

const clock = fixedClock("2026-08-09T03:00:00Z");

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

/**
 * Where a `redirect()` aimed — read off the digest Next.js actually throws, for
 * `lending-actions.test.ts`' stated reason: a test that mocked `redirect` would
 * pass against an action that never redirected.
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

/** A shelf, a signed-in manager, a book with `copies` copies, and a reader. */
async function shelfWithQueue(copies = 1) {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const [user] = await sql<{ id: string }[]>`
    insert into users (full_name, father_name, mother_name, phone, username, password_hash)
    values ('Maria Nguyễn Thị Lan', 'A', 'B', '0900000001', 'lan.nguyen',
            ${await hashPassword("x")})
    returning id
  `;
  const [membership] = await sql<{ id: string }[]>`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${shelf.id}, ${user.id}, 'manager', 'active')
    returning id
  `;
  const { token } = await signIn(sql, {
    username: "lan.nguyen",
    password: "x",
    clock,
  });
  session.token = token;

  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, copies);
  const reader = await makeMember(sql, shelf.id);
  return {
    shelf,
    manager: { id: membership.id, userId: user.id },
    bookId,
    copyIds,
    reader,
  };
}

/** A pending request from `reader`, through the real command. */
async function queue(
  shelfId: string,
  bookId: string,
  reader: { id: string; userId: string },
): Promise<string> {
  const { requestId } = await runCommand(
    sql,
    {
      bookshelfId: shelfId,
      actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
      clock,
    },
    createBorrowRequest,
    { bookId, membershipId: reader.id },
  );
  return requestId;
}

async function statusOf(requestId: string) {
  const [row] = await sql<
    { status: string; copy_id: string | null; decision_note: string | null }[]
  >`
    select status, copy_id, decision_note from borrow_requests where id = ${requestId}
  `;
  return row;
}

test("approving posts both ids and lands back on the queue", async () => {
  const { shelf, bookId, copyIds, reader } = await shelfWithQueue();
  const requestId = await queue(shelf.id, bookId, reader);

  const target = await redirectedTo(
    approveBorrowRequestAction(
      form({ "tu-sach": shelf.slug, "yeu-cau": requestId, ban: copyIds[0] }),
    ),
  );

  // Back to the queue, never to the dashboard: the manager is working down a
  // stack of cards, and the card they just decided is simply gone from it.
  expect(target).toBe("/tu-sach/dong-thap/quan-ly/yeu-cau-muon");
  expect(refusalIn(target)).toBeNull();
  const row = await statusOf(requestId);
  expect(row.status).toBe("approved");
  expect(row.copy_id).toBe(copyIds[0]);
});

test("approving with no free copy is a sentence, not a failed uuid cast", async () => {
  // The page renders the button disabled and posts `ban=""` when
  // `freeCopies` is empty. Remove the `disabled` attribute in a browser's
  // inspector — or race another manager to the last copy — and this is the
  // request that arrives. Without `complete()`, `""` reaches Postgres as a
  // failed `uuid` cast and comes back a raw `22P02`: a bare 500 for a form this
  // application itself rendered incomplete, which OPS §2 forbids.
  const { shelf, bookId, reader } = await shelfWithQueue();
  const requestId = await queue(shelf.id, bookId, reader);

  const target = await redirectedTo(
    approveBorrowRequestAction(
      form({ "tu-sach": shelf.slug, "yeu-cau": requestId, ban: "" }),
    ),
  );

  expect(refusalIn(target)).toBe("validation_failed");
  expect((await statusOf(requestId)).status).toBe("pending");
});

test("rejecting with an empty reason box is accepted, and stores no reason", async () => {
  // Q2, at the surface. The two other rejections in this file's sibling
  // (`manager-actions.test.ts`) come back with `reject_reason_required` for an
  // empty box; this one does not, because OPS §4.2 lists no such failure mode
  // for `RejectBorrowRequest` and the queue screen makes no such promise.
  const { shelf, bookId, reader } = await shelfWithQueue();
  const requestId = await queue(shelf.id, bookId, reader);

  const target = await redirectedTo(
    rejectBorrowRequestAction(
      form({ "tu-sach": shelf.slug, "yeu-cau": requestId, "ly-do": "" }),
    ),
  );

  expect(refusalIn(target)).toBeNull();
  const row = await statusOf(requestId);
  expect(row.status).toBe("rejected");
  expect(row.decision_note).toBeNull();
});

test("the handover posts one id, and the book goes out", async () => {
  const { shelf, bookId, copyIds, reader } = await shelfWithQueue();
  const requestId = await queue(shelf.id, bookId, reader);
  await redirectedTo(
    approveBorrowRequestAction(
      form({ "tu-sach": shelf.slug, "yeu-cau": requestId, ban: copyIds[0] }),
    ),
  );

  const target = await redirectedTo(
    handoverRequestAction(form({ "tu-sach": shelf.slug, "yeu-cau": requestId })),
  );

  expect(refusalIn(target)).toBeNull();
  expect((await statusOf(requestId)).status).toBe("fulfilled");
  const [copy] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${copyIds[0]}
  `;
  expect(copy.state).toBe("on_loan");
});

test("the return holds the copy for the reader the manager picked", async () => {
  // The wiring that had never existed: `giu-cho` → `holdForRequestId`. Both
  // branches, because the interesting one is the *default* — a form that posts
  // the empty string must leave the copy on the shelf, not write a hold for
  // nobody and not fail a uuid cast.
  const { shelf, manager, bookId, copyIds, reader } = await shelfWithQueue();
  const borrower = await makeMember(sql, shelf.id);
  const ctx = {
    bookshelfId: shelf.id,
    actor: {
      userId: manager.userId,
      membershipId: manager.id,
      role: "manager" as const,
    },
    clock,
  };
  const { loanId } = await runCommand(sql, ctx, lendCopy, {
    copyId: copyIds[0],
    membershipId: borrower.id,
  });
  const requestId = await queue(shelf.id, bookId, reader);

  const target = await redirectedTo(
    receiveReturnAction(
      form({
        "tu-sach": shelf.slug,
        muon: loanId,
        "tinh-trang": "perfect",
        "ghi-chu": "",
        q: "",
        "giu-cho": requestId,
      }),
    ),
  );

  expect(refusalIn(target)).toBeNull();
  const row = await statusOf(requestId);
  expect(row.status).toBe("approved");
  expect(row.copy_id).toBe(copyIds[0]);
  const [copy] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${copyIds[0]}
  `;
  expect(copy.state).toBe("held");
});

test("no hold chosen leaves the copy on the shelf and the queue untouched", async () => {
  const { shelf, manager, bookId, copyIds, reader } = await shelfWithQueue();
  const borrower = await makeMember(sql, shelf.id);
  const { loanId } = await runCommand(
    sql,
    {
      bookshelfId: shelf.id,
      actor: {
        userId: manager.userId,
        membershipId: manager.id,
        role: "manager" as const,
      },
      clock,
    },
    lendCopy,
    { copyId: copyIds[0], membershipId: borrower.id },
  );
  const requestId = await queue(shelf.id, bookId, reader);

  const target = await redirectedTo(
    receiveReturnAction(
      form({
        "tu-sach": shelf.slug,
        muon: loanId,
        "tinh-trang": "perfect",
        "ghi-chu": "",
        q: "",
        // What "Không giữ chỗ, trả về kệ" posts. An empty string is the absence
        // of a choice, and both the action (`optional`) and the command (its
        // truthiness branch) read it that way — either one alone would do, and
        // this asserts the outcome rather than which of the two did it.
        "giu-cho": "",
      }),
    ),
  );

  expect(refusalIn(target)).toBeNull();
  expect((await statusOf(requestId)).status).toBe("pending");
  const [copy] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${copyIds[0]}
  `;
  expect(copy.state).toBe("available");
});
