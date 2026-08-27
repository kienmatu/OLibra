import type { AuditEntry } from "../../kernel/audit";
import { RuleViolated } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command } from "../../kernel/unit-of-work";
// Imported, never restated — the note at the top of `./lend-copy.ts` carries
// the argument.
import { requireReader } from "../../catalogue/policy";
import type { CopyState } from "../../catalogue/policy";

export interface CancelOwnRequestInput {
  requestId: string;
}

export interface CancelOwnRequestResult {
  requestId: string;
  /**
   * The copy this cancellation put back on the shelf, or `null` when the
   * request had not been approved onto one. The reader's dashboard has nothing
   * to say about it; the *manager's* queue does, and a caller that had to
   * re-read `book_copies` to find out would be asking the database a question
   * this transaction already answered.
   */
  releasedCopyId: string | null;
}

/**
 * A reader withdraws their own request. BR §7.2's `cancelled`, reachable from
 * both of the states that lead to it: `pending` (still queueing) and `approved`
 * (a copy is on the shelf with their name on it).
 *
 * **Cancelling a held request releases the copy, in this same transaction.**
 * That is INV-2 in substance — OPS §4.2 lists it under this command's invariants
 * as "releases the hold if one exists" — and it is the mirror of what `lendCopy`
 * does when it collects one. A request left `approved` goes on naming the copy,
 * so `copies_borrowable`'s hold clause (`20260808_14_olibra_now.sql:120-126`)
 * keeps excluding it for the rest of `hold_days` while the book sits on the
 * shelf and every public surface tells the next child there is none free. The
 * copy's `state` would keep saying `held` for the same span, with nobody left
 * to hand it to.
 *
 * **`held → available` is the transition, and it is guarded on the state rather
 * than performed blindly.** `catalogue/policy.ts`'s table permits the arrow, and
 * BR §7.1 is the reason the guard is on `state = 'held'`: if the copy has since
 * moved on — somebody lent it, reported it lost, retired it — this cancellation
 * must not drag it back to `available` and put a lost book on the shelf. The
 * write therefore names the state it expects and calls `.allowZero()`, because
 * "the copy already moved on" is a legitimate outcome and not the kernel's
 * `write_target_not_found` fault.
 *
 * **`hold_expires_at` and `copy_id` are left where they stand.** They are the
 * record of what this reader had and until when, and every read of either is
 * already gated on `status = 'approved'` — `copies_borrowable`'s clause and
 * `lendCopy`'s lateral join both — so a cancelled row's hold is inert rather
 * than stale. Blanking them would erase what the reader gave up. `lendCopy`
 * makes the identical choice for a fulfilled request.
 *
 * **Ownership is the whole of the permission, and `requireReader` cannot
 * express it.** That guard ranks a role and waves a manager through besides. The
 * comparison below is `borrow_requests.member_id` against `ctx.actor.userId`,
 * and both sides are `users(id)` — `member_id`'s name says membership and its
 * foreign key says otherwise (`0005_circulation.sql:63`). Comparing it against
 * `ctx.actor.membershipId` would never be equal, so *every* cancellation would
 * be refused as somebody else's, and no unit test of a pure predicate would
 * notice because there is no predicate here to test. That is the same trap
 * `copyLendable`'s parameter names exist to make unwriteable, one command over.
 *
 * A manager therefore cannot cancel a reader's request through this command,
 * which is correct rather than a gap: OPS §4.2 names the caller `reader (own
 * request only)`, and *Từ chối* is the command a manager has for the same row.
 *
 * **Notification: D1.** BR §15 does not list a reader's own cancellation among
 * the events anybody is told about, so this is the one of the five that may
 * genuinely need none. Named here anyway so D1 decides rather than inherits.
 */
export const cancelOwnRequest: Command<
  CancelOwnRequestInput,
  CancelOwnRequestResult
> = async (tx, ctx, input) => {
  requireReader(ctx);
  // Without this a `systemContext` — waved through by `requireReader` on rank
  // alone — reaches the ownership comparison below with `userId === null`, and
  // `null !== <a uuid>` refuses it, which is the right answer for the wrong
  // reason and by accident. `kernel/tenant.ts` carries the long version.
  requireIdentifiedActor(ctx);

  // RLS scopes this to the shelf. The title is read here so the audit entry can
  // *store* it rather than joining `books` at render time (P1 §3.2a);
  // `book_copies` is a left join because a `pending` request names no copy.
  const [request] = await tx<
    {
      id: string;
      member_id: string;
      status: string;
      copy_id: string | null;
      title: string;
      copy_state: CopyState | null;
    }[]
  >`
    select r.id, r.member_id, r.status, r.copy_id, b.title,
           c.state as copy_state
      from borrow_requests r
      join books b on b.id = r.book_id
      left join book_copies c on c.id = r.copy_id
     where r.id = ${input.requestId} and r.deleted_at is null
  `;
  // "Does not exist" and "belongs to another shelf" are one answer, and here
  // they are also the same answer as "belongs to another reader" — which is the
  // point rather than a shortcut. OPS §4.2 notes `not_own_request` "should be
  // structurally unreachable via UI, but the command must still check", and a
  // caller who guessed a uuid learns nothing from it either way.
  if (!request || request.member_id !== ctx.actor.userId) {
    throw new RuleViolated("not_own_request");
  }
  // Checked before the general case, because OPS gives it its own sentence:
  // "Yêu cầu này đã được trao sách, không thể huỷ." A child who has the book
  // has not had a request processed in the abstract — they have the book.
  if (request.status === "fulfilled") {
    throw new RuleViolated("request_already_fulfilled");
  }
  if (request.status !== "pending" && request.status !== "approved") {
    throw new RuleViolated("request_not_pending");
  }

  await tx`
    update borrow_requests
       set status = 'cancelled',
           cancelled_at = ${ctx.clock.now()}
     where id = ${request.id}
  `;

  // `copy_state === "held"` and not merely `copy_id !== null`: the guard is the
  // decision, and the `where` below repeats it so that a copy which changed
  // state between this read and that write is left alone rather than dragged
  // back to `available`.
  const releasing = request.copy_id !== null && request.copy_state === "held";
  if (releasing) {
    await tx`
      update book_copies
         set state = 'available'
       where id = ${request.copy_id} and state = 'held'
    `.allowZero();
  }

  const audit: AuditEntry = {
    action: "request.cancelled",
    entityType: "request",
    entityId: request.id,
    before: { status: request.status, copy_id: request.copy_id },
    after: {
      status: "cancelled",
      title: request.title,
      // Which copy went back on the shelf, and `null` when none did — so an
      // auditor can tell a withdrawal from a queue apart from a withdrawal that
      // freed a book, without joining anything.
      released_copy_id: releasing ? request.copy_id : null,
    },
  };

  return {
    result: {
      requestId: request.id,
      releasedCopyId: releasing ? request.copy_id : null,
    },
    audit,
  };
};
