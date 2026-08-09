import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import type { TenantContext } from "../../src/domain/kernel/tenant";
import { runCommand } from "../../src/domain/kernel/unit-of-work";
import { approveBorrowRequest } from "../../src/domain/circulation/commands/approve-borrow-request";
import { cancelOwnRequest } from "../../src/domain/circulation/commands/cancel-own-request";
import { createBorrowRequest } from "../../src/domain/circulation/commands/create-borrow-request";
import { handoverRequest } from "../../src/domain/circulation/commands/handover-request";
import { lendCopy } from "../../src/domain/circulation/commands/lend-copy";
import { receiveReturn } from "../../src/domain/circulation/commands/receive-return";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/**
 * INV-2 — "A copy cannot be simultaneously held and on loan."
 *
 * **Two halves, enforced in two different places, and the second is the one
 * this file is really about.**
 *
 *  1. **The copy's own row.** `book_copies.state` is a single `copy_state`
 *     enum column, so `held` and `on_loan` cannot both be true of one row —
 *     the contradiction is unrepresentable rather than merely unwritten.
 *     DATABASE.md §4.4 says exactly this, and says why two booleans would have
 *     been the wrong model.
 *  2. **Across two tables.** A hold does not live only in
 *     `book_copies.state`. It is also a `borrow_requests` row with `status =
 *     'approved'` and a `hold_expires_at` still in the future, which is what
 *     `copies_borrowable` actually filters on. **Nothing in the schema stops
 *     that row from naming a copy whose state is `on_loan`** — no constraint,
 *     no index, no trigger — so "held and on loan at the same time" *is*
 *     representable, and the guarantee against it is the commands', inside one
 *     transaction. DATABASE.md §4.4 (`:757`) and the §7 table (`:1310`) both
 *     record this; C1 corrected the document when it corrected the code.
 *
 * **So this file is mostly a detector and a list of paths.** `heldAndOnLoan()`
 * below is the second half written as a query, and the first test proves it is a
 * real detector by planting the forbidden state by hand — without that, every
 * other assertion in this file would be satisfied by a query that can only ever
 * return zero.
 *
 * The paths are then walked with the real commands, in the order a shelf walks
 * them. C1 closed the one window it found (`lendCopy` fulfilling the hold it
 * collects). C2 opens four more — every command in the request family can put a
 * copy and a request out of step — and each gets a test here rather than a
 * paragraph in a docstring.
 */

const AT = "2026-08-07T10:00:00Z";

function ctxFor(
  bookshelfId: string,
  member: { id: string; userId: string },
  role: "manager" | "reader",
  instant = AT,
): TenantContext {
  return {
    bookshelfId,
    actor: { userId: member.userId, membershipId: member.id, role },
    clock: fixedClock(instant),
  };
}

/**
 * Every copy that is `on_loan` while a **live** approved hold names it.
 *
 * `hold_expires_at > olibra_now()` rather than a bound instant, because that is
 * the comparison every other reader of this column makes — `copies_borrowable`
 * (`20260808_14_olibra_now.sql:124`), `lendCopy`'s lateral join,
 * `handoverRequest`. A detector that decided liveness a fourth way would be
 * checking a different invariant from the one the system enforces.
 *
 * Run on the shared superuser handle rather than through `runQuery`,
 * deliberately: this is a whole-database scan for a state that must not exist
 * anywhere, and scoping it to one shelf would let a violation on another shelf
 * pass. `olibra_now()` needs `olibra.now` set, so the instant is passed in.
 */
async function heldAndOnLoan(instant = AT): Promise<{ copy_id: string }[]> {
  return sql.begin(async (tx) => {
    await tx`select set_config('olibra.now', ${instant}, true)`;
    return tx<{ copy_id: string }[]>`
      select c.id as copy_id
        from borrow_requests r
        join book_copies c on c.id = r.copy_id
       where r.status = 'approved'
         and r.deleted_at is null
         and r.hold_expires_at > olibra_now()
         and c.state = 'on_loan'
    `;
  });
}

