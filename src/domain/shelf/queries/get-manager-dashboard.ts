import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireManager } from "../../members/policy";

/**
 * The numbers the manager sidebar puts beside a nav entry.
 *
 * **Three, not six.** `manager-shell.tsx` shipped six hard-coded counts, and
 * three of them belong to slices that do not exist: `Yêu cầu mượn` is C2's
 * borrow-request queue, `Tặng sách` and `Bình luận` are B3's donations and
 * comments. There is no query that could answer them, so U3 §3.1 removes the
 * badge and the nav entry with it rather than showing `0` — a volunteer reads
 * "no comments waiting" and stops checking, which is a worse lie than the
 * fixture number was, because it is a plausible one.
 *
 * Each of the three that remain is the **count of a list that exists**, and
 * each is counted the way that list is selected, not a shorter way that happens
 * to give the same answer today:
 *
 * - `pendingRegistrations` mirrors `getPendingRegistrations`
 *   (`../../members/queries/get-pending-registrations.ts`) — the same
 *   `memberships`→`users` join, the same two `deleted_at is null`, the same
 *   `status = 'pending'`.
 * - `pendingProfileChanges` mirrors `getPendingProfileChanges` — including its
 *   join through `memberships`, which is what makes a request belong to *this*
 *   shelf's queue rather than merely carrying its `bookshelf_id`.
 * - `overdue` reads `loans_current.is_overdue`, which BR §8 derives on read
 *   against `olibra_now()` (`20260808_14_olibra_now.sql`) — never a stored
 *   flag, never a job.
 *
 * A badge that disagrees with the list it links to is worse than no badge: the
 * volunteer clicks "Đăng ký chờ duyệt 5", counts four cards, and now has to
 * decide which of the two the software means.
 */
export interface ManagerBadgeCounts {
  pendingRegistrations: number;
  pendingProfileChanges: number;
  overdue: number;
}

/**
 * BR:537's "shelf totals", the quiet row under the dashboard's stat cards.
 *
 * `readers` counts every **active membership**, managers included, because that
 * is exactly the population `getReadersList` lists — a manager holds a
 * membership of her own shelf and appears in her own reader list (verified:
 * that query filters on `deleted_at` and an optional `status`, never on
 * `role`). A total that quietly disagreed with the list one tap away would be
 * the same defect as a badge that disagrees with its queue.
 *
 * `copies` excludes `retired` and nothing else, which is `getBooksList`'s own
 * definition of a title's `copiesTotal` — a retired copy has left the shelf, a
 * lost one has not stopped being the shelf's.
 */
export interface ShelfTotals {
  /** Titles. `books` rows, drafts included — the manager's list shows drafts. */
  titles: number;
  /** Physical copies, retired ones excluded. */
  copies: number;
  onLoan: number;
  readers: number;
}

export interface ManagerDashboard {
  counts: ManagerBadgeCounts;
  totals: ShelfTotals;
}

/**
 * OPS:81's `GetManagerDashboard`, counting half.
 *
 * **One statement, not three.** This runs on every manager page render — the
 * sidebar is on all of them — so the cost that matters is round trips, not
 * rows: three scalar subqueries in one `select` is one network wait and one
 * planner invocation, and the counts are then all as of the same instant, which
 * three separate statements inside one transaction would also give but which
 * three separate *calls* would not.
 *
 * **There is no `where bookshelf_id = …` in it, deliberately, and that is the
 * whole security argument.** `runQuery` (`../../kernel/unit-of-work.ts`) opens
 * a read-only transaction, sets `olibra.bookshelf_id` and assumes `role
 * olibra_app`; `memberships`, `profile_change_requests` and `loans` all carry
 * `<table>_tenant` policies keyed on that GUC (`0010_rls.sql`), and
 * `loans_current` is `security_invoker`, so the policy is evaluated as the
 * caller and not as the view's owner (`0011_views.sql` states what happens
 * without that clause, having verified it live).
 *
 * A count is exactly the shape of query where the missing predicate looks like
 * a working feature: the badge shows a number, the number is plausible, and it
 * is every parish's applicants added together. So the property is a test rather
 * than a comment — `tests/domain/shelf/manager-dashboard.test.ts` runs this
 * function unchanged under `olibra_admin`, which holds `bypassrls`, and asserts
 * that the counts then include the *other* shelf's rows. If a `where` clause
 * were doing the scoping the count would not move, and that test fails.
 *
 * `users` is joined for its `deleted_at`, never for scope: it carries no RLS
 * policy at all (`0010_rls.sql`'s loop excludes it, with `categories` and
 * site-wide `feedback`), so a join *to* it can only ever narrow what
 * `memberships` already admitted.
 */
