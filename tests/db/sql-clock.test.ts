import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import postgres, { type TransactionSql } from "postgres";
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
 * `readLoan`, with the *session* timezone pinned for the duration of the read.
 *
 * The timezone test below is the only caller and needs this to be a guard
 * rather than a coincidence. `set local` inside the same transaction
 * `runQuery` opened, so it is scoped to this read and reverts with it —
 * `SET` is permitted in a read-only transaction.
 */
function readLoanInZone(
  shelfId: string,
  instant: string,
  zone: string,
): Promise<LoanRow> {
  return runQuery(sql, ctxAt(shelfId, instant), async (tx) => {
    await tx`select set_config('TimeZone', ${zone}, true)`;
    const [row] = await tx<LoanRow[]>`
      select is_overdue, days_remaining from loans_current
    `;
    return row;
  });
}

/**
 * The id of the transaction that last wrote a row, plus the columns the
 * clock could plausibly be accused of having rewritten.
 *
 * Read from the base table, not through the view: a view exposes no system
 * columns, so `select xmin from loans_current` fails outright with `column
 * "xmin" does not exist` — which is itself worth knowing, since it is the
 * reason the "nothing was written" assertions below reach past the view to
 * the table underneath it.
 *
 * **What the `xmin` assertions are and are not.** They are confirmatory
 * narration, not a regression guard, and the comments below say so rather
 * than implying otherwise. `xmin` *cannot* differ across these reads: every
 * read here goes through `runQuery`, which issues `set transaction read only`
 * before anything else, so a write attempted inside one is rejected by
 * Postgres outright rather than committing and bumping `xmin`. There is no
 * implementation of `olibra_now()` or of these views that could make the
 * assertion fail. It is kept because it states, in the database's own terms
 * and not the test's, what "the clock is the only thing that moved" means —
 * and because a future rewrite of these tests that dropped `runQuery` for a
 * raw handle would find the assertion already in place.
 */
async function xminOf(table: "loans" | "borrow_requests", id: string) {
  const [row] = await sql<{ xmin: string }[]>`
    select xmin::text from ${sql(table)} where id = ${id}
  `;
  return row.xmin;
}

const loanXmin = (loanId: string) => xminOf("loans", loanId);

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

  // Nothing wrote the row between the two reads, in Postgres's own terms:
  // `xmin` is the id of the transaction that last wrote it, so an equal
  // `xmin` says the row is physically untouched — a stronger statement than
  // comparing `updated_at`, which a trigger could have rewritten to the same
  // value. Confirmatory rather than a guard: see `xminOf` for why it cannot
  // fail while the reads go through `runQuery`.
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
  //
  // **The session timezone is pinned, and that is what makes this a guard.**
  // `olibra_now()::date` — the broken form — resolves through the *session's*
  // `TimeZone`, so whether it gives the wrong answer depends on what that
  // happens to be. It is UTC today only because that is Docker's default and
  // `compose.yaml` pins nothing; give the `db-test` container
  // `TZ=Asia/Ho_Chi_Minh` and the broken view agrees with the correct one and
  // this test goes green against it. Verified by doing exactly that: recreated
  // the container with that TZ (tmpfs, so a fresh initdb picks it up), applied
  // a view without the conversion, and watched this test pass.
  //
  // Reading under three zones — one of which is the application's own — and
  // demanding the same answer from all three is the fix, and it needs no
  // cooperation from the server's configuration: under the correct view the
  // explicit `at time zone` makes the session irrelevant, and under the broken
  // one at least two of the three disagree with these expectations no matter
  // what the server default is.
  const { shelfId, loanId } = await shelfWithLoan("2026-08-08");
  const xminBefore = await loanXmin(loanId);

  for (const zone of ["UTC", "America/Los_Angeles", "Asia/Ho_Chi_Minh"]) {
    const stillToday = await readLoanInZone(shelfId, "2026-08-08T16:00:00Z", zone);
    expect(stillToday.is_overdue, zone).toBe(false);
    expect(Number(stillToday.days_remaining), zone).toBe(0);

    const justAfterMidnight = await readLoanInZone(
      shelfId,
      "2026-08-08T17:30:00Z",
      zone,
    );
    expect(justAfterMidnight.is_overdue, zone).toBe(true);
    expect(Number(justAfterMidnight.days_remaining), zone).toBe(-1);
  }

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
  const xminBefore = await xminOf("borrow_requests", hold.id);

  const borrowable = (instant: string) =>
    runQuery(
      sql,
      ctxAt(shelf.id, instant),
      (tx) => tx<{ id: string }[]>`select id from copies_borrowable`,
    );

  expect(await borrowable("2026-08-08T09:59:00Z")).toHaveLength(0);
  expect(await borrowable("2026-08-08T10:01:00Z")).toHaveLength(1);

  // Nothing tidied the hold up. `hold_expires_at` is the column this test's
  // whole claim turns on — "the clock moved, the expiry did not" — and it was
  // the one column not being checked: `status` and `deleted_at` alone leave
  // room for an implementation that quietly pushed the expiry around. It is
  // asserted first, and against the literal the fixture was written with.
  const [after] = await sql<
    { status: string; deleted_at: string | null; hold_expires_at: Date }[]
  >`
    select status, deleted_at, hold_expires_at
      from borrow_requests where id = ${hold.id}
  `;
  expect(after.hold_expires_at.toISOString()).toBe("2026-08-08T10:00:00.000Z");
  expect(after.status).toBe("approved");
  expect(after.deleted_at).toBeNull();

  // And the row is physically the one that was inserted — the same `xmin`
  // assertion the loan tests make, for the same reason and with the same
  // caveat: confirmatory, not a guard, since both reads above ran in
  // `runQuery`'s read-only transaction. See `xminOf`.
  expect(await xminOf("borrow_requests", hold.id)).toBe(xminBefore);
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

