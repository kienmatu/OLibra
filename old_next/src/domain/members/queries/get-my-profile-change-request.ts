import { NotFound } from "../../kernel/errors";
import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireSelfOrManager } from "../policy";
import { pickProfileFields, type ProfilePatch } from "../profile-fields";

export interface MyProfileChangeRequest {
  id: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  proposedValues: ProfilePatch;
  previousValues: ProfilePatch;
  rejectionReason: string | null;
  requestedAt: string;
  decidedAt: string | null;
}

/**
 * What a reader sees about their own proposal (OPS §4.3, moved here from D3 by
 * B2a's known gap 9 — it touches no loan, and leaving it in a C1-blocked slice
 * would have blocked a reader seeing their own pending change for no reason).
 *
 * **It returns the most recent request, not only a pending one.** OPS §4.3's
 * own note on the notification gap is the reason: BR §15 lists no notification
 * for a profile-change decision, so "a reader only learns the outcome by
 * revisiting `GetMyProfileChangeRequest` (or, on rejection, by whatever
 * surfaces the reason on the profile page)". A query that returned only pending
 * rows would make the rejection reason unreachable the instant it was written,
 * which would turn a documented gap into a dead end. Ordered by `requested_at`
 * descending, and INV-13a guarantees at most one of them is pending.
 *
 * `null` rather than a throw when there is no request at all: a reader who has
 * never proposed anything is the ordinary case, not a failure.
 *
 * A manager passes `requireSelfOrManager` on rank, which is intended —
 * `getReaderDetail` already surfaces the existence and timestamp of a pending
 * request on the manager's reader page, and this is the same fact with the
 * values attached. `requireIdentifiedActor` is deliberately **not** called
 * here: it exists so an audit row cannot name nobody, and a query writes none.
 */
export async function getMyProfileChangeRequest(
  tx: Tx,
  ctx: TenantContext,
  input: { membershipId: string },
): Promise<MyProfileChangeRequest | null> {
  requireSelfOrManager(ctx, input.membershipId);

  const [membership] = await tx<{ user_id: string }[]>`
    select m.user_id from memberships m
    join users u on u.id = m.user_id and u.deleted_at is null
    where m.id = ${input.membershipId} and m.deleted_at is null
  `;
  if (!membership) throw new NotFound("membership_not_found");

  const [row] = await tx<
    {
      id: string;
      status: MyProfileChangeRequest["status"];
      proposed_values: unknown;
      previous_values: unknown;
      rejection_reason: string | null;
      requested_at: string;
      decided_at: string | null;
    }[]
  >`
    select id, status, proposed_values, previous_values, rejection_reason,
           requested_at::text as requested_at, decided_at::text as decided_at
      from profile_change_requests
     where user_id = ${membership.user_id}
     order by requested_at desc
     limit 1
  `;
  if (!row) return null;

  return {
    id: row.id,
    status: row.status,
    // Filtered through the allowlist on the way out too, not only on the way
    // in. `proposed_values` is `jsonb` with no check constraint behind it
    // (DATABASE.md §4.11), so it may hold anything a hand-written or older row
    // put there; a query that handed back whatever it happened to hold would be
    // the place that leaked it.
    proposedValues: pickProfileFields(row.proposed_values),
    previousValues: pickProfileFields(row.previous_values),
    rejectionReason: row.rejection_reason,
    requestedAt: row.requested_at,
    decidedAt: row.decided_at,
  };
}