/** A shelf, a manager, a reader, one book, `copies` copies. */
async function shelfWithCopies(slug: string, copies = 1) {
  const shelf = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const reader = await makeMember(sql, shelf.id);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, copies);
  return {
    shelf,
    manager,
    reader,
    bookId,
    copyIds,
    manage: (at?: string) => ctxFor(shelf.id, manager, "manager", at),
    read: (at?: string) => ctxFor(shelf.id, reader, "reader", at),
  };
}

/** A pending request, through the real command. */
async function queued(
  shelfId: string,
  bookId: string,
  reader: { id: string; userId: string },
): Promise<string> {
  const { requestId } = await runCommand(
    sql,
    ctxFor(shelfId, reader, "reader"),
    createBorrowRequest,
    { bookId, membershipId: reader.id },
  );
  return requestId;
}

test("INV-2: the copy's own row cannot say both, and the detector below can", async () => {
  // Half 1, as a fact about the schema rather than about any command:
  // `book_copies.state` is one enum column, so a row saying `held` is a row not
  // saying `on_loan`. Read out of the catalogue rather than asserted from
  // memory — the claim is about what Postgres holds.
  const [column] = await sql<{ data_type: string; udt_name: string }[]>`
    select data_type, udt_name from information_schema.columns
     where table_name = 'book_copies' and column_name = 'state'
  `;
  expect(column.data_type).toBe("USER-DEFINED");
  expect(column.udt_name).toBe("copy_state");

  // Half 2, and the whole reason the rest of this file means anything: the
  // forbidden state is *representable*. Written here by hand, with no command
  // involved, because no command produces it — and if `heldAndOnLoan()` came
  // back empty for this fixture it would be a query that cannot fail, and every
  // other test below would be proving nothing at all.
  const { shelf, bookId, copyIds, reader, manage } =
    await shelfWithCopies("dong-thap");
  await runCommand(sql, manage(), lendCopy, {
    copyId: copyIds[0],
    membershipId: reader.id,
  });
  await sql`
    insert into borrow_requests
      (bookshelf_id, book_id, copy_id, member_id, status, requested_at,
       hold_expires_at)
    values
      (${shelf.id}, ${bookId}, ${copyIds[0]}, ${reader.userId}, 'approved',
       timestamptz '2026-08-07T10:00:00Z', timestamptz '2026-08-10T10:00:00Z')
  `;

  expect(await heldAndOnLoan()).toHaveLength(1);
  // And no constraint stopped that insert. Said out loud because DATABASE.md
  // §7's table row for INV-2 is the only place this is written down, and a
  // reader of `0009_invariant_constraints.sql` would reasonably assume
  // otherwise.
});

test("INV-2: collecting a hold closes it, so no live hold names a lent copy", async () => {
  // C1's window, kept under test from C2's side. `lendCopy` moves the request
  // to `fulfilled` in the same transaction that lends the copy to its holder —
  // without that the request goes on naming an `on_loan` copy for the rest of
  // `hold_days`, which is this invariant broken *and* a public catalogue
  // telling the next child there is no copy free while the book is out.
  const { shelf, bookId, copyIds, reader, manage } =
    await shelfWithCopies("can-tho");
  const requestId = await queued(shelf.id, bookId, reader);
  await runCommand(sql, manage(), approveBorrowRequest, {
    requestId,
    copyId: copyIds[0],
  });

  await runCommand(sql, manage(), lendCopy, {
    copyId: copyIds[0],
    membershipId: reader.id,
  });

  expect(await heldAndOnLoan()).toEqual([]);
  const [row] = await sql<{ status: string }[]>`
    select status from borrow_requests where id = ${requestId}
  `;
  expect(row.status).toBe("fulfilled");
});

