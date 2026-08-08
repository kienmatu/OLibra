import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import postgres from "postgres";
import { fixedClock } from "../../src/domain/kernel/clock";
import type { TenantContext } from "../../src/domain/kernel/tenant";
import { runQuery } from "../../src/domain/kernel/unit-of-work";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";
import { testDatabaseUrl } from "../support/env";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/**
 * The clock, moved in SQL.
 *
 * `tests/db/derived-state.test.ts` (the file next to this one) asserts what
 * the two views compute; this file asserts *when* they compute it against.
 * Until `20260808_14_olibra_now.sql` the answer was "whatever SQL `now()`
 * says", which meant `src/domain/kernel/clock.ts`'s stated premise — "every
 * one of those rules is only testable if the clock can be moved" — was true
 * in TypeScript and false in the database. A test holding a `fixedClock`
 * could not make `is_overdue` true and could not make a hold expire without
 * waiting real wall-clock time, so `derived-state.test.ts` moves `due_on`
 * and `hold_expires_at` instead, and `2026-08-08-b2-members.md` recorded the
 * limitation as Known gap #14 for C1/C2 to inherit.
 *
 * Every test below therefore moves the clock and **nothing else**: one
 * fixture, written once, read twice through `runQuery` with two different
 * `fixedClock`s. No second write, no scheduled job, no re-read of anything
 * but the view. Several assert `xmin` — Postgres's own "which transaction
 * last wrote this row" system column — is byte-identical across the two
 * reads, so "nothing else changed" is checked by the database rather than
 * asserted by the test's own narration.
 *
 * These go through `runQuery` rather than setting `olibra.now` by hand,
 * deliberately: the chain that has to work is kernel -> GUC -> `olibra_now()`
 * -> view, and a test that set the GUC itself would stay green if
 * `unit-of-work.ts` stopped setting it. The last two tests are the exception,
 * and say why.
 */
function ctxAt(bookshelfId: string, instant: string): TenantContext {
  return {
    bookshelfId,
    actor: { userId: null, membershipId: null, role: "super_admin" },
    clock: fixedClock(instant),
  };
}

async function shelfWithLoan(dueOn: string) {
  const shelf = await makeShelf(sql);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);
  const [loan] = await sql<{ id: string }[]>`
    insert into loans
      (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status)
    values
      (${shelf.id}, ${copyIds[0]}, ${bookId}, ${reader.userId}, ${reader.userId},
       ${dueOn}::date, 'active')
    returning id
  `;
  return { shelfId: shelf.id, loanId: loan.id };
}

interface LoanRow {
  is_overdue: boolean;
  days_remaining: number;
}

function readLoan(shelfId: string, instant: string): Promise<LoanRow> {
  return runQuery(sql, ctxAt(shelfId, instant), async (tx) => {
    const [row] = await tx<LoanRow[]>`
      select is_overdue, days_remaining from loans_current
    `;
    return row;
  });
}

/**
 * The id of the transaction that last wrote the loan row.
 *
 * Read from `loans`, not from `loans_current`: a view exposes no system
 * columns, so `select xmin from loans_current` fails outright with `column
 * "xmin" does not exist` — which is itself worth knowing, since it is the
 * reason the "nothing was written" assertions below reach past the view to
 * the table underneath it.
 */
async function loanXmin(loanId: string): Promise<string> {
  const [row] = await sql<{ xmin: string }[]>`
    select xmin::text from loans where id = ${loanId}
  `;
  return row.xmin;
}

test("a loan due tomorrow is overdue two days later, with nothing written in between", async () => {
  // BR §8 / G5: overdue is computed on read. The point of this test is the
  // *second* read — same row, same fixture, no write, no job, only a clock
  // that moved forward two days.
  const { shelfId, loanId } = await shelfWithLoan("2026-08-09");
  const xminBefore = await loanXmin(loanId);

  const before = await readLoan(shelfId, "2026-08-08T03:00:00Z");
  expect(before.is_overdue).toBe(false);

  const after = await readLoan(shelfId, "2026-08-10T03:00:00Z");
  expect(after.is_overdue).toBe(true);

  // Nothing wrote the row between the two reads: `xmin` is the id of the
  // transaction that last wrote it, so an equal `xmin` is Postgres saying
  // the row is untouched — stronger than comparing `updated_at`, which a
  // trigger could have rewritten to the same value.
  expect(await loanXmin(loanId)).toBe(xminBefore);
});

