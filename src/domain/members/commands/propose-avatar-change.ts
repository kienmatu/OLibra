import { NotFound, RuleViolated, ValidationFailed } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command } from "../../kernel/unit-of-work";
import {
  AVATAR_OBJECT,
  readPendingProposal,
  writePendingProposal,
} from "../pending-proposal";
import { blank, requireSelfOrManager } from "../policy";
import { readProfileFields } from "../profile-fields";
import { mergeProposal } from "../profile-proposals";

export interface ProposeAvatarChangeInput {
  /**
   * Whose photograph. **Omitted means the caller's own**, taken from
   * `ctx.actor.membershipId` — see the command's note on why that default is the
   * safest available value rather than a convenience.
   */
  membershipId?: string;
  /** What a browser will fetch — `ObjectStore.url(key)`, resolved at the surface. */
  avatarUrl: string;
  /** The storage key the surface just wrote the bytes to. Never copied onto `users`. */
  avatarObject: string;
}

/**
 * A reader proposes a new photograph (OPS §4.3). Like every other personal
 * field it takes effect only on approval — this is `ProposeProfileChange`'s
 * file-carrying case, not a separate lifecycle, and it shares that command's
 * pending row, its merge and its cross-shelf `23505` catch through
 * `../pending-proposal.ts`.
 *
 * ── The domain never sees the bytes, and this is where that is decided ───
 *
 * `tests/architecture/boundaries.test.ts` forbids anything under `src/domain/`
 * importing `src/storage/` or `@aws-sdk/*`, and it names the tempting wrong move
 * in its own comment: a command that stored the file inside its own transaction
 * would leave an object nobody references the moment that transaction rolled
 * back. So the surface puts the bytes, and hands this command two strings.
 *
 * That split is also why `file_too_large` and `invalid_image` — the two failure
 * modes OPS §4.3 lists for this command — are not raised here. Both are facts
 * about bytes this command is forbidden to hold. They are raised by
 * `src/lib/avatar.ts`, with the domain's own codes, before anything is stored.
 * **No aspect-ratio check is enforced anywhere.** OPS §4.3 says "≤2 MB, square,
 * per the profile screen's own copy"; the size has a sentence
 * (`file_too_large`, "Ảnh vượt quá 2 MB.") and is therefore implementable from
 * the sentence, while "square" has no sentence, no code and no source — the
 * profile screen's copy says only that a new photograph goes to a manager for
 * approval. The B2b plan §8 asks the product owner for it rather than inventing
 * a refusal a reader would have no way to understand.
 *
 * ── What is stored, and the one name that is not arbitrary ───────────────
 *
 * `proposed_values` carries **both** `avatar_url` (copied to `users.avatar_url`
 * on approval, like any other proposed field) and `avatar_object` (the storage
 * key, never copied anywhere). The key is there so that rejecting or cancelling
 * the request can delete the object rather than leave it orphaned, which OPS
 * §4.3 requires: "a rejected or cancelled proposal's image is deleted rather
 * than left orphaned in storage."
 *
 * It is called `avatar_object` and not `avatar_key` because `kernel/audit.ts`
 * forbids `key` as a whole token, and this command audits the payload. See
 * `../pending-proposal.ts`, which owns the name.
 *
 * ── The superseded object, and who deletes it ────────────────────────────
 *
 * Proposing a second photograph while the first is pending replaces it, and the
 * first one's object is then referenced by nothing. This command returns its key
 * rather than deleting it — it cannot delete it — and the surface deletes it
 * **after the transaction commits**, for the reason `src/lib/avatar.ts` states
 * at length: a delete issued before a commit that then fails destroys an image a
 * live request still points at, while a delete issued after a commit that then
 * fails costs one orphaned object and can be retried.
 *
 * ── No `empty_proposal` ──────────────────────────────────────────────────
 *
 * `ProposeProfileChange` filters its patch against the person's current values
 * and refuses a proposal that would change nothing. That check has no meaning
 * here: `objectKey` mints a fresh UUID per upload, so a re-uploaded identical
 * photograph is a genuinely different object at a genuinely different URL. What
 * a refusal *would* do is strand the bytes the surface has already written, with
 * nothing left holding their key.
 */
