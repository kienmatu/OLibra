import { NotFound, RuleViolated } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import {
  type MembershipStatus,
  membershipTransition,
  requireManager,
} from "../policy";

/**
 * `pending → active` (BR §7.5; BR §16.3's review card, "with prominent Approve
 * and Reject buttons").
 *
 * BR §4's assumption 3 makes this the consent step for holding a minor's data,
 * which is why `RegisterMemberOnBehalf` cannot skip it and why the approving
 * manager is recorded on the row as well as in the audit log.
 *
 * The select runs before the update on purpose. RLS's `using` clause *filters*
 * rather than raises — verified live, an update naming another shelf's
 * membership affects zero rows silently — so without a prior read the caller
 * would get the kernel guard's generic `write_target_not_found` instead of
 * "Không tìm thấy bạn đọc này."
 */
export const approveMembership: Command<{ membershipId: string }, void> = async (
  tx,
  ctx,
  input,
) => {
  requireManager(ctx);

  const [membership] = await tx<{ id: string; status: MembershipStatus }[]>`
    select id, status from memberships
    where id = ${input.membershipId} and deleted_at is null
  `;
  if (!membership) throw new NotFound("membership_not_found");

  const move = membershipTransition(membership.status, "active");
  if (!move.allowed) throw new RuleViolated(move.reason!);

  await tx`
    update memberships
    set status = 'active',
        approved_by = ${ctx.actor.userId},
        approved_at = ${ctx.clock.now()},
        rejection_reason = null
    where id = ${membership.id}
  `;

  return {
    result: undefined,
    audit: {
      action: "membership.approved",
      entityType: "membership",
      entityId: membership.id,
      before: { status: membership.status },
      after: { status: "active" },
    },
  };
};
