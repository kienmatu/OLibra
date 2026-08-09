import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
// Imported rather than restated, for the reason `../commands/lend-copy.ts`
// records: two identical copies of `requireManager` already exist and each says
// the tidy end state is one copy in the kernel. This slice's files all take the
// catalogue's, as `./search-loans-for-return.ts` beside it does.
import { requireManager } from "../../catalogue/policy";

/**
 * The three orderings this screen offers, as the domain spells them.
 *
 * **Not BR §16.3's three.** BR:573 specifies exactly one — "Sorted by how
 * overdue, showing borrower and contact phone" — and says nothing about a
 * choice. The three come from two other places: OPS:93 gives `GetOverdueLoans`
 * a `sort` input, and the fixture page's `<select>` already carried three
 * labels ("Trễ nhiều nhất trước", "Trễ ít nhất trước", "Tên bạn đọc"), inert.
 * `qua-han/page.tsx:26-32` states this correctly and is where the labels live;
 * this comment used to contradict it.
 *
 * The URL spells them in Vietnamese (`?sap-xep=tre-it`) and the page does that
 * translation, the same split `getBooksList` makes for `sort: "recent" |
 * "title"` against `danh-muc`'s `?sap-xep=ten`.
 */
export type OverdueSort = "most-late" | "least-late" | "borrower";

export interface OverdueLoanRow {
  loanId: string;
  copyId: string;
  copyCode: string;
  bookId: string;
  title: string;
  /**
   * `loans.borrower_id` — a `users(id)`, not a `memberships(id)`
   * (`0005_circulation.sql:20`). Named for the id it actually carries, the same
   * discipline `LoanForReturnRow` follows, so a caller joining this to a
   * membership has to notice it is doing so.
   */
  borrowerUserId: string;
  borrowerName: string;
  /**
   * BR §16.3's entire reason this screen exists: "Sorted by how overdue,
   * showing borrower and contact phone. That phone number is the actual
   * mechanism by which books come back, so it must be tappable."
   *
   * Nullable because `users.phone` is (`0003_identity.sql`). A family that
   * never gave a number is a real row, and a screen that printed an empty
   * `tel:` link would be offering a tap that dials nothing.
   */
  borrowerPhone: string | null;
  dueOn: string;
  /**
   * How many days late, as a positive number — `-days_remaining` from
   * `loans_current`, never a second subtraction performed here.
   *
   * G5, and OPS §3.3's own note on `GetOverdueLoans`: "Days late — computed
   * from `due_on` vs. today (§8), never stored." The view derives it against
   * `olibra_now()`, which `unit-of-work.ts` sets from `ctx.clock`, so a
   * `fixedClock` moves this number with nothing written and no job run.
   */
  daysLate: number;
}

