import type { AuditEntry } from "../../kernel/audit";
import { NotFound, RuleViolated } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command } from "../../kernel/unit-of-work";
// Imported, never restated — see the note at the top of `./lend-copy.ts` on why
// every file in this domain takes `requireReader`/`requireManager` from the
// catalogue's copy rather than growing a third.
import { requireReader } from "../../catalogue/policy";
import type { MembershipStatus } from "../../members/policy";
import { memberMayRequest } from "../policy";

export interface CreateBorrowRequestInput {
  bookId: string;
  /**
   * The caller's **own** membership of this shelf. OPS §4.2 names it as an
   * input and the reader's dashboard has it; it is checked against
   * `ctx.actor.membershipId` below rather than trusted, because a
   * caller-supplied id is not a scope.
   */
  membershipId: string;
  /**
   * The physical copy in the reader's hands, when they scanned its QR label
   * rather than pressing "Xin mượn" on a title (BR §19).
   *
   * **Optional, and it stays optional.** A request is a statement of intent
   * about a *title* (§7.2) — the title-level button predates this and is
   * unchanged. This records which copy prompted it, which is strictly more
   * than the queue knew before: the manager sees the book that is actually in
   * the child's hands, not merely which title was wanted.
   *
   * It is **not** a claim on that copy. `ApproveBorrowRequest` still chooses
   * which copy to hand over, for the reason this command's own docstring gives
   * below — nothing here reads a copy's state.
   */
  copyId?: string;
}

export interface CreateBorrowRequestResult {
  requestId: string;
}

/**
 * A reader joins the queue for a title. BR §16.1's "Xin mượn", pressed by
 * somebody who is signed in — OPS §4.2: it "submits immediately with a
 * confirmation dialog".
 *
 * **This does not check whether a copy is free, and that is the whole point.**
 * OPS §4.2 describes the command as covering a title "that has no copy free
 * right now, *or*" a reader who "wants to queue even when copies exist". BR §7.2
 * agrees: "requests for a title whose copies are all out simply remain
 * *pending*", and there is no separate reservation concept. Nothing here reads
 * `book_copies` at all, so a request is a statement of intent and never a claim
 * on a physical object — the claim is made by `ApproveBorrowRequest`, by a
 * manager, on a copy they have chosen.
 *
 * **`member_id` receives a `users(id)`, despite its name.**
 * (`0005_circulation.sql:63`, `references users(id)`, left that way deliberately
 * by `20260808_04_composite_tenant_fks.sql:42` because `users` is a global table
 * with no shelf-scoped column to pair an id with.) The select below resolves the
 * membership to its `user_id` in the same statement that reads its status, the
 * same way `lendCopy` resolves a borrower. Writing `input.membershipId` there
 * instead is a `23503` on the first request, and if it somehow were not, INV-3's
 * holder comparison in `copyLendable` would be permanently false and a held copy
 * would never be lendable to the child it was held for — with every pure test
 * still green. `inv-03-only-available-or-own-hold.test.ts` pins that directly.
 *
 * **The membership must be the caller's own.** OPS §4.2 gives the caller as
 * `reader`, and `requireReader` cannot express "own" — it ranks a role, and it
 * waves a manager through besides. A reader who edited the hidden field would
 * otherwise put another child in a queue under that child's name. So the id is
 * compared against `ctx.actor.membershipId`, which `src/auth/guards.ts` resolved
 * from a session cookie this process verified, and a mismatch is
 * `not_permitted`. That refusal is not a shortcut for a missing feature: a
 * manager queueing on a reader's behalf is a *different command* nobody has
 * specified, and inventing it here would put a Vietnamese sentence and an audit
 * actor on an act the requirements never describe.
 *
 * **`requested_at` is written from `ctx.clock`**, though the column carries
 * `default now()`. It is the queue's ordering key (the column's own comment,
 * `0005_circulation.sql:66`) and every hold derived from it is compared against
 * `olibra_now()`, which follows `ctx.clock` — so letting the default fill it in
 * would order a queue by the database host's clock while expiring its holds by
 * the injected one. This is the same correction `lendCopy` records for `lent_at`
 * and `receiveReturn` for `hold_expires_at`; DB §6, "Two clocks in one
 * transaction".
 *
 * **`duplicate_request` is an application check with a race behind it.** There
 * is no unique index on `(book_id, member_id)` — verified against `pg_indexes`,
 * which knows only `requests_queue`, `requests_holds`, the primary key and the
 * composite-FK unique. So two taps in the same second produce two pending rows
 * and one child occupies two places in the queue. OPS §6 says exactly this about
 * read-then-write, and the migration that would close it is written out in the
 * C2 plan §7 rather than applied here: master §7.6's file list for this slice
 * has no migration in it, and a partial unique index over a soft-deleted table
 * is the shape `20260808_03` and `20260808_09` each had to correct once already.
 * The select below closes the case the screen actually produces — a stale page,
 * a second tap seconds later.
 *
 * **Notification: D1.** BR §15 lists "borrow request submitted" among the
 * events a manager is told about. This slice writes no notification row (C2 plan
 * §6); this is one of the five sites D1 will come back to.
 */
