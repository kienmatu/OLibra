import {
  isUniqueViolation,
  NotFound,
  RuleViolated,
  ValidationFailed,
} from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { assertPasswordLength, blank, requireManager } from "../policy";
import { hashFor } from "../registration";

/**
 * Sets or changes a reader's sign-in details (OPS §4.3). One command for both
 * cases deliberately, "because they are the same act from the volunteer's
 * side": giving an account the ability to sign in for the first time, and
 * giving it back to someone who forgot. BR §4's assumption 2 — no outbound
 * email — means there is no self-service reset; a child who forgets asks the
 * volunteer standing at the shelf.
 *
 * ── Four things this command must get right ──────────────────────────────
 *
 * **1. The audit records the act, never the secret.** BR §2 states it as a
 * rule and BR §14 explains why it is stated twice: credential changes "are not
 * a field change to be captured automatically, because the field that changed
 * must never be recorded." The entry below sets neither `before` nor `after` —
 * not a redacted one, not `{ hasPassword: true }`. OPS §4.3: "with no before
 * and no after."
 *
 * The kernel's `assertNoSecrets` would catch a hash placed in either bag, but
 * it walks `before`/`after` **only** — it never reads `action`, `entityType`
 * or `entityId`, and `toRow` does not emit `context` at all. So not defeating
 * the guard is this command's job as much as the kernel's: nothing derived
 * from the password goes into any field of the entry. `audit.ts`'s `ALLOWED`
 * list would even permit `session_count` by name; it is not recorded, because
 * OPS says no after and this is not the place to be inventive.
 *
 * **2. It must not be quiet.** BR §2: "The mitigation is not to restrict the
 * power but to make every use of it visible" — whoever can set a password can
 * sign in as that reader, and that is inherent in a trust model which already
 * assumes the manager knows the family personally. `credentials.set` is
 * therefore a name the administration surface filters on (BR §13.2's
 * Oversight), which is why it is an explicit domain event with a stable action
 * name rather than an automatic change capture.
 *
 * **3. It ends that reader's existing sessions, in this transaction.** BR §2's
 * argument is revocability, and credentials that changed while an old session
 * kept working are not revoked. `revokeAllSessions` in `src/auth/session.ts`
 * has a docstring naming this exact caller but is unusable here for two
 * independent reasons: `tests/architecture/boundaries.test.ts` forbids
 * `src/domain` importing `src/auth`, and it opens its *own* transaction — so
 * the credential change could commit while the revocation failed. `olibra_app`
 * holds `delete` on `sessions` and on no other table (verified with `\dp`),
 * which is exactly enough.
 *
 * **4. The reader is reached through `memberships`, never from a caller
 * -supplied id.** `users` carries no row-level security (DB §3, "Global
 * tables"), verified live: `update users ... where id = <any user>` succeeds
 * from any scoped session. The membership select below — filtered by RLS to
 * this shelf — is the entire protection between a manager of one parish and
 * every account in the system. That is why the input is a `membershipId` and
 * why there is no `userId` parameter to get wrong.
 *
 * **5. The identity itself must not be soft-deleted.** IMPORTANT 4
 * (fix-report, 2026-08-08-b2-members): the membership select joins `users`
 * with `deleted_at is null`, the same predicate `changeOwnPassword` reaches
 * `users` through and `getReaderDetail`/`getReadersList` already filter on.
 * Narrower than an identity-slice Critical would be — `signIn` and
 * `resolveSession` both filter `deleted_at` too, so a credential written onto
 * a deleted row could never be used to sign in — but a manager should never
 * see this command succeed against a reader every other screen already
 * refuses to show. Nothing soft-deletes a `users` row yet, which is exactly
 * why this was easy to miss and why it must not stay missing.
 */
export const setReaderCredentials: Command<
  { membershipId: string; username: string; password: string },
  void
> = async (tx, ctx, input) => {
  requireManager(ctx);

  if (blank(input.username)) {
    throw new ValidationFailed("required_fields_missing", "username");
  }
  assertPasswordLength(input.password, "password_too_short");

  // RLS scopes this to ctx.bookshelfId. A membership on another shelf is
  // filtered to zero rows, so the sentence a cross-shelf caller gets is
  // "Không tìm thấy bạn đọc này." — which is also the honest one: as far as
  // this shelf is concerned, there is no such reader. The join onto `users`
  // adds the other half of that same sentence: a soft-deleted identity is
  // "no such reader" too (note 5 above).
  const [membership] = await tx<{ user_id: string }[]>`
    select m.user_id from memberships m
    join users u on u.id = m.user_id and u.deleted_at is null
    where m.id = ${input.membershipId} and m.deleted_at is null
  `;
  if (!membership) throw new NotFound("membership_not_found");

  const username = input.username.trim();

  // Checked before the write so the caller gets OPS §4.3's sentence rather
  // than a 23505, and scoped `id <> this user` so re-setting a password while
  // keeping the same username is not mistaken for a collision with oneself.
  const clash = await tx`
    select 1 from users
    where lower(username) = lower(${username})
      and deleted_at is null
      and id <> ${membership.user_id}
  `;
  if (clash.length > 0) throw new RuleViolated("username_in_use");

  const passwordHash = await hashFor(input.password);

  try {
    // INV-14: both columns in one statement, so the pairing cannot be broken
    // even momentarily. `users_credentials_paired` would catch it as a 23514;
    // writing both is what makes that unreachable rather than merely caught.
    await tx`
      update users
      set username = ${username}, password_hash = ${passwordHash}
      where id = ${membership.user_id}
    `;
  } catch (e) {
    // The check above closes the window for a sequential caller; a concurrent
    // one can still lose the race to the unique index. Translating it here is
    // what keeps that a plain Vietnamese sentence rather than a 500 (BR §2).
    if (isUniqueViolation(e)) throw new RuleViolated("username_in_use");
    throw e;
  }

  // Same transaction as the credential change, by construction (G3).
  await tx`delete from sessions where user_id = ${membership.user_id}`.allowZero();

  return {
    result: undefined,
    audit: {
      action: "credentials.set",
      entityType: "user",
      entityId: membership.user_id,
      // No before. No after. See note 1 above — this is the requirement, not
      // an omission somebody can helpfully fill in later.
    },
  };
};
