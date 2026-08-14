import { NotFound, RuleViolated } from "../../kernel/errors";
import { atLeast, requireIdentifiedActor } from "../../kernel/tenant";
import type { Command } from "../../kernel/unit-of-work";
import { requireManager } from "../policy";
import {
  applyProfileFields,
  assertPhoneOrReason,
  diffProfileFields,
  normaliseProfilePatch,
  type ProfilePatch,
} from "../profile-fields";
import { userAndRoleOfMembership } from "../scoped-user";

export interface UpdateReaderProfileInput {
  /**
   * **A membership id, and there is deliberately no `userId` parameter.**
   * See the note in this file's docstring — this is the whole of the
   * protection between a manager of one parish and every person in the system.
   */
  membershipId: string;
  /** Any subset of `PROFILE_FIELDS`. An absent key is untouched; `null` clears. */
  fields: ProfilePatch;
}

/**
 * A manager corrects a reader's personal details directly, with no approval
 * step (OPS §4.3, `UpdateReaderProfile`).
 *
 * ── Why this command exists, and why it is not a weakening ───────────────
 *
 * BR §2 makes credentials optional *because* most readers are children who
 * will never sign in, and `ProposeProfileChange`'s caller is `reader` (self
 * only). So for most of the shelf there was no path at all to a corrected
 * phone number — the number BR §16.3 calls the actual mechanism by which books
 * come back. Master plan §5 Q8 named that hole and assumed the answer would be
 * "a manager proposes on the reader's behalf"; the product owner decided the
 * opposite on 2026-08-09, and BR §6's INV-13 was restated before this command
 * was written (commit `fb95adc`).
 *
 * It reads as a weakening and is not one. BR §2 already hands a manager a
 * strictly larger power, by an argument that applies unchanged here: whoever
 * can set a reader's password (`./set-reader-credentials.ts`) can sign in as
 * that reader and propose anything as that reader — and the audit trail would
 * then say a *reader* proposed it. A direct edit naming the manager is the more
 * truthful record. What INV-13b protects is that a person's details never
 * change **silently**, not the approval step as such; the narrower thing the
 * approval step protects still holds, because a *reader* still cannot rewrite
 * their own verified details.
 *
 * ── Four things this command must get right ──────────────────────────────
 *
 * **1. The reader is reached through `memberships`, never from a caller-
 * supplied id.** `users` carries no row-level security at all — `0010_rls.sql`
 * names it excluded by design, and B2a probed it live: `update users … where
 * id = <any user>` succeeds from any scoped session. A command here taking a
 * `userId` would let a manager of one parish rewrite every person in the
 * system, guarded by nothing but a comparison somebody remembered to write.
 * `userOfMembership` (`../scoped-user.ts`) is filtered by RLS to
 * `ctx.bookshelfId`, so a cross-shelf id yields zero rows and the sentence is
 * "Không tìm thấy bạn đọc này." — which is also the honest one. Same rule and
 * same reason as `./set-reader-credentials.ts`.
 *
 * That used to be a promise this file made and nothing checked. It is now in
 * the type: `applyProfileFields` takes a `ScopedUserId`, a branded string only
 * `../scoped-user.ts` can mint, and it mints one only by joining
 * `memberships`. Review found the evasion that made the change worth making —
 * a *new* command calling `applyProfileFields(tx, userIdFromInput, patch)`
 * writes no `update users` of its own, so the INV-13b grep test stays green
 * while the shelf-scoped join is skipped entirely. The grep catches a fourth
 * file writing the table; the type catches a second caller reaching the wrong
 * person, and neither alone is enough.
 *
 * **2. Both gates, not one.** `requireManager` ranks a role, and
 * `systemContext` (`kernel/tenant.ts`) yields the *highest* rank with nobody
 * behind it: `{ userId: null, membershipId: null, role: "super_admin" }`. A
 * rank-only gate therefore passes under the seed or a scheduled job and commits
 * an audit row whose actor is null — which is exactly the defect
 * `requireIdentifiedActor`'s own docstring records `voidLoan` shipping. INV-8
 * asks for the actor by name, and BR §2's argument for permitting this command
 * at all is that every use of it is attributable.
 *
 * **3. An edit that changes nothing writes nothing.** `empty_proposal` is
 * raised *after* `applyProfileFields`, on the authoritative before/after that
 * statement returns, and the throw rolls the whole transaction back — the
 * no-op `UPDATE` included. That ordering is deliberate rather than lazy: the
 * alternative is to read the row, compare, and then write, which decides on one
 * snapshot and writes against another. An audit entry is a claim about what
 * changed, and this way its two halves come from one statement. The test that
 * holds it asserts `users.updated_at` did not move, which is the part a
 * pre-check would leave true by accident.
 *
 * **4. The audit entry carries only the fields that actually changed.** OPS
 * §4.3 asks for it and BR §14 is the reason: an entry listing all eight fields,
 * six identical on both sides, says "a manager rewrote this person" when a
 * manager fixed a phone number.
 *
 * **5. A manager's or admin's own record is not this command's to write.**
 * Added in the post-review fix wave that followed this command's first
 * review: §9 of `docs/superpowers/specs/2026-08-12-po-feedback-design.md`
 * routes a `manager`/`admin`-subject profile change through a `super_admin`
 * at `/quan-tri/doi-thong-tin` (`./approve-profile-change.ts:167-170`), and
 * this command wrote the identical nine columns with no such check — a
 * manager could open a colleague from the ordinary "Bạn đọc" list, or their
 * own record (the check is the same either way: a manager's own membership
 * role is `manager`), and rewrite it in one click, no approval, no colleague
 * in the loop. `userAndRoleOfMembership` (`../scoped-user.ts`) resolves the
 * subject's role in the same scoped join that resolves their id, so this is
 * one more column off an already-validated row, not a second permission
 * check to keep in step with the first.
 *
 * **6. `avatar_object` rides along in `patch` with no avatar-specific
 * handling at all, and that is currently safe but only by accident of what
 * calls this command, not by anything enforced here.** `input.fields` is a
 * raw `ProfilePatch` — see `../profile-fields.ts`, "the allowlist is
 * `PROFILE_FIELDS`, data, not a chain of `if`s" — and `PROFILE_FIELDS`'s ninth
 * entry is the photograph, so nothing in this file's types stops a caller
 * from writing `avatar_object` directly through `applyProfileFields`, the
 * same statement every other field goes through. Every other path that can
 * replace a photograph — `ProposeAvatarChange`/`ApproveProfileChange`,
 * `RejectProfileChange`, `CancelProfileChange` — is wrapped in
 * `decideAndDiscardAvatar` (`../../../lib/avatar.ts`) precisely so the object
 * a new key supersedes gets deleted from the bucket rather than orphaned;
 * this command has no such wrapper on its path at all, because it has never
 * needed one. It is safe today for one reason and one only:
 * `updateReaderProfileAction` (`quan-ly/actions.ts`), the sole caller, builds
 * its `fields` object by hand from eight named form inputs and does not
 * include a ninth for the photograph — `avatar_object` is never `named()` in
 * any patch this command actually receives, so the `case when … else
 * prev.avatar_object end` arm in `applyProfileFields`'s statement always
 * takes its `else`. That is a fact about the one caller today, not a
 * constraint this command enforces on itself. A future caller — a bulk-edit
 * screen, an API route, a second admin form — that assembles its own patch
 * and includes `avatar_object` would write a bare storage key straight onto
 * `users` with nothing deleting whatever key it replaced: a photograph
 * orphaned in a public-read bucket, silently, with an audit entry that
 * (correctly) says the field changed and nothing that says a file was
 * leaked. Per this file's own docstring and `INV-13b`, that gap is left open
 * deliberately rather than closed defensively here — the fix, if one is ever
 * needed, is for the *new* caller to route its avatar writes through
 * `decideAndDiscardAvatar` the way every other avatar-touching path already
 * does, not for this command to grow a special case for a field it has never
 * had to think about.
 *
 * ── The action name ──────────────────────────────────────────────────────
 *
 * `profile.corrected`, and deliberately not `profile_change.approved`, which
 * is a manager who was *shown a proposal* ruling on it. The thing a super
 * administrator must be able to filter for is precisely "a manager changed
 * someone's details with no approval step", the same oversight need
 * `credentials.set` serves.
 *
 * Its Vietnamese label and sentence did not exist anywhere and are newly
 * authored — see `../profile-copy.ts`, which is flagged for the product owner.
 */
