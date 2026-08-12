import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireManager } from "../../members/policy";

/**
 * OPS §3.4's `GetStatistics` — BR §16.3's *Thống kê* screen.
 *
 * **"Every figure is computed for the period at query time — nothing here is a
 * materialised counter."** That sentence from the operations catalogue is the
 * whole design, and it is the same rule BR §8 states for overdue status: a
 * counter is a second copy of a fact that drifts from the first one silently.
 * Every number below is an aggregate over `loans`, `books` or `book_copies` as
 * they stand, so a voided loan stops being counted the moment it is voided and
 * nobody has to remember to decrement anything.
 *
 * **The period comes from `olibra_now()`, not from `new Date()`.** A statistics
 * screen is exactly where an unmoveable clock hides: every figure would be
 * plausible, and no test could put a loan inside or outside a window. The
 * boundaries are computed in SQL from the injected instant, in
 * `Asia/Ho_Chi_Minh` — the timezone `loans_current` already compares in, and
 * the reason `derived-state.test.ts` failed daily between 17:00Z and midnight
 * before anybody noticed the two were different.
 */

export type StatsPeriod = "week" | "month" | "year" | "all";

export interface StatsPoint {
  /** `YYYY-MM-DD` in the shelf's timezone. */
  day: string;
  count: number;
}

export interface Statistics {
  period: StatsPeriod;
  loans: number;
  borrowers: number;
  booksAdded: number;
  copiesLost: number;
  daily: StatsPoint[];
  byCategory: { label: string; count: number }[];
  topBooks: { bookId: string; slug: string; title: string; count: number }[];
  topReaders: { name: string; count: number }[];
}

/** A `?ky=` value narrowed to the four OPS names, defaulting to the month. */
export function statsPeriodFrom(value: string | null): StatsPeriod {
  return value === "week" || value === "year" || value === "all" ? value : "month";
}

