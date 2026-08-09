import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import {
  systemContext,
  type TenantContext,
} from "../../../src/domain/kernel/tenant";
import { runCommand, runQuery } from "../../../src/domain/kernel/unit-of-work";
import { lendCopy } from "../../../src/domain/circulation/commands/lend-copy";
import { receiveReturn } from "../../../src/domain/circulation/commands/receive-return";
import { migrate } from "../../../src/db/migrate";
import { makeBookWithCopies, makeMember } from "../../support/factories";
import { lentOut, SCENARIO_CLOCK } from "../../support/scenarios";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock(SCENARIO_CLOCK);

/** A pending request for `bookId`, from a new reader of this shelf. */
async function queueReader(bookshelfId: string, bookId: string, at = clock.now()) {
  const reader = await makeMember(sql, bookshelfId);
  const [request] = await sql<{ id: string }[]>`
    insert into borrow_requests
      (bookshelf_id, book_id, member_id, status, requested_at)
    values (${bookshelfId}, ${bookId}, ${reader.userId}, 'pending', ${at})
    returning id
  `;
  return { reader, requestId: request.id };
}

test("a returned copy becomes available again", async () => {
  const { ctx, copyId, loanId } = await lentOut(sql);

  await runCommand(sql, ctx, receiveReturn, { loanId, condition: "perfect" });

  const [copy] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${copyId}
  `;
  const [loan] = await sql<{ status: string }[]>`
    select status from loans where id = ${loanId}
  `;
  expect(copy.state).toBe("available");
  expect(loan.status).toBe("returned");
});

test("the return records a condition assessment tied to the loan", async () => {
  // BR §5.4: ConditionAssessment is separate from the loan because a manager
  // may assess a copy at any time, not only at return. The link back to the
  // loan is what makes "returned in worse condition than it left in" (BR §3)
  // answerable later.
  const { ctx, copyId, loanId } = await lentOut(sql);

  await runCommand(sql, ctx, receiveReturn, {
    loanId,
    condition: "torn",
    note: "Rách trang 12",
  });

  const [assessment] = await sql<
    {
      copy_id: string;
      loan_id: string;
      condition: string;
      note: string;
      assessed_by: string;
      assessed_at: Date;
    }[]
  >`select copy_id, loan_id, condition, note, assessed_by, assessed_at
      from condition_assessments`;
  expect(assessment).toMatchObject({
    copy_id: copyId,
    loan_id: loanId,
    condition: "torn",
    note: "Rách trang 12",
  });
  // `assessed_by` is a users(id) (0005_circulation.sql:90), like every other
  // actor column in this schema, and `assessed_at` is the injected clock's —
  // not the column's `default now()`.
  expect(assessment.assessed_by).toBe(ctx.actor.userId);
  expect(assessment.assessed_at.toISOString()).toBe(clock.now().toISOString());
});

test("the copy carries its new condition forward", async () => {
  const { ctx, copyId, loanId } = await lentOut(sql);

  await runCommand(sql, ctx, receiveReturn, {
    loanId,
    condition: "worn",
    note: "Gáy sách long",
  });

  const [copy] = await sql<{ condition: string; condition_note: string | null }[]>`
    select condition, condition_note from book_copies where id = ${copyId}
  `;
  expect(copy.condition).toBe("worn");
  // The note travels with the condition, the way `assessCondition` (B1) writes
  // the pair. A note left behind from an earlier judgement would describe
  // damage this copy no longer has.
  expect(copy.condition_note).toBe("Gáy sách long");
});

test("the loan carries the return's own record: who, when, in what condition", async () => {
  // `loans_returned_has_condition` (0005_circulation.sql:50) makes the status
  // and the condition one statement; these three columns are what a manager
  // reading the loan history a year later actually sees.
  const { ctx, loanId } = await lentOut(sql);

  await runCommand(sql, ctx, receiveReturn, {
    loanId,
    condition: "slightly_worn",
    note: "Bìa hơi cong",
    photo: "https://example.invalid/anh.jpg",
  });

  const [loan] = await sql<
    {
      returned_at: Date;
      received_by: string;
      return_condition: string;
      return_note: string;
      return_photo_url: string;
    }[]
  >`select returned_at, received_by, return_condition, return_note, return_photo_url
      from loans where id = ${loanId}`;
  expect(loan.received_by).toBe(ctx.actor.userId);
  expect(loan.return_condition).toBe("slightly_worn");
  expect(loan.return_note).toBe("Bìa hơi cong");
  expect(loan.return_photo_url).toBe("https://example.invalid/anh.jpg");
  // `returned_at` from `ctx.clock`, not the wall clock: the column has no
  // default at all, so the only thing this catches is the command reaching for
  // `new Date()` or SQL's `now()` instead of the clock every other timestamp
  // on this row already follows.
  expect(loan.returned_at.toISOString()).toBe(clock.now().toISOString());
});

test("returning an already-returned loan fails with loan_not_active", async () => {
  // BR §17.7: every button that triggers a change disables itself in flight,
  // "which also prevents the double-submit that would otherwise create
  // duplicate loans." This is the server-side half of that guarantee — the
  // client-side half is not a security control.
  const { ctx, loanId } = await lentOut(sql);

  await runCommand(sql, ctx, receiveReturn, { loanId, condition: "perfect" });

  await expect(
    runCommand(sql, ctx, receiveReturn, { loanId, condition: "perfect" }),
  ).rejects.toMatchObject({ code: "loan_not_active" });

  // And nothing was written the second time round: one assessment, not two.
  const [{ n }] = await sql<{ n: string }[]>`
    select count(*) as n from condition_assessments
  `;
  expect(Number(n)).toBe(1);
});

test("INV-11: a loan is never deleted on return", async () => {
  const { ctx, loanId } = await lentOut(sql);
  const [{ count: before }] = await sql<{ count: string }[]>`
    select count(*) from loans
  `;

  await runCommand(sql, ctx, receiveReturn, { loanId, condition: "perfect" });

  const [{ count: after }] = await sql<{ count: string }[]>`
    select count(*) from loans
  `;
  expect(after).toBe(before);
});

test("the returned copy can immediately be lent again — INV-1 stays satisfiable", async () => {
  // The partial unique index keys on `status = 'active'`. If the return set a
  // flag beside the status instead of changing it, this fails with a 23505 and
  // the copy is stuck forever.
  const { ctx, copyId, loanId } = await lentOut(sql);
  const next = await makeMember(sql, ctx.bookshelfId);

  await runCommand(sql, ctx, receiveReturn, { loanId, condition: "perfect" });

  await expect(
    runCommand(sql, ctx, lendCopy, { copyId, membershipId: next.id }),
  ).resolves.toMatchObject({ loanId: expect.any(String) });
});

test("nothing is held automatically when the manager does not ask", async () => {
  // The rule that matters most in this command. OPS §5: "Nothing happens
  // automatically: the manager decides, because the next reader may not be
  // standing there." A queued request must still be pending afterwards.
  const { ctx, bookId, copyId, loanId, reader } = await lentOut(sql);
  const { requestId } = await queueReader(ctx.bookshelfId, bookId);

  const result = await runCommand(sql, ctx, receiveReturn, {
    loanId,
    condition: "perfect",
  });

  const [request] = await sql<
    { status: string; copy_id: string | null; hold_expires_at: Date | null }[]
  >`select status, copy_id, hold_expires_at from borrow_requests`;
  expect(request.status).toBe("pending");
  expect(request.copy_id).toBeNull();
  expect(request.hold_expires_at).toBeNull();

  const [copy] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${copyId}
  `;
  expect(copy.state).toBe("available");

  // The command still *tells* the manager somebody is waiting — BR §16.3:
  // "the confirmation says so immediately and offers to approve the first
  // person in the queue."
  expect(result.queuedRequestId).toBe(requestId);

  // One fact, one audit row. The `request.approved` entry belongs to the
  // decision the manager did not make.
  const actions = await sql<{ action: string }[]>`
    select action from audit_log order by action
  `;
  expect(actions.map((a) => a.action)).toEqual(["loan.created", "loan.returned"]);

  // P1 §3.2a: the entry stores the title and the borrower rather than leaving
  // the browser to join for them. BR §14's return sentence names both -- "đã
  // nhận trả Hoàng Tử Bé từ Têrêsa Lê Ngọc Ánh" -- and both are values a
  // manager can change afterwards (`UpdateBook` and `UpdateReaderProfile` each
  // audit exactly such a correction), so re-reading either at render time
  // would rewrite what the log says happened.
  //
  // The title is corrected *after* the return, and the entry keeps saying what
  // it said: that is the assertion, not the equality with a fixture string.
  const [{ title }] = await sql<{ title: string }[]>`
    select title from books where id = ${bookId}
  `;
  await sql`update books set title = 'Một tên khác hẳn' where id = ${bookId}`;

  const [entry] = await sql<{ after: Record<string, unknown> }[]>`
    select after from audit_log where action = 'loan.returned'
  `;
  expect(entry.after.title).toBe(title);
  expect(entry.after.title).not.toBe("Một tên khác hẳn");
  expect(entry.after.borrower_id).toBe(reader.userId);
});

