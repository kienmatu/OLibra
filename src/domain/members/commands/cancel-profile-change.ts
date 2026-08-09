import { NotFound, RuleViolated } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command } from "../../kernel/unit-of-work";
import { requireSelfOrManager } from "../policy";

export interface CancelProfileChangeInput {
  membershipId: string;
  profileChangeRequestId: string;
}

/**
 * The reader withdraws their own proposal before a decision is made (OPS §4.3;
 * BR §7.4's diagram: `pending ──► cancelled (reader withdrew before a
 * decision)`).
 *
 * **`membershipId` as well as the request id, and the pairing is the check.**
 * OPS §4.3 lists both and calls `not_own_request` "structurally unreachable via
 * UI, but the command must still check". It is more than that here: the
 * membership id is what `requireSelfOrManager` compares against
 * `ctx.actor.membershipId` — resolved from the session by `contextFor`, never
 * supplied by the caller — and it is also how this command reaches a `users`
 * row at all, `users` having no row-level security. So the request id alone
 * would authorise nothing.
 *
 * **`not_own_request` is a reuse, deliberately, and was checked before
 * reusing.** `errors.ts:94`'s "Bạn không thể huỷ yêu cầu của người khác." is
 * character-identical to OPS §4.3:524's sentence for this command and to OPS
 * §4.2:340's for `CancelOwnRequest`. Same meaning, same sentence, same code —
 * unlike `not_pending`, three lines below, where OPS gives one code two
 * different subjects and this slice had to split it. Checked precisely because
 * three slices in a row found one that needed splitting.
 *
 * **`decided_by` stays null while `decided_at` is set,** which looks
 * inconsistent and is not. `decided_by` is the manager who ruled on the
 * request; a withdrawal has no such manager, and writing the reader's own id
 * there would make "who decided this" answer with the person who asked. The
 * time is a real fact worth keeping, and who did it is in the audit row, where
 * INV-12 makes it permanent.
 */
export const cancelProfileChange: Command<CancelProfileChangeInput, void> = async (
  tx,
  ctx,
  input,
) => {
  requireSelfOrManager(ctx, input.membershipId);
  requireIdentifiedActor(ctx);

  const [membership] = await tx<{ user_id: string }[]>`
      select m.user_id from memberships m
      join users u on u.id = m.user_id and u.deleted_at is null
      where m.id = ${input.membershipId} and m.deleted_at is null
    `;
  if (!membership) throw new NotFound("membership_not_found");

  // RLS scopes this to the shelf; a request of another shelf is zero rows and
  // therefore `write_target_not_found`, not `not_own_request` — telling a
  // caller "that is somebody else's" would confirm it exists.
  const [request] = await tx<{ id: string; status: string; user_id: string }[]>`
      select id, status, user_id from profile_change_requests
      where id = ${input.profileChangeRequestId}
    `;
  if (!request) throw new NotFound("write_target_not_found");
  if (request.user_id !== membership.user_id) {
    throw new RuleViolated("not_own_request");
  }
  if (request.status !== "pending") {
    throw new RuleViolated("profile_change_not_pending");
  }

  await tx`
      update profile_change_requests
         set status = 'cancelled', decided_at = ${ctx.clock.now()}
       where id = ${request.id} and status = 'pending'
    `;

  return {
    result: undefined,
    audit: {
      action: "profile_change.cancelled",
      entityType: "profile_change_request",
      entityId: request.id,
      before: { status: "pending" },
      after: { status: "cancelled" },
    },
  };
};
