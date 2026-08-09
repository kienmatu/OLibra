import { requireReader } from "../domain/catalogue/policy";
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
  /**
   * BR §5.5's `hold_days`, defaulting to 3.
   *
   * Read for one screen only, the same way `loanDays` above is: the borrow
   * queue tells a manager how long the hold they are about to create will
   * stand ("Giữ chỗ 3 ngày kể từ khi duyệt", the sentence that screen already
   * carried with the number written into it). `approveBorrowRequest` reads the
   * value again for itself, through `holdDaysFor`, and that read is the one
   * that decides the row; this one only has to agree with it, which it does by
   * being the same `coalesce` over the same column.
   */
  holdDays: number;
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
    {
      name: string;
      max_concurrent_loans: number;
      loan_days: number;
      hold_days: number;
    }[]
  >`
    select
      name,
      coalesce((settings->>'max_concurrent_loans')::int, 3) as max_concurrent_loans,
      coalesce((settings->>'loan_days')::int, 14)           as loan_days,
      coalesce((settings->>'hold_days')::int, 3)            as hold_days
    from bookshelves
    where id = ${ctx.bookshelfId}
  `;
  if (!row) throw new NotFound("shelf_not_found");
  return {
    name: row.name,
    maxConcurrentLoans: row.max_concurrent_loans,
    loanDays: row.loan_days,
    holdDays: row.hold_days,
  };
}

/**
 * What a shelf page says about the shelf itself: BR §16.1's shelf-home item 1,
 * "name, where it is, when it is open, who holds the key with a tappable phone
 * number".
 *
 * Every field is nullable except the name, because every column behind them is
 * (`0003_identity.sql`) and a parish onboarded on a Sunday afternoon has filled
 * in what it knew. A page renders the rows it has; a `dt` labelled "Giờ mở cửa"
 * over a blank `dd` is worse than no row, and a `MapPin` pointing at nothing is
 * the same mistake the portal already declines to make.
 *
 * **`requireReader` is called here, and that is the whole disclosure argument.**
 * This is the one read in `src/lib/` that names `keeper_name` and
 * `keeper_phone`, which BR §16.1 withholds from anyone without a membership —
 * "Book counts, reader counts and keeper contact are not shown, because a
 * person with no membership has no business knowing them" — and which
 * `tests/db/bookshelves-public-columns.test.ts` guards for exactly that reason.
 * `bookshelves_public_read` admits the whole row to any caller, so the column
 * list is the only thing standing there (DATABASE.md §4.2), and every other
 * exemption in that guard argues that its file is unreachable without a
 * membership. `readShelf` above cannot make that argument — it runs on the `Tx`
 * before the page's own gated query does — so this function does not rely on
 * the page beside it either. It refuses first, itself, with the domain's own
 * `requireReader`, and `loadPage` then turns that `RuleViolated` into a
 * redirect for a guest or a 404 for a signed-in non-member before a byte of
 * HTML exists.
 *
 * That check is *added*, never a gate that was moved or relaxed: the queries
 * these pages call each still run their own `requireReader`, and nothing in
 * `src/domain/` changed. Two refusals for one page is the point — U1 §3.4's
 * split between the domain deciding permission and the surface deciding
 * visibility only holds while the surface's own reads are gated too.
 *
 * **One function for all four member pages**, not a narrow name-only variant
 * beside it. `danh-muc` and `tim-kiem` render only the name today; the shelf
 * home and the book page render the keeper line BR §16.1 specifies word for
 * word ("Liên hệ {keeper} · {phone} để nhận sách."). Splitting that into two
 * reads would put the same `select` in two places for the benefit of not
 * loading two strings a member is entitled to see — and two nearly identical
 * shelf reads is how one of them later drifts from the other's guard exemption.
 */
export interface ShelfIdentity {
  name: string;
  /** `0003_identity.sql:46` — "physical location, shown publicly". */
  location: string | null;
  /** Free text: "Mở sau lễ Chúa nhật · 9:00 đến 11:00". */
  openingHours: string | null;
  keeperName: string | null;
  keeperPhone: string | null;
}

export async function readShelfIdentity(
  tx: Tx,
  ctx: TenantContext,
): Promise<ShelfIdentity> {
  requireReader(ctx);

  const [row] = await tx<
    {
      name: string;
      location: string | null;
      opening_hours: string | null;
      keeper_name: string | null;
      keeper_phone: string | null;
    }[]
  >`
    select name, location, opening_hours, keeper_name, keeper_phone
    from bookshelves
    where id = ${ctx.bookshelfId}
  `;
  // Same reasoning as `readShelf` above: a missing row is the code `loadPage`
  // maps to a 404, not a `TypeError` from destructuring `undefined`.
  if (!row) throw new NotFound("shelf_not_found");
  return {
    name: row.name,
    location: row.location,
    openingHours: row.opening_hours,
    keeperName: row.keeper_name,
    keeperPhone: row.keeper_phone,
  };
}
