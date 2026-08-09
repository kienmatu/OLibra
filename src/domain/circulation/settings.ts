import { NotFound } from "../kernel/errors";
import type { Tx } from "../kernel/unit-of-work";

/**
 * BR §5.5's two per-shelf lending numbers, read from the shelf row.
 *
 * **One module rather than a private copy in each command** (C2). `loanDaysFor`
 * arrived as a private function in `./commands/lend-copy.ts` and `hold_days` as
 * three lines inside `./commands/receive-return.ts`'s `resolveHold`, which was
 * fine while each had one caller. C2 gives `hold_days` a second caller
 * (`ApproveBorrowRequest`) and `loan_days` a second one by way of
 * `HandoverRequest`, and two copies of "coalesce to 3" is how one of them later
 * stops matching the settings screen — the same argument `pageNumber` and
 * `isUuid` each record for moving out of the page that first needed them.
 *
 * **`max_concurrent_loans` is deliberately not here.** It is passed *into*
 * `memberMayBorrow` as a parameter (see that function), because a pure
 * predicate a screen calls cannot reach a shelf row; these two are read by
 * commands that already have a transaction open. The asymmetry is stated in
 * `memberMayBorrow`'s own docstring and is not an oversight.
 *
 * **The defaults are the values nearly every shelf uses, not corner cases.**
 * `makeShelf` leaves `settings` as `{}` and DB §4.2 says a shelf row "need only
 * store what it overrides", so a shelf that has never opened the settings screen
 * gets 14 and 3 from here rather than from a column.
 *
 * The missing-row case is `NotFound("shelf_not_found")` in both, rather than
 * destructuring an absent row and returning a raw `TypeError` from inside a
 * transaction — the unstructured exception OPS §2 forbids. It is not reachable
 * today: `bookshelves_tenant`'s policy matches unconditionally (verified against
 * `pg_policy`), so a shelf id that reached `runCommand` finds its row.
 */

/** BR §5.5's `loan_days`, defaulting to 14. */
export async function loanDaysFor(tx: Tx, bookshelfId: string): Promise<number> {
  const [row] = await tx<{ loan_days: number }[]>`
    select coalesce((settings->>'loan_days')::int, 14) as loan_days
      from bookshelves where id = ${bookshelfId}
  `;
  if (!row) throw new NotFound("shelf_not_found");
  return row.loan_days;
}

/** BR §5.5's `hold_days`, defaulting to 3 — how long a hold stands. */
export async function holdDaysFor(tx: Tx, bookshelfId: string): Promise<number> {
  const [row] = await tx<{ hold_days: number }[]>`
    select coalesce((settings->>'hold_days')::int, 3) as hold_days
      from bookshelves where id = ${bookshelfId}
  `;
  if (!row) throw new NotFound("shelf_not_found");
  return row.hold_days;
}

/**
 * BR §5.5's two renewal numbers, read together because INV-6 needs both in one
 * breath: `max_renewals` (default 1) decides *whether* a loan may be renewed,
 * `renewal_days` (default 7) decides *by how much*, and a command that read one
 * without the other could only ever answer half the rule.
 *
 * One statement rather than two round trips, unlike the pair above — those two
 * have callers that genuinely want one number each (`lendCopy` never asks about
 * holds), and this pair has exactly one caller that always wants both.
 */
export async function renewalSettingsFor(
  tx: Tx,
  bookshelfId: string,
): Promise<{ maxRenewals: number; renewalDays: number }> {
  const [row] = await tx<{ max_renewals: number; renewal_days: number }[]>`
    select coalesce((settings->>'max_renewals')::int, 1) as max_renewals,
           coalesce((settings->>'renewal_days')::int, 7) as renewal_days
      from bookshelves where id = ${bookshelfId}
  `;
  if (!row) throw new NotFound("shelf_not_found");
  return { maxRenewals: row.max_renewals, renewalDays: row.renewal_days };
}