test("days_remaining moves with the clock, and is negative once the loan is overdue", async () => {
  const { shelfId } = await shelfWithLoan("2026-08-20");

  // 2026-08-20 minus 2026-08-08, in Asia/Ho_Chi_Minh.
  expect(
    Number((await readLoan(shelfId, "2026-08-08T03:00:00Z")).days_remaining),
  ).toBe(12);
  expect(
    Number((await readLoan(shelfId, "2026-08-19T03:00:00Z")).days_remaining),
  ).toBe(1);

  const late = await readLoan(shelfId, "2026-08-23T03:00:00Z");
  expect(Number(late.days_remaining)).toBe(-3);
  expect(late.is_overdue).toBe(true);
});

test("a returned loan is still never overdue, however far the clock is advanced", async () => {
  // The `status = 'active'` half of the predicate. Moving the clock must not
  // turn a closed loan overdue — otherwise "advance the clock" becomes a way
  // to manufacture overdue rows that BR §8 says cannot exist.
  const shelf = await makeShelf(sql);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);
  await sql`
    insert into loans
      (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status,
       return_condition)
    values
      (${shelf.id}, ${copyIds[0]}, ${bookId}, ${reader.userId}, ${reader.userId},
       date '2026-08-09', 'returned', 'perfect')
  `;

  const row = await readLoan(shelf.id, "2036-01-01T00:00:00Z");
  expect(row.is_overdue).toBe(false);
});

test("the overdue boundary is midnight in Asia/Ho_Chi_Minh, not midnight UTC", async () => {
  // DB §2.2 and `clock.ts`: `due_on` is a date, so the comparison must be
  // made in the application timezone or a loan turns overdue seven hours
  // early every evening. This is the guard on `at time zone
  // 'Asia/Ho_Chi_Minh'` in both derived columns, and both instants below are
  // chosen so that dropping it gives the *wrong* answer rather than the same
  // one:
  //
  //   2026-08-08T16:00:00Z is 2026-08-08 23:00 +07 — still the due date.
  //   2026-08-08T17:30:00Z is 2026-08-09 00:30 +07 — the day after.
  //
  // Both instants are 2026-08-08 in UTC. A view comparing against
  // `olibra_now()::date` instead of `(olibra_now() at time zone
  // 'Asia/Ho_Chi_Minh')::date` reads them as the same day, so the second
  // assertion pair below flips: not overdue, days_remaining 0.
  const { shelfId, loanId } = await shelfWithLoan("2026-08-08");
  const xminBefore = await loanXmin(loanId);

  const stillToday = await readLoan(shelfId, "2026-08-08T16:00:00Z");
  expect(stillToday.is_overdue).toBe(false);
  expect(Number(stillToday.days_remaining)).toBe(0);

  const justAfterMidnight = await readLoan(shelfId, "2026-08-08T17:30:00Z");
  expect(justAfterMidnight.is_overdue).toBe(true);
  expect(Number(justAfterMidnight.days_remaining)).toBe(-1);

  expect(await loanXmin(loanId)).toBe(xminBefore);
});

test("an unexpired hold hides a copy, and the clock alone makes it borrowable again", async () => {
  // DB §6: "if the tidy-up never runs, `copies_borrowable` is still right".
  // C2's acceptance in master §7.6 asks for exactly this shape — the test
  // advances an injected Clock rather than sleeping, and the hold silently
  // stops blocking with no job having run. Before `olibra_now()` it was not
  // expressible: the view read SQL `now()`, so the only way to expire a hold
  // was to move `hold_expires_at`, which is a write and therefore proves
  // nothing about expiry-on-read.
  const shelf = await makeShelf(sql);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);
  const [hold] = await sql<{ id: string }[]>`
    insert into borrow_requests
      (bookshelf_id, book_id, copy_id, member_id, status, requested_at,
       hold_expires_at)
    values
      (${shelf.id}, ${bookId}, ${copyIds[0]}, ${reader.userId}, 'approved',
       timestamptz '2026-08-08T02:00:00Z', timestamptz '2026-08-08T10:00:00Z')
    returning id
  `;

  const borrowable = (instant: string) =>
    runQuery(
      sql,
      ctxAt(shelf.id, instant),
      (tx) => tx<{ id: string }[]>`select id from copies_borrowable`,
    );

  expect(await borrowable("2026-08-08T09:59:00Z")).toHaveLength(0);
  expect(await borrowable("2026-08-08T10:01:00Z")).toHaveLength(1);

  // Nothing tidied the hold up: it is still `approved`, still not deleted,
  // and still the same physical row. Only the clock moved.
  const [after] = await sql<{ status: string; deleted_at: string | null }[]>`
    select status, deleted_at from borrow_requests where id = ${hold.id}
  `;
  expect(after.status).toBe("approved");
  expect(after.deleted_at).toBeNull();
});

