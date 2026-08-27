import type { AuditEntry } from "../../kernel/audit";
import { NotFound, RuleViolated } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import { notify } from "../../notifications/write";
import type { Command } from "../../kernel/unit-of-work";
// Imported, never restated — the note at the top of `./lend-copy.ts` carries
// the argument.
import { requireManager } from "../../catalogue/policy";
import type { CopyState } from "../../catalogue/policy";
import { copyHoldable, holdExpiryFrom } from "../policy";
import { holdDaysFor } from "../settings";

export interface ApproveBorrowRequestInput {
  requestId: string;
  /** An available copy **of the requested title** — OPS §4.2's own wording. */
  copyId: string;
}

export interface ApproveBorrowRequestResult {
  requestId: string;
  copyId: string;
  /** When the hold lapses, so the screen can say so without re-reading. */
  holdExpiresAt: Date;
}

/**
 * A manager puts a specific copy aside for the reader whose turn it is.
 * BR §7.2's `pending → approved`, and BR §16.3's "Approve (creating a hold with
 * a visible expiry)".
 *
 * **This is the same effect `receiveReturn` already performs**, reached from the
 * queue screen instead of from the return form. `receive-return.ts:216-237`
 * writes `status='approved'`, the copy id, `hold_expires_at`, `decided_by` and
 * `decided_at`, and pushes a `request.approved` audit row — and it does so
 * because OPS §5 makes holding a returned copy for the next reader a second,
 * explicit decision inside the return. The two commands therefore share
 * `holdDaysFor` and `holdExpiryFrom` rather than each carrying their own
 * arithmetic; what they do not share is the copy, because `receiveReturn`'s is
 * the one just handed back and this one's is chosen from a list.
 *
 * **The copy moves `available → held`, and that settles a question C1 left
 * open.** `inv-03-only-available-or-own-hold.test.ts:188-215` exercises both
 * shapes deliberately — a hold that shows up in `book_copies.state` and a hold
 * that shows up only as a `borrow_requests` row — precisely because which one
 * C2 would choose was not decided. It is the state, matching `receiveReturn`,
 * which sets `held` in the same statement it would otherwise have set
 * `available`. `catalogue/policy.ts`'s table permits the arrow. The consequence
 * worth stating: `copies_borrowable` now excludes this copy twice over, by state
 * and by hold, and a lapsed hold leaves the copy sitting in `held` until
 * somebody records `held → available` — which is a transition a command
 * performs, never one a later read performs on the way past (BR §8's "if the
 * tidy-up never runs, `copies_borrowable` is still right", from the other side).
 *
 * **The copy row is locked, and this is the one place in the slice where a
 * constraint cannot arbitrate.** Two managers approving two different readers
 * onto the same copy in the same second would each read it `available` and each
 * write a hold — two live holds on one physical book, which is INV-3's premise
 * broken with no index to catch it, because `borrow_requests` has no uniqueness
 * on `copy_id` (verified against `pg_indexes`). OPS §6 names row locking as one
 * of the three acceptable mechanisms, and it is the one available here: `for
 * update of c` makes the second transaction wait, and under `read committed`
 * Postgres re-fetches the row it waited for, so the second manager's
 * `copyHoldable` sees `held` and answers `no_copy_available` — OPS's own
 * sentence for it. `for update of c` rather than a bare `for update` because the
 * lateral join below is on the nullable side of an outer join, which Postgres
 * refuses to lock.
 *
 * **Q2 is untouched here.** `decision_note` is `RejectBorrowRequest`'s column
 * too; this command writes none, since OPS §4.2 gives approval no reason field.
 *
 * **Notification: D1.** BR §15's "borrow request approved / copy held for you"
 * is written by nothing yet (C2 plan §6).
 */
export const approveBorrowRequest: Command<
  ApproveBorrowRequestInput,
  ApproveBorrowRequestResult