export async function getManagerBadgeCounts(
  tx: Tx,
  ctx: TenantContext,
): Promise<ManagerBadgeCounts> {
  requireManager(ctx);

  const [row] = await tx<
    {
      pending_registrations: number;
      pending_profile_changes: number;
      overdue: number;
    }[]
  >`
    select
      (
        select count(*)
        from memberships m
        join users u on u.id = m.user_id and u.deleted_at is null
        where m.status = 'pending' and m.deleted_at is null
      )::int as pending_registrations,
      (
        select count(*)
        from profile_change_requests r
        join memberships m on m.user_id = r.user_id and m.deleted_at is null
        join users u       on u.id = r.user_id and u.deleted_at is null
        where r.status = 'pending'
      )::int as pending_profile_changes,
      (
        -- BR §8: derived on read, against the injected clock. Never a column.
        select count(*) from loans_current where is_overdue
      )::int as overdue
  `;

  // A `select` of three scalar subqueries and no `from` returns exactly one
  // row, always — but destructuring an absent row into three `undefined`s
  // would render three empty badges rather than failing, so the fallback is
  // written out rather than assumed away.
  return {
    pendingRegistrations: row?.pending_registrations ?? 0,
    pendingProfileChanges: row?.pending_profile_changes ?? 0,
    overdue: row?.overdue ?? 0,
  };
}

/**
 * OPS:81's `GetManagerDashboard` — "the four stat cards, shelf totals, recent
 * activity (§16.3)", as much of it as this system can currently answer.
 *
 * **Two of the four cards and the activity feed are absent, for U3 §3.1's
 * reason.** BR:537 names the four: *Quá hạn*, *Chờ duyệt tài khoản*, *Yêu cầu
 * mượn*, *Bình luận chờ duyệt*. The last two are C2's borrow requests and B3's
 * comments — no table this codebase queries, no page behind them. OPS:81's
 * "recent activity feed" is `audit_log` rendered as BR §14's readable
 * Vietnamese sentences, and the thing that renders them is D2's audit browser,
 * which U3 §6 puts out of scope. A card showing `0` and a feed showing invented
 * events are the same lie the sidebar's fixture badges were.
 *
 * **And no substitute card is added in their place.** BR:571 settles that
 * directly, about the donation queue: the fourth card "was already chosen for a
 * reason; a fifth card would be a change to that decision, not an addition to
 * it." `Đổi thông tin` is therefore a badge and not a card, exactly as it is
 * today.
 *
 * **Two statements, not one, and the counts are not repeated here.**
 * `getManagerBadgeCounts` above is called rather than its three subqueries
 * being pasted into this `select`. The dashboard's *Quá hạn* card and the
 * sidebar's *Quá hạn* badge sit six inches apart on the same screen; two
 * definitions of that number is how they come to disagree. Both statements run
 * inside the one transaction `loadPage` opened, so they still see one instant.
 *
 * Same scoping argument as `getManagerBadgeCounts`: no `where bookshelf_id`
 * anywhere, `books`, `book_copies`, `loans` and `memberships` all carry a
 * tenant policy, and the test asserts the totals move under `bypassrls`.
 */
export async function getManagerDashboard(
  tx: Tx,
  ctx: TenantContext,
): Promise<ManagerDashboard> {
  const counts = await getManagerBadgeCounts(tx, ctx);

  const [row] = await tx<
    { titles: number; copies: number; on_loan: number; readers: number }[]
  >`
    select
      (select count(*) from books where deleted_at is null)::int as titles,
      (
        select count(*) from book_copies
        where deleted_at is null and state <> 'retired'
      )::int as copies,
      (select count(*) from loans where status = 'active')::int as on_loan,
      (
        select count(*) from memberships
        where status = 'active' and deleted_at is null
      )::int as readers
  `;

  return {
    counts,
    totals: {
      titles: row?.titles ?? 0,
      copies: row?.copies ?? 0,
      onLoan: row?.on_loan ?? 0,
      readers: row?.readers ?? 0,
    },
  };
}
