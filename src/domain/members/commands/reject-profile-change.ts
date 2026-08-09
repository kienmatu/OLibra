import { NotFound, RuleViolated, ValidationFailed } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command } from "../../kernel/unit-of-work";
import { avatarObjectOf } from "../pending-proposal";
import { blank, requireManager } from "../policy";

export interface RejectProfileChangeInput {
  profileChangeRequestId: string;
  reason: string;
}

/**
 * A manager rejects a pending change with a reason, which the reader then sees
 * (OPS §4.3; BR §16.3 — mirrors `RejectMembership` and `RejectComment`'s
 * required-reason pattern). The existing values are untouched: there was never
 * anything to undo, because `ProposeProfileChange` never wrote them.
 *
 * **`reject_reason_required`, not `reason_required_on_reject`.** OPS §4.3:513's
 * sentence is "Vui lòng ghi lý do từ chối.", which is `reject_reason_required`'s
 * shipped wording (B2a split it out of OPS's overloaded `reason_required`).
 * `errors.ts` also holds `reason_required_on_reject` — "Từ chối cần ghi lý
 * do." — unreferenced by anything; B2a recorded it as B3's. It is noted here
 * only so that nobody "tidies" the two together: they are different sentences
 * and only one of them is OPS §4.3's.
 *
 * **The reason and the status move in one statement,** because
 * `profile_change_requests_rejected_has_reason` is `check (status <> 'rejected'
 * or rejection_reason is not null)`. Two statements would raise 23514 between
 * them, which OPS §2 forbids surfacing — and would be a constraint catching an
 * ordering mistake rather than an ordering that cannot be made.
 *
 * **The reason is trimmed first,** so three spaces is the same as no reason at
 * all. The constraint catches null, which is the shape a caller with no field
 * at all produces, and says nothing about whitespace — the same split
 * `voidLoan` makes for `loans_voided_has_reason`.
 *
 * ── It returns the rejected photograph's storage key, and does not delete it ─
 *
 * OPS §4.3 requires that "a rejected or cancelled proposal's image is deleted
 * rather than left orphaned in storage". This command cannot perform that
 * deletion — the domain may not import the object store
 * (`tests/architecture/boundaries.test.ts`) — and, more to the point, it must
 * not: a delete issued inside this transaction destroys the image while the
 * request that points at it is still live, for as long as the commit that
 * follows might fail. So the key comes back to the surface, which deletes it
 * **after** the commit. `src/lib/avatar.ts` holds that ordering and the residual
 * failure it accepts. `null` when the pending request proposed no photograph,
 * which is the ordinary case.
 */
export const rejectProfileChange: Command<
  RejectProfileChangeInput,
  { avatarObject: string | null }
> = async (tx, ctx, input) => {
  requireManager(ctx);
  requireIdentifiedActor(ctx);

  if (blank(input.reason)) {
    throw new ValidationFailed("reject_reason_required", "reason");
  }
  const reason = input.reason.trim();

  // The join through `memberships` is the security check, not a convenience:
  // RLS scopes the request row to this shelf, and nothing structurally ties
  // that row to a membership of the same shelf. See the long version in
  // `./approve-profile-change.ts`.
  const [request] = await tx<
    {
      id: string;
      status: string;
      user_id: string;
      proposed_values: unknown;
    }[]
  >`
      select r.id, r.status, r.user_id, r.proposed_values
        from profile_change_requests r
        join memberships m on m.user_id = r.user_id and m.deleted_at is null
       where r.id = ${input.profileChangeRequestId}
    `;
  if (!request) throw new NotFound("write_target_not_found");
  if (request.status !== "pending") {
    throw new RuleViolated("profile_change_not_pending");
  }

  await tx`
      update profile_change_requests
         set status           = 'rejected',
             rejection_reason = ${reason},
             decided_by       = ${ctx.actor.userId},
             decided_at       = ${ctx.clock.now()}
       where id = ${request.id} and status = 'pending'
    `;

  return {
    result: { avatarObject: avatarObjectOf(request.proposed_values) },
    audit: {
      action: "profile_change.rejected",
      entityType: "profile_change_request",
      entityId: request.id,
      before: { status: "pending" },
      // The reason is in the audit as well as on the row, for the reason
      // `voidLoan` gives: INV-12 makes the audit append-only, while
      // `rejection_reason` is an ordinary column somebody could overwrite.
      after: { status: "rejected", rejection_reason: reason },
    },
  };
};
