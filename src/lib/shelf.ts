import { NotFound } from "../domain/kernel/errors";
import type { TenantContext } from "../domain/kernel/tenant";
import type { Tx } from "../domain/kernel/unit-of-work";

export interface ShelfPageData {
  /** The shelf's own name, for `ManagerShell`'s chrome. */
  name: string;
  /**
   * BR §5.5's `max_concurrent_loans`, defaulting to 3.
   *
   * Read here rather than inside `searchReadersForLending`, which takes it as
   * a parameter — U1 §4 and that query's own docstring both say why: the
   * predicate is pure and cannot reach a shelf row, so the *caller* owns
   * knowing where a shelf's lending policy lives. This is that one caller.
   */
  maxConcurrentLoans: number;
  /**
   * BR §5.5's `loan_days`, defaulting to 14.
   *
   * Read for one screen only: the confirm step previews the due date the lend
   * is about to write, through the domain's own `dueDateFor`. `lendCopy` reads
   * this value again for itself (`loanDaysFor`) and that read is the one that
   * decides the row — this one only has to agree with it, which it does by
   * being the same `coalesce` over the same column.
   */
  loanDays: number;
}

/**
 * The two facts every manager lending screen needs about the shelf itself,
 * read once, inside the page's own scoped transaction.
 *
 * **Why this is not a query in `src/domain/`.** OPS §3 defines no
 * `GetShelfHeader`, and inventing one so five pages can put a name in a
 * heading would be a domain change U1 is explicitly not making. What it *is*
 * is the surface concern U1 §4 already names for the lending policy — one
 * place that knows where a shelf's own configuration lives — so both reads sit
 * together in `src/lib/`, on the surface side of the boundary
 * `tests/architecture/boundaries.test.ts` draws.
 *
 * **Extracted rather than repeated.** U1 Task 2 landed this as an inline
 * `select` in `quan-ly/cho-muon/page.tsx`, with a note that Task 3 would have
 * five more pages wanting it. Five copies of one `select` is five places to
 * fix when the chrome grows a second field.
 *
 * It runs on the `Tx` `loadPage` hands the page, so it is inside the same
 * read-only transaction with `olibra.bookshelf_id` set and `role olibra_app`
 * assumed. `bookshelves_tenant` therefore applies to it exactly as it does to
 * every domain query, and `ctx.bookshelfId` is the id `contextFor` already
 * resolved — not a slug this function looks up for itself.
 *
 * **It names two columns and no more.** BR §16.1 withholds a shelf's keeper
 * contact from anyone without a membership, and since
 * `bookshelves_public_read` widened `select` on the table to every active row,
 * the column list is the only thing protecting them (DB §4.2).
 * `tests/db/bookshelves-public-columns.test.ts` is the guard, and this file
 * carries the narrowest exemption it offers: one column, `settings`, read only
 * as `coalesce((settings->>'max_concurrent_loans')::int, 3)`, so an integer
 * leaves this function and the JSON never does. See that test's own docstring
 * for the entry and the reasoning, which is the same shape it already accepts
 * from `lend-copy.ts` for the identical value.
 *
 * **The missing-row case is `NotFound("shelf_not_found")`**, matching
 * `loanDaysFor` and `resolveHold` in `domain/circulation/` rather than
 * destructuring an absent row into a `TypeError`. `loadPage` maps exactly that
 * code to `notFound()`, so a shelf that vanished between `contextFor` and this
 * read renders a 404 rather than a stack trace. It is not reachable today —
 * `contextFor` resolved the id from this very table one statement earlier.
 */
export async function readShelf(
  tx: Tx,
  ctx: TenantContext,
): Promise<ShelfPageData> {
  const [row] = await tx<
    { name: string; max_concurrent_loans: number; loan_days: number }[]
  >`
    select
      name,
      coalesce((settings->>'max_concurrent_loans')::int, 3) as max_concurrent_loans,
      coalesce((settings->>'loan_days')::int, 14)           as loan_days
    from bookshelves
    where id = ${ctx.bookshelfId}
  `;
  if (!row) throw new NotFound("shelf_not_found");
  return {
    name: row.name,
    maxConcurrentLoans: row.max_concurrent_loans,
    loanDays: row.loan_days,
  };
}
