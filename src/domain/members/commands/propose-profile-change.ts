import { NotFound, RuleViolated } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command } from "../../kernel/unit-of-work";
import { readPendingProposal, writePendingProposal } from "../pending-proposal";
import { requireSelfOrManager } from "../policy";
import {
  assertPhoneOrReason,
  normaliseProfilePatch,
  readProfileFields,
  type ProfileField,
  type ProfilePatch,
} from "../profile-fields";
import { userOfMembership } from "../scoped-user";
import { mergeProposal, PROPOSABLE_FIELDS } from "../profile-proposals";

export interface ProposeProfileChangeInput {
  membershipId: string;
  /** Any subset of `PROPOSABLE_FIELDS`. The photograph is `ProposeAvatarChange`'s. */
  fields: ProfilePatch;
}

/**
 * A reader proposes new values for their own verified details (OPS §4.3; BR §2,
 * "Changing your own details is a request, not an edit").
 *
 * **This command never writes to `users`.** That is BR §6's restated INV-13
 * read strictly: a manager may correct a person's details directly, and a
 * *reader* may not — the existing values stay in force, "including the phone
 * number, so a manager never loses the means of contacting a family
 * mid-change", until a manager approves. It is also master plan §7.2's
 * acceptance clause, which B2a deferred to this slice.
 *
 * ── Proposing again while one is pending ─────────────────────────────────
 *
 * OPS §4.3 calls this normal rather than a failure, and this command implements
 * it in three steps whose order is forced by the schema rather than chosen:
 *
 * 1. **Look for a pending request.** RLS scopes the read to this shelf.
 * 2. **Merge.** `../profile-proposals.ts` holds the merge and the one constant
 *    that reverses it; see there for why "replace" taken literally would
 *    silently lose a reader's phone proposal the moment they also proposed a
 *    photograph.
 * 3. **Update, or insert and catch `23505`.**
 *
 * Steps 1 and 3 are `../pending-proposal.ts`, shared with `ProposeAvatarChange`
 * — which OPS §4.3 calls "the file-carrying case rather than a separate
 * lifecycle" of this command, and which would otherwise be a second copy of a
 * lifecycle whose two subtleties (the cross-shelf `23505`, and carrying
 * `avatar_object` through a proposal that is not about the photograph) are both
 * silent when they are got wrong. That module carries the long version of both.
 *
 * ── Two smaller decisions ────────────────────────────────────────────────
 *
 * **A field proposed at its current value is not a proposal.** OPS §4.3's
 * `empty_proposal` is "nothing differs from the current values", so the
 * incoming patch is filtered against the person as they stand before anything
 * is stored. Otherwise a reader could fill a form, change nothing, and leave a
 * manager a request to decide about that would change nothing.
 *
 * **`requested_at` comes from `ctx.clock`, never from the column default.**
 * The default is `now()` on the *database* host (DATABASE.md §6, two clocks in
 * one transaction), and this is a timestamp the domain means: a test with a
 * `fixedClock` must be able to make a request look a week old without waiting a
 * week. `updated_at` on this table is written by `set_updated_at()` from SQL
 * `now()` and will not agree with it under a fixed clock; that is the rule, not
 * a bug, and no test may assert otherwise.
 */
export const proposeProfileChange: Command<
  ProposeProfileChangeInput,
  { profileChangeRequestId: string }
> = async (tx, ctx, input) => {
  requireSelfOrManager(ctx, input.membershipId);
  // A proposal names who asked, and `profile_change.proposed`'s audit row is
  // the only place that survives once the request is decided. `systemContext`
  // holds `super_admin` with a null `userId` and would otherwise pass the gate
  // above on rank alone — the defect `requireIdentifiedActor` records.
  requireIdentifiedActor(ctx);

  // Narrowed to the eight before validation, so a caller that sends
  // `avatar_url` gets it dropped rather than quietly bypassing
  // `ProposeAvatarChange`'s size and content-type policy, which lives at the
  // surface and cannot be enforced from here.
  const named = onlyProposable(input.fields);
  const patch = normaliseProfilePatch(named);
  if (Object.keys(patch).length === 0) {
    throw new RuleViolated("empty_proposal");
  }

  // RLS scopes this to `ctx.bookshelfId`; `users` has none, so the join
  // `userOfMembership` performs is the whole of what stands between a caller
  // and any person in the system — and it is the only source of the
  // `ScopedUserId` the three functions below will accept (`../scoped-user.ts`).
  const userId = await userOfMembership(tx, input.membershipId);
  if (userId === null) throw new NotFound("membership_not_found");

  const current = await readProfileFields(tx, userId);
  if (!current) throw new NotFound("membership_not_found");

  const incoming = Object.fromEntries(
    Object.entries(patch).filter(
      ([field, value]) => current[field as ProfileField] !== value,
    ),
  ) as ProfilePatch;
  if (Object.keys(incoming).length === 0) {
    throw new RuleViolated("empty_proposal");
  }

  const pending = await readPendingProposal(tx, userId);
  const next = mergeProposal(pending?.contents ?? null, incoming, current);

  // Fix round 1 (PO feedback round 1, Task 8). This screen has the reason
  // box (`ho-so/page.tsx` renders it, visible and pre-filled, exactly when
  // this check would matter) and `ApproveProfileChange`'s does not — its own
  // form carries only the request id. A refusal raised only at approval, on
  // a screen with nowhere to answer it, is not a refusal a manager can act
  // on; rejecting would be the only exit. So the record this proposal would
  // *produce*, if approved unchanged right now, is asked here — overlaying
  // `next.proposed` (this proposal, merged with whatever was already
  // pending) onto `current` for exactly the two fields that matter, the
  // same "resulting record, not the patch alone" rule `assertPhoneOrReason`
  // already applies at the two direct-write callers. `ApproveProfileChange`
  // keeps its own call as the backstop: a request written before this fix,
  // or by a caller that bypasses this command entirely, is still refused
  // rather than approved into a phone-less, reason-less record.
  assertPhoneOrReason({
    phone: "phone" in next.proposed ? (next.proposed.phone ?? null) : current.phone,
    phone_missing_reason:
      "phone_missing_reason" in next.proposed
        ? (next.proposed.phone_missing_reason ?? null)
        : current.phone_missing_reason,
  });

  // The pending row's `avatar_object` is carried through unchanged. This
  // command never proposes a photograph and never withdraws one, and
  // `pickProfileFields` — which `readPendingProposal` runs the stored bag
  // through — drops that key by design, so rebuilding `proposed_values` from
  // the patch alone would erase the storage key of an image the same row still
  // proposes by URL. Nothing would then be able to delete it on a reject.
  // `../pending-proposal.ts` holds the whole of that reasoning.
  const requestId = await writePendingProposal(tx, ctx, {
    userId,
    pending,
    next,
    avatarObject: pending?.avatarObject ?? null,
  });

  return {
    result: { profileChangeRequestId: requestId },
    audit: {
      action: "profile_change.proposed",
      // The request, not the person: nothing on the person changed, and that
      // is the whole point of this command. `ApproveProfileChange` is the one
      // that audits against the user id, because that is when a person's
      // details actually move.
      entityType: "profile_change_request",
      entityId: requestId,
      before: next.previous,
      after: next.proposed,
    },
  };
};

/** The seven, and nothing else — see `PROPOSABLE_FIELDS`. */
function onlyProposable(fields: ProfilePatch): ProfilePatch {
  return Object.fromEntries(
    PROPOSABLE_FIELDS.filter((f) => fields[f] !== undefined).map((f) => [
      f,
      fields[f],
    ]),
  ) as ProfilePatch;
}
