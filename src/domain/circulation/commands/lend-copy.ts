import type { AuditEntry } from "../../kernel/audit";
import { isUniqueViolation, NotFound, RuleViolated } from "../../kernel/errors";
import type { Command, Tx } from "../../kernel/unit-of-work";
// `requireManager` is imported rather than restated. Two identical copies of
// it already exist — `../../catalogue/policy.ts:223` and
// `../../members/policy.ts:153` — and each carries a note saying the tidy end
// state is one copy in `kernel/tenant.ts`, blocked only by a change to
// `src/auth`. A third copy here would be exactly the drift those two notes
// warn about, so this slice's three commands all import catalogue's; moving it
// to the kernel is a change to `src/auth`'s neighbours and not this slice's.
import { requireManager } from "../../catalogue/policy";
import type { CopyState } from "../../catalogue/policy";
import type { MembershipStatus } from "../../members/policy";
import { copyLendable, dueDateFor, memberMayBorrow } from "../policy";

export interface LendCopyInput {
  copyId: string;
  membershipId: string;
}

export interface LendCopyResult {
  loanId: string;
  dueOn: string;
}

/**
 * Hands a copy to a reader. BR §16.3's quick-lend terminal step, and the most
 * important command in the application.
 *
 * The ordering below is deliberate and worth reading before changing:
 *
 *   1. Read the copy and the member, and apply the *pure* predicates. This
 *      produces the friendly named errors BR §16.3 requires — "Bạn đọc đã
 *      mượn tối đa số sách cho phép", not a constraint violation.
 *
 *   2. Attempt the insert, and let the partial unique index decide the race.
 *
 * Step 1 does not make step 2 unnecessary, and step 2 does not make step 1
 * pointless. Step 1 exists for the *common* case, where the answer is knowable
 * and the message should be kind. Step 2 exists for the case BR §2 describes:
 * two managers, two phones, the same second. There is no ordering of reads and
 * writes in application code that closes that window — only the index does
 * (INV-1, `loans_one_active_per_copy`, `0009_invariant_constraints.sql:21`),
 * which is why the losing insert is caught and translated rather than
 * prevented. A pre-check reads as more careful and is strictly worse, because
 * it re-opens the window it appears to close.
 *
 * **`loans` stores user ids, not membership ids.** `borrower_id` and `lent_by`
 * both `references users(id)` (`0005_circulation.sql:20,23`), left that way
 * deliberately by `20260808_04_composite_tenant_fks.sql:42` because `users` is
 * a global table with no shelf-scoped column to pair an id with. The command's
 * *input* is a `membershipId` — OPS §4.2 names it, and it is what the screen
 * has — and the select below resolves it to a `user_id` in the same statement
 * that reads the membership's status. Writing `ctx.actor.membershipId` or
 * `input.membershipId` into either column is a `23503` on the very first lend,
 * and the shipped `members/queries/search-readers-for-lending.ts:92` already
 * joins `l.borrower_id = u.id`, so even a hypothetical membership id that
 * satisfied the FK would produce loans that query cannot see.
 *
 * **Lending a held copy to its own holder closes that hold, in this same
 * transaction.** INV-3's second clause makes this command the one that hands a
 * child the copy their approved request put aside for them, and a request whose
 * copy has just been handed over is fulfilled — BR §7.2's `pending → approved →
 * fulfilled`, and the only terminal status in that enum that means "the book
 * went to the reader". OPS §4.2 already pairs the two facts for
 * `HandoverRequest`: "`loan.created` (with `request.fulfilled` written in the
 * same transaction)". The pairing is not bookkeeping. A request left `approved`
 * still names this copy, so `copies_borrowable`'s hold clause
 * (`20260808_14_olibra_now.sql:119-125`) keeps excluding it for the rest of
 * `hold_days` — and it keeps excluding it *after the copy comes back*, so every
 * public surface tells a child there is no copy free while the book sits on the
 * shelf and `lendCopy` hands it to the next person who asks. That is BR §16.3's
 * screen-and-command disagreement in the "told no when the answer is yes"
 * direction. It also closes the window in which the copy is `on_loan` while a
 * live approved hold names it, which is INV-2 in substance across two tables
 * (DB §4.4 and §7 say what the `state` column alone does and does not
 * guarantee).
 *
 * The two rows point at each other — `borrow_requests.fulfilled_loan_id` at the
 * loan, `loans.request_id` at the request ("originating request",
 * `0005_circulation.sql:21`). Writing only the first would leave a loan that
 * fulfilled a queued request looking, from its own row, like a walk-up lend.
 *
 * This is *not* `HandoverRequest`. That command (C2) takes a `requestId`, finds
 * the copy from it, and checks the hold has not expired; this one takes a
 * `copyId`, and closing the request is a consequence of the lend it was already
 * performing. Nothing here creates, approves, rejects or skips a request.
 */
