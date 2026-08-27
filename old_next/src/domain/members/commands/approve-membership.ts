import { NotFound, RuleViolated } from "../../kernel/errors";
import { notify } from "../../notifications/write";
import type { Command } from "../../kernel/unit-of-work";
import { type MembershipStatus, requireManager } from "../policy";

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
 *
 * **Deliberately not `membershipTransition(status, "active")`.** IMPORTANT 3
 * (fix-report, 2026-08-08-b2-members): this is the mirror image of
 * `reactivateMembership`'s own docstring, which explains why *that* command
 * cannot delegate to the shared graph for `to === "active"` — `suspended →
 * active` is a real edge in `policy.ts`, so the generic transition would let
 * this command un-suspend a membership, clearing nothing but
 * `rejection_reason` and leaving `status = 'active'` with a live
 * `suspension_reason` still attached (which `getReaderDetail` renders
 * verbatim). ApproveMembership's own rule is exactly as narrow and
 * unambiguous as ReactivateMembership's — only a *pending* application may be
 * approved — so it is checked directly against `status`, not through the
 * shared graph.
 *
 * **The `update` clears `suspension_reason` too, not only `rejection_reason`.**
 * Re-review (fix-report, 2026-08-08-b2-members): today no command produces a
 * `pending` row carrying a live `suspension_reason` — an exhaustive walk of
 * all seven members commands confirmed it — so "no active row carries a
 * live suspension reason" held only as a reachability accident, not as
 * something this command itself guaranteed. `reactivateMembership` already
 * clears its own stale reason defensively rather than trusting upstream; one
 * more assignment here makes the same guarantee local instead of borrowed.
 */
export const approveMembership: Command<{ membershipId: string }, void> = async (
  tx,
  ctx,
  input,
) => {
  requireManager(ctx);

  const [membership] = await tx<
    { id: string; status: MembershipStatus; user_id: string }[]
  >`
    select id, status, user_id from memberships
    where id = ${input.membershipId} and deleted_at is null
  `;
  if (!membership) throw new NotFound("membership_not_found");

  if (membership.status !== "pending") {
    throw new RuleViolated("registration_not_pending");
  }

  await tx`
    update memberships
    set status = 'active',
        approved_by = ${ctx.actor.userId},
        approved_at = ${ctx.clock.now()},
        rejection_reason = null,
        suspension_reason = null
    where id = ${membership.id}
  `;

  // OPS §7, in this transaction rather than after it: a rolled-back approval
  // must not leave a child told they were approved. `user_id`, not
  // `membershipId` — `notifications.user_id` is a `users(id)`.
  await notify(tx, { userId: membership.user_id, kind: "membership_approved" });

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
