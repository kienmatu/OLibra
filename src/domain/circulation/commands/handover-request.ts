import { RuleViolated } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command } from "../../kernel/unit-of-work";
// Imported, never restated — the note at the top of `./lend-copy.ts` carries
// the argument.
import { requireManager } from "../../catalogue/policy";
import { lendCopy, type LendCopyResult } from "./lend-copy";

export interface HandoverRequestInput {
  requestId: string;
}

export type HandoverRequestResult = LendCopyResult;

/**
 * The manager hands a child the copy their approved request put aside for them.
 * BR §7.1's `held → on_loan` and BR §7.2's `approved → fulfilled`, at the moment
 * the book actually changes hands.
 *
 * ── Why this delegates to `lendCopy` instead of restating it ─────────────────
 *
 * OPS §5 says what the difference between the two commands is, and it is
 * narrower than it looks: "`HandoverRequest` runs the identical sequence with
 * one substitution at step 3 — the copy must be `held` **and** the collecting
 * reader must be the one the hold was created for (INV-3's second clause) — and
 * a fourth check is inserted: the hold must not have expired."
 *
 * `lendCopy` already performs that substituted step 3. Its `copyLendable` call
 * admits a `held` copy exactly when `heldForUserId === forUserId`, and its
 * caller reads `heldForUserId` through a `hold_expires_at > olibra_now()`
 * filter, so a lapsed hold arrives as absence and is refused. It also already
 * closes the request it collects — `request.fulfilled` beside `loan.created`,
 * `fulfilled_loan_id` and `loans.request_id` pointing at each other — which is
 * the pairing OPS §4.2 specifies for *this* command and which C1 implemented
 * there because the same two facts are true whichever way the copy was reached.
 *
 * So the entire remainder of this command is: find the copy and the reader from
 * the request, check the hold has not expired, and call the one implementation.
 * The C2 plan §3.2 states the risk it is guarding against — that this command
 * "grows a second definition of who may take a held copy" — and delegation is a
 * stronger answer than consulting `copyLendable` a second time would be: there
 * is no second call site to drift, and INV-1's race, INV-4, INV-5 and INV-7 are
 * enforced by the same lines that enforce them for a walk-up lend.
 *
 * `lendCopy`'s own docstring predicted this shape exactly: "That command (C2)
 * takes a `requestId`, finds the copy from it, and checks the hold has not
 * expired; this one takes a `copyId`."
 *
 * ── The two refusals that must come first, and why ───────────────────────────
 *
 * **`hold_expired`** (OPS §4.2 `:244`). A lapsed hold leaves the copy in `held`
 * with no live row naming its holder, so `lendCopy` would answer
 * `copy_not_available` — "Bản sách này đang được mượn hoặc đang giữ chỗ.",
 * which is a false statement about a book sitting on the shelf, and it would
 * tell a volunteer nothing about what to do next. "Thời gian giữ chỗ đã hết.
 * Bạn đọc cần đăng ký lại." is what OPS asks for and it names the remedy.
 *
 * Expiry is decided by comparing `hold_expires_at` against `olibra_now()` — the
 * transaction's clock, set from `ctx.clock` by the kernel — and by nothing else.
 * No row is written, no job runs; the hold stops being handable over because the
 * clock moved past it. That is master §7.6's acceptance criterion, and
 * `tests/invariants/inv-03-only-available-or-own-hold.test.ts` advances a
 * `fixedClock` to prove it rather than sleeping.
 *
 * **`request_not_held`** — the one sentence this slice authors, and the C2 plan
 * §8 gives the argument. OPS gives this command three failure modes and none of
 * them describes a `requestId` naming a row with no hold at all: a `pending`
 * request nobody has approved, or one already `rejected`, `cancelled` or
 * `fulfilled`. A stale queue page posts exactly that.
 *
 * ── The hold this command intends to collect is named, not assumed ───────────
 *
 * `lendCopy` collects *the earliest live approved hold on the copy* (its lateral
 * join, `order by requested_at asc, id asc limit 1`). That is the right rule for
 * a walk-up lend, which knows a copy and a reader and not a request. Here the
 * request is the input, so this command checks that the hold `lendCopy` will
 * find is the one it was asked about — same subquery, same ordering — and
 * refuses with `request_not_held` when it is not. Two live approved holds on one
 * copy is a state `approveBorrowRequest`'s row lock exists to prevent and no
 * constraint enforces, so the check is cheap insurance against fulfilling the
 * wrong child's request; without it this command would silently hand the book to
 * the right person and close somebody else's row.
 *
 * **Notification: D1.** BR §15's "your book is ready" is the *approval*'s
 * notification, not this one; nothing here writes a row (C2 plan §6).
 */