test("the queue is reported in requested_at order, not insertion order", async () => {
  // `requested_at` is "the queue ordering key" (the column's own comment,
  // 0005_circulation.sql:66). The two rows below are written in the opposite
  // order to the one they queued in, so a command that reported whatever
  // Postgres returned first would offer the manager the wrong child.
  //
  // **The `analyze` is what makes that true, and it is not a trick.** Measured
  // (fix-report): without it, deleting `order by requested_at asc, id asc`
  // from `receiveReturn` left this test — and all 42 circulation tests —
  // green. A table truncated by `resetDatabase` has `reltuples = 0` and no
  // statistics, and against that the planner costs the partial index
  // `requests_queue (book_id, requested_at) where status = 'pending'`
  // (0012_indexes.sql:26) as the cheapest way to find one row — an ordered
  // index scan, which hands back `requested_at` order for free and made the
  // guard decorative. A real shelf's `borrow_requests` has been analyzed by
  // autovacuum, and there the planner sees a two-page table where every row
  // matches and takes a seq scan for a `limit 1`: heap order, which is
  // insertion order, which is the wrong child. `analyze` here is what gives
  // the test database the statistics production has, not a distortion of it.
  // Re-measured after adding it: deleting the `order by` fails this test.
  const { ctx, bookId, loanId } = await lentOut(sql);
  const later = await queueReader(
    ctx.bookshelfId,
    bookId,
    new Date("2026-08-05T10:00:00Z"),
  );
  const earlier = await queueReader(
    ctx.bookshelfId,
    bookId,
    new Date("2026-08-01T10:00:00Z"),
  );
  await sql`analyze borrow_requests`;

  const result = await runCommand(sql, ctx, receiveReturn, {
    loanId,
    condition: "perfect",
  });
  expect(result.queuedRequestId).toBe(earlier.requestId);
  expect(result.queuedRequestId).not.toBe(later.requestId);
});