export const lendCopy: Command<LendCopyInput, LendCopyResult> = async (
  tx,
  ctx,
  input,
) => {
  requireManager(ctx);

  // Both rows are read before either predicate runs, because `copyLendable`
  // needs this reader's *user* id to answer "is this hold theirs?" while OPS
  // §5 requires the copy-side refusals to be the ones a manager hears first.
  // Reading then judging keeps both: two selects, then two predicates in OPS's
  // order.
  const [copy] = await tx<
    {
      id: string;
      book_id: string;
      state: CopyState;
      held_for_user: string | null;
      hold_request_id: string | null;
    }[]
  >`
    select c.id, c.book_id, c.state, h.member_id as held_for_user,
           h.id as hold_request_id
      from book_copies c
      -- The live hold on this copy, if there is one. member_id, not
      -- requester_id (0005_circulation.sql:63), and it holds a users(id).
      -- Compared against olibra_now() rather than a bound ctx.clock.now() for
      -- the same reason copies_borrowable does
      -- (20260808_14_olibra_now.sql:124): one clock, set once per transaction
      -- by the kernel, read by every statement in it.
      --
      -- A lateral join rather than a scalar subquery because two columns are
      -- wanted from the same row and two subqueries could, in principle,
      -- resolve to two different requests — the holder from one and the id
      -- from another — which is exactly the kind of gap that would fulfil the
      -- wrong request. The order by is there for the same reason
      -- receiveReturn's queue read carries one: limit 1 over a set with no
      -- ordering is whatever the plan happens to produce.
      left join lateral (
        select r.id, r.member_id
          from borrow_requests r
         where r.copy_id = c.id
           and r.status = 'approved'
           and r.deleted_at is null
           and r.hold_expires_at > olibra_now()
         order by r.requested_at asc, r.id asc
         limit 1
      ) h on true
     where c.id = ${input.copyId} and c.deleted_at is null
  `;
  // INV-10, and OPS §5 step 1: a copy id from another shelf is filtered out by
  // RLS before this line, so "belongs to another tenant" and "does not exist"
  // are the same answer here, deliberately — the second tells a caller the
  // first shelf's copy exists.
  if (!copy) throw new NotFound("copy_not_found");

  const [member] = await tx<
    {
      id: string;
      user_id: string;
      status: MembershipStatus;
      active_loans: string;
      max_loans: number;
    }[]
  >`
    select m.id, m.user_id, m.status,
           -- borrower_id is a users(id) (0005_circulation.sql:20). "Per
           -- bookshelf" (BR §5.5) comes from RLS scoping loans and this
           -- transaction running as olibra_app, not from a clause here: one
           -- person has one user id across every shelf they belong to, so
           -- adding "and l.bookshelf_id = ..." would be harmless and
           -- misleading about where the guarantee lives.
           -- inv-05-loan-limit.test.ts's third test runs this exact count on
           -- an unscoped handle and gets 3 where a scoped one gets 0.
           (select count(*) from loans l
             where l.borrower_id = m.user_id and l.status = 'active') as active_loans,
           coalesce((b.settings->>'max_concurrent_loans')::int, 3) as max_loans
      from memberships m
      join bookshelves b on b.id = m.bookshelf_id
     where m.id = ${input.membershipId} and m.deleted_at is null
  `;
  if (!member) throw new NotFound("membership_not_found");

  // OPS §5, steps 2 and 3, before steps 4 and 5 — and it says why: "a manager
  // who searched for a book that's already gone needs to know that
  // immediately, not after they've also picked a reader."
  const copyBlock = copyLendable(
    { state: copy.state, heldForUserId: copy.held_for_user },
    // The reader's *user* id, never `member.id`. `copyLendable`'s parameter is
    // named `forUserId` precisely so this line cannot be written the other way
    // without noticing: a membership id here never equals `member_id`, and INV-3's
    // most interesting case — a held copy is lendable to its holder — would
    // silently become "a held copy is never lendable", with every pure test in
    // `tests/domain/circulation/policy.test.ts` still green.
    member.user_id,
  );
  if (copyBlock.blocked) throw new RuleViolated(copyBlock.reason);

  const memberBlock = memberMayBorrow(
    { status: member.status, activeLoans: Number(member.active_loans) },
    member.max_loans,
  );
  if (memberBlock.blocked) throw new RuleViolated(memberBlock.reason);

  // The hold this lend collects, or null when the copy was simply available.
  //
  // Both halves are required, and neither is redundant. `hold_request_id`
  // being non-null says a live approved hold names this copy; the id
  // comparison says it is *this reader's*, which is the only case
  // `copyLendable` admitted a non-`available` copy for. Closing a hold that
  // belongs to somebody else would take a child's turn away — the one thing
  // worse than leaving the row open.
  const collectedHoldId =
    copy.hold_request_id !== null && copy.held_for_user === member.user_id
      ? copy.hold_request_id
      : null;

  const dueOn = dueDateFor(ctx.clock, await loanDaysFor(tx, ctx.bookshelfId));

  let loanId: string;
  try {
    const [row] = await tx<{ id: string }[]>`
      insert into loans
        (bookshelf_id, copy_id, book_id, borrower_id, lent_by, lent_at, due_on,
         status, request_id)
      values
        (${ctx.bookshelfId}, ${copy.id}, ${copy.book_id}, ${member.user_id},
         ${ctx.actor.userId}, ${ctx.clock.now()}, ${dueOn}, 'active',
         ${collectedHoldId})
      returning id
    `;
    loanId = row.id;
  } catch (e) {
    // INV-1's loser. BR §2: it "must fail cleanly and see a plain message,
    // never a silently corrupted record." `isUniqueViolation` tests `23505`
    // (`errors.ts:192`); anything else is rethrown untouched, because a
    // `catch` that swallowed every error here would turn an FK violation or a
    // dead connection into "Bản sách này đang được mượn".
    if (isUniqueViolation(e)) throw new RuleViolated("copy_not_available");
    throw e;
  }

  // `lent_at` is written explicitly even though the column carries `default
  // now()` (`0005_circulation.sql:24`), and dropping it to "let the default
  // handle it" is the tempting simplification the `feat/sql-clock` review
  // recorded a constraint to refuse. The two are not the same clock: the
  // default is the *database* host's, while `due_on` above, and `is_overdue`
  // and `days_remaining` in `loans_current`, all follow `ctx.clock` through
  // the transaction-local `olibra.now` GUC (`20260808_14_olibra_now.sql`). A
  // loan written under a `fixedClock` set in 2026 would otherwise carry three
  // columns on one row, two from the injected clock and one from wall-clock
  // time, and INV-8's "a loan's `lent_at` precedes its `due_on`" would become
  // untestable rather than false. DB §6, "Two clocks in one transaction".

  // Domain-kernel fix report (2026-08-07-s2-domain-kernel, IMPORTANT 1):
  // RLS's `with check` raises on a cross-shelf insert, but its `using` clause
  // only *filters* rows on update — a blind `update ... where id = ...`
  // against a row belonging to another shelf affects zero rows rather than
  // erroring. Two things stand between that and a silent success here, and it
  // is worth knowing which is which:
  //
  //   1. `copy` was fetched by a shelf-scoped select earlier in this same
  //      transaction, so `copy.id` is already known to belong to
  //      `ctx.bookshelfId`. That is this command's own reasoning.
  //   2. Since the `Tx` wrapper shipped (`guardWrites`,
  //      `src/domain/kernel/unit-of-work.ts:290`), *every* UPDATE/DELETE a
  //      command runs through `tx` that affects zero rows throws
  //      `NotFound("write_target_not_found")` by default, whether or not the
  //      command reasoned about it. That is the kernel's, and it is the
  //      backstop, not the argument.
  //
  // So this line needs no `assertWritten` and no `.allowZero()` — the write is
  // not conditional, it must hit exactly the row just read. Reach for
  // `assertWritten` (same module, `:323`) only to swap the kernel's generic
  // code for a specific one, or to assert a count other than one.
  await tx`update book_copies set state = 'on_loan' where id = ${copy.id}`;

  const audit: AuditEntry[] = [
    {
      action: "loan.created",
      entityType: "loan",
      entityId: loanId,
      before: { copy_state: copy.state },
      after: {
        copy_state: "on_loan",
        // Both ids, because they answer different questions six months later:
        // `borrower_id` is what the `loans` row actually holds and what every
        // join keys on, while `membership_id` is what the manager picked on
        // the screen and the only one of the two that is shelf-specific.
        borrower_id: member.user_id,
        membership_id: member.id,
        due_on: dueOn,
        // Null for the ordinary direct lend, so an auditor can tell the two
        // apart without joining anything: this loan either came out of a
        // queue or it did not.
        request_id: collectedHoldId,
      },
    },
  ];

  if (collectedHoldId) {
    // `fulfilled`, from BR §7.2's `pending → approved → fulfilled`. Not a
    // status invented here: `request_status` (`0005_circulation.sql:54`)
    // spells exactly six, and `fulfilled` is the only one of them that means
    // the reader got the book. `expired` would say the hold lapsed and
    // `cancelled` that the reader withdrew — both of which describe a child
    // who went home empty-handed.
    //
    // `hold_expires_at` is deliberately left where it stands. It is the
    // record of a deadline this reader met, and every read of it is already
    // gated on `status = 'approved'` (`copies_borrowable`, and the lateral
    // join above), so a fulfilled row's expiry is inert rather than stale.
    // Blanking it would erase how long they had.
    await tx`
      update borrow_requests
         set status = 'fulfilled',
             fulfilled_loan_id = ${loanId}
       where id = ${collectedHoldId}
    `;
    audit.push({
      action: "request.fulfilled",
      entityType: "request",
      entityId: collectedHoldId,
      before: { status: "approved", copy_id: copy.id, fulfilled_loan_id: null },
      after: { status: "fulfilled", copy_id: copy.id, fulfilled_loan_id: loanId },
    });
  }

  return { result: { loanId, dueOn }, audit };
};

/**
 * BR §5.5's `loan_days`, defaulting to 14.
 *
 * Read from the shelf rather than taken as a parameter, unlike
 * `max_concurrent_loans` in `memberMayBorrow` — the asymmetry is deliberate
 * and lives one level up: `memberMayBorrow` is a *pure predicate* a screen
 * calls too, so it cannot reach a shelf row, while this is a command that
 * already has a transaction open. `makeShelf` leaves `settings` as `{}` and DB
 * §4.2 says a shelf row "need only store what it overrides", so the coalesce
 * default is the value nearly every shelf actually uses, not a corner case.
 */
async function loanDaysFor(tx: Tx, bookshelfId: string): Promise<number> {
  const [row] = await tx<{ loan_days: number }[]>`
    select coalesce((settings->>'loan_days')::int, 14) as loan_days
      from bookshelves where id = ${bookshelfId}
  `;
  return row.loan_days;
}