/**
 * What `olibra_now()` refuses (`20260808_15_olibra_now_strict.sql`).
 *
 * These are the third and last exception to this file's "go through
 * `runQuery`" rule, and the reason is the opposite of the other two: the
 * kernel *cannot* produce any of these values —
 * `assertValidClockInstant`/`toISOString()` see to that — so a test that went
 * through the kernel could not reach the guard at all. The function is the
 * schema's contract, not the kernel's private helper: a `psql` session, a
 * migration or a future slice can set this GUC, and what happens then is what
 * these pin.
 *
 * `set_config(..., true)` — LOCAL, inside `sql.begin` — so a rejected value
 * cannot outlive its transaction and poison the rest of the suite on this
 * `max: 1` handle.
 */
function withOlibraNow<T>(value: string, body: (tx: TransactionSql) => Promise<T>) {
  return sql.begin(async (tx) => {
    await tx`select set_config('olibra.now', ${value}, true)`;
    return body(tx as TransactionSql);
  }) as Promise<T>;
}

async function errorFor(
  value: string,
): Promise<{ code?: string; message: string }> {
  return withOlibraNow(value, (tx) => tx`select olibra_now()`).then(
    () => ({ message: "no error was raised" }),
    (e: { code?: string; message: string }) => e,
  );
}

test("a value with no offset is refused rather than read in the session's timezone", async () => {
  // The headline case, and the one that would have been silently wrong rather
  // than loudly wrong. `'2026-08-08 10:00:00'` was accepted by the original
  // function and resolved through the session `TimeZone`, so the *same string*
  // was 10:00+00 under UTC, 10:00+07 under Asia/Ho_Chi_Minh and 10:00-07 under
  // America/Los_Angeles — all three measured. DB §2.2: "Never rely on the
  // session TimeZone setting for correctness." Nothing in SQL required the
  // offset; one `.toISOString()` call in TypeScript was the whole guarantee.
  const e = await errorFor("2026-08-08 10:00:00");
  expect(e.code).toBe("22007");
  expect(e.message).toMatch(/explicit UTC offset/);

  // And the reason this is a guard rather than a preference: under a session
  // timezone that is not UTC, the accepted-and-guessed reading is a different
  // instant from the one the same wall-clock text means with `Z` on the end.
  // If the guard is ever relaxed, this is the assertion that says what it
  // costs.
  const [row] = await sql<{ differs: boolean }[]>`
    select (timestamptz '2026-08-08 10:00:00 +07' <> timestamptz '2026-08-08 10:00:00Z')
      as differs
  `;
  expect(row.differs).toBe(true);
});

