import { NotFound, RuleViolated } from "../../kernel/errors";
import { atLeast, requireIdentifiedActor } from "../../kernel/tenant";
import type { Command } from "../../kernel/unit-of-work";
import { avatarObjectOf } from "../pending-proposal";
import { requireSelfOrManager } from "../policy";
import { lockPerson } from "../profile-fields";
import { userAndRoleOfMembership } from "../scoped-user";

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
 * **Who else may cancel, beyond the subject themselves — §9's routing, reused
 * rather than restated.** `requireSelfOrManager` above is only the floor: it
 * lets any `manager`+ through regardless of whose request it is, which is
 * exactly the gap PO feedback found — a manager could cancel a peer manager's
 * own pending change, cutting §9's routing rule off at the knees before a
 * super admin ever saw it. The fix reads the subject's *current* membership
 * role the same way `./approve-profile-change.ts` does — off the same
 * `userAndRoleOfMembership` join `../scoped-user.ts` already exposes for this
 * exact purpose (its own docstring names this command's sibling,
 * `UpdateReaderProfile`, as the reason it exists) — and applies the identical
 * table: a `reader` subject may be cancelled by any `manager`/`admin` of the
 * shelf, a `manager`/`admin` subject only by a `super_admin`.
 *
 * **The one place this deliberately does *not* mirror approve/reject: a
 * subject cancelling their own request is always allowed, at any rank,
 * including a manager withdrawing their own pending change.**
 * `ApproveProfileChange` and `RejectProfileChange` refuse self-decision at
 * every rank, because approving your own change is signing both halves of a
 * decision nobody else reviewed. Cancelling is not a decision at all — it is
 * the reader (or manager) who filed the request taking it back before anyone
 * rules on it, the ordinary case this command exists for in the first place.
 * Refusing a manager's self-cancel "for consistency" with approve/reject would
 * read the two verbs as the same shape when they are not, and would strand a
 * manager who mistyped their own phone number with no way to withdraw it
 * short of a super admin's intervention. So the self check runs first and, if
 * it matches, nothing below it runs at all.
 *
 * **`decided_by` stays null while `decided_at` is set,** which looks
 * inconsistent and is not. `decided_by` is the manager who ruled on the
 * request; a withdrawal has no such manager, and writing the reader's own id
 * there would make "who decided this" answer with the person who asked. The
 * time is a real fact worth keeping, and who did it is in the audit row, where
 * INV-12 makes it permanent.
 *
 * **It locks the person before it touches the request,** which is the order
 * every command in this lifecycle now takes its two locks in. Reversed, this
 * command deadlocked against `ApproveProfileChange` — a manager clicking *Duyệt*
 * as the reader clicked *Huỷ* — and the loser's `40P01` is not a `DomainError`,
 * so it reached the screen as a 500. See `../profile-fields.ts`'s `lockPerson`.
 *
 * **It returns the withdrawn photograph's storage key and does not delete it.**
 * OPS §4.3 requires a cancelled proposal's image to be deleted rather than left
 * orphaned; this command may not import the object store, and must not delete
 * inside its own transaction, where a commit that then failed would leave a live
 * request pointing at an image that no longer exists. The surface deletes it
 * after the commit — `./reject-profile-change.ts` carries the same note, and
 * `src/lib/avatar.ts` holds the ordering itself.
 */
export const cancelProfileChange: Command<
  CancelProfileChangeInput,
  { avatarObject: string | null }
> = async (tx, ctx, input) => {
  requireSelfOrManager(ctx, input.membershipId);
  requireIdentifiedActor(ctx);

  // `../scoped-user.ts`'s join, carrying the subject's role alongside their
  // id — the same fact `./approve-profile-change.ts` reads off its own
  // `subject_role` column, resolved here rather than restated.
  const subject = await userAndRoleOfMembership(tx, input.membershipId);
  if (subject === null) throw new NotFound("membership_not_found");

  // The lifecycle's lock, before this command touches `profile_change_requests`
  // at all. Without it this command reached the two rows in the *opposite*
  // order from `ApproveProfileChange` — it took the request row, then needed
  // `FOR KEY SHARE` on the reader's `users` row for its audit entry's
  // `actor_id`, while approval held `for update` on that `users` row and wanted
  // the request — and a manager clicking *Duyệt* as the reader clicked *Huỷ*
  // deadlocked. `40P01` is not a `DomainError`, so the loser got a 500, which
  // OPS §2 forbids. It also makes the select below current: every writer of
  // that request row holds this same lock first, so nothing can decide the
  // request between reading its status here and updating it below.
  // `../profile-fields.ts` holds the whole rule.
  await lockPerson(tx, subject.userId);

  // RLS scopes this to the shelf; a request of another shelf is zero rows and
  // therefore `write_target_not_found`, not `not_own_request` — telling a
  // caller "that is somebody else's" would confirm it exists.
  const [request] = await tx<
    {
      id: string;
      status: string;
      user_id: string;
      proposed_values: unknown;
    }[]
  >`
      select id, status, user_id, proposed_values from profile_change_requests
      where id = ${input.profileChangeRequestId}
    `;
  if (!request) throw new NotFound("write_target_not_found");
  if (request.user_id !== subject.userId) {
    throw new RuleViolated("not_own_request");
  }
  if (request.status !== "pending") {
    throw new RuleViolated("profile_change_not_pending");
  }

  // §9's routing (`docs/superpowers/specs/2026-08-12-po-feedback-design.md`),
  // reused rather than restated — see this file's own docstring for why
  // self-cancellation is *not* refused the way self-approval is.
  // `requireSelfOrManager` above is only the floor: it lets any `manager`+
  // through regardless of whose request this is, which is exactly the gap
  // this fix closes.
  const isSelf = ctx.actor.membershipId === input.membershipId;
  if (!isSelf) {
    const subjectIsManager = atLeast(subject.role, "manager");
    if (subjectIsManager && ctx.actor.role !== "super_admin") {
      throw new RuleViolated("not_permitted");
    }
  }

  await tx`
      update profile_change_requests
         set status = 'cancelled', decided_at = ${ctx.clock.now()}
       where id = ${request.id} and status = 'pending'
    `;

  return {
    result: { avatarObject: avatarObjectOf(request.proposed_values) },
    audit: {
      action: "profile_change.cancelled",
      entityType: "profile_change_request",
      entityId: request.id,
      before: { status: "pending" },
      after: { status: "cancelled" },
    },
  };
};
