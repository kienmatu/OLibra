import { NotFound, RuleViolated } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command } from "../../kernel/unit-of-work";
import { requireManager } from "../policy";
import {
  applyProfileFields,
  diffProfileFields,
  normaliseProfilePatch,
  type ProfilePatch,
} from "../profile-fields";
import { userOfMembership } from "../scoped-user";

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
 * ── The action name ──────────────────────────────────────────────────────
 *
 * `profile.corrected`, and deliberately neither of the two names already in
 * use. Not `membership.updated`, which `./update-own-profile.ts` uses for the
 * leaderboard toggle — a reader flipping their own visibility and a manager
 * rewriting a child's date of birth are not the same event and BR §13.2's
 * Oversight view must be able to tell them apart. Not
 * `profile_change.approved`, which is a manager who was *shown a proposal*
 * ruling on it. The thing a super administrator must be able to filter for is
 * precisely "a manager changed someone's details with no approval step", the
 * same oversight need `credentials.set` serves.
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

  // `userOfMembership` is the *only* way to obtain the `ScopedUserId` that
  // `applyProfileFields` will accept, and that is the whole point: it performs
  // the shelf-scoped join itself, so a command cannot reach a person any other
  // way without the compiler saying so. See `../scoped-user.ts`.
  const userId = await userOfMembership(tx, input.membershipId);
  if (userId === null) throw new NotFound("membership_not_found");

  const { before, after } = await applyProfileFields(tx, userId, patch);
  const diff = diffProfileFields(before, after);

  // Note 3 above. Nothing has committed yet; this rolls back the `UPDATE`
  // along with everything else, and no audit entry is written because
  // `runCommand` never reaches the insert.
  if (diff.changed.length === 0) {
    throw new RuleViolated("empty_proposal");
  }

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
