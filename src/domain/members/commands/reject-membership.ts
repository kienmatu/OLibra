import { NotFound, RuleViolated, ValidationFailed } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import {
  blank,
  type MembershipStatus,
  membershipTransition,
  requireManager,
} from "../policy";

/**
 * `pending → rejected`, retained with a reason so the person may re-apply
 * (BR §2). Nothing is deleted — G10, and BR §2's whole point about retention.
 *
 * The reason is required by the database as well as by the catalogue:
 * `memberships_rejected_has_reason` is `check (status <> 'rejected' or
 * rejection_reason is not null)`. Checking it here first is what turns a 23514
 * raised from inside the transaction into the named failure OPS §2 requires.
 *
 * `reject_reason_required` rather than the shipped `reason_required`, whose
 * sentence is "Vui lòng ghi lý do huỷ." — *huỷ* is cancelling something, not
 * declining an application.
 */
export const rejectMembership: Command<
  { membershipId: string; reason: string },
  void
> = async (tx, ctx, input) => {
  requireManager(ctx);
  if (blank(input.reason)) {
    throw new ValidationFailed("reject_reason_required", "reason");
  }

  const [membership] = await tx<{ id: string; status: MembershipStatus }[]>`
    select id, status from memberships
    where id = ${input.membershipId} and deleted_at is null
  `;
  if (!membership) throw new NotFound("membership_not_found");

  const move = membershipTransition(membership.status, "rejected");
  if (!move.allowed) throw new RuleViolated(move.reason!);

  await tx`
    update memberships
    set status = 'rejected', rejection_reason = ${input.reason.trim()}
    where id = ${membership.id}
  `;

  return {
    result: undefined,
    audit: {
      action: "membership.rejected",
      entityType: "membership",
      entityId: membership.id,
      before: { status: membership.status },
      after: { status: "rejected", reason: input.reason.trim() },
    },
  };
};
