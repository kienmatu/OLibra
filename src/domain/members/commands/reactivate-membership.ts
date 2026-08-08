import { NotFound, RuleViolated } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { type MembershipStatus, requireManager } from "../policy";

/**
 * `suspended → active` (BR §7.5). Clears `suspension_reason` on the way back
 * out — a stale reason left in place would render on the reader-detail screen
 * as though the account were still suspended for it.
 *
 * Same select-first shape as `approveMembership`/`suspendMembership`, for the
 * same reason: RLS filters a cross-shelf update to zero rows silently, so the
 * prior read is what turns that silence into "Không tìm thấy bạn đọc này."
 *
 * **Deliberately not `membershipTransition(status, "active")`.** `to ===
 * "active"` is the one target two different arrows share in `policy.ts`'s
 * graph — `pending → active` (Approve) and `suspended → active` (Reactivate)
 * — and `policy.ts`'s own `refusalFor` resolves that ambiguity in
 * ApproveMembership's favor: `membershipTransition("active", "active")` is
 * `registration_not_pending` (see `tests/domain/members/policy.test.ts`,
 * "approving something already decided"), which is the right sentence for a
 * *replayed approval* but the wrong one here. Delegating to the generic
 * transition would also let this command silently approve a `pending`
 * application, since `pending → active` is a real edge in that same graph.
 * ReactivateMembership's own rule is narrower and unambiguous — OPS §4.3
 * gives it one sentence, "only a suspended account can be reactivated" — so
 * it is checked directly against `status`, not through the shared graph.
 */
export const reactivateMembership: Command<{ membershipId: string }, void> = async (
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

  if (membership.status !== "suspended") {
    throw new RuleViolated("not_suspended_cannot_reactivate");
  }

  await tx`
    update memberships
    set status = 'active', suspension_reason = null
    where id = ${membership.id}
  `;

  return {
    result: undefined,
    audit: {
      action: "membership.reactivated",
      entityType: "membership",
      entityId: membership.id,
      before: { status: membership.status },
      after: { status: "active" },
    },
  };
};