test("the copy is hidden again when the clock moves back before the hold expires", async () => {
  // The same fixture read at three instants, out of order, to rule out the
  // one alternative explanation for the test above: that the first read
  // somehow latched a value. `olibra_now()` is STABLE, not IMMUTABLE, so the
  // planner may not fold it to a constant and reuse it across plans; marking
  // it IMMUTABLE is the mistake this catches.
  const shelf = await makeShelf(sql);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);
  await sql`
    insert into borrow_requests
      (bookshelf_id, book_id, copy_id, member_id, status, requested_at,
       hold_expires_at)
    values
      (${shelf.id}, ${bookId}, ${copyIds[0]}, ${reader.userId}, 'approved',
       timestamptz '2026-08-08T02:00:00Z', timestamptz '2026-08-08T10:00:00Z')
  `;

  const borrowable = (instant: string) =>
    runQuery(
      sql,
      ctxAt(shelf.id, instant),
      (tx) => tx<{ id: string }[]>`select id from copies_borrowable`,
    );

  expect(await borrowable("2026-08-08T11:00:00Z")).toHaveLength(1);
  expect(await borrowable("2026-08-08T09:00:00Z")).toHaveLength(0);
  expect(await borrowable("2026-08-08T11:00:00Z")).toHaveLength(1);
});

test("olibra_now() falls back to now() on a connection the kernel never touched", async () => {
  // A `psql` session, a migration, `src/db/seed.ts`, `session.ts`'s own
  // `sql.begin` — none of them go through `runQuery`/`runCommand`, and every
  // one of them must still see real time rather than an error or a null. A
  // fresh connection is used on purpose: the shared `sql` handle in this
  // suite has already had `olibra.now` set on it by the tests above, which is
  // the *other* case, covered by the test below.
  const fresh = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    const [row] = await fresh<
      { unset: string | null; matches_now: boolean; drift: number }[]
    >`
      select
        current_setting('olibra.now', true)            as unset,
        olibra_now() = now()                           as matches_now,
        abs(extract(epoch from (olibra_now() - clock_timestamp()))) as drift
    `;
    // Never set on this connection at all, so `missing_ok` is what keeps
    // `current_setting` from raising `unrecognized configuration parameter`.
    expect(row.unset).toBeNull();
    expect(row.matches_now).toBe(true);
    expect(Number(row.drift)).toBeLessThan(5);
  } finally {
    await fresh.end();
  }
});

test("olibra.now is transaction-local and does not leak to the next transaction", async () => {
  // The connection is pooled. A clock that survived its transaction would
  // freeze time for whatever unrelated request got that connection next —
  // silently, and only in production, where connections are reused. This is
  // the clock half of the leak DB §3 describes for `olibra.bookshelf_id`.
  //
  // Set through the kernel, read outside it, on the same physical connection:
  // `tests/support/db.ts` builds `sql` with `max: 1` precisely so "the same
  // connection" is a fact rather than a hope.
  const shelf = await makeShelf(sql);
  const inside = await runQuery(
    sql,
    ctxAt(shelf.id, "2020-01-02T03:04:05Z"),
    async (tx) => {
      const [row] = await tx<
        { injected: string }[]
      >`select olibra_now() as injected`;
      return row.injected;
    },
  );
  expect(new Date(inside).toISOString()).toBe("2020-01-02T03:04:05.000Z");

  const [row] = await sql<
    { leftover: string | null; matches_now: boolean; drift: number }[]
  >`
    select
      current_setting('olibra.now', true)             as leftover,
      olibra_now() = now()                            as matches_now,
      abs(extract(epoch from (olibra_now() - clock_timestamp()))) as drift
  `;
  // Not null — the empty string. DB §3 names this for the tenant GUC and it
  // is identical here: a LOCAL setting does not revert to *unset* when its
  // transaction ends, it reverts to `''`. `''::timestamptz` raises rather
  // than returning null, so `olibra_now()`'s `nullif(..., '')` is what makes
  // this line a fallback instead of an error. Asserting the empty string
  // rather than "not the injected value" is what keeps this test pointed at
  // the `nullif`.
  expect(row.leftover).toBe("");
  expect(row.matches_now).toBe(true);
  expect(Number(row.drift)).toBeLessThan(5);
});