export const proposeAvatarChange: Command<
  ProposeAvatarChangeInput,
  { profileChangeRequestId: string; supersededAvatarObject: string | null }
> = async (tx, ctx, input) => {
  // A reader proposing their own photograph names nobody: the membership is
  // `ctx.actor.membershipId`, which `contextFor` resolved from the session
  // cookie and which no form can supply. That is the *identity* case of
  // `requireSelfOrManager`, so defaulting to it cannot widen what this command
  // permits — it can only remove a hidden field from a page, and a value that is
  // never posted is a value nobody can rewrite. OPS §4.3 lists `membershipId`
  // as an input because a manager may also set a photograph "when registering on
  // behalf"; that caller supplies it, and is gated on rank exactly as before.
  //
  // A caller with no membership *and* no supplied id is a `super_admin` browsing
  // a shelf they hold no membership of, or a guest. Neither has a photograph
  // here to propose.
  const membershipId = input.membershipId ?? ctx.actor.membershipId;
  if (membershipId === null || membershipId === undefined) {
    throw new RuleViolated("not_permitted");
  }
  requireSelfOrManager(ctx, membershipId);
  // A proposal names who asked, and the `profile_change.proposed` audit row is
  // the only place that survives once the request is decided. `systemContext`
  // holds `super_admin` with a null `userId` and would otherwise pass the gate
  // above on rank alone — the defect `requireIdentifiedActor` records.
  requireIdentifiedActor(ctx);

  // Not `validation_failed` being generous: an empty url or key is a surface
  // that called this without storing anything, and writing it would produce a
  // request proposing a photograph that does not exist. OPS §4.3 lists no code
  // for it, and `validation_failed` — "Vui lòng kiểm tra lại thông tin." — is
  // the catalogue's own sentence for input this command cannot act on.
  if (blank(input.avatarUrl)) {
    throw new ValidationFailed("validation_failed", "avatarUrl");
  }
  if (blank(input.avatarObject)) {
    throw new ValidationFailed("validation_failed", AVATAR_OBJECT);
  }

  // RLS scopes this to `ctx.bookshelfId`; `users` has none, so this join is the
  // whole of what stands between a caller and any person in the system. OPS
  // §4.3:562 lists `membershipId` for this command for exactly that reason.
  const [membership] = await tx<{ user_id: string }[]>`
    select m.user_id from memberships m
    join users u on u.id = m.user_id and u.deleted_at is null
    where m.id = ${membershipId} and m.deleted_at is null
  `;
  if (!membership) throw new NotFound("membership_not_found");

  const current = await readProfileFields(tx, membership.user_id);
  if (!current) throw new NotFound("membership_not_found");

  const pending = await readPendingProposal(tx, membership.user_id);
  const next = mergeProposal(
    pending?.contents ?? null,
    { avatar_url: input.avatarUrl.trim() },
    current,
  );

  const requestId = await writePendingProposal(tx, ctx, {
    userId: membership.user_id,
    pending,
    next,
    avatarObject: input.avatarObject.trim(),
  });

  // Only when it is a *different* object. A surface that retried the same
  // command with the same key would otherwise be told to delete the image the
  // row it just wrote still points at.
  const superseded =
    pending?.avatarObject && pending.avatarObject !== input.avatarObject.trim()
      ? pending.avatarObject
      : null;

  return {
    result: {
      profileChangeRequestId: requestId,
      supersededAvatarObject: superseded,
    },
    audit: {
      // OPS §4.3:565 — the same action as `ProposeProfileChange`, "with the
      // changed field named in the payload". This is one lifecycle, so the
      // audit browser filters it as one thing.
      action: "profile_change.proposed",
      entityType: "profile_change_request",
      entityId: requestId,
      before: { avatar_url: next.previous.avatar_url ?? null },
      // The storage key is audited as well as the URL. It is the only durable
      // record of which object a decided request once pointed at — the row's
      // own `proposed_values` is overwritten by the next proposal, while INV-12
      // makes the audit append-only. This is also the payload whose field name
      // `kernel/audit.ts` would have rejected as `avatar_key`.
      after: {
        avatar_url: input.avatarUrl.trim(),
        [AVATAR_OBJECT]: input.avatarObject.trim(),
      },
    },
  };
};
