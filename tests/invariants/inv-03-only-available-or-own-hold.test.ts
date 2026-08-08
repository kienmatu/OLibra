import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import type { TenantContext } from "../../src/domain/kernel/tenant";
import { runQuery } from "../../src/domain/kernel/unit-of-work";
import { copyLendable } from "../../src/domain/circulation/policy";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/**
 * INV-3 — "A copy may be lent only if it is available, or held for the very
 * reader now borrowing it."
 *
 * Three halves, filed the way `inv-07-lost-or-retired-not-lendable.test.ts`
 * files INV-7's, because the failure modes are genuinely different:
 *
 *  1. the predicate — `copyLendable` (`src/domain/circulation/policy.ts`)
 *     admits `available`, admits `held` for its own holder, and refuses
 *     everything else;
 *  2. the access path — `copies_borrowable` offers a copy under a live hold to
 *     nobody at all, including its holder, and starts offering it again the
 *     moment the clock passes `hold_expires_at`, with no job having run;
 *  3. the command — `LendCopy` refuses, end to end. **Deferred to C1's Task 3**
 *     (see the closing note), because `lendCopy` does not exist in this branch
 *     yet and a test that cannot run proves nothing.
 *
 * Halves 1 and 2 are asserted here. Half 2 is not a restatement of half 1: the
 * two answer *different* questions, and the gap between them is why
 * `copyLendable` exists at all. The view says whether a copy is free for
 * anybody; the predicate says whether it is free for *this* reader. A
 * `LendCopy` built on the view alone would be correct about strangers and
 * wrong about the one reader the hold was placed for — it would refuse to hand
 * a child the book that is sitting on the shelf with their name on it.
 *
 * **The user-id trap this file exists to pin.** A hold's holder is
 * `borrow_requests.member_id` (`0005_circulation.sql:63`), a column whose name
 * says membership and whose `references users(id)` says otherwise —
 * deliberately, per `20260808_04_composite_tenant_fks.sql:42`, since `users`
 * is a global table. The second test below reads that column back out of the
 * database and asserts what it actually holds, because a caller comparing a
 * membership id against it gets a permanently false answer while every pure
 * unit test stays green.
 */

const clock = fixedClock("2026-08-08T03:00:00Z");

function ctxAt(bookshelfId: string, instant: string): TenantContext {
  return {
    bookshelfId,
    actor: { userId: null, membershipId: null, role: "super_admin" },
    clock: fixedClock(instant),
  };
}

test("INV-3: the predicate admits available, admits the holder, refuses everyone else", async () => {
  // The rule in one line, before any database is involved. The end-to-end
  // cases below cannot be read without knowing which answer each shape is
  // supposed to produce.
  const holder = "the-holder";
  const stranger = "somebody-else";
  expect(
    copyLendable({ state: "available", heldForUserId: null }, stranger),
  ).toEqual({ blocked: false });
  expect(copyLendable({ state: "held", heldForUserId: holder }, holder)).toEqual({
    blocked: false,
  });
  expect(copyLendable({ state: "held", heldForUserId: holder }, stranger)).toEqual({
    blocked: true,
    reason: "copy_not_available",
  });
  expect(copyLendable({ state: "on_loan", heldForUserId: null }, stranger)).toEqual(
    {
      blocked: true,
      reason: "copy_not_available",
    },
  );
});

test("INV-3: the hold's holder is a user id, and a membership id never matches it", async () => {
  // This is the whole reason `copyLendable`'s parameters are called
  // `heldForUserId` and `forUserId`. The holder is read out of the database
  // rather than invented by the test, so the assertion is about what the
  // schema actually stores, not about what this file believes it stores.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);
  const stranger = await makeMember(sql, shelf.id);
  await sql`
    insert into borrow_requests
      (bookshelf_id, book_id, copy_id, member_id, status, requested_at,
       hold_expires_at)
    values
      (${shelf.id}, ${bookId}, ${copyIds[0]}, ${reader.userId}, 'approved',
       ${clock.now()}, timestamptz '2026-08-11T03:00:00Z')
  `;
  await sql`update book_copies set state = 'held' where id = ${copyIds[0]}`;

  // The subquery `lendCopy` will run, spelled the way Task 3 spells it.
  const [row] = await sql<{ held_for_user: string }[]>`
    select r.member_id as held_for_user
      from borrow_requests r
     where r.copy_id = ${copyIds[0]}
       and r.status = 'approved'
       and r.deleted_at is null
  `;

  // What the column holds, said out loud. `member_id` is the reader's *user*
  // id; their membership id is a different value entirely, and the two are
  // never interchangeable.
  expect(row.held_for_user).toBe(reader.userId);
  expect(row.held_for_user).not.toBe(reader.id);

  const held = { state: "held" as const, heldForUserId: row.held_for_user };
  expect(copyLendable(held, reader.userId)).toEqual({ blocked: false });
  expect(copyLendable(held, stranger.userId)).toEqual({
    blocked: true,
    reason: "copy_not_available",
  });

  // And the mistake, made on purpose so the cost of it is recorded here
  // rather than discovered at a shelf: pass the holder's *membership* id as
  // `forUserId` and their own hold refuses them. A `LendCopy` written that way
  // would pass every pure test in `tests/domain/circulation/policy.test.ts`,
  // because the predicate would be answering exactly the question it was
  // asked. INV-3's most interesting case would silently become "a held copy is
  // never lendable".
  expect(copyLendable(held, reader.id)).toEqual({
    blocked: true,
    reason: "copy_not_available",
  });
});

