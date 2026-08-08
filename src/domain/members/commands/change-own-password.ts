import { NotFound, RuleViolated } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { assertPasswordLength, requireSelfOrManager } from "../policy";
import { hashFor, verifyFor } from "../registration";

/**
 * A reader changes their own password (OPS §4.3). BR §16.2: "Changing the
 * password and toggling leaderboard visibility take effect immediately —
 * neither is a fact about the person that a manager verified", which is why
 * this is not a `ProfileChangeRequest` the way every other personal field now
 * is.
 *
 * **The input is a `membershipId`, not OPS §4.3's `userId`.** OPS lists
 * `userId`, and taking one would be a real hazard here: `users` carries no
 * row-level security (DB §3), so a caller-supplied `userId` is guarded only by
 * whatever comparison the command remembers to make. A membership id is
 * compared against `ctx.actor.membershipId`, which `contextFor`
 * (`src/auth/guards.ts`) resolved from the session and the shelf — never from
 * the request — and the `users` row is reached only by joining out of a row
 * RLS already scoped. The screen calling this is already rendering that
 * membership.
 *
 * **A wrong password and an account with no password fail identically.**
 * INV-14 makes credential-less a valid state; distinguishing it here would
 * tell a caller which accounts have never been given credentials. Same
 * reasoning `sign_in_failed` already carries in `src/auth/session.ts`.
 *
 * **The audit entry carries no before and no after,** for the same reason
 * `setReaderCredentials`' does — OPS §4.3 lists "password value never captured
 * in the audit record (§14)" among this command's own invariants, not only
 * that one's.
 */
export const changeOwnPassword: Command<
  { membershipId: string; currentPassword: string; newPassword: string },
  void
> = async (tx, ctx, input) => {
  requireSelfOrManager(ctx, input.membershipId);
  assertPasswordLength(input.newPassword, "new_password_too_short");

  const [membership] = await tx<{ user_id: string }[]>`
    select user_id from memberships
    where id = ${input.membershipId} and deleted_at is null
  `;
  if (!membership) throw new NotFound("membership_not_found");

  const [user] = await tx<{ password_hash: string | null }[]>`
    select password_hash from users
    where id = ${membership.user_id} and deleted_at is null
  `;
  if (!user) throw new NotFound("membership_not_found");

  const ok =
    user.password_hash !== null &&
    (await verifyFor(input.currentPassword, user.password_hash));
  if (!ok) throw new RuleViolated("current_password_incorrect");

  await tx`
    update users set password_hash = ${await hashFor(input.newPassword)}
    where id = ${membership.user_id}
  `;

  // A password change is a revocation too: whoever had the old one should not
  // keep a live session issued under it. Same transaction, same reasoning as
  // setReaderCredentials (BR §2).
  await tx`delete from sessions where user_id = ${membership.user_id}`.allowZero();

  return {
    result: undefined,
    audit: {
      action: "user.password_changed",
      entityType: "user",
      entityId: membership.user_id,
    },
  };
};