> = async (tx, ctx, input) => {
  requireManager(ctx);
  // `decided_by` is nullable, but INV-8 wants the audit row to name the actor
  // and BR §14's browser renders "who decided this" off exactly this column.
  // The same check `receiveReturn` applies before it writes `decided_by`.
  requireIdentifiedActor(ctx);

  // RLS scopes this to `ctx.bookshelfId`, so a request id from another shelf and
  // one naming nothing are the same answer — deliberately, as in `lendCopy`:
  // telling them apart would confirm the other shelf's request exists.
  //
  // One code for both "no such request" and "already decided", the way
  // `receiveReturn` gives `loan_not_active` to both. OPS §4.2 lists exactly one
  // failure mode here for the request's own state (`:306`), and `errors.ts` may
  // not gain a code whose Vietnamese sentence nobody wrote.
  const [request] = await tx<
    {
      id: string;
      book_id: string;
      member_id: string;
      status: string;
      title: string;
    }[]
  >`
    select r.id, r.book_id, r.member_id, r.status, b.title
      from borrow_requests r
      -- The title, for the notification D1 writes below. An inner join is
      -- right: book_id is not null and books is RLS-scoped to the same shelf,
      -- so a row that fails this join is a request for another shelf's book,
      -- which request_not_pending should refuse anyway. (No backticks in a
      -- SQL comment here: this is inside a tagged template, and one would end
      -- the literal -- the trap C1's reconciliation caught in a draft.)
      join books b on b.id = r.book_id
     where r.id = ${input.requestId} and r.deleted_at is null
  `;
  if (!request || request.status !== "pending") {
    throw new RuleViolated("request_not_pending");
  }

  // Filtered on `book_id`, so a copy of a *different* title is simply not found
  // rather than being refused with a sentence about availability. OPS §4.2
  // specifies "an available copy of the requested title" and this is that
  // clause; `NotFound` is the shape OPS §2 gives "the thing asked for does not
  // exist, or is not visible to this caller", which is exactly a copy this
  // request could never have been approved onto.
  const [copy] = await tx<
    { id: string; state: CopyState; held_for_user: string | null }[]
  >`
    select c.id, c.state, h.member_id as held_for_user
      from book_copies c
      -- The live hold on this copy, if any: the same subquery lendCopy runs,
      -- spelled the same way and compared against olibra_now() rather than a
      -- bound ctx.clock.now() for the same reason copies_borrowable does
      -- (20260808_14_olibra_now.sql:124) -- one clock, set once per
      -- transaction by the kernel, read by every statement in it. A hold that
      -- has lapsed therefore arrives as null, which is the convention
      -- copyHoldable is written against.
      left join lateral (
        select r.member_id
          from borrow_requests r
         where r.copy_id = c.id
           and r.status = 'approved'
           and r.deleted_at is null
           and r.hold_expires_at > olibra_now()
         order by r.requested_at asc, r.id asc
         limit 1
      ) h on true
     where c.id = ${input.copyId}
       and c.book_id = ${request.book_id}
       and c.deleted_at is null
     for update of c
  `;
  if (!copy) throw new NotFound("copy_not_found");

  const block = copyHoldable({
    state: copy.state,
    heldForUserId: copy.held_for_user,
  });
  if (block.blocked) throw new RuleViolated(block.reason);

  const holdExpiresAt = holdExpiryFrom(
    ctx.clock.now(),
    await holdDaysFor(tx, ctx.bookshelfId),
  );

  await tx`
    update borrow_requests
       set status = 'approved',
           copy_id = ${copy.id},
           hold_expires_at = ${holdExpiresAt},
           decided_by = ${ctx.actor.userId},
           decided_at = ${ctx.clock.now()}
     where id = ${request.id}
  `;

  // No `assertWritten` and no `.allowZero()`: RLS's `using` clause *filters*
  // rather than raises on UPDATE, so a cross-shelf write is a silent no-op —
  // and since the `Tx` wrapper shipped (`unit-of-work.ts`'s `guardWrites`),
  // every UPDATE a command runs through `tx` that affects zero rows throws
  // `write_target_not_found` by default. Both rows were read by shelf-scoped
  // selects in this same transaction, so neither write is conditional.
  await tx`update book_copies set state = 'held' where id = ${copy.id}`;

  const audit: AuditEntry = {
    action: "request.approved",
    entityType: "request",
    entityId: request.id,
    // The same payload shape `receiveReturn` writes for this action, so one
    // resolution rule covers both ways a hold is created rather than two
    // spellings of the same fact.
    before: { status: "pending", copy_id: null },
    after: {
      status: "approved",
      copy_id: copy.id,
      hold_expires_at: holdExpiresAt.toISOString(),
      // A `users(id)` — `member_id`'s name says membership and its foreign key
      // says otherwise. Stored under `userId` because that is one of the two
      // keys `get-audit-log.ts`'s subject join reads out of a payload.
      userId: request.member_id,
    },
  };

  // OPS §7 — "yêu cầu mượn được duyệt (kèm hạn đến nhận)" and "sách đã sẵn
  // sàng để nhận" are one event a reader experiences once, so one row. The
  // deadline is in the payload because a hold whose end a child does not know
  // is a hold they will miss.
  await notify(tx, {
    userId: request.member_id,
    kind: "request_approved",
    payload: {
      title: request.title,
      hold_until: holdExpiresAt.toISOString().slice(0, 10),
    },
  });

  return {
    result: { requestId: request.id, copyId: copy.id, holdExpiresAt },
    audit,
  };
};