test("INV-2: the handover closes the hold it collects", async () => {
  // C2's own version of the same window, and the one a manager actually walks:
  // *Xác nhận trao sách* on the queue screen. `handoverRequest` delegates to
  // `lendCopy`, so the fulfilment above and this one are the same three lines
  // rather than two implementations that could drift apart — which is the point
  // of the delegation and the reason both paths are asserted here rather than
  // one being taken on trust.
  const { shelf, bookId, copyIds, reader, manage } =
    await shelfWithCopies("ben-tre");
  const requestId = await queued(shelf.id, bookId, reader);
  await runCommand(sql, manage(), approveBorrowRequest, {
    requestId,
    copyId: copyIds[0],
  });

  await runCommand(sql, manage(), handoverRequest, { requestId });

  expect(await heldAndOnLoan()).toEqual([]);
  const [copy] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${copyIds[0]}
  `;
  expect(copy.state).toBe("on_loan");
});

test("INV-2: a withdrawn hold leaves nothing behind to contradict a later loan", async () => {
  // The path C2 adds that C1 could not have: a child changes their mind, the
  // copy goes back on the shelf, and somebody else borrows it. If
  // `cancelOwnRequest` left the request `approved`, that stale hold would name
  // a copy the next lend puts on loan — and `lendCopy` would not close it,
  // because it only collects a hold whose holder is the reader in front of it.
  const { shelf, bookId, copyIds, reader, manage, read } =
    await shelfWithCopies("vinh-long");
  const other = await makeMember(sql, shelf.id);
  const requestId = await queued(shelf.id, bookId, reader);
  await runCommand(sql, manage(), approveBorrowRequest, {
    requestId,
    copyId: copyIds[0],
  });

  await runCommand(sql, read(), cancelOwnRequest, { requestId });
  await runCommand(sql, manage(), lendCopy, {
    copyId: copyIds[0],
    membershipId: other.id,
  });

  expect(await heldAndOnLoan()).toEqual([]);
});

test("INV-2: holding a returned copy for the next reader never overlaps the loan", async () => {
  // OPS §5's one deliberate two-fact transaction, from this invariant's side.
  // The copy goes `on_loan → held` in a single statement while the loan closes
  // in the same transaction, so there is no instant — observable or not — at
  // which a live hold names a copy that is still out.
  const { shelf, bookId, copyIds, reader, manage } =
    await shelfWithCopies("soc-trang");
  const next = await makeMember(sql, shelf.id);
  const { loanId } = await runCommand(sql, manage(), lendCopy, {
    copyId: copyIds[0],
    membershipId: reader.id,
  });
  const requestId = await runCommand(
    sql,
    ctxFor(shelf.id, next, "reader"),
    createBorrowRequest,
    { bookId, membershipId: next.id },
  ).then((r) => r.requestId);

  await runCommand(sql, manage(), receiveReturn, {
    loanId,
    condition: "perfect",
    holdForRequestId: requestId,
  });

  expect(await heldAndOnLoan()).toEqual([]);
  const [copy] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${copyIds[0]}
  `;
  expect(copy.state).toBe("held");
});

test("INV-2: a hold that lapses cannot become a contradiction by the clock alone", async () => {
  // The invariant is about a *live* hold, and liveness moves without anything
  // being written. So the same fixture is read at two instants: while the hold
  // stands the copy is `held` and no loan exists, and once it lapses the copy
  // is still `held` — a lapsed hold does not free a copy, and a later lend of
  // it is refused (`inv-03`'s last test) rather than creating the state this
  // file forbids.
  //
  // The row is written once and never touched again (BR §8: "if the tidy-up
  // never runs, `copies_borrowable` is still right"). No sleep, no job.
  const { shelf, bookId, copyIds, reader, manage } =
    await shelfWithCopies("hau-giang");
  const requestId = await queued(shelf.id, bookId, reader);
  await runCommand(sql, manage(), approveBorrowRequest, {
    requestId,
    copyId: copyIds[0],
  });

  expect(await heldAndOnLoan("2026-08-09T10:00:00Z")).toEqual([]);
  expect(await heldAndOnLoan("2026-08-11T10:00:00Z")).toEqual([]);

  await expect(
    runCommand(sql, manage("2026-08-11T10:00:00Z"), lendCopy, {
      copyId: copyIds[0],
      membershipId: reader.id,
    }),
  ).rejects.toMatchObject({ code: "copy_not_available" });
  expect(await heldAndOnLoan("2026-08-11T10:00:00Z")).toEqual([]);
});
