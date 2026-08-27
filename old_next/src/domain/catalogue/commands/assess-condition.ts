import { NotFound, RuleViolated, ValidationFailed } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { type CopyCondition, isCopyCondition, requireManager } from "../policy";

export interface AssessConditionInput {
  copyId: string;
  condition: CopyCondition;
  note?: string | null;
  photoUrl?: string | null;
}

/**
 * Records a manager's judgement of a copy's physical state at a point in time.
 *
 * BR §5.4: "Separate from the loan because a manager may assess a copy at any
 * time, not only at return." So `loan_id` is null here; C1's `ReceiveReturn`
 * is what writes an assessment carrying one.
 *
 * **A condition is not a state** (BR §9: "`lost` is deliberately absent,
 * because it is a copy *state*"), so this command consults no transition
 * table and moves no copy. It does update `book_copies.condition`, because
 * that column is "the current judgement" while `condition_assessments` is the
 * history — and BR §11 lists condition assessments among the things never
 * deleted, which is why the history is a table and not a column.
 */
export const assessCondition: Command<
  AssessConditionInput,
  { assessmentId: string }
> = async (tx, ctx, input) => {
  requireManager(ctx);

  if (!isCopyCondition(input.condition)) {
    throw new ValidationFailed("validation_failed", "condition");
  }
  // condition_assessments.assessed_by is `not null references users(id)`, so
  // a system context (userId null, e.g. the seed) cannot write one. Rejected
  // by name rather than by a not-null violation from inside the transaction.
  if (!ctx.actor.userId) throw new RuleViolated("not_permitted");

  const [copy] = await tx<
    { id: string; condition: string; condition_note: string | null }[]
  >`
    select id, condition, condition_note from book_copies
    where id = ${input.copyId} and deleted_at is null
  `;
  if (!copy) throw new NotFound("copy_not_found");

  const [assessment] = await tx<{ id: string }[]>`
    insert into condition_assessments
      (bookshelf_id, copy_id, loan_id, assessed_by, condition, note, photo_url, assessed_at)
    values
      (${ctx.bookshelfId}, ${copy.id}, null, ${ctx.actor.userId}, ${input.condition},
       ${input.note ?? null}, ${input.photoUrl ?? null}, ${ctx.clock.now()})
    returning id
  `;

  await tx`
    update book_copies
    set condition = ${input.condition}, condition_note = ${input.note ?? null}
    where id = ${copy.id}
  `;

  return {
    result: { assessmentId: assessment.id },
    audit: {
      action: "copy.condition_assessed",
      entityType: "copy",
      entityId: copy.id,
      before: { condition: copy.condition, conditionNote: copy.condition_note },
      after: { condition: input.condition, conditionNote: input.note ?? null },
    },
  };
};
