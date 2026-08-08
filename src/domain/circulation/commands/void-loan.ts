import { RuleViolated, ValidationFailed } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
// Imported, not restated — see the note in `./lend-copy.ts` on why this slice's
// three commands all take `requireManager` from the catalogue's copy.
import { type CopyState, requireManager } from "../../catalogue/policy";

export interface VoidLoanInput {
  loanId: string;
  reason: string;
}

/**
 * Undoes a loan recorded in error. BR §3's edge case: "A manager records a loan
 * by mistake and needs to undo it."
 *
 * **Never a delete — INV-11, and the reason is the audit history.** The row
 * survives with `status = 'voided'`, a reason and who voided it, so that six
 * months later "why is there no loan here" has an answer. A `delete` is refused
 * by a trigger regardless (`0009_invariant_constraints.sql`), which is what
 * makes this a rule rather than a convention, but the reason column is what
 * makes the surviving row worth having.
 *
 * **`loan_not_active_cannot_void`, not `loan_not_active`.** OPS §4.2 gives the
 * one code two different Vietnamese sentences, one under `ReceiveReturn` and
 * one here; `errors.ts` shipped only the first. The two refusals genuinely
 * differ: returning an already-returned loan is a double-submit and nothing is
 * wrong, while voiding a closed loan is a manager reaching for an undo that no
 * longer applies, and BR §17.7 asks the message to name what is allowed
 * instead. See the note beside the code in `errors.ts` for the collision's
 * history.
 *
 * A loan that does not exist shares that code with one that is closed, for the
 * same reason `receiveReturn` folds its own missing case into
 * `loan_not_active`: OPS §4.2 lists two failure modes for this command and no
 * `loan_not_found`, an `ErrorCode` may not be invented with a sentence nobody
 * wrote, and RLS has already filtered another shelf's loan out of the select
 * above — so distinguishing the two would leak that it exists.
 */
export const voidLoan: Command<VoidLoanInput, { loanId: string }> = async (
  tx,
  ctx,
  input,
) => {
  requireManager(ctx);

  // Trimmed, so a reason of three spaces is the same as no reason at all. The
  // check is here rather than left to `loans_voided_has_reason`
  // (`0005_circulation.sql:48`): that constraint catches null, which is the
  // shape a caller with no reason field would produce, and says nothing about
  // whitespace — and it would surface as a 23514 rather than as OPS §4.2's
  // "Vui lòng ghi lý do huỷ." either way.
  const reason = input.reason.trim();
  if (!reason) throw new ValidationFailed("reason_required", "reason");

  const [loan] = await tx<
    { id: string; copy_id: string; status: string; copy_state: CopyState }[]
  >`
    select l.id, l.copy_id, l.status, c.state as copy_state
      from loans l
      join book_copies c on c.id = l.copy_id
     where l.id = ${input.loanId}
  `;
  if (!loan || loan.status !== "active") {
    throw new RuleViolated("loan_not_active_cannot_void");
  }

  // `status` and `void_reason` in one statement, never two:
  // `loans_voided_has_reason` is `check (status <> 'voided' or void_reason is
  // not null)`, so an update that changed the status first would raise 23514.
  //
  // `voided_by` is a users(id) (`0005_circulation.sql:41`), like every other
  // actor column on this table — `ctx.actor.userId`, never
  // `ctx.actor.membershipId`.
  await tx`
    update loans
       set status = 'voided',
           voided_at = ${ctx.clock.now()},
           voided_by = ${ctx.actor.userId},
           void_reason = ${reason}
     where id = ${loan.id}
  `;

  // INV-2, and INV-1's other half. The partial unique index keys on `status =
  // 'active'`, so voiding already frees the copy as far as the index is
  // concerned — but the copy's own `state` is what every screen and
  // `copies_borrowable` read, and a copy left `on_loan` with no active loan is
  // a book nobody can lend and nobody can find the loan for.
  //
  // `copyStateTransition` is not consulted, deliberately. The only arrow this
  // can be is `on_loan → available`, which the table permits: INV-1 makes the
  // copy's state a consequence of the loan being active, checked above.
  // Consulting it would add a refusal OPS §4.2 does not list, for a state the
  // schema does not allow to occur.
  await tx`update book_copies set state = 'available' where id = ${loan.copy_id}`;

  return {
    result: { loanId: loan.id },
    audit: {
      action: "loan.voided",
      entityType: "loan",
      entityId: loan.id,
      before: { status: "active", copy_state: loan.copy_state },
      // The reason is the whole value of voiding rather than deleting, so it
      // is in the audit record as well as on the row: INV-12 makes the audit
      // append-only, while `loans.void_reason` is an ordinary column somebody
      // could later overwrite.
      after: { status: "voided", copy_state: "available", reason },
    },
  };
};