test("two readers who queued in the same instant are ordered by id, not by luck", async () => {
  // The `id asc` half of the same `order by`, which had no test at all.
  //
  // `requested_at` is a `timestamptz` and two requests can share one — a
  // reader queueing from home and a manager queueing them at the shelf in the
  // same second, or (the case the column comment worries about) two rows
  // written inside one transaction under one `ctx.clock`, where they are equal
  // by construction. With the ordering key tied, `limit 1` returns whichever
  // row the plan reaches first, and that is heap order: the row inserted
  // first. So the ids below are written explicitly and inserted in the
  // *opposite* order to their sort order — the larger id first — which is what
  // makes "ordered by id" and "ordered by insertion" give different answers.
  // Nothing else in this fixture can tell them apart.
  const { ctx, bookId, loanId } = await lentOut(sql);
  const readerA = await makeMember(sql, ctx.bookshelfId);
  const readerB = await makeMember(sql, ctx.bookshelfId);
  const sameInstant = new Date("2026-08-01T10:00:00Z");
  const higherId = "ffffffff-0000-4000-8000-000000000002";
  const lowerId = "00000000-0000-4000-8000-000000000001";

  for (const [id, reader] of [
    [higherId, readerA],
    [lowerId, readerB],
  ] as const) {
    await sql`
      insert into borrow_requests
        (id, bookshelf_id, book_id, member_id, status, requested_at)
      values (${id}, ${ctx.bookshelfId}, ${bookId}, ${reader.userId}, 'pending',
              ${sameInstant})
    `;
  }
  await sql`analyze borrow_requests`;

  const result = await runCommand(sql, ctx, receiveReturn, {
    loanId,
    condition: "perfect",
  });
  expect(result.queuedRequestId).toBe(lowerId);
});

