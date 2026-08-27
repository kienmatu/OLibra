import { NotFound, RuleViolated, ValidationFailed } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { type CopyState, copyStateTransition, requireManager } from "../policy";

/**
 * Permanently withdraws a copy (BR §7.1: `available → retired`, `lost →
 * retired`).
 *
 * The reason is required by the database as well as by the catalogue —
 * `book_copies_retired_has_reason` is `check (state <> 'retired' or
 * retired_reason is not null)`. Checking it here first is what turns a 23514
 * raised from inside the transaction into the named failure OPS §2 requires.
 *
 * `retire_reason_required` rather than the shipped `reason_required`, whose
 * sentence is "Vui lòng ghi lý do huỷ." — *huỷ* is the word for cancelling
 * something, not for taking a book off the shelf for good.
 *
 * **A copy that is `on_loan` cannot be retired directly** — BR §7.1's own
 * note: "it must first be returned or reported lost." The refusal comes from
 * `copyStateTransition`, which has no `on_loan → retired` arrow and names the
 * refusal `copy_on_loan` specifically for that `from` state (see
 * `refusalFor` in `../policy`), rather than the generic `copy_not_available`
 * a `held` copy gets. A copy someone is still holding is a book the system
 * has lost track of if this were allowed to succeed.
 */
export const retireCopy: Command<{ copyId: string; reason: string }, void> = async (
  tx,
  ctx,
  input,
) => {
  requireManager(ctx);

  if (!input.reason || input.reason.trim() === "") {
    throw new ValidationFailed("retire_reason_required", "reason");
  }

  const [copy] = await tx<{ id: string; state: CopyState }[]>`
    select id, state from book_copies where id = ${input.copyId} and deleted_at is null
  `;
  if (!copy) throw new NotFound("copy_not_found");

  const move = copyStateTransition(copy.state, "retired");
  if (!move.allowed) throw new RuleViolated(move.reason!);

  await tx`
    update book_copies
    set state = 'retired', retired_at = ${ctx.clock.now()}, retired_reason = ${input.reason.trim()}
    where id = ${copy.id}
  `;

  return {
    result: undefined,
    audit: {
      action: "copy.retired",
      entityType: "copy",
      entityId: copy.id,
      before: { state: copy.state },
      after: { state: "retired", reason: input.reason.trim() },
    },
  };
};