test("the strings Postgres would happily reinterpret are refused", async () => {
  // Each of these casts cleanly to timestamptz and means something other than
  // "the instant the caller had in mind": 'now' is real time (a frozen clock
  // that is not frozen), 'epoch' is 1970, 'today' is midnight in the session
  // timezone. Accepting them is guessing.
  for (const value of ["now", "epoch", "today", "yesterday", "allballs"]) {
    const e = await errorFor(value);
    expect(e.code, `${value} should be refused`).toBe("22007");
  }

  // A date is not an instant, and neither is a naked time. (The empty string
  // is deliberately absent: it is the pooled-connection sentinel that must
  // keep falling back to `now()`, pinned by the test above this one.)
  for (const value of ["2026-08-08", "10:00:00Z"]) {
    const e = await errorFor(value);
    expect(e.code, `${value} should be refused`).toBe("22007");
  }
});

test("infinity is refused, so loans_current stays queryable", async () => {
  // 'infinity' is a legal timestamptz and was accepted. Two separate failures
  // followed, both measured against the original function:
  //
  //   copies_borrowable  hid *every* copy — nothing is `> infinity` — so the
  //                      whole catalogue reads as unavailable, with no error.
  //   loans_current      stopped being queryable at all: `due_on -
  //                      'infinity'::date` raises `cannot subtract infinite
  //                      dates`, taking down reads that have nothing to do
  //                      with the clock.
  //
  // The second is why this is worth a guard rather than a shrug: a GUC value
  // that makes a view *raise* is worse than one that makes it wrong.
  const { shelfId } = await shelfWithLoan("2026-08-09");

  for (const value of ["infinity", "-infinity"]) {
    const e = await errorFor(value);
    expect(e.code, `${value} should be refused`).toBe("22007");
  }

  // The refusal is at the function, so both views fail the same legible way
  // rather than one hiding rows and the other raising an arithmetic error.
  const viewError = await withOlibraNow(
    "infinity",
    (tx) => tx`select is_overdue from loans_current`,
  ).then(
    () => ({ code: undefined as string | undefined }),
    (e: { code?: string }) => e,
  );
  expect(viewError.code).toBe("22007");

  // And with a value the guard accepts, the same view on the same fixture
  // answers normally — the guard rejects what is ambiguous, not what is
  // merely unusual.
  expect((await readLoan(shelfId, "2026-08-10T03:00:00Z")).is_overdue).toBe(true);
});

test("the shapes the kernel and a human might legitimately send are accepted", async () => {
  // The negative control. A guard that rejects everything would pass every
  // test above and break the application, so this pins the accepted set:
  // `toISOString()`'s exact output first, because that is the only writer
  // today, then the forms a migration or a psql session would plausibly type.
  const accepted: [string, string][] = [
    ["2026-08-08T10:00:00.000Z", "2026-08-08T10:00:00.000Z"],
    ["2026-08-08T10:00:00Z", "2026-08-08T10:00:00.000Z"],
    ["2026-08-08 10:00:00+07", "2026-08-08T03:00:00.000Z"],
    ["2026-08-08 10:00:00+07:00", "2026-08-08T03:00:00.000Z"],
    ["2026-08-08T10:00:00.123456-05:30", "2026-08-08T15:30:00.123Z"],
    ["9999-12-31T23:59:59.000Z", "9999-12-31T23:59:59.000Z"],
  ];

  for (const [value, expected] of accepted) {
    const [row] = await withOlibraNow(
      value,
      (tx) => tx<{ injected: string }[]>`select olibra_now() as injected`,
    );
    expect(new Date(row.injected).toISOString(), value).toBe(expected);
  }
});
