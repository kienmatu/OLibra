import { NotFound } from "../../kernel/errors";
import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { loadParishContext } from "../parish-context";
import { describeSelection, unitName } from "../parish-taxonomy";
import type { MembershipRole, MembershipStatus } from "../policy";
import { requireManager } from "../policy";
import type { ReaderRow } from "./get-readers-list";

export interface ReaderDetail extends ReaderRow {
  dateOfBirth: string | null;
  fatherName: string;
  motherName: string;
  phone: string | null;
  email: string | null;
  avatarUrl: string | null;
  hasCredentials: boolean;
  leaderboardOptIn: boolean;
  managerNotes: string | null;
  rejectionReason: string | null;
  suspensionReason: string | null;
  approvedAt: string | null;
  currentLoans: {
    loanId: string;
    bookId: string;
    dueOn: string;
    isOverdue: boolean;
    daysRemaining: number;
  }[];
  pendingProfileChange: { id: string; requestedAt: string } | null;
}

/**
 * OPS §3.3's reader-detail page: `ReaderRow`'s manager-only fields (BR §5.3
 * — date of birth, parents' names, phone, parish units), plus the loans
 * currently out and any profile-change request awaiting a decision.
 *
 * `hasCredentials` is the boolean the "Đặt lại mật khẩu" button reads —
 * never the password hash itself (BR §14, and a screen is no better a place
 * for one than the audit log is).
 *
 * `currentLoans`' `isOverdue`/`daysRemaining` come straight from
 * `loans_current`'s own derived columns (G5) and **must not be recomputed
 * here from `ctx.clock`.** Doing so would create a second definition of
 * "overdue" in a second language, which is the exact thing G5 exists to
 * prevent — and it would buy nothing, because the view already follows
 * `ctx.clock`: `20260808_14_olibra_now.sql` replaced the SQL `now()` both
 * derived columns used to call with `olibra_now()`, which reads the
 * transaction-local `olibra.now` GUC that `unit-of-work.ts` sets from
 * `ctx.clock` on every command and every scoped query. Handing this query a
 * `fixedClock` moves `isOverdue` and `daysRemaining`; see DB §6 and
 * `tests/db/sql-clock.test.ts`.
 *
 * (An earlier version of this comment said the opposite — that the view read
 * SQL `now()` and ignored the injected clock, "verified via `pg_get_viewdef`"
 * — and called it a limitation to inherit. That was true when it was written
 * and false from `20260808_14` onward. It is corrected here rather than
 * deleted because it is the note a C1/C2 implementer would have read as
 * permission to derive overdue in TypeScript.)
 */
export async function getReaderDetail(
  tx: Tx,
  ctx: TenantContext,
  input: { membershipId: string },
): Promise<ReaderDetail> {
  requireManager(ctx);

  const [row] = await tx<
    {
      membership_id: string;
      user_id: string;
      full_name: string;
      saint_name: string | null;
      status: string;
      role: string;
      parish_unit_l1_id: string | null;
      parish_unit_l2_id: string | null;
      date_of_birth: string | null;
      father_name: string;
      mother_name: string;
      phone: string | null;
      email: string | null;
      avatar_url: string | null;
      has_credentials: boolean;
      leaderboard_opt_in: boolean;
      manager_notes: string | null;
      rejection_reason: string | null;
      suspension_reason: string | null;
      approved_at: string | null;
    }[]
  >`
    select
      m.id                  as membership_id,
      m.user_id,
      m.status, m.role,
      m.parish_unit_l1_id, m.parish_unit_l2_id,
      m.leaderboard_opt_in, m.manager_notes,
      m.rejection_reason, m.suspension_reason,
      m.approved_at::text as approved_at,
      u.full_name, u.saint_name, u.date_of_birth::text as date_of_birth,
      u.father_name, u.mother_name, u.phone, u.email, u.avatar_url,
      -- INV-14: username and password_hash are paired or both null — never
      -- the hash itself, only whether one exists.
      (u.username is not null) as has_credentials
    from memberships m
    join users u on u.id = m.user_id and u.deleted_at is null
    where m.id = ${input.membershipId} and m.deleted_at is null
  `;
  if (!row) throw new NotFound("membership_not_found");

  const { taxonomy, units } = await loadParishContext(tx, ctx);

  // G5, BR §8, DB §6: the live loan set. loans_current is every loan plus
  // two derived columns, never pre-filtered — the explicit status = 'active'
  // is what makes this "currently holding" rather than "ever borrowed".
  const loans = await tx<
    {
      id: string;
      book_id: string;
      due_on: string;
      is_overdue: boolean;
      days_remaining: number;
    }[]
  >`
    select l.id, l.book_id, l.due_on::text as due_on, l.is_overdue, l.days_remaining
    from loans_current l
    where l.borrower_id = ${row.user_id} and l.status = 'active'
    order by l.due_on
  `;

  const [pending] = await tx<{ id: string; requested_at: string }[]>`
    select id, requested_at::text as requested_at
    from profile_change_requests
    where user_id = ${row.user_id} and status = 'pending'
  `;

  return {
    membershipId: row.membership_id,
    userId: row.user_id,
    fullName: row.full_name,
    saintName: row.saint_name,
    status: row.status as MembershipStatus,
    role: row.role as MembershipRole,
    parishLine: describeSelection(taxonomy, units, {
      l1: row.parish_unit_l1_id,
      l2: row.parish_unit_l2_id,
    }),
    parishUnitL1Name: unitName(units, row.parish_unit_l1_id),
    parishUnitL2Name: unitName(units, row.parish_unit_l2_id),
    // G5, DB §6: the live count for this one reader, same rule as
    // get-readers-list.ts — derived from the loans just read, not a second
    // query re-deriving the same fact.
    holdingCount: loans.length,
    dateOfBirth: row.date_of_birth,
    fatherName: row.father_name,
    motherName: row.mother_name,
    phone: row.phone,
    email: row.email,
    avatarUrl: row.avatar_url,
    hasCredentials: row.has_credentials,
    leaderboardOptIn: row.leaderboard_opt_in,
    managerNotes: row.manager_notes,
    rejectionReason: row.rejection_reason,
    suspensionReason: row.suspension_reason,
    approvedAt: row.approved_at,
    currentLoans: loans.map((l) => ({
      loanId: l.id,
      bookId: l.book_id,
      dueOn: l.due_on,
      isOverdue: l.is_overdue,
      daysRemaining: Number(l.days_remaining),
    })),
    pendingProfileChange: pending
      ? { id: pending.id, requestedAt: pending.requested_at }
      : null,
  };
}