test("holding for the next reader is a second fact, in the same transaction", async () => {
  // OPS §5 is explicit that this is two facts and one user action. The kernel
  // already supports an array of audit entries for exactly this case.
  const { ctx, bookId, copyId, loanId } = await lentOut(sql);
  const { requestId } = await queueReader(ctx.bookshelfId, bookId);

  const result = await runCommand(sql, ctx, receiveReturn, {
    loanId,
    condition: "perfect",
    holdForRequestId: requestId,
  });

  // `queuedRequestId` answers "is anyone *still* waiting", so it is read after
  // the hold is written rather than before: the only child in the queue has
  // just been offered the copy, so there is nobody left to offer it to. A read
  // taken before the write would name the request that was just approved and
  // send the confirmation screen to offer the same child the same book twice.
  expect(result.queuedRequestId).toBeNull();

  const [held] = await sql<
    {
      status: string;
      copy_id: string;
      hold_expires_at: Date;
      decided_by: string;
      decided_at: Date;
    }[]
  >`select status, copy_id, hold_expires_at, decided_by, decided_at
      from borrow_requests where id = ${requestId}`;
  expect(held.status).toBe("approved");
  expect(held.copy_id).toBe(copyId);
  expect(held.decided_by).toBe(ctx.actor.userId);
  expect(held.decided_at.toISOString()).toBe(clock.now().toISOString());

  // BR §5.5's `hold_days`, defaulting to 3, counted from the *injected* clock.
  // Asserted as an exact instant rather than merely "later than now": the
  // sharpest case in the `feat/sql-clock` constraint is precisely that this
  // column is written by one clock and compared against another, and
  // `toBeGreaterThan(clock.now())` is satisfied by a `now() + interval '3 days'`
  // written from the database's clock in whatever year this suite really runs.
  expect(held.hold_expires_at.toISOString()).toBe("2026-08-10T10:00:00.000Z");

  const [copy] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${copyId}
  `;
  expect(copy.state).toBe("held");

  const actions = await sql<{ action: string }[]>`
    select action from audit_log order by action
  `;
  expect(actions.map((a) => a.action)).toEqual([
    "loan.created",
    "loan.returned",
    "request.approved",
  ]);
});

test("a copy held for the next reader is lendable to them and to nobody else", async () => {
  // The end of the story OPS §5 tells, and the reason the hold is worth
  // writing at all: the copy the manager just put aside is the one that child
  // collects. Both halves in one test, because a `held` state that refused
  // everybody would satisfy the second alone.
  const { ctx, bookId, copyId, loanId } = await lentOut(sql);
  const { reader: waiting, requestId } = await queueReader(ctx.bookshelfId, bookId);
  const stranger = await makeMember(sql, ctx.bookshelfId);

  await runCommand(sql, ctx, receiveReturn, {
    loanId,
    condition: "perfect",
    holdForRequestId: requestId,
  });

  await expect(
    runCommand(sql, ctx, lendCopy, { copyId, membershipId: stranger.id }),
  ).rejects.toMatchObject({ code: "copy_not_available" });

  await expect(
    runCommand(sql, ctx, lendCopy, { copyId, membershipId: waiting.id }),
  ).resolves.toMatchObject({ loanId: expect.any(String) });
});

test("collecting a hold closes its request, and the copy is free again after the return", async () => {
  // The whole round trip C1's INV-3 branch makes reachable, asserted end to
  // end because the defect it catches only shows up at the end of it.
  //
  // Before this was fixed: the hold-collecting lend left the `borrow_requests`
  // row `approved` and still naming this copy. The lend itself looked right,
  // the return looked right, and then `copies_borrowable`'s hold clause
  // (20260808_14_olibra_now.sql:120-126) went on excluding the copy for the
  // rest of `hold_days` — so every public surface told a child there was no
  // copy free while the book sat on the shelf, and `lendCopy` handed it to the
  // next person who asked anyway. BR §16.3's screen/command disagreement, in
  // the direction where the screen is the one that lies.
  const { shelf, manager, ctx, bookId, copyId, loanId } = await lentOut(sql);
  const { reader: waiting, requestId } = await queueReader(ctx.bookshelfId, bookId);

  await runCommand(sql, ctx, receiveReturn, {
    loanId,
    condition: "perfect",
    holdForRequestId: requestId,
  });

  const { loanId: collectedLoanId } = await runCommand(sql, ctx, lendCopy, {
    copyId,
    membershipId: waiting.id,
  });

  // Fulfilled, and pointing at the loan that fulfilled it — BR §7.2's
  // `pending → approved → fulfilled`, and `fulfilled_loan_id` is the column
  // 0005_circulation.sql:73 exists for.
  const [request] = await sql<
    { status: string; fulfilled_loan_id: string | null; copy_id: string }[]
  >`select status, fulfilled_loan_id, copy_id from borrow_requests where id = ${requestId}`;
  expect(request.status).toBe("fulfilled");
  expect(request.fulfilled_loan_id).toBe(collectedLoanId);
  expect(request.copy_id).toBe(copyId);

  // And the loan points back, so a loan that came out of the queue does not
  // read as a walk-up lend from its own row.
  const [loan] = await sql<{ request_id: string | null }[]>`
    select request_id from loans where id = ${collectedLoanId}
  `;
  expect(loan.request_id).toBe(requestId);

  // The reader brings it back the next day, with nobody queued behind them.
  const nextDay: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock: fixedClock("2026-08-08T10:00:00Z"),
  };
  await runCommand(sql, nextDay, receiveReturn, {
    loanId: collectedLoanId,
    condition: "perfect",
  });

  // The assertion the defect actually failed. `copies_borrowable` is what
  // `getCatalogue`, `searchCatalogue`, `getBookDetail`, `getBooksList`,
  // `getBookDetailManager` and `searchBooksForLending` all read; a stale
  // approved hold naming this copy empties every one of them at once, and the
  // reason is invisible from any of them.
  const borrowable = await runQuery(
    sql,
    nextDay,
    (tx) => tx<{ id: string }[]>`select id from copies_borrowable`,
  );
  expect(borrowable.map((c) => c.id)).toEqual([copyId]);
});

test("collecting a hold writes both facts, one audit row each", async () => {
  // OPS §4.2 pairs them by name for `HandoverRequest`: "`loan.created` (with
  // `request.fulfilled` written in the same transaction)". Two records, because
  // they are two things happening to two different rows — the same reasoning
  // `receiveReturn`'s `loan.returned` + `request.approved` pair already
  // follows, and the reason the kernel takes an array at all.
  const { ctx, bookId, copyId, loanId } = await lentOut(sql);
  const { reader: waiting, requestId } = await queueReader(ctx.bookshelfId, bookId);

  await runCommand(sql, ctx, receiveReturn, {
    loanId,
    condition: "perfect",
    holdForRequestId: requestId,
  });
  const { loanId: collectedLoanId } = await runCommand(sql, ctx, lendCopy, {
    copyId,
    membershipId: waiting.id,
  });

  const rows = await sql<
    {
      action: string;
      entity_type: string;
      entity_id: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }[]
    // `id`, not `occurred_at`: every row here is stamped with the same
    // `fixedClock` instant (audit.ts's `toRow` uses `ctx.clock.now()`), so
    // ordering by the timestamp would sort three simultaneous facts
    // alphabetically and say nothing about which happened first. The identity
    // column is the only write order this table records.
  >`select action, entity_type, entity_id, before, after
      from audit_log order by id`;
  expect(rows.map((r) => r.action)).toEqual([
    "loan.created", // the original lend, from `lentOut`
    "loan.returned",
    "request.approved",
    "loan.created", // the collection
    "request.fulfilled",
  ]);

  const fulfilled = rows.find((r) => r.action === "request.fulfilled")!;
  expect(fulfilled.entity_type).toBe("request");
  expect(fulfilled.entity_id).toBe(requestId);
  expect(fulfilled.before).toMatchObject({ status: "approved" });
  expect(fulfilled.after).toMatchObject({
    status: "fulfilled",
    fulfilled_loan_id: collectedLoanId,
  });

  // And the lend's own record says which request it came out of, so the two
  // rows are readable as a pair without a join.
  const collection = rows.filter((r) => r.action === "loan.created").at(-1)!;
  expect(collection.after).toMatchObject({ request_id: requestId });
});

test("a lend that collects nobody's hold leaves the queue and the loan unlinked", async () => {
  // The other side of the branch, so the fix cannot degenerate into "close
  // whatever request is lying around". A reader is queued for this title and
  // has *not* been given a hold; lending the copy to somebody else must leave
  // their place in the queue exactly where it was.
  const { ctx, bookId, copyId, loanId } = await lentOut(sql);
  const { requestId } = await queueReader(ctx.bookshelfId, bookId);
  const walkUp = await makeMember(sql, ctx.bookshelfId);

  await runCommand(sql, ctx, receiveReturn, { loanId, condition: "perfect" });
  const { loanId: second } = await runCommand(sql, ctx, lendCopy, {
    copyId,
    membershipId: walkUp.id,
  });

  const [request] = await sql<
    { status: string; fulfilled_loan_id: string | null }[]
  >`select status, fulfilled_loan_id from borrow_requests where id = ${requestId}`;
  expect(request.status).toBe("pending");
  expect(request.fulfilled_loan_id).toBeNull();

  const [loan] = await sql<{ request_id: string | null }[]>`
    select request_id from loans where id = ${second}
  `;
  expect(loan.request_id).toBeNull();

  const actions = await sql<{ action: string }[]>`select action from audit_log`;
  expect(actions.map((a) => a.action)).not.toContain("request.fulfilled");
});

test("a hold belonging to somebody else is never the one a lend closes", async () => {
  // The other half of "which request does this lend fulfil?", and the only
  // shape in which the holder comparison can bite: a copy left `available`
  // while an approved hold names it. No C1 command produces that — a hold from
  // `receiveReturn` moves the copy to `held`, where `copyLendable` refuses
  // everyone but the holder — but the schema represents it (two tables, no
  // constraint), and `inv-03-only-available-or-own-hold.test.ts`'s fourth test
  // records that which of the two shapes C2's `ApproveBorrowRequest` will
  // produce is not settled. Written with direct SQL for exactly that reason,
  // the way that file writes its own hold fixtures.
  //
  // Drop `copy.held_for_user === member.user_id` from `collectedHoldId` and
  // this lend marks a waiting child's request `fulfilled` — the queue screen
  // stops showing them, the notification says they got the book, and they did
  // not.
  const { ctx, bookId, copyId, loanId } = await lentOut(sql);
  const holder = await makeMember(sql, ctx.bookshelfId);
  const walkUp = await makeMember(sql, ctx.bookshelfId);

  await runCommand(sql, ctx, receiveReturn, { loanId, condition: "perfect" });
  const [request] = await sql<{ id: string }[]>`
    insert into borrow_requests
      (bookshelf_id, book_id, copy_id, member_id, status, requested_at,
       hold_expires_at)
    values
      (${ctx.bookshelfId}, ${bookId}, ${copyId}, ${holder.userId}, 'approved',
       ${clock.now()}, timestamptz '2026-08-10T10:00:00Z')
    returning id
  `;

  await runCommand(sql, ctx, lendCopy, { copyId, membershipId: walkUp.id });

  const [after] = await sql<
    { status: string; fulfilled_loan_id: string | null }[]
  >`select status, fulfilled_loan_id from borrow_requests where id = ${request.id}`;
  expect(after.status).toBe("approved");
  expect(after.fulfilled_loan_id).toBeNull();
});

test("the hold clock is the injected one, so the hold lapses without a job running", async () => {
  // BR §8 / DB §6: "if the tidy-up never runs, `copies_borrowable` is still
  // right." That only holds if `hold_expires_at` and `olibra_now()` are the
  // same clock — write the column from the database's and this assertion is
  // unwriteable, because the two are years apart under a `fixedClock`.
  const { shelf, manager, ctx, bookId, copyId, loanId } = await lentOut(sql);
  const { reader: waiting, requestId } = await queueReader(ctx.bookshelfId, bookId);

  await runCommand(sql, ctx, receiveReturn, {
    loanId,
    condition: "perfect",
    holdForRequestId: requestId,
  });

  // Three days and a minute later, the same command, the same rows.
  const after: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock: fixedClock("2026-08-10T10:01:00Z"),
  };
  await expect(
    runCommand(sql, after, lendCopy, { copyId, membershipId: waiting.id }),
  ).rejects.toMatchObject({ code: "copy_not_available" });

  // Nothing expired it; the clock moved and the row did not.
  const [request] = await sql<{ status: string }[]>`
    select status from borrow_requests where id = ${requestId}
  `;
  expect(request.status).toBe("approved");
});

test("holding for a request that is no longer queued fails cleanly", async () => {
  // The reader cancelled between page load and confirm. OPS §4.2 names this
  // failure `request_not_queued`.
  const { ctx, bookId, loanId } = await lentOut(sql);
  const { requestId } = await queueReader(ctx.bookshelfId, bookId);
  await sql`
    update borrow_requests set status = 'cancelled', cancelled_at = ${clock.now()}
     where id = ${requestId}
  `;

  await expect(
    runCommand(sql, ctx, receiveReturn, {
      loanId,
      condition: "perfect",
      holdForRequestId: requestId,
    }),
  ).rejects.toMatchObject({ code: "request_not_queued" });
});

test("holding for a request queued against a different title fails the same way", async () => {
  // OPS §4.2's wording is "no longer points at a pending request **for this
  // title**", which is two conditions and one code. A command that checked only
  // the status would put this copy aside for a child waiting on a book it is
  // not a copy of — and the queue screen would still show them waiting.
  const { ctx, loanId } = await lentOut(sql);
  const { bookId: otherBook } = await makeBookWithCopies(sql, ctx.bookshelfId, 1);
  const { requestId } = await queueReader(ctx.bookshelfId, otherBook);

  await expect(
    runCommand(sql, ctx, receiveReturn, {
      loanId,
      condition: "perfect",
      holdForRequestId: requestId,
    }),
  ).rejects.toMatchObject({ code: "request_not_queued" });
});

test("a failed hold rolls back the return as well", async () => {
  // G3, in its sharpest form: the two facts commit together or not at all.
  // A return that succeeded while its hold failed would leave a book on the
  // shelf that the system believes is with a reader.
  const { ctx, bookId, copyId, loanId } = await lentOut(sql);
  const { requestId } = await queueReader(ctx.bookshelfId, bookId);
  await sql`
    update borrow_requests set status = 'cancelled', cancelled_at = ${clock.now()}
     where id = ${requestId}
  `;

  await expect(
    runCommand(sql, ctx, receiveReturn, {
      loanId,
      condition: "perfect",
      holdForRequestId: requestId,
    }),
  ).rejects.toThrow();

  const [loan] = await sql<{ status: string }[]>`
    select status from loans where id = ${loanId}
  `;
  expect(loan.status).toBe("active");
  const [copy] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${copyId}
  `;
  expect(copy.state).toBe("on_loan");
  expect(await sql`select 1 from condition_assessments`).toHaveLength(0);
});