test("INV-3: a live hold offers the copy to nobody, and the clock alone gives it back", async () => {
  // BR §8 and DB §6: "if the tidy-up never runs, `copies_borrowable` is still
  // right". The clock is injected, so this needs no wall-clock waiting and no
  // second write — the fixture is written once and read three times.
  //
  // The first assertion is the one that matters for INV-3 specifically, and it
  // is easy to read past: while the hold is live the view offers the copy to
  // *nobody*, the holder included. `copies_borrowable` has no notion of who is
  // asking. That is precisely why a lend cannot be built on it alone, and why
  // `copyLendable` takes a `forUserId` the view has no column for.
  const shelf = await makeShelf(sql, { slug: "can-tho" });
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);
  await sql`
    insert into borrow_requests
      (bookshelf_id, book_id, copy_id, member_id, status, requested_at,
       hold_expires_at)
    values
      (${shelf.id}, ${bookId}, ${copyIds[0]}, ${reader.userId}, 'approved',
       timestamptz '2026-08-08T03:00:00Z', timestamptz '2026-08-11T03:00:00Z')
  `;

  const borrowable = (instant: string) =>
    runQuery(
      sql,
      ctxAt(shelf.id, instant),
      (tx) => tx<{ id: string }[]>`select id from copies_borrowable`,
    );

  expect(await borrowable("2026-08-10T23:59:00Z")).toHaveLength(0);
  expect(await borrowable("2026-08-11T03:01:00Z")).toHaveLength(1);

  // Nothing expired the hold; the clock moved and the row did not. Asserted
  // against the literal the fixture was written with, so an implementation
  // that quietly pushed `hold_expires_at` around could not satisfy it.
  const [after] = await sql<
    { status: string; hold_expires_at: Date; deleted_at: string | null }[]
  >`
    select status, hold_expires_at, deleted_at
      from borrow_requests where copy_id = ${copyIds[0]}
  `;
  expect(after.hold_expires_at.toISOString()).toBe("2026-08-11T03:00:00.000Z");
  expect(after.status).toBe("approved");
  expect(after.deleted_at).toBeNull();
});

test("INV-3: a copy in the held state is out of the view however the hold is read", async () => {
  // `copies_borrowable` filters on `state = 'available'` *and* on the absence
  // of a live approved hold (`20260808_14_olibra_now.sql`), and the two clauses
  // catch different situations rather than one being redundant. C2 has not
  // shipped, so which of the two a real approved request will lean on is not
  // settled yet: if `ApproveBorrowRequest` moves the copy to `held`, the state
  // filter does the work; if it leaves the copy `available` and records only
  // the request, the hold clause does. Both shapes are exercised here so that
  // whichever C2 chooses, INV-3 is already pinned and this file does not need
  // to be revisited to stay honest.
  const shelf = await makeShelf(sql, { slug: "ben-tre" });
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 2);

  const borrowable = () =>
    runQuery(
      sql,
      ctxAt(shelf.id, "2026-08-08T03:00:00Z"),
      (tx) => tx<{ id: string }[]>`select id from copies_borrowable order by id`,
    );
  expect(await borrowable()).toHaveLength(2);

  // Shape one: state alone.
  await sql`update book_copies set state = 'held' where id = ${copyIds[0]}`;
  // Shape two: state alone, again — `on_loan` is the same filter and the case
  // a double-lend would have to get past.
  await sql`update book_copies set state = 'on_loan' where id = ${copyIds[1]}`;
  expect(await borrowable()).toHaveLength(0);
});

// **Deferred to C1's Task 3, and said plainly rather than skipped silently.**
//
// Nothing here exercises `lendCopy` itself refusing a copy that is on loan, or
// handing a held copy to somebody other than its holder. That command does not
// exist in this branch: Task 1 (the predicates) and Task 2 (these tests) were
// implemented on their own, ahead of Task 3, so there is no `lendCopy` to
// call. A test written against it would fail to load and would take the two
// halves proved above down with it — the plan's own Task 2 assumed Task 3
// followed immediately, and it did not.
//
// What Task 3 owes this file, concretely, is three cases and no more:
//
//   * an available copy lends, and `book_copies.state` becomes `on_loan`;
//   * a copy held for reader A, lent to reader B, is refused with
//     `copy_not_available` and nothing is written — the case the second test
//     above pins the *inputs* of but cannot pin the command's use of;
//   * a copy already on loan is refused with `copy_not_available`.
//
// The middle one is the one to write first. It is the case the whole predicate
// exists for, and the one a user-id/membership-id mix-up turns green in unit
// tests and wrong at the shelf.
