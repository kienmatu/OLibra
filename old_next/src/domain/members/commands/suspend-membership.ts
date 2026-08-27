import { NotFound, RuleViolated } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import {
  type MembershipStatus,
  membershipTransition,
  requireManager,
} from "../policy";

/**
 * `active → suspended` (BR §7.5). BR §3's example — "a reader is suspended
 * while still holding a book" — is why INV-4's second sentence exists: this
 * command only ever flips `status`. It does not touch `loans`, and it must
 * not; a suspended reader's existing loan is unaffected (see
 * `tests/invariants/inv-04-suspended-cannot-borrow.test.ts`).
 *
 * The reason is optional (OPS §4.3) — a manager may suspend without typing
 * one — unlike `rejectMembership`'s, which the database itself requires.
 *
 * The select runs before the update for the same reason `approveMembership`'s
 * does: RLS's `using` clause filters a cross-shelf update to zero rows rather
 * than raising, so the prior read is what turns that silence into
 * "Không tìm thấy bạn đọc này." instead of the kernel guard's generic code.
 */
export const suspendMembership: Command<
  { membershipId: string; reason?: string | null },
  void
> = async (tx, ctx, input) => {
  requireManager(ctx);

  const [membership] = await tx<{ id: string; status: MembershipStatus }[]>`
    select id, status from memberships
    where id = ${input.membershipId} and deleted_at is null
  `;
  if (!membership) throw new NotFound("membership_not_found");

  const move = membershipTransition(membership.status, "suspended");
  if (!move.allowed) throw new RuleViolated(move.reason!);

  const reason =
    input.reason === undefined ||
    input.reason === null ||
    input.reason.trim() === ""
      ? null
      : input.reason.trim();

  await tx`
    update memberships
    set status = 'suspended', suspension_reason = ${reason}
    where id = ${membership.id}
  `;

  return {
    result: undefined,
    audit: {
      action: "membership.suspended",
      entityType: "membership",
      entityId: membership.id,
      before: { status: membership.status },
      after: { status: "suspended" },
    },
  };
};
