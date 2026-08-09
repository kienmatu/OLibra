import type { AuditEntry } from "../../kernel/audit";
import { NotFound, RuleViolated, ValidationFailed } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command, Tx } from "../../kernel/unit-of-work";
// Imported, not restated — see the note in `./lend-copy.ts` on why this slice's
// three commands all take `requireManager` from the catalogue's copy.
import {
  type CopyCondition,
  type CopyState,
  isCopyCondition,
  requireManager,
} from "../../catalogue/policy";
import { holdExpiryFrom } from "../policy";
import { holdDaysFor } from "../settings";

export interface ReceiveReturnInput {
  loanId: string;
  /**
   * B1's `CopyCondition` (`catalogue/policy.ts:17-30`), spelled exactly as the
   * `copy_condition` enum spells it. There is no type called `Condition`; an
   * earlier draft of this signature invented one.
   */
  condition: CopyCondition;
  note?: string | null;
  photo?: string | null;
  /** Present only when the manager chose to hold the copy for a queued reader. */
  holdForRequestId?: string;
}

export interface ReceiveReturnResult {
  loanId: string;
  /**
   * The earliest reader still waiting for this title once the return has been
   * recorded, or null. BR §16.3: "the confirmation says so immediately and
   * offers to approve the first person in the queue."
   */
  queuedRequestId: string | null;
}

/**
 * Closes a loan and records the copy's condition. BR §16.3's common case — an
 * undamaged book — is two taps.
 *
 * **The queued-reader decision is a second fact, and it is never automatic.**
 * OPS §5 is explicit about why: "the manager decides, because the next reader
 * may not be standing there." A queued reader who registered from home might
 * not be at the shelf that Sunday, and only a human knows that. So a pending
 * request for this title is *reported* (`queuedRequestId`) and acted on only
 * when the caller passes `holdForRequestId`. Modelling the hold as automatic
 * would make the choice invisible and put two business facts in one audit row.
 *
 * When the manager does ask, both facts commit in this one transaction and
 * produce two audit entries — the kernel takes an array for exactly this case
 * (`unit-of-work.ts:348`). G3 in its sharpest form: a return that succeeded
 * while its hold failed would leave a book on the shelf that the system
 * believes is with a reader.
 *
 * **Every timestamp here comes from `ctx.clock`, not from a column default.**
 * `returned_at`, `assessed_at`, `decided_at` and above all `hold_expires_at`.
 * The constraint recorded from the `feat/sql-clock` review names the last one
 * as the sharpest case in the system: it is *written* by whichever process
 * approved the request and *compared against `olibra_now()`* on every later
 * read (`copies_borrowable`, `20260808_14_olibra_now.sql:124`), so a hold
 * written from the database's clock is being compared against a clock that did
 * not produce it. The column defaults stay; they are the backstop for rows
 * written outside the domain, not a source a `fixedClock` can move.
 */
export const receiveReturn: Command<
  ReceiveReturnInput,
  ReceiveReturnResult
