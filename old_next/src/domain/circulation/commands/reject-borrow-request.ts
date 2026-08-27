import type { AuditEntry } from "../../kernel/audit";
import { RuleViolated } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import { notify } from "../../notifications/write";
import type { Command } from "../../kernel/unit-of-work";
// Imported, never restated — the note at the top of `./lend-copy.ts` carries
// the argument.
import { requireManager } from "../../catalogue/policy";

export interface RejectBorrowRequestInput {
  requestId: string;
  /**
   * **Optional, and that is Q2's assumed reading rather than an omission.**
   * `RejectMembership` and `RejectProfileChange` both require one, and their UI
   * copy says so ("Từ chối cần ghi lý do"); the borrow queue's *Từ chối* button
   * carries no such statement, and OPS §4.2 lists no `reason_required` among
   * this command's failure modes. The C2 plan §3.4 records the choice and why
   * reversing it is cheap: a validation rule here and a field in D1's
   * notification, nothing structural.
   */
  reason?: string | null;
}

export interface RejectBorrowRequestResult {
  requestId: string;
}

/**
 * A manager declines a queued request. BR §7.2's `pending → rejected`, which is
 * terminal.
 *
 * **Terminal, and deliberately not what *Bỏ qua* does.** The queue screen shows
 * *Bỏ qua* and *Từ chối* as separate buttons on the same pending row, and OPS
 * §4.2 calls skip "the least well-specified command in the catalogue". This
 * command is the one of the two that BR §7.2 draws an arrow for: the reader is
 * out of the queue for this title and the row records who decided and why. The
 * other button is disabled until somebody decides what it means (C2 plan §4) —
 * which is only defensible because this one exists and works.
 *
 * **Nothing is deleted** (G10, and BR §2's argument for keeping a rejected
 * registration): the row stays, with its reason, so *why did this not happen*
 * has an answer six months later.
 *
 * **The reason lands in `decision_note`.** There is no `rejection_reason`
 * column on `borrow_requests` — `decided_by`, `decided_at` and `decision_note`
 * are shared by approval and rejection alike (verified against
 * `information_schema.columns`), which is why this command writes all three and
 * `approveBorrowRequest` writes the first two.
 *
 * **Notification: D1.** BR §15 names "borrow request rejected" and does not say
 * whether the reason travels with it. Nothing is written here (C2 plan §6).
 */
export const rejectBorrowRequest: Command<
  RejectBorrowRequestInput,
  RejectBorrowRequestResult
> = async (tx, ctx, input) => {
  requireManager(ctx);
  // `decided_by` is nullable and INV-8 still wants the actor named — the same
  // check `receiveReturn` and `approveBorrowRequest` apply before writing it.
  requireIdentifiedActor(ctx);

  // RLS scopes this, so "another shelf's request" and "no such request" are one
  // answer, and one code covers both of those and "already decided" — the shape
  // `receiveReturn` established for `loan_not_active`. OPS §4.2 gives this
  // command exactly one failure mode (`:316`).
  //
  // The title is read here so the audit entry can *store* it (P1 §3.2a):
  // `UpdateBook` audits title corrections, so a sentence that joined `books` at
  // render time would restate history. Inner join — `book_id` is `not null`
  // with a composite tenant FK, so a request for no book is not a state this
  // schema admits.
  const [request] = await tx<
    { id: string; member_id: string; status: string; title: string }[]
  >`
    select r.id, r.member_id, r.status, b.title
      from borrow_requests r
      join books b on b.id = r.book_id
     where r.id = ${input.requestId} and r.deleted_at is null
  `;
  if (!request || request.status !== "pending") {
    throw new RuleViolated("request_not_pending");
  }

  // An empty box is no reason, not a reason that says nothing — `decision_note`
  // is nullable, and a blank string would read, a year later, as a manager who
  // wrote something illegible. The same rule `receiveReturnAction` applies to
  // its note field.
  const reason = input.reason?.trim() ? input.reason.trim() : null;

  await tx`
    update borrow_requests
       set status = 'rejected',
           decided_by = ${ctx.actor.userId},
           decided_at = ${ctx.clock.now()},
           decision_note = ${reason}
     where id = ${request.id}
  `;

  const audit: AuditEntry = {
    action: "request.rejected",
    entityType: "request",
    entityId: request.id,
    before: { status: "pending" },
    after: {
      status: "rejected",
      title: request.title,
      // `member_id` holds a `users(id)`. Stored under `userId` because that is
      // the key `get-audit-log.ts`'s subject join reads out of a payload, and
      // this is the one sentence in the request family whose actor and subject
      // are different people — a manager refusing a child.
      userId: request.member_id,
      // `reason`, matching the key `copy.retired` and `membership.rejected`
      // already store a reason under, so `because()` finds it without a third
      // spelling.
      reason,
    },
  };

  // OPS §7. `reason` is optional here (Q2's assumed reading), so the sentence
  // degrades to one without a because-clause rather than printing "null".
  await notify(tx, {
    userId: request.member_id,
    kind: "request_rejected",
    payload: reason ? { title: request.title, reason } : { title: request.title },
  });

  return { result: { requestId: request.id }, audit };
};