export const updateReaderProfile: Command<UpdateReaderProfileInput, void> = async (
  tx,
  ctx,
  input,
) => {
  requireManager(ctx);
  requireIdentifiedActor(ctx);

  // Before the membership select, so a malformed date or a blanked
  // `full_name` is refused without a database round trip and without the
  // `for update` lock `applyProfileFields` takes.
  const patch = normaliseProfilePatch(input.fields);

  // A caller that named no fields at all. `empty_proposal` is the same
  // refusal as a caller that named eight fields none of which differ — from
  // the manager's side both are "you have not changed anything" — but this
  // one is worth catching here, because an empty patch makes
  // `applyProfileFields` issue an eight-armed no-op `UPDATE` for nothing.
  if (Object.keys(patch).length === 0) {
    throw new RuleViolated("empty_proposal");
  }

  // `userAndRoleOfMembership` is the *only* way to obtain the `ScopedUserId`
  // that `applyProfileFields` will accept, and that is the whole point: it
  // performs the shelf-scoped join itself, so a command cannot reach a
  // person any other way without the compiler saying so. See
  // `../scoped-user.ts`.
  const subject = await userAndRoleOfMembership(tx, input.membershipId);
  if (subject === null) throw new NotFound("membership_not_found");
  const { userId, role: subjectRole } = subject;

  // Note 5 above. Mirrors `approveProfileChange`'s identical check
  // (`./approve-profile-change.ts:167-170`), same error code, derived fresh
  // from the subject's *current* membership role rather than a stored value —
  // a membership promoted or demoted since the last write is routed
  // correctly with nothing to update. This also refuses a manager editing
  // their own record: their own membership role is exactly `manager`, so no
  // separate self-check is needed the way `approveProfileChange` needs one
  // for self-*approval* (this command has no queue to route a self-edit
  // through in the first place — refusing the write is the whole of it).
  if (atLeast(subjectRole, "manager") && ctx.actor.role !== "super_admin") {
    throw new RuleViolated("not_permitted");
  }

  const { before, after } = await applyProfileFields(tx, userId, patch);
  const diff = diffProfileFields(before, after);

  // Note 3 above. Nothing has committed yet; this rolls back the `UPDATE`
  // along with everything else, and no audit entry is written because
  // `runCommand` never reaches the insert.
  if (diff.changed.length === 0) {
    throw new RuleViolated("empty_proposal");
  }

  // PO feedback round 1, Task 8. Checked after `applyProfileFields`, on the
  // same authoritative `after` the diff above reads — so a reason already on
  // file (inherited from `prev` because this call named neither field) answers
  // this without the manager retyping it, and only a record that ends up
  // genuinely silent on both is refused. Rolls the whole transaction back,
  // same as `empty_proposal` just above.
  assertPhoneOrReason(after);

  return {
    result: undefined,
    audit: {
      action: "profile.corrected",
      // `entityType: "user"` and the *user* id, matching `credentials.set`
      // on the sibling command: what changed is the person, not the
      // relationship. `audit_log.entity_id` is a bare `uuid` with no foreign
      // key (`0007:28`), so which of the two ids goes in it is a decision
      // each command states rather than one the schema makes.
      entityType: "user",
      entityId: userId,
      before: diff.before,
      after: diff.after,
    },
  };
};
