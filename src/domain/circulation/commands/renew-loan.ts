import { RuleViolated } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command } from "../../kernel/unit-of-work";
import { requireReader } from "../../catalogue/policy";
import { loanRenewable } from "../policy";
import { renewalSettingsFor } from "../settings";

export interface RenewLoanInput {
  loanId: string;
}

export interface RenewLoanResult {
  loanId: string;
  dueOn: string;
  renewalsUsed: number;
}

/**
 * A reader extends their own loan. OPS §4.2, reached from §16.2's dashboard
 * button "Xin gia hạn".
 *
 * **INV-6 has two halves and an arithmetic, and each fails differently.**
 * BR §6: *"A loan may be renewed only if renewals remain **and** no borrow
 * request is queued for that title. A renewal extends the due date by
 * `renewal_days` **from the current due date**, not from the day the renewal
 * was requested."* The two refusals carry different sentences because they ask
 * the reader for different things — one says you have had your turn, the other
 * says somebody else is waiting.
 *
 * **The arithmetic is the part an implementation gets wrong silently.**
 * Extending from *today* rather than from `due_on` reads as identical on every
 * loan that is renewed early, which is nearly all of them — and quietly
 * *shortens* a loan that is renewed late, since `today + 7` is earlier than
 * `due_on + 7` the moment a book is overdue. That is why the arithmetic is done
 * in SQL against the stored column (`due_on + n`) rather than in TypeScript
 * from `ctx.clock.today()`: there is no expression here that could accidentally
 * mean today. `inv-06-renewal-rules.test.ts` renews an already-overdue loan for
 * exactly this reason.
 *
 * **The queue is checked on the title, not the copy.** A reader waiting for
 * *Dế Mèn Phiêu Lưu Ký* does not care which of the shelf's three copies they
 * get, so holding on to any of them keeps them waiting. Checking `copy_id`
 * would let a renewal sail through while somebody sat in the queue for the book
 * — the rule would appear to work and would never fire.
 *
 * `status = 'pending'` and not `'approved'`: an approved request already names
 * a *specific* copy and is being held for its reader (C2's
 * `ApproveBorrowRequest`), so it is not waiting on this loan and blocking a
 * renewal for it would refuse the reader on account of a queue that has already
 * been served.
 *
 * **Q4 — a suspended reader may renew, on the assumed reading.** INV-4 blocks
 * *new* loans and explicitly protects existing ones, and a renewal extends an
 * existing loan rather than starting one. OPS §4.2 records the same reading and
 * says plainly that the stricter one ("renewal is a new commitment, block it")
 * is equally defensible and that the requirements never settle it. So there is
 * deliberately no `memberMayBorrow` call here, and no membership status check
 * at all — reversing that is one predicate and one test, and the test that
 * pins the current answer is named so it fails loudly rather than silently
 * changing meaning.
 *
 * **A loan that is not active, does not exist, or belongs to somebody else all
 * share `loan_not_active`.** The same reasoning `voidLoan` records: OPS §4.2
 * lists two failure modes for this command and no `loan_not_found`, an
 * `ErrorCode` may not be invented with a sentence nobody wrote, and RLS has
 * already filtered another shelf's loan out of the select — so distinguishing
 * them would leak that the loan exists. `borrower_id` is a **`users(id)`**
 * (`0005_circulation.sql:20`), like every other actor column on this table, so
 * "own loan" compares against `ctx.actor.userId` and never `membershipId`.
 */
export const renewLoan: Command<RenewLoanInput, RenewLoanResult> = async (
  tx,
  ctx,
  input,
) => {
  requireReader(ctx);
  // A renewal names its actor in the audit record (INV-8) and is attributed to
  // the borrower on the row it extends. `systemContext` is `super_admin` with a
  // null `userId`, which `requireReader` alone would admit — the defect
  // `voidLoan` shipped and this guard exists to close.
  requireIdentifiedActor(ctx);

  const [loan] = await tx<
    {
      id: string;
      book_id: string;
      borrower_id: string;
      status: string;
      due_on: string;
      renewals_used: number;
    }[]
  >`
    select id, book_id, borrower_id, status, due_on::text as due_on, renewals_used
      from loans
     where id = ${input.loanId}
  `;
  if (!loan || loan.status !== "active" || loan.borrower_id !== ctx.actor.userId) {
    throw new RuleViolated("loan_not_active");
  }

  const { maxRenewals, renewalDays } = await renewalSettingsFor(
    tx,
    ctx.bookshelfId,
  );
  if (loan.renewals_used >= maxRenewals) {
    throw new RuleViolated("no_renewals_remaining");
  }

  // The title, deliberately — see the docstring. `deleted_at is null` because a
  // cancelled-then-soft-deleted request is not somebody waiting, and every
  // other read of this table filters it the same way.
  const [queued] = await tx<{ id: string }[]>`
    select id from borrow_requests
     where book_id = ${loan.book_id}
       and status = 'pending'
       and deleted_at is null
     limit 1
  `;

  // Both refusals come from `loanRenewable` in `../policy.ts` rather than from
  // two `if`s here, because U4's dashboard has to answer the same question to
  // disable its button and say why. One predicate, two callers — the rule C1's
  // review established after finding a query and a command disagreeing.
  const block = loanRenewable(
    { renewalsUsed: loan.renewals_used, titleHasQueue: queued != null },
    maxRenewals,
  );
  if (block.blocked) throw new RuleViolated(block.reason);

  // `due_on + n`, in SQL, against the stored column. Not `ctx.clock.today()`
  // plus anything: see the docstring on why extending from today is the wrong
  // answer that looks right.
  const [renewed] = await tx<{ due_on: string; renewals_used: number }[]>`
    update loans
       set due_on = due_on + ${renewalDays}::int,
           renewals_used = renewals_used + 1
     where id = ${loan.id}
    returning due_on::text as due_on, renewals_used
  `;

  return {
    result: {
      loanId: loan.id,
      dueOn: renewed.due_on,
      renewalsUsed: renewed.renewals_used,
    },
    audit: {
      action: "loan.renewed",
      entityType: "loan",
      entityId: loan.id,
      before: { due_on: loan.due_on, renewals_used: loan.renewals_used },
      after: { due_on: renewed.due_on, renewals_used: renewed.renewals_used },
    },
  };
};
