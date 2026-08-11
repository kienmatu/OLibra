import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
// Imported rather than restated, for the reason recorded in
// `../commands/lend-copy.ts`: two identical copies of `requireManager` already
// exist and each says the tidy end state is one copy in the kernel. This
// slice's files all take the catalogue's.
import { requireManager } from "../../catalogue/policy";

export interface LoanForReturnRow {
  loanId: string;
  copyId: string;
  copyCode: string;
  bookId: string;
  title: string;
  /** `books.cover_url` — Task 12 (2026-08-10 QA remediation), see
   *  `src/components/ui/book.tsx`'s own docstring for why this now travels
   *  with every row a `BookCover` renders rather than being guessed from the
   *  title. */
  coverUrl: string | null;
  /**
   * `loans.borrower_id` — a `users(id)`, not a `memberships(id)`
   * (`0005_circulation.sql:20`). Named for the id it actually carries, the
   * same discipline `copyLendable`'s `forUserId` follows, so that a caller
   * joining this to a membership has to notice it is doing so.
   */
  borrowerUserId: string;
  borrowerName: string;
  dueOn: string;
  isOverdue: boolean;
  daysRemaining: number;
}

/**
 * Step 1 of the return flow (OPS §5, "Tìm sách đang mượn"): find the loan to
 * receive back, by book, by reader, or by the code on the copy's label.
 *
 * The third search key is the one the shelf actually uses. OPS §5's second
 * entry point exists because "every step removed from a volunteer holding a
 * phone next to a book is worth more than a feature elsewhere" — and the
 * volunteer is holding the copy, whose code is printed on it (the column's own
 * comment calls it "intended to become a QR label", `0004_catalogue.sql:60`). Searching a title
 * returns as many rows as there are copies out; searching the code in their
 * hand returns exactly one.
 *
 * **Only `status = 'active'` rows.** `loans_current` is every loan plus two
 * derived columns, never pre-filtered — the explicit filter is what makes
 * this "out right now" rather than "ever borrowed", and it is also what keeps
 * an already-returned loan off the screen so a double submit cannot be aimed
 * at it. `receiveReturn` refuses one anyway (`loan_not_active`); this is the
 * screen not offering what the command would refuse, which is BR §16.3's
 * whole shape.
 *
 * **`isOverdue` and `daysRemaining` are the view's, never recomputed here**
 * (G5: overdue is derived, never written). They follow `ctx.clock`, because
 * `20260808_14_olibra_now.sql:97-105` had both columns read `olibra_now()`
 * and `runQuery` sets the `olibra.now` GUC from `ctx.clock` on the way in. A
 * second definition of "overdue" in TypeScript would be a second definition
 * in a second language, and it would buy nothing: a `fixedClock` already
 * moves these two. See `../../members/queries/get-reader-detail.ts`, which
 * carries the same note and the history behind it.
 */
export async function searchLoansForReturn(
  tx: Tx,
  ctx: TenantContext,
  input: { q: string },
): Promise<LoanForReturnRow[]> {
  requireManager(ctx);

  // A blank box lists nothing, exactly as `searchBooksForLending:34` and
  // `searchReadersForLending:67` do. The `olibra_fold(…) <> ''` guard below
  // would already reduce a blank query to zero rows; returning early is how
  // the three quick-action searches stay one behaviour rather than three that
  // agree by accident.
  if (input.q.trim() === "") return [];

  const rows = await tx<
    {
      loan_id: string;
      copy_id: string;
      copy_code: string;
      book_id: string;
      title: string;
      cover_url: string | null;
      borrower_user_id: string;
      borrower_name: string;
      due_on: string;
      is_overdue: boolean;
      days_remaining: number;
    }[]
  >`
    select
      l.id as loan_id,
      l.copy_id, c.code as copy_code,
      l.book_id, b.title, b.cover_url,
      l.borrower_id as borrower_user_id,
      u.full_name  as borrower_name,
      l.due_on::text as due_on,
      l.is_overdue, l.days_remaining
    from loans_current l
    join book_copies c on c.id = l.copy_id
    join books       b on b.id = l.book_id
    -- borrower_id is a users(id) (0005_circulation.sql:20), so the borrower's
    -- name comes from users directly. Joining memberships instead would drop
    -- every loan whose borrower has since left the shelf — and a book they
    -- still hold is exactly the loan a manager most needs to find.
    join users       u on u.id = l.borrower_id
    where l.status = 'active'
      -- M7 (fix-report, 2026-08-08-b1-catalogue), the same guard both shipped
      -- quick-action searches carry: a query made entirely of punctuation
      -- folds to '', which would degenerate every LIKE below to '%%' and list
      -- every loan on the shelf.
      and olibra_fold(${input.q}) <> ''
      and (
        b.title_folded like '%' || olibra_fold(${input.q}) || '%'
        -- Neither users.full_name nor book_copies.code has a stored folded
        -- column (verified against 0003_identity.sql and 0004_catalogue.sql),
        -- so both fold at query time. Folding the *code* rather than matching
        -- it plainly is what lets "dt 0142", "DT-0142" and "dt-0142" all find
        -- the label a volunteer is squinting at: olibra_fold turns
        -- punctuation into a space on both sides of the comparison, so the
        -- hyphen cannot be the reason a search misses.
        or olibra_fold(u.full_name) like '%' || olibra_fold(${input.q}) || '%'
        or olibra_fold(c.code)      like '%' || olibra_fold(${input.q}) || '%'
      )
    -- Soonest due first, which puts the overdue ones at the top: the loans a
    -- manager is most likely to be receiving back. Then the copy code, so two
    -- loans sharing a due date come back in a stable order rather than
    -- whatever the plan happens to produce.
    order by l.due_on, c.code
  `;

  return rows.map((r) => ({
    loanId: r.loan_id,
    copyId: r.copy_id,
    copyCode: r.copy_code,
    bookId: r.book_id,
    title: r.title,
    coverUrl: r.cover_url,
    borrowerUserId: r.borrower_user_id,
    borrowerName: r.borrower_name,
    dueOn: r.due_on,
    isOverdue: r.is_overdue,
    // Not wrapped in `Number()`, unlike every `count(*)` in this codebase, and
    // the difference is the Postgres type rather than a style choice: `date -
    // date` is `int4`, which this driver hands back as a JavaScript number,
    // while `count()` is `int8`, which it hands back as a *string* because
    // int8 does not fit a number safely. Measured on this project's test
    // database, not assumed. (`get-reader-detail.ts:171` wraps the identical
    // column; that call is a harmless no-op, not a conversion this one is
    // missing.)
    daysRemaining: r.days_remaining,
  }));
}