export const handoverRequest: Command<
  HandoverRequestInput,
  HandoverRequestResult
> = async (tx, ctx, input) => {
  requireManager(ctx);
  // `lendCopy` applies both guards again — it must, since it is reachable
  // directly — but a `systemContext` reaching the reads below and failing on
  // `loans.lent_by` two functions later is a worse error than failing here.
  requireIdentifiedActor(ctx);

  // Everything this command needs, in one statement. RLS scopes it to
  // `ctx.bookshelfId`.
  //
  // `hold_live` is computed in SQL against `olibra_now()` rather than in
  // TypeScript against `ctx.clock.now()`, and the two are not interchangeable
  // even though the kernel sets the second from the first: every other read of
  // this column in the codebase — `copies_borrowable`, `lendCopy`'s lateral
  // join, the queue query — compares against `olibra_now()`, and a fourth
  // comparison written a different way is a fourth place the answer can differ.
  //
  // `memberships` is joined on `member_id` (a `users(id)`) to reach *this
  // shelf's* membership for that person, because `memberships` carries a tenant
  // policy and `users` carries none — the scope comes from the join, never from
  // an id anybody sent. `lendCopy`'s input is a membership id, which is what
  // this join exists to produce.
  const [request] = await tx<
    {
      id: string;
      status: string;
      copy_id: string | null;
      membership_id: string | null;
      hold_live: boolean;
    }[]
  >`
    select r.id, r.status, r.copy_id, m.id as membership_id,
           (r.hold_expires_at > olibra_now()) as hold_live
      from borrow_requests r
      left join memberships m
             on m.user_id = r.member_id and m.deleted_at is null
     where r.id = ${input.requestId} and r.deleted_at is null
  `;

  // One code for "no such request", "another shelf's request" and "a request
  // with nothing held for it" — the shape `receiveReturn` established for
  // `loan_not_active`, and for the same reason: telling the first two apart
  // would confirm the other shelf's request exists, and a manager's screen
  // never offers this button on a row in any of those states.
  if (!request || request.copy_id === null) {
    throw new RuleViolated("request_not_held");
  }
  if (request.status === "expired") throw new RuleViolated("hold_expired");
  if (request.status !== "approved") throw new RuleViolated("request_not_held");
  // `hold_live` is `null` for a row whose `hold_expires_at` is null, which an
  // `approved` row should never be; `=== true` rather than a truthiness test so
  // that state is refused rather than treated as live.
  if (request.hold_live !== true) throw new RuleViolated("hold_expired");

  // The reader whose hold this is has no membership of this shelf any more —
  // they left, or the row was soft-deleted. `lendCopy` takes a membership id
  // and there is none to give it; refusing here keeps that command's input
  // honest instead of passing `null` into a uuid parameter.
  if (request.membership_id === null) {
    throw new RuleViolated("request_not_held");
  }

  // The hold `lendCopy` is about to collect, resolved by the identical
  // subquery. See this command's docstring on why it is checked rather than
  // assumed.
  const [firstHold] = await tx<{ id: string }[]>`
    select r.id from borrow_requests r
     where r.copy_id = ${request.copy_id}
       and r.status = 'approved'
       and r.deleted_at is null
       and r.hold_expires_at > olibra_now()
     order by r.requested_at asc, r.id asc
     limit 1
  `;
  if (firstHold?.id !== request.id) throw new RuleViolated("request_not_held");

  // INV-1, INV-2, INV-3, INV-4, INV-5, INV-7 and both audit entries, from the
  // one implementation. Its `AuditEntry[]` is returned untouched: OPS §4.2
  // specifies `loan.created` "with `request.fulfilled` written in the same
  // transaction" for this command, and that is exactly the pair `lendCopy`
  // produces when the copy it lends is under the borrower's own live hold.
  return lendCopy(tx, ctx, {
    copyId: request.copy_id,
    membershipId: request.membership_id,
  });
};