> = async (tx, ctx, input) => {
  requireManager(ctx);

  // `condition_assessments.assessed_by` is `not null references users(id)`
  // (0005_circulation.sql:90), so a system context — the seed, scheduled
  // housekeeping — cannot record one. Rejected by name here rather than as a
  // not-null violation from inside the transaction, the same way
  // `assessCondition` (B1) rejects it. Shared with `lendCopy` and `voidLoan`
  // since the fix report: all three write an actor column and only this one
  // used to refuse.
  requireIdentifiedActor(ctx);

  if (!isCopyCondition(input.condition)) {
    throw new ValidationFailed("validation_failed", "condition");
  }

  const [loan] = await tx<
    {
      id: string;
      copy_id: string;
      book_id: string;
      borrower_id: string;
      title: string;
      status: string;
      copy_state: CopyState;
      copy_condition: CopyCondition;
    }[]
  >`
      select l.id, l.copy_id, l.book_id, l.borrower_id, l.status,
             b.title,
             c.state as copy_state, c.condition as copy_condition
        from loans l
        join book_copies c on c.id = l.copy_id
        -- The title and the borrower, read here so the audit entry can *store*
        -- them (P1 §3.2a). BR §14 wants "Quản lý Maria Lan đã nhận trả Hoàng
        -- Tử Bé từ Têrêsa Lê Ngọc Ánh", and a sentence that re-read either at
        -- render time would restate history: UpdateBook audits title
        -- corrections and UpdateReaderProfile audits name corrections, so
        -- both values move. Inner join: loans.book_id is not null with a
        -- composite tenant FK, so a loan of no book is not a state this schema
        -- admits.
        join books b on b.id = l.book_id
       where l.id = ${input.loanId}
    `;
  // One code for two situations, deliberately. OPS §4.2 gives ReceiveReturn
  // exactly two failure modes and no `loan_not_found` among them, and
  // `errors.ts` may not gain a code whose Vietnamese sentence nobody wrote —
  // "Lượt mượn này đã được xử lý." is the shipped wording for the case that
  // actually happens, which BR §17.7 names: a double-submit. A loan id that
  // does not exist, or belongs to another shelf (RLS filters the select
  // before this line, INV-10), is unreachable from the screen that calls
  // this; telling those two apart would leak that the other shelf's loan
  // exists.
  if (!loan || loan.status !== "active") {
    throw new RuleViolated("loan_not_active");
  }

  // The whole hold decision is resolved before anything is written, so a
  // `request_not_queued` refusal costs no write at all. The transaction would
  // roll one back anyway (and `receive-return.test.ts` asserts exactly that,
  // because the rollback is the guarantee G3 actually makes) — this ordering
  // is so a reviewer does not have to reason about a partially-applied
  // return to convince themselves of it.
  const hold = input.holdForRequestId
    ? await resolveHold(tx, ctx.bookshelfId, input.holdForRequestId, loan.book_id)
    : null;

  await tx`
      insert into condition_assessments
        (bookshelf_id, copy_id, loan_id, assessed_by, condition, note, photo_url,
         assessed_at)
      values
        (${ctx.bookshelfId}, ${loan.copy_id}, ${loan.id}, ${ctx.actor.userId},
         ${input.condition}, ${input.note ?? null}, ${input.photo ?? null},
         ${ctx.clock.now()})
    `;

  // `status` and `return_condition` in one statement, never two:
  // `loans_returned_has_condition` (0005_circulation.sql:50) is
  // `check (status <> 'returned' or return_condition is not null)`, so an
  // update that closed the loan first and recorded the condition afterwards
  // raises 23514 — and one that did it the other way round would leave a
  // window where neither is true of the row.
  await tx`
      update loans
         set status = 'returned',
             returned_at = ${ctx.clock.now()},
             received_by = ${ctx.actor.userId},
             return_condition = ${input.condition},
             return_note = ${input.note ?? null},
             return_photo_url = ${input.photo ?? null}
       where id = ${loan.id}
    `;

  // One statement, not `available` and then `held`. OPS §5 asks that "the
  // copy is never observably `available` for an instant in between", and
  // although the transaction makes that unobservable to another session
  // anyway, one write is also one fewer state for a reviewer to reason about.
  //
  // `copyStateTransition` is deliberately *not* consulted here, and that is
  // worth saying out loud rather than leaving as an omission. Its table
  // (`catalogue/policy.ts:46-60`) has no `on_loan → held` arrow, because there
  // is no such transition: what this statement performs is the composition of
  // two arrows the table does permit, `on_loan → available` and `available →
  // held`, collapsed into one beat exactly as OPS §5 requires. Asking the
  // table about the endpoints would refuse a write the operations catalogue
  // mandates.
  //
  // `condition_note` moves with `condition` because the two are one judgement
  // — `assessCondition` (B1) writes them together for the same reason. Leaving
  // a note from a previous assessment beside a new condition would describe
  // damage the copy no longer has, or omit damage it now does.
  const copyState: CopyState = hold ? "held" : "available";
  await tx`
      update book_copies
         set state = ${copyState},
             condition = ${input.condition},
             condition_note = ${input.note ?? null}
       where id = ${loan.copy_id}
    `;

  const audit: AuditEntry[] = [
    {
      action: "loan.returned",
      entityType: "loan",
      entityId: loan.id,
      before: {
        status: "active",
        copy_state: loan.copy_state,
        condition: loan.copy_condition,
      },
      after: {
        status: "returned",
        copy_state: copyState,
        condition: input.condition,
        // Stored, not joined at read time — see the select above and P1 §3.2a.
        title: loan.title,
        // `borrower_id`, matching the name `loan.created` already stores it
        // under (`lend-copy.ts`), so one resolution rule covers both ends of a
        // loan rather than two spellings of the same fact.
        borrower_id: loan.borrower_id,
      },
    },
  ];

  if (hold) {
    const holdExpiresAt = holdExpiryFrom(ctx.clock.now(), hold.holdDays);
    await tx`
        update borrow_requests
           set status = 'approved',
               copy_id = ${loan.copy_id},
               hold_expires_at = ${holdExpiresAt},
               decided_by = ${ctx.actor.userId},
               decided_at = ${ctx.clock.now()}
         where id = ${hold.id}
      `;
    audit.push({
      action: "request.approved",
      entityType: "request",
      entityId: hold.id,
      before: { status: "pending", copy_id: null },
      after: {
        status: "approved",
        copy_id: loan.copy_id,
        hold_expires_at: holdExpiresAt.toISOString(),
      },
    });
  }

  // Read *after* the writes, so it answers "is anyone still waiting?" rather
  // than "was anyone waiting a moment ago". When the manager just held the
  // copy for the first in the queue, that request is no longer pending and
  // this is the next person along, or null — which is the fact the
  // confirmation screen wants either way.
  //
  // `requested_at` is the queue ordering key (the column's own comment,
  // 0005_circulation.sql:66); `id` breaks a tie so two requests written in
  // the same transaction, under one `ctx.clock`, still order deterministically
  // rather than by whatever Postgres happens to return.
  //
  // Neither half is decoration, and neither is free. Deleting this clause
  // changes the answer as soon as the planner stops using
  // `requests_queue (book_id, requested_at) where status = 'pending'`
  // (0012_indexes.sql:26) — which it does for a `limit 1` on any table it has
  // real statistics for, i.e. every live shelf. The two tests that pin it
  // (`receive-return.test.ts`, "the queue is reported in requested_at order"
  // and "two readers who queued in the same instant") `analyze` the table
  // first for exactly that reason; without that they passed against a
  // `receiveReturn` carrying no `order by` at all.
  const [queued] = await tx<{ id: string }[]>`
      select id from borrow_requests
       where book_id = ${loan.book_id}
         and status = 'pending'
         and deleted_at is null
       order by requested_at asc, id asc
       limit 1
    `;

  return {
    result: { loanId: loan.id, queuedRequestId: queued?.id ?? null },
    audit,
  };
};

/**
 * The request the manager asked to hold for, and the shelf's `hold_days`.
 *
 * `request_not_queued` covers both halves of OPS §4.2's own wording — the id
 * "no longer points at a pending request **for this title**" — because they are
 * one situation from the manager's side: the row they saw on the confirmation
 * screen is not the row the database has now. The reader cancelled between page
 * load and confirm, or another manager approved them for a different copy.
 */
async function resolveHold(
  tx: Tx,
  bookshelfId: string,
  requestId: string,
  bookId: string,
): Promise<{ id: string; holdDays: number }> {
  const [request] = await tx<{ id: string }[]>`
    select id from borrow_requests
     where id = ${requestId}
       and book_id = ${bookId}
       and status = 'pending'
       and deleted_at is null
  `;
  if (!request) throw new RuleViolated("request_not_queued");

  // `../settings.ts`, not three lines here: `ApproveBorrowRequest` (C2) reads
  // the same number for the same purpose, and two copies of "coalesce to 3" is
  // how one of them later stops matching the settings screen. The expiry
  // arithmetic moved to `../policy.ts` (`holdExpiryFrom`) for the same reason
  // and keeps its whole argument there.
  return { id: request.id, holdDays: await holdDaysFor(tx, bookshelfId) };
}