export const createBorrowRequest: Command<
  CreateBorrowRequestInput,
  CreateBorrowRequestResult
> = async (tx, ctx, input) => {
  requireReader(ctx);
  // `borrow_requests.member_id` is `not null`, and INV-8 wants the audit row to
  // name somebody. `requireReader` waves a `systemContext` through on rank
  // alone (`kernel/tenant.ts` carries the long version), so without this a seed
  // or a scheduled job reaches the insert and comes back as a raw 23502 from
  // inside the transaction — the unstructured exception OPS §2 forbids.
  requireIdentifiedActor(ctx);
  if (input.membershipId !== ctx.actor.membershipId) {
    throw new RuleViolated("not_permitted");
  }

  // The title, read here so the audit entry can *store* it (P1 §3.2a) rather
  // than joining `books` at render time — `UpdateBook` audits title
  // corrections, so a sentence that re-read the table would restate history.
  // No `is_published` filter: BR §7.2 makes a request a fact about a title and
  // says nothing about visibility, and a draft book is one a reader has no URL
  // for anyway. RLS scopes this to `ctx.bookshelfId`, so a book id from another
  // shelf and a book id naming nothing are the same answer here, deliberately
  // — the second would tell a caller the other shelf's book exists.
  const [book] = await tx<{ id: string; title: string }[]>`
    select id, title from books
     where id = ${input.bookId} and deleted_at is null
  `;
  if (!book) throw new NotFound("book_not_found");

  // `memberships` carries `memberships_tenant` (`0010_rls.sql`), so this is the
  // caller's membership *of this shelf*. `users` carries no policy at all, which
  // is exactly why the scope is taken from this join and never from an id
  // somebody sent.
  const [member] = await tx<
    { id: string; user_id: string; status: MembershipStatus }[]
  >`
    select id, user_id, status from memberships
     where id = ${input.membershipId} and deleted_at is null
  `;
  if (!member) throw new NotFound("membership_not_found");

  const standing = memberMayRequest({ status: member.status });
  if (standing.blocked) throw new RuleViolated(standing.reason);

  // `approved` counts as well as `pending`: a reader whose turn has come and
  // whose copy is on the shelf with their name on it has a request in flight,
  // and "Bạn đã có một yêu cầu đang chờ cho cuốn này." is true of them too.
  // Restricting this to `pending` would let one child hold a copy *and* stand
  // in the queue for the same title.
  const [existing] = await tx<{ id: string }[]>`
    select id from borrow_requests
     where book_id = ${book.id}
       and member_id = ${member.user_id}
       and status in ('pending', 'approved')
       and deleted_at is null
     limit 1
  `;
  if (existing) throw new RuleViolated("duplicate_request");

  // A scanned copy must belong to the title being requested. It always does
  // when the reader's own scan resolved it — the page reads the book *from* the
  // copy — so this guards a caller that constructed the pair itself, and it
  // guards it because the alternative is a row saying "wants DT-0142 of Hoàng
  // Tử Bé" when DT-0142 is a copy of Dế Mèn: a contradiction a manager can only
  // resolve by hand. RLS scopes the lookup, so another shelf's copy id and a
  // copy id naming nothing are the same refusal.
  if (input.copyId !== undefined) {
    const [copy] = await tx<{ id: string }[]>`
      select id from book_copies
       where id = ${input.copyId}
         and book_id = ${book.id}
         and deleted_at is null
    `;
    if (!copy) throw new NotFound("copy_not_found");
  }

  const [row] = await tx<{ id: string }[]>`
    insert into borrow_requests
      (bookshelf_id, book_id, copy_id, member_id, status, requested_at)
    values
      (${ctx.bookshelfId}, ${book.id}, ${input.copyId ?? null},
       ${member.user_id}, 'pending', ${ctx.clock.now()})
    returning id
  `;

  const audit: AuditEntry = {
    action: "request.created",
    entityType: "request",
    entityId: row.id,
    // Null rather than an invented "before": the row did not exist.
    before: null,
    after: {
      status: "pending",
      book_id: book.id,
      // Null when the request came from the title page rather than a scan. The
      // key is always present so the two paths produce the same shape.
      copy_id: input.copyId ?? null,
      // The title **as it is now**, stored rather than joined later (P1 §3.2a).
      title: book.title,
      // Both ids, for the reason `loan.created` stores both: `member_id` is
      // what the row actually holds and what every join keys on, while
      // `membership_id` is the only one of the two that is shelf-specific.
      // `userId` is also the key `get-audit-log.ts`'s subject join reads out of
      // a payload, so the entry can name the person if a sentence ever needs to.
      userId: member.user_id,
      membership_id: member.id,
    },
  };

  return { result: { requestId: row.id }, audit };
};