export async function getStatistics(
  tx: Tx,
  ctx: TenantContext,
  input: { period?: StatsPeriod } = {},
): Promise<Statistics> {
  requireManager(ctx);
  const period = input.period ?? "month";

  /**
   * The window's lower bound, decided once in SQL and carried as **text**.
   *
   * Three things ruled out the obvious spellings, and each is worth the line:
   *
   * 1. **Not `-infinity`, which is the natural way to spell "all time".** It is
   *    a perfectly good `timestamptz` and a perfectly bad `Date`: it comes back
   *    into JavaScript as an Invalid Date, and sending it to the next statement
   *    raises `RangeError: Invalid time value` from inside the driver's
   *    serialiser — a raw fault at the kernel boundary, which is what happened
   *    the first time this ran. `0001-01-01` is earlier than any row this system
   *    can hold and survives the round trip.
   * 2. **Not a SQL fragment.** `` tx`(case … end)` `` reads naturally and does
   *    not work here: the kernel wraps every tagged-template call in
   *    `guardPendingQuery`, which attaches a `.then` — so the "fragment" is
   *    *executed* as a statement of its own the moment it is built and arrives
   *    at the interpolation site as a result rather than as SQL. That is a
   *    property of this codebase's write guard, not of the driver, and it is
   *    worth knowing before the next query wants one.
   * 3. **Not computed in TypeScript.** "Start of the week in
   *    `Asia/Ho_Chi_Minh`" is exactly the arithmetic
   *    `tests/db/derived-state.test.ts` caught this suite getting wrong daily
   *    between 17:00Z and midnight, and doing it here would be a second
   *    definition beside the one `loans_current` already uses.
   *
   * A single early bound rather than branching each statement on whether there
   * is one: five identical comparisons, instead of five chances to filter one
   * figure and forget another.
   */
  const [bound] = await tx<{ since: string }[]>`
    select (case ${period}
      when 'week'  then date_trunc('week',  olibra_now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh'
      when 'month' then date_trunc('month', olibra_now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh'
      when 'year'  then date_trunc('year',  olibra_now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh'
      else '0001-01-01T00:00:00Z'::timestamptz
    end)::text as since
  `;
  const since = bound.since;

  const [totals] = await tx<
    {
      loans: number;
      borrowers: number;
      books_added: number;
      copies_lost: number;
    }[]
  >`
    select
      (
        -- Voided loans are excluded everywhere in this query. BR §11 keeps the
        -- row so that "why is there no loan here" has an answer, and a void is
        -- a correction of a mistake rather than a lending event.
        select count(*) from loans
        where lent_at >= ${since}::timestamptz and status <> 'voided'
      )::int as loans,
      (
        select count(distinct borrower_id) from loans
        where lent_at >= ${since}::timestamptz and status <> 'voided'
      )::int as borrowers,
      (
        select count(*) from books
        where created_at >= ${since}::timestamptz and deleted_at is null
      )::int as books_added,
      (
        select count(*) from book_copies
        where state = 'lost' and deleted_at is null and updated_at >= ${since}::timestamptz
      )::int as copies_lost
  `;

  const daily = await tx<{ day: string; n: number }[]>`
    select to_char(lent_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') as day,
           count(*)::int as n
      from loans
     where lent_at >= ${since}::timestamptz and status <> 'voided'
     group by day
     order by day
  `;

  const byCategory = await tx<{ label: string; n: number }[]>`
    select coalesce(c.name, 'Chưa phân loại') as label, count(*)::int as n
      from loans l
      join books b on b.id = l.book_id
      left join categories c on c.id = b.category_id
     where l.lent_at >= ${since}::timestamptz::timestamptz and l.status <> 'voided'
     group by label
     order by n desc, label asc
  `;

  const topBooks = await tx<
    { id: string; slug: string; title: string; n: number }[]
  >`
    select b.id, b.slug, b.title, count(*)::int as n
      from loans l
      join books b on b.id = l.book_id
     where l.lent_at >= ${since}::timestamptz::timestamptz and l.status <> 'voided'
     group by b.id, b.slug, b.title
     -- b.id beside the count: without a unique tiebreak a tie between two
     -- titles orders differently on every read, which this project has now
     -- measured three times.
     order by n desc, b.title asc, b.id asc
     limit 5
  `;

  /**
   * **A reader who opted out is absent, not anonymised.**
   *
   * BR §16.2's toggle is on the reader's own profile and its shipped words are
   * "Hiện tên bạn trong bảng bạn đọc chăm nhất — nếu tắt, tên bạn sẽ không xuất
   * hiện công khai." This screen's heading is that phrase. A manager can of
   * course see every loan through the lending screens and the audit log, so
   * hiding a name here withholds nothing they could not reach — which is the
   * argument for showing it, and it is the weaker one. The child was told their
   * name would not appear in this list. It does not.
   *
   * Absent rather than counted as "Ẩn danh": a row saying somebody borrowed
   * eleven books is most of the disclosure on a shelf of thirty children, and
   * pairing it with the one name missing from the list is not hard.
   */
  const topReaders = await tx<{ name: string; n: number }[]>`
    select coalesce(nullif(u.display_name, ''), u.full_name) as name,
           count(*)::int as n
      from loans l
      join users u on u.id = l.borrower_id and u.deleted_at is null
      join memberships m on m.user_id = u.id and m.deleted_at is null
     where l.lent_at >= ${since}::timestamptz::timestamptz
       and l.status <> 'voided'
       and m.leaderboard_opt_in
     group by u.id, name
     order by n desc, name asc, u.id asc
     limit 5
  `;

  return {
    period,
    loans: totals?.loans ?? 0,
    borrowers: totals?.borrowers ?? 0,
    booksAdded: totals?.books_added ?? 0,
    copiesLost: totals?.copies_lost ?? 0,
    daily: daily.map((r) => ({ day: r.day, count: r.n })),
    byCategory: byCategory.map((r) => ({ label: r.label, count: r.n })),
    topBooks: topBooks.map((r) => ({
      bookId: r.id,
      slug: r.slug,
      title: r.title,
      count: r.n,
    })),
    topReaders: topReaders.map((r) => ({ name: r.name, count: r.n })),
  };
}