/**
 * OPS §3.3's `GetOverdueLoans` — "Loans past due, sorted by lateness. Inputs:
 * `bookshelfId`, `sort`. Returns: borrower, phone, days late, due date."
 *
 * **Not a widening of `searchLoansForReturn`**, and the reconciliation in U3's
 * plan says why in one line: that query "requires a search term and returns no
 * borrower phone, which BR:573 makes the whole point of the screen". Widening
 * it would mean the return flow's search — which exists to find *one* loan from
 * a code printed on a copy in the volunteer's hand — growing a mode where it
 * lists everything and carries a child's phone number into every result. Two
 * screens, two questions, two queries; they share the shape of their rows
 * because they are both loans, and nothing else.
 *
 * ── Scoping, and why `users` is joined directly ─────────────────────────────
 *
 * There is no `where bookshelf_id` here, deliberately. `loans_current` is
 * `security_invoker` (`0011_views.sql`, which records what happens without that
 * clause, having verified it live), so `loans_tenant` is evaluated as
 * `olibra_app` with `olibra.bookshelf_id` set by `runQuery` — the rows this
 * returns are this shelf's because RLS says so, and
 * `tests/domain/circulation/overdue-loans.test.ts` asserts that by running this
 * same function under `olibra_admin`, which holds `bypassrls`.
 *
 * `users` carries no RLS at all (`0010_rls.sql`'s loop excludes it, with
 * `categories` and site-wide `feedback`), so the join to it can only ever narrow
 * what `loans` already admitted — it cannot widen it. It is joined *directly*,
 * rather than through `memberships`, for `searchLoansForReturn`'s stated reason
 * and it applies twice as strongly here: joining `memberships` would drop every
 * loan whose borrower has since left the shelf, and a book somebody still holds
 * after leaving is precisely the overdue loan a manager most needs the phone
 * number for.
 *
 * ── The order is total, and one third of it is folded ───────────────────────
 *
 * `l.id` ends every ordering. Two loans due on the same day is the ordinary
 * case on a shelf that lends after Sunday mass, so `due_on` alone is not a total
 * order and the rows would come back in whatever order the plan happened to
 * produce — a list that reshuffles between two reads of the same data, which is
 * how a volunteer working down a call list loses their place. It is also what a
 * `limit`/`offset` would need if this ever grows one; see below on why it has
 * none today.
 *
 * `olibra_fold(u.full_name)`, not `u.full_name`, for the borrower ordering. This
 * cluster's collation is `C`, so byte order is the order and `Đ` encodes above
 * every ASCII letter — every child called *Đặng* or *Đỗ* would sort after every
 * *Vũ*, at the bottom of the list. The same defect U2 found in the two catalogue
 * queries, U3 wave 1 found in `getReadersList`, and this query would have
 * inherited by writing the obvious thing.
 *
 * **It is not paged**, and that is a decision rather than an omission. The two
 * shipped queues of this shape — `getPendingRegistrations` and
 * `getPendingProfileChanges` — are unpaged for the same reason: the set is
 * bounded by its own state rather than by the size of the shelf, and a parish
 * with two hundred overdue loans has a problem no pagination control addresses.
 * The order is total anyway, so adding `limit`/`offset` later is two lines and
 * not a re-derivation — which is the half of the paging trap that is expensive
 * to fix afterwards (U2 measured 304 titles collected over a paged walk and 229
 * distinct, on a query whose order was not total).
 */
export async function getOverdueLoans(
  tx: Tx,
  ctx: TenantContext,
  input: { sort?: OverdueSort } = {},
): Promise<OverdueLoanRow[]> {
  requireManager(ctx);

  const sort: OverdueSort = input.sort ?? "most-late";

  const rows = await tx<
    {
      loan_id: string;
      copy_id: string;
      copy_code: string;
      book_id: string;
      title: string;
      borrower_user_id: string;
      borrower_name: string;
      borrower_phone: string | null;
      due_on: string;
      days_late: number;
    }[]
  >`
    select
      l.id as loan_id,
      l.copy_id, c.code as copy_code,
      l.book_id, b.title,
      l.borrower_id as borrower_user_id,
      u.full_name   as borrower_name,
      u.phone       as borrower_phone,
      l.due_on::text as due_on,
      -- The view's own derived column, negated. Never a second subtraction of
      -- due_on from today written here: that would be a second definition of
      -- lateness, in a second language, and G5 exists to forbid exactly that.
      (-l.days_remaining) as days_late
    from loans_current l
    join book_copies c on c.id = l.copy_id
    join books       b on b.id = l.book_id
    join users       u on u.id = l.borrower_id
    -- is_overdue already carries status = 'active' (0011_views.sql), so a
    -- returned loan, however late it was, is not on this screen -- and neither
    -- is one closed as lost or voided.
    where l.is_overdue
    order by
      -- One arm per sort. Each case expression is null for every row when its
      -- own sort was not chosen, and ordering by an all-null key is a no-op --
      -- the same shape getBooksList already uses for its title/recent switch.
      case when ${sort}::text = 'borrower' then olibra_fold(u.full_name) end asc,
      case when ${sort}::text = 'least-late' then l.due_on end desc,
      case when ${sort}::text = 'most-late' then l.due_on end asc,
      l.id
  `;

  return rows.map((r) => ({
    loanId: r.loan_id,
    copyId: r.copy_id,
    copyCode: r.copy_code,
    bookId: r.book_id,
    title: r.title,
    borrowerUserId: r.borrower_user_id,
    borrowerName: r.borrower_name,
    borrowerPhone: r.borrower_phone,
    dueOn: r.due_on,
    // Not wrapped in `Number()`, for the reason `search-loans-for-return.ts`
    // measured on this project's database: `date - date` is `int4`, which this
    // driver hands back as a JavaScript number, while `count()` is `int8` and
    // arrives as a string.
    daysLate: r.days_late,
  }));
}
