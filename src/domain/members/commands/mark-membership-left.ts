import { NotFound, RuleViolated } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import {
  type MembershipStatus,
  membershipTransition,
  requireManager,
} from "../policy";

/**
 * Any status `→ left` (OPS §4.3) — the "Đánh dấu đã rời" button on the reader
 * -detail screen, whose label is the UI's wording rather than the
 * requirements'.
 *
 * **Blocked while the reader still holds a book.** OPS §4.3 lists
 * `has_active_loans` and flags it honestly as "inferred from general
 * soundness, not stated explicitly", offering the alternative reading that
 * leaving is allowed and the loans simply keep displaying. Implemented as OPS
 * lists it, for BR §16.3's reason: the borrower's phone number "is the actual
 * mechanism by which books come back", and a `left` membership is a person the
 * shelf has stopped tracking. Reversing this later is one predicate and one
 * test; recovering a cohort of `left` members whose books quietly vanished is
 * not.
 *
 * The count comes from `loans_current`, the access path DB §6 names, rather
 * than from a hand-written `status = 'active'` filter that would be a second
 * definition of "active loan" free to drift from the one every other slice
 * reads (G5).
 *
 * `member_has_active_loans`, not the shipped `has_active_loans` — whose
 * sentence is "Không thể xoá sách đang có bản được mượn.", about a book.
 */
export const markMembershipLeft: Command<{ membershipId: string }, void> = async (
  tx,
  ctx,
  input,
) => {
  requireManager(ctx);

  const [membership] = await tx<
    { id: string; user_id: string; status: MembershipStatus }[]
  >`
    select id, user_id, status from memberships
    where id = ${input.membershipId} and deleted_at is null
  `;
  if (!membership) throw new NotFound("membership_not_found");

  const move = membershipTransition(membership.status, "left");
  if (!move.allowed) throw new RuleViolated(move.reason!);

  // `loans.borrower_id` references `users(id)`, not `memberships` — verified
  // with `\d loans`, and recorded in B1's reconciliation for `borrow_requests`
  // for the same reason. The shelf scoping comes from RLS on the view, not
  // from the join key.
  //
  // `loans_current` (defined in `0011_views.sql`, redefined by
  // `20260808_14_olibra_now.sql` — the live definition is the latter's, and
  // `pg_get_viewdef` is where to read it rather than either file) is
  // `select l.*, is_overdue,
  // days_remaining from loans l` — every loan, not only active ones; "current"
  // names the read path DB §6 points to for a loan's *live, derived* fields,
  // not a pre-filtered set. `status = 'active'` here reads that column through
  // the same view every other slice reads it through, rather than querying
  // the base `loans` table directly — a second read path free to drift from
  // this one, not a second *definition* of "active" (there is only ever one:
  // the `loan_status` enum's own value).
  const outstanding = await tx<{ id: string }[]>`
    select id from loans_current
    where borrower_id = ${membership.user_id} and status = 'active'
  `;
  if (outstanding.length > 0) throw new RuleViolated("member_has_active_loans");

  await tx`update memberships set status = 'left' where id = ${membership.id}`;

  return {
    result: undefined,
    audit: {
      action: "membership.left",
      entityType: "membership",
      entityId: membership.id,
      before: { status: membership.status },
      after: { status: "left" },
    },
  };
};
