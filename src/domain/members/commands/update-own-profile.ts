import type { AuditEntry } from "../../kernel/audit";
import { NotFound } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command } from "../../kernel/unit-of-work";
import { requireSelfOrManager } from "../policy";

export interface UpdateOwnProfileInput {
  membershipId: string;
  /** BR §16.2's toggle: whether this reader's name may appear in the rankings. */
  leaderboardOptIn: boolean;
}

/**
 * A reader changes the one thing on their profile page that takes effect
 * immediately: whether their name appears in the leaderboard (OPS §4.3,
 * `UpdateOwnProfile`).
 *
 * ── Why this command writes anything at all, when a reader may not ───────
 *
 * BR §16.2 draws the line and DATABASE.md §4.11 repeats it: "Password and
 * leaderboard visibility are the only things a reader changes directly …
 * neither is a fact about the person that a manager ever verified, so they
 * write straight to `users` and `memberships` and never pass through this
 * table." Everything else a reader wants changed is a proposal
 * (`./propose-profile-change.ts`), and the restated INV-13 keeps that half
 * intact: a **reader** still cannot rewrite their own verified details.
 *
 * `leaderboard_opt_in` is a column of `memberships`, not of `users`, and that
 * is the structural reason it is safe here — it is a fact about this person's
 * relationship to *this* shelf (BR §2's list), it is RLS-scoped, and this
 * command therefore never touches the table INV-13b guards. It is deliberately
 * **not** routed through `applyProfileFields`, whose allowlist is the eight
 * verified fields and must stay that way.
 *
 * ── The audit action, and why it is the one `UpdateReaderProfile` refused ─
 *
 * `membership.updated`. `./update-reader-profile.ts` says in its own docstring
 * that it deliberately does not use this name, "which `UpdateOwnProfile` uses
 * for the leaderboard toggle" — a claim that was false for as long as this
 * command did not exist, and true now. BR §13.2's Oversight view has to be able
 * to tell a reader flipping their own visibility apart from a manager rewriting
 * a child's date of birth, which is the whole reason `profile.corrected` is a
 * separate name.
 *
 * ── A toggle set to the value it already had writes no audit entry ───────
 *
 * OPS §4.3 lists no failure mode for this command beyond not-found, so it must
 * not start refusing one — a reader tapping a switch twice has done nothing
 * wrong. But an audit entry claiming a change nobody made is the thing
 * `empty_proposal` exists to prevent elsewhere in this slice, and BR §14's
 * browser renders every entry as a sentence. `Command`'s return type already
 * takes an `AuditEntry[]`, so "no entry" is expressible; `./reorder-parish-
 * units.ts` makes the same choice for a reorder that moved nothing, for the
 * same reason.
 */
export const updateOwnProfile: Command<UpdateOwnProfileInput, void> = async (
  tx,
  ctx,
  input,
) => {
  // `requireSelfOrManager` compares `ctx.actor.membershipId`, which `contextFor`
  // resolved from the session cookie and which no form can supply. OPS §4.3
  // calls this command's caller "reader (self only)"; a manager passes on rank,
  // which is the same admission every other self-service command in this slice
  // makes and is what lets a manager help a child who cannot read the screen.
  requireSelfOrManager(ctx, input.membershipId);
  // INV-8: the audit row names who did it, and `systemContext` would otherwise
  // pass the gate above on rank alone with a null actor — the defect
  // `requireIdentifiedActor` records `voidLoan` shipping.
  requireIdentifiedActor(ctx);

  // RLS scopes this to `ctx.bookshelfId`. The join to `users` is the same
  // half-sentence the sibling commands carry: a soft-deleted identity is "no
  // such reader" too, not a membership row that still answers.
  const [membership] = await tx<{ leaderboard_opt_in: boolean }[]>`
    select m.leaderboard_opt_in from memberships m
    join users u on u.id = m.user_id and u.deleted_at is null
    where m.id = ${input.membershipId} and m.deleted_at is null
  `;
  if (!membership) throw new NotFound("membership_not_found");

  if (membership.leaderboard_opt_in === input.leaderboardOptIn) {
    return { result: undefined, audit: [] as AuditEntry[] };
  }

  await tx`
    update memberships
       set leaderboard_opt_in = ${input.leaderboardOptIn}
     where id = ${input.membershipId} and deleted_at is null
  `;

  return {
    result: undefined,
    audit: {
      action: "membership.updated",
      // The **membership**, not the person: this is a fact about one
      // relationship, and the same reader at a second parish keeps their own
      // setting there. `audit_log.entity_id` is a bare `uuid` with no foreign
      // key, so each command states which id it writes.
      entityType: "membership",
      entityId: input.membershipId,
      before: { leaderboard_opt_in: membership.leaderboard_opt_in },
      after: { leaderboard_opt_in: input.leaderboardOptIn },
    },
  };
};
