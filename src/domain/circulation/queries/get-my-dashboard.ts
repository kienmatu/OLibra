import { requireIdentifiedActor } from "../../kernel/tenant";
import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import type { ErrorCode } from "../../kernel/errors";
import { requireReader } from "../../catalogue/policy";
import { loanRenewable } from "../policy";
import { renewalSettingsFor } from "../settings";

export interface MyLoanRow {
  loanId: string;
  bookId: string;
  slug: string;
  title: string;
  copyCode: string;
  dueOn: string;
  isOverdue: boolean;
  daysRemaining: number;
  renewalsUsed: number;
  /** `null` when the button works; an `ErrorCode` the screen renders otherwise. */
  renewBlockedBy: ErrorCode | null;
}

export interface MyRequestRow {
  requestId: string;
  bookId: string;
  slug: string;
  title: string;
  status: string;
  /** 1 for the person at the front. Derived, never stored (OPS §3.2). */
  queuePosition: number | null;
  holdExpiresAt: Date | null;
}

export interface MyDashboard {
  loans: MyLoanRow[];
  requests: MyRequestRow[];
}

/**
 * OPS §3.2's `GetMyDashboard` — BR §16.2's "My page": books currently held with
 * days remaining and a renew button where permitted, pending requests with their
 * queue position, recent history.
 *
 * **`isOverdue` and `daysRemaining` come from `loans_current`, and nothing here
 * recomputes them.** G5, and this is the screen where the temptation is
 * strongest: a child wants "còn 3 ngày" and `due_on` is right there. The view
 * derives both from `olibra_now()`, which follows the injected clock, so a
 * second subtraction in TypeScript would be a second definition of overdue that
 * moves independently. `get-reader-detail.ts` carries the same rule and U1's
 * review found a stale comment there talking a future implementer into breaking
 * it.
 *
 * **Renewability is answered here, not on the page**, and by `loanRenewable`
 * rather than by two conditions written again. C3's `renewLoan` calls the same
 * predicate, so the sentence under a disabled button is the sentence the button
 * would have produced — the rule C1's review established after finding a query
 * and a command disagreeing about a copy, in the direction that turns a child
 * away from a book that is there.
 *
 * **Queue position is a count of the requests ahead**, ordered exactly as C2's
 * queue is (`requested_at`, then `id`). Derived on read, no column, no job.
 */
export async function getMyDashboard(
  tx: Tx,
  ctx: TenantContext,
): Promise<MyDashboard> {
  requireReader(ctx);
  requireIdentifiedActor(ctx);

  const { maxRenewals } = await renewalSettingsFor(tx, ctx.bookshelfId);

  const loanRows = await tx<
    {
      id: string;
      book_id: string;
      slug: string;
      title: string;
      code: string;
      due_on: string;
      is_overdue: boolean;
      days_remaining: number;
      renewals_used: number;
      title_has_queue: boolean;
    }[]
  >`
    select l.id, l.book_id, b.slug, b.title, c.code,
           l.due_on::text as due_on, l.is_overdue, l.days_remaining,
           l.renewals_used,
           exists (
             select 1 from borrow_requests r
              where r.book_id = l.book_id
                and r.status = 'pending'
                and r.deleted_at is null
           ) as title_has_queue
      from loans_current l
      join books b on b.id = l.book_id
      join book_copies c on c.id = l.copy_id
     where l.borrower_id = ${ctx.actor.userId}
       and l.status = 'active'
     order by l.due_on asc, l.id asc
  `;

  const requestRows = await tx<
    {
      id: string;
      book_id: string;
      slug: string;
      title: string;
      status: string;
      hold_expires_at: Date | null;
      ahead: string;
    }[]
  >`
    select r.id, r.book_id, b.slug, b.title, r.status, r.hold_expires_at,
           (
             select count(*) from borrow_requests q
              where q.book_id = r.book_id
                and q.status = 'pending'
                and q.deleted_at is null
                and (q.requested_at, q.id) < (r.requested_at, r.id)
           ) as ahead
      from borrow_requests r
      join books b on b.id = r.book_id
     where r.member_id = ${ctx.actor.userId}
       and r.status in ('pending', 'approved')
       and r.deleted_at is null
     order by r.requested_at asc, r.id asc
  `;

  return {
    loans: loanRows.map((r) => {
      const block = loanRenewable(
        { renewalsUsed: r.renewals_used, titleHasQueue: r.title_has_queue },
        maxRenewals,
      );
      return {
        loanId: r.id,
        bookId: r.book_id,
        slug: r.slug,
        title: r.title,
        copyCode: r.code,
        dueOn: r.due_on,
        isOverdue: r.is_overdue,
        // `date - date` is `int4`, which the driver returns as a number. The
        // `Number()` is a no-op kept for the same reason `get-reader-detail.ts`
        // keeps its own — the asymmetry with `count()`'s `int8` reads as an
        // omission otherwise.
        daysRemaining: Number(r.days_remaining),
        renewalsUsed: r.renewals_used,
        renewBlockedBy: block.blocked ? block.reason : null,
      };
    }),
    requests: requestRows.map((r) => ({
      requestId: r.id,
      bookId: r.book_id,
      slug: r.slug,
      title: r.title,
      status: r.status,
      // A held request has been served — it has a copy waiting, so it is no
      // longer in a queue and a position for it would be a number about
      // nothing.
      queuePosition: r.status === "pending" ? Number(r.ahead) + 1 : null,
      holdExpiresAt: r.hold_expires_at,
    })),
  };
}

export interface MyHistoryRow {
  loanId: string;
  slug: string;
  title: string;
  lentOn: Date;
  returnedOn: Date | null;
  status: string;
  returnCondition: string | null;
}

/**
 * OPS §3.2's `GetMyLoanHistory` — everything, newest first.
 *
 * Closed loans only would hide the one a reader most wants to see. `status` is
 * returned so the screen can say `Đã trả`, `Đang mượn` or `Đã mất` rather than
 * inferring it from which timestamps are null.
 *
 * `id desc` beside `lent_at desc`: `lent_at` carries no unique constraint, and
 * a paged walk without a unique tiebreak repeats and drops rows — measured
 * twice in this codebase.
 */
export async function getMyLoanHistory(
  tx: Tx,
  ctx: TenantContext,
  input: { limit?: number } = {},
): Promise<MyHistoryRow[]> {
  requireReader(ctx);
  requireIdentifiedActor(ctx);

  const limit = Math.min(200, Math.max(1, input.limit ?? 50));

  const rows = await tx<
    {
      id: string;
      slug: string;
      title: string;
      lent_at: Date;
      returned_at: Date | null;
      status: string;
      return_condition: string | null;
    }[]
  >`
    select l.id, b.slug, b.title, l.lent_at, l.returned_at, l.status,
           l.return_condition
      from loans l
      join books b on b.id = l.book_id
     where l.borrower_id = ${ctx.actor.userId}
     order by l.lent_at desc, l.id desc
     limit ${limit}
  `;

  return rows.map((r) => ({
    loanId: r.id,
    slug: r.slug,
    title: r.title,
    lentOn: r.lent_at,
    returnedOn: r.returned_at,
    status: r.status,
    returnCondition: r.return_condition,
  }));
}
