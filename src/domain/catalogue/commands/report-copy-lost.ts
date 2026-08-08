import type { AuditEntry } from "../../kernel/audit";
import { NotFound, RuleViolated } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { type CopyState, copyStateTransition, requireManager } from "../policy";

/**
 * Marks a copy lost, and closes the loan it was out on.
 *
 * **Q3, decided in this plan: only an `on_loan` copy.** BR §7.1 draws exactly
 * one arrow into `lost`. The refusal comes from `copyStateTransition`, so the
 * rule lives in one table rather than in an `if` here — and widening it, if
 * the product owner ever says `available → lost` is real, is a line in that
 * table plus a test, with nothing to change in this file.
 *
 * OPS §4.1: "if the copy has an active loan, that loan is closed out
 * (`loan.status = lost`, not left dangling as `active`)". That is a second
 * state transition, so INV-8 earns it a second audit entry — the kernel takes
 * an array.
 *
 * `note` has no column. BR §5.4 gives BookCopy a "time reported lost" and no
 * lost note, so the note lives in the audit entry, which is where a manager
 * reading the history a year later will look anyway.
 */
export const reportCopyLost: Command<
  { copyId: string; note?: string | null },
  void
> = async (tx, ctx, input) => {
  requireManager(ctx);

  const [copy] = await tx<{ id: string; state: CopyState }[]>`
    select id, state from book_copies where id = ${input.copyId} and deleted_at is null
  `;
  if (!copy) throw new NotFound("copy_not_found");

  const move = copyStateTransition(copy.state, "lost");
  if (!move.allowed) throw new RuleViolated(move.reason!);

  await tx`
    update book_copies
    set state = 'lost', lost_reported_at = ${ctx.clock.now()}
    where id = ${copy.id}
  `;

  const audit: AuditEntry[] = [
    {
      action: "copy.lost_reported",
      entityType: "copy",
      entityId: copy.id,
      before: { state: copy.state },
      after: { state: "lost", note: input.note ?? null },
    },
  ];

  const [loan] = await tx<{ id: string }[]>`
    select id from loans where copy_id = ${copy.id} and status = 'active'
  `;
  if (loan) {
    await tx`
      update loans
      set status = 'lost',
          lost_reported_at = ${ctx.clock.now()},
          lost_reported_by = ${ctx.actor.userId}
      where id = ${loan.id}
    `;
    audit.push({
      action: "loan.lost",
      entityType: "loan",
      entityId: loan.id,
      before: { status: "active" },
      after: { status: "lost" },
    });
  }

  return { result: undefined, audit };
};