test("only a manager may receive a return", async () => {
  const { ctx, reader, loanId } = await lentOut(sql);
  const asReader: TenantContext = {
    ...ctx,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
  };

  await expect(
    runCommand(sql, asReader, receiveReturn, { loanId, condition: "perfect" }),
  ).rejects.toMatchObject({ code: "not_permitted" });
});

test("a system context cannot receive a return", async () => {
  // The one of the three commands that always refused this, kept as a test now
  // that the check is shared (`requireIdentifiedActor`, kernel/tenant.ts).
  // `condition_assessments.assessed_by` is `not null references users(id)`
  // (0005_circulation.sql:90), so the seed and scheduled housekeeping cannot
  // record one — and `requireManager` alone cannot say so, because
  // `systemContext`'s role is `super_admin`.
  const { shelf, loanId } = await lentOut(sql);

  await expect(
    runCommand(sql, systemContext(shelf.id, clock), receiveReturn, {
      loanId,
      condition: "perfect",
    }),
  ).rejects.toMatchObject({ code: "not_permitted" });

  const [loan] = await sql<{ status: string }[]>`
    select status from loans where id = ${loanId}
  `;
  expect(loan.status).toBe("active");
});

test("a condition outside the enum is refused before anything is written", async () => {
  // `copy_condition` would reject it as a 22P02 from inside the transaction;
  // `isCopyCondition` (B1) turns that into the named failure OPS §2 requires.
  const { ctx, loanId } = await lentOut(sql);

  await expect(
    runCommand(sql, ctx, receiveReturn, {
      loanId,
      condition: "destroyed" as never,
    }),
  ).rejects.toMatchObject({ code: "validation_failed" });
  const [loan] = await sql<{ status: string }[]>`
    select status from loans where id = ${loanId}
  `;
  expect(loan.status).toBe("active");
});
