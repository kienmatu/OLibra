import {
  PROFILE_FIELDS,
  type ProfileField,
  type ProfileFields,
  type ProfilePatch,
} from "./profile-fields";

/**
 * What a reader may put forward, and what happens when they put forward a
 * second thing while the first is still pending.
 *
 * Separate from `./profile-fields.ts` because the two answer different
 * questions and only one of them is a security boundary: that module says which
 * columns of `users` may ever be written, and this one says which of those a
 * *reader* may ask about and how two asks combine. Folding them together would
 * put a product reading (below) in the same file as an invariant.
 */

/**
 * The eight fields `ProposeProfileChange` accepts — `PROFILE_FIELDS` without
 * the photograph. (Seven until `phone_missing_reason` joined `PROFILE_FIELDS`
 * as its ninth field; this filter picked it up automatically, which is the
 * whole point of deriving rather than writing the list out again — see
 * below.)
 *
 * Derived from that array rather than written out again, so the two cannot
 * drift: a ninth verified field becomes proposable automatically, which is the
 * behaviour OPS §4.3 describes ("**every** field requires approval") and
 * DATABASE.md §4.11 chose `jsonb` for.
 *
 * The photograph is excluded here and only here. It is not a different *kind*
 * of fact — OPS §4.3 is explicit that the product owner named the photograph
 * when confirming every field needs approval — it is the one proposable field
 * that is a **file**, and it therefore arrives through `ProposeAvatarChange`,
 * whose caller has already put the bytes in the object store and has the
 * storage key to hand. That command writes `avatar_object` into the same
 * `proposed_values` this module merges, and `avatar_object` is the name rather
 * than `avatar_key` because `kernel/audit.ts` forbids `key` as a whole token
 * (see `./profile-fields.ts`).
 */
export const PROPOSABLE_FIELDS: readonly ProfileField[] = PROFILE_FIELDS.filter(
  (f) => f !== "avatar_object",
);

/**
 * ── A product reading, deliberately isolated so it can be reversed in one
 * line ───────────────────────────────────────────────────────────────────
 *
 * OPS §4.3 says two things that are fine apart and awkward together.
 * `ProposeAvatarChange` is "the file-carrying case rather than a separate
 * lifecycle" of `ProposeProfileChange` (`:540`), and proposing again while one
 * is pending "**replaces** it rather than creating a second… this is normal,
 * specified behavior, not a failure" (`:480`).
 *
 * Read strictly together, a reader who proposes a corrected phone number and
 * then a new photograph **silently loses the phone proposal**, with no signal
 * anywhere on a screen that shows one pending card. That is a data-loss
 * outcome nobody asked for, arrived at by composing two sentences neither of
 * which was written with the other in mind.
 *
 * So this slice reads `:480` as *replace the portion you named*, and merges the
 * rest. `"merge"` is the reading; `"replace"` is `:480` taken literally. The
 * product owner may prefer the literal one — B2b's plan §8 flags it as the one
 * question it answers on a reading rather than on a source.
 *
 * **Reversing it is no longer "this constant plus the test named in its
 * comment, nothing else".** That was true on `main`, where `carryAvatar`
 * unconditionally grafted `avatar_object` back onto `proposed_values` after
 * every merge, so a `"replace"` that dropped the key here got it restored a
 * step later. This branch deleted `carryAvatar` (correctly — `avatar_object`
 * is an ordinary `ProfileField` now, kept by `pickProfileFields` like any
 * other, so a second graft would be redundant). Under `"replace"`,
 * `mergeProposal` now returns `{ proposed: { ...incoming } }` outright: a
 * phone-only `ProposeProfileChange` while a photograph is still pending would
 * silently drop `avatar_object` from `proposed_values`, and nothing would
 * ever name that key again for `decideAndDiscardAvatar` to delete on
 * rejection or cancellation — an orphaned photograph left behind forever in a
 * public-read bucket. Flipping this constant today requires restoring that
 * graft (or an equivalent) alongside it, not flipping it alone.
 *
 * Typed as the union rather than inferred as its value on purpose: without the
 * annotation TypeScript narrows this to the literal `"merge"` and then reports
 * the `=== "replace"` branch below as an impossible comparison, so flipping the
 * value would be a compile error rather than a one-line change.
 */
export const PROPOSAL_ON_SECOND_PROPOSE: "merge" | "replace" = "merge";

export interface ProposalContents {
  proposed: ProfilePatch;
  previous: ProfilePatch;
}

/**
 * Combines an incoming proposal with whatever is already pending, and takes
 * BR §5.4's snapshot for the fields this proposal touches.
 *
 * `current` is the person as they stand right now, which is what
 * `previous_values` means: BR §5.4 wants it "so a manager reviewing a week-old
 * request sees what it would actually change". Only the incoming fields are
 * re-snapshotted — a field already pending keeps the snapshot taken when it was
 * first proposed, because that is the moment its `previous` describes.
 *
 * What this deliberately does **not** do is prune entries of `existing` that
 * have since become equal to `current` — say, because a manager corrected the
 * phone number directly while the reader's proposal for it sat pending. That
 * would make this command edit a portion of the request it was not asked about,
 * and §3.5 of the plan settles the same question the other way for
 * `UpdateReaderProfile`: neither command reaches into the other's half. A
 * manager approving a proposal whose value already matches simply writes the
 * value that is already there, which is a no-op with an honest audit entry.
 *
 * Pure, and returns new objects rather than mutating either argument, so the
 * caller's `existing` is still available for an audit `before`.
 */
export function mergeProposal(
  existing: ProposalContents | null,
  incoming: ProfilePatch,
  current: ProfileFields,
): ProposalContents {
  const snapshotOf = (patch: ProfilePatch): ProfilePatch =>
    Object.fromEntries(
      Object.keys(patch).map((f) => [f, current[f as ProfileField]]),
    ) as ProfilePatch;

  if (existing === null || PROPOSAL_ON_SECOND_PROPOSE === "replace") {
    return { proposed: { ...incoming }, previous: snapshotOf(incoming) };
  }

  return {
    proposed: { ...existing.proposed, ...incoming },
    previous: { ...existing.previous, ...snapshotOf(incoming) },
  };
}
