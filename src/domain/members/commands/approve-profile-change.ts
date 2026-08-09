import { NotFound, RuleViolated, ValidationFailed } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command } from "../../kernel/unit-of-work";
import { loadParishContext } from "../parish-context";
import { validateSelection } from "../parish-taxonomy";
import { requireManager } from "../policy";
import {
  applyProfileFields,
  diffProfileFields,
  normaliseProfilePatch,
  pickProfileFields,
} from "../profile-fields";

export interface ApproveProfileChangeInput {
  profileChangeRequestId: string;
  /** BR §5.6, both optional, always — supplying neither leaves the placement alone. */
  parishUnitL1Id?: string | null;
  parishUnitL2Id?: string | null;
}

/**
 * A manager approves a pending change; the proposed values are written to the
 * person record in the same transaction as the audit record (OPS §4.3, BR
 * §7.4's diagram: `pending ──► approved (values written to the person)`).
 *
 * ── The join is the security check, not a convenience ────────────────────
 *
 * `profile_change_requests.user_id` references `users(id)` plainly, and `users`
 * is global with no row-level security. RLS's `with check` on this table
 * guarantees a row's `bookshelf_id` matches the session and **nothing else** —
 * so a row naming a `user_id` with no membership at that shelf is
 * representable. Reading the request and then writing `users` from its
 * `user_id` would therefore be a `users` write authorised by a column, not by
 * a policy. The `join memberships` below is what ties the subject to *this*
 * shelf; every command in this lifecycle carries it for the same reason.
 *
 * ── `parishUnitL1Id` / `parishUnitL2Id` ──────────────────────────────────
 *
 * Not part of what was proposed — parish units are a membership fact, not one
 * of the person-level fields a reader may put forward. They let the approving
 * manager set or correct the placement in the same action, which is what the
 * profile screen points a reader towards when it says a unit change needs the
 * manager's help. `validateSelection` is the shared rule (`../parish-taxonomy
 * .ts`), and it treats a soft-deleted unit as existing on purpose, so
 * re-validating an unchanged selection does not start failing the day a manager
 * retires that unit. **This is the only code path this slice shares with B2a**,
 * and it is shared as an import rather than as a restatement.
 *
 * ── `write_target_not_found` for a request that is not there ─────────────
 *
 * OPS §4.3 names no failure mode for it, and an `ErrorCode` may not be invented
 * with a Vietnamese sentence nobody wrote (the rule `kernel/tenant.ts` states).
 * The kernel's generic — "Không tìm thấy dữ liệu cần thay đổi." — is honest,
 * and it is also what a request belonging to *another shelf* produces, because
 * RLS filtered the select to zero rows rather than anyone comparing two shelf
 * ids. B2b's plan §8 asks the product owner for a specific sentence.
 */
export const approveProfileChange: Command<
  ApproveProfileChangeInput,
  { userId: string }
> = async (tx, ctx, input) => {
  requireManager(ctx);
  // `decided_by` is nullable and would take a null happily; INV-8 wants the
  // actor by name, and a decision with nobody's name on it is exactly what
  // `voidLoan` shipped.
  requireIdentifiedActor(ctx);

  const [request] = await tx<
    {
      id: string;
      user_id: string;
      membership_id: string;
      status: string;
      proposed_values: unknown;
      parish_unit_l1_id: string | null;
      parish_unit_l2_id: string | null;
    }[]
  >`
    select r.id, r.user_id, r.status, r.proposed_values,
           m.id as membership_id, m.parish_unit_l1_id, m.parish_unit_l2_id
      from profile_change_requests r
      join memberships m on m.user_id = r.user_id and m.deleted_at is null
      join users u       on u.id = r.user_id and u.deleted_at is null
     where r.id = ${input.profileChangeRequestId}
  `;
  if (!request) throw new NotFound("write_target_not_found");
  if (request.status !== "pending") {
    throw new RuleViolated("profile_change_not_pending");
  }

  const hasL1 = input.parishUnitL1Id !== undefined;
  const hasL2 = input.parishUnitL2Id !== undefined;
  if (hasL1 || hasL2) {
    const l1 = hasL1 ? (input.parishUnitL1Id ?? null) : request.parish_unit_l1_id;
    const l2 = hasL2 ? (input.parishUnitL2Id ?? null) : request.parish_unit_l2_id;
    const { taxonomy, units } = await loadParishContext(tx, ctx);
    // Validated as the *resulting* selection rather than as the supplied half:
    // setting only l1 while a leftover l2 hangs off a different parent is
    // precisely the state BR §5.6's rule exists to forbid, and checking only
    // what was typed would let it through.
    const check = validateSelection(taxonomy, units, { l1, l2 });
    if (check.blocked) {
      throw new ValidationFailed(check.reason!, "parishUnitL1Id");
    }
    await tx`
      update memberships
         set parish_unit_l1_id = ${l1}, parish_unit_l2_id = ${l2}
       where id = ${request.membership_id}
    `;
  }

  // Re-validated rather than trusted. `proposed_values` is `jsonb` with no
  // check constraint behind it (DATABASE.md §4.11 names that as the price of
  // the design), and a row written by an older version of this application —
  // or by hand — could hold a blanked `full_name` or a date in a shape
  // `::date` will misread. `pickProfileFields` also drops `avatar_object`,
  // which the avatar wave stores here and which is never copied to `users`.
  const proposed = normaliseProfilePatch(
    pickProfileFields(request.proposed_values),
  );
  const { before, after } = await applyProfileFields(tx, request.user_id, proposed);
  const diff = diffProfileFields(before, after);

  await tx`
    update profile_change_requests
       set status     = 'approved',
           decided_by = ${ctx.actor.userId},
           decided_at = ${ctx.clock.now()}
     where id = ${request.id} and status = 'pending'
  `;

  return {
    result: { userId: request.user_id },
    audit: {
      action: "profile_change.approved",
      // The **person**, unlike the other three commands in this lifecycle,
      // which audit against the request. This is the moment a person's verified
      // details actually move, and INV-13b's whole substance is that such a
      // move is traceable on the person. Which request it came from is
      // recoverable from `profile_change_requests.decided_by`/`decided_at`,
      // written in this same transaction. A decision, not a rule —
      // `audit_log.entity_id` is a bare `uuid` with no foreign key, so each
      // command states which id it writes.
      entityType: "user",
      entityId: request.user_id,
      before: diff.before,
      after: diff.after,
    },
  };
};
