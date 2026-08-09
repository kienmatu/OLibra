import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import type { TenantContext } from "../../src/domain/kernel/tenant";
import { runCommand } from "../../src/domain/kernel/unit-of-work";
import { renewLoan } from "../../src/domain/circulation/commands/renew-loan";
import { createBorrowRequest } from "../../src/domain/circulation/commands/create-borrow-request";
import { receiveReturn } from "../../src/domain/circulation/commands/receive-return";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeMember } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";
import { SCENARIO_CLOCK, lentOut } from "../support/scenarios";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/**
 * INV-6 — "A loan may be renewed only if renewals remain **and** no borrow
 * request is queued for that title. A renewal extends the due date by
 * `renewal_days` **from the current due date**, not from the day the renewal
 * was requested." (BR §6.)
 *
 * Three rules in one sentence, and they fail in three different ways. The
 * arithmetic is the one worth the most care, because the wrong implementation
 * is **invisible on every loan renewed early** — which is nearly all of them —
 * and only diverges once a book is late. So the case that discriminates is a
 * renewal of an already-overdue loan, and it is the first test below rather
 * than an afterthought at the end.
 *
 * Like INV-5, this invariant has no database constraint behind it: `due_on` is
 * an ordinary date column and `renewals_used` an ordinary integer, so every
 * part of INV-6 lives in `renew-loan.ts` and is only as true as these tests.
 */

/** A reader's own `TenantContext` — renewal is reader-initiated (OPS §4.2). */
function readerContext(
  bookshelfId: string,
  reader: { id: string; userId: string },
  instant: string = SCENARIO_CLOCK,
): TenantContext {
  return {
    bookshelfId,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
    clock: fixedClock(instant),
  };
}

test("a renewal extends the current due date, not today — even when overdue", async () => {
  // The discriminating case. `lentOut` lends on 2026-08-07 with the default
  // `loan_days` of 14, so the loan is due 2026-08-21. The renewal is requested
  // on 2026-09-10 — twenty days late — with the default `renewal_days` of 7.
  //
  //   from the due date (correct):  2026-08-21 + 7 = 2026-08-28
  //   from today     (wrong):       2026-09-10 + 7 = 2026-09-17
  //
  // Note which direction the wrong answer errs: extending from today *rewards*
  // lateness with three extra weeks. Renewed a day early instead, both
  // implementations return the same date and this rule would look enforced
  // while doing nothing.
  const { shelf, reader, loanId, dueOn } = await lentOut(sql);
  expect(dueOn).toBe("2026-08-21");

  const ctx = readerContext(shelf.id, reader, "2026-09-10T10:00:00Z");
  const result = await runCommand(sql, ctx, renewLoan, { loanId });

  expect(result.dueOn).toBe("2026-08-28");
  expect(result.renewalsUsed).toBe(1);
});

test("the extension is the shelf's renewal_days, not a hard-coded seven", async () => {
  const { shelf, reader, loanId } = await lentOut(sql);
  await sql`
    update bookshelves
       set settings = settings || '{"renewal_days": 3}'::jsonb
     where id = ${shelf.id}
  `;

  const ctx = readerContext(shelf.id, reader);
  const { dueOn } = await runCommand(sql, ctx, renewLoan, { loanId });

  expect(dueOn).toBe("2026-08-24"); // 2026-08-21 + 3
});

test("renewals run out, and the second attempt says so", async () => {
  // `max_renewals` defaults to 1 (BR §5.5), so the first renewal succeeds and
  // the second is refused — and the loan keeps the date the first one gave it
  // rather than being extended by a refused command.
  const { shelf, reader, loanId } = await lentOut(sql);
  const ctx = readerContext(shelf.id, reader);

  const first = await runCommand(sql, ctx, renewLoan, { loanId });
  expect(first.dueOn).toBe("2026-08-28");

  await expect(runCommand(sql, ctx, renewLoan, { loanId })).rejects.toMatchObject({
    code: "no_renewals_remaining",
  });

  const [row] = await sql<{ due_on: string; renewals_used: number }[]>`
    select due_on::text as due_on, renewals_used from loans where id = ${loanId}
  `;
  expect(row.due_on).toBe("2026-08-28");
  expect(row.renewals_used).toBe(1);
});

test("a shelf that allows more renewals allows more", async () => {
  // Pins that the refusal above came from the *setting* and not from a
  // hard-coded 1 — the same defect `renewal_days` is guarded against above.
  const { shelf, reader, loanId } = await lentOut(sql);
  await sql`
    update bookshelves
       set settings = settings || '{"max_renewals": 2}'::jsonb
     where id = ${shelf.id}
  `;
  const ctx = readerContext(shelf.id, reader);

  await runCommand(sql, ctx, renewLoan, { loanId });
  const second = await runCommand(sql, ctx, renewLoan, { loanId });

  expect(second.renewalsUsed).toBe(2);
  expect(second.dueOn).toBe("2026-09-04"); // 21st + 7 + 7
});

test("somebody queued for the title blocks the renewal", async () => {
  const { shelf, ctx: managerCtx, bookId, reader, loanId } = await lentOut(sql);

  // A second reader joins the queue for the same title, through the real
  // command rather than an insert, so the row is exactly what the product
  // writes.
  const waiting = await makeMember(sql, shelf.id);
  await runCommand(
    sql,
    {
      ...managerCtx,
      actor: {
        ...managerCtx.actor,
        userId: waiting.userId,
        membershipId: waiting.id,
        role: "reader",
      },
    },
    createBorrowRequest,
    { bookId, membershipId: waiting.id },
  );

  await expect(
    runCommand(sql, readerContext(shelf.id, reader), renewLoan, { loanId }),
  ).rejects.toMatchObject({ code: "title_has_queue" });
});

test("the queue is checked on the title, not on the copy", async () => {
  // The defect this catches: `where copy_id = <the loan's copy>` instead of
  // `where book_id = <the loan's book>`. A queued request names a *book* and no
  // copy until it is approved, so the copy-keyed version matches nothing, the
  // renewal sails through, and INV-6's second half never fires once — while
  // the test above still passes if it happens to queue against the same copy.
  //
  // Here the shelf has two copies of the title. The reader holds one; the
  // request is for the title. A copy-keyed check sees no request against the
  // copy that is out and lets the renewal through.
  const { shelf, ctx: managerCtx, reader } = await lentOut(sql);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 2);

  const { lendCopy } =
    await import("../../src/domain/circulation/commands/lend-copy");
  const { loanId } = await runCommand(sql, managerCtx, lendCopy, {
    copyId: copyIds[0],
    membershipId: reader.id,
  });

  const waiting = await makeMember(sql, shelf.id);
  await runCommand(
    sql,
    {
      ...managerCtx,
      actor: {
        ...managerCtx.actor,
        userId: waiting.userId,
        membershipId: waiting.id,
        role: "reader",
      },
    },
    createBorrowRequest,
    { bookId, membershipId: waiting.id },
  );

  // The request names the *book* and no copy — which is precisely why a
  // copy-keyed check would not see it.
  const [queued] = await sql<{ copy_id: string | null }[]>`
    select copy_id from borrow_requests where book_id = ${bookId}
  `;
  expect(queued.copy_id).toBeNull();

  await expect(
    runCommand(sql, readerContext(shelf.id, reader), renewLoan, { loanId }),
  ).rejects.toMatchObject({ code: "title_has_queue" });
});

test("a queue for a different title does not block", async () => {
  // The other direction, and the reason it is worth its own test: a check that
  // forgot its `book_id` predicate entirely — `select id from borrow_requests
  // where status = 'pending'` — passes every test above and refuses every
  // renewal on a shelf where anybody is waiting for anything.
  const { shelf, ctx: managerCtx, reader, loanId } = await lentOut(sql);
  const { bookId: otherBook } = await makeBookWithCopies(sql, shelf.id, 1);

  const waiting = await makeMember(sql, shelf.id);
  await runCommand(
    sql,
    {
      ...managerCtx,
      actor: {
        ...managerCtx.actor,
        userId: waiting.userId,
        membershipId: waiting.id,
        role: "reader",
      },
    },
    createBorrowRequest,
    { bookId: otherBook, membershipId: waiting.id },
  );

  const { dueOn } = await runCommand(
    sql,
    readerContext(shelf.id, reader),
    renewLoan,
    { loanId },
  );
  expect(dueOn).toBe("2026-08-28");
});

test("Q4: a suspended reader may still renew", async () => {
  // OPS §4.2 records this as an open question and takes the permissive reading:
  // INV-4 blocks *new* loans and explicitly protects existing ones, and a
  // renewal extends an existing loan. This test exists so that reading is
  // pinned rather than incidental — if the product owner chooses the stricter
  // one, this is the test that fails and names the decision, instead of the
  // behaviour changing quietly under a `memberMayBorrow` call added for tidiness.
  const { shelf, reader, loanId } = await lentOut(sql);
  await sql`update memberships set status = 'suspended' where id = ${reader.id}`;

  const { dueOn } = await runCommand(
    sql,
    readerContext(shelf.id, reader),
    renewLoan,
    { loanId },
  );
  expect(dueOn).toBe("2026-08-28");
});

test("a reader cannot renew somebody else's loan", async () => {
  // `borrower_id` is a `users(id)`, so this is the one place a membership id
  // would compare unequal *by accident* and refuse everybody — which would look
  // like the rule working. The positive tests above are what stop that reading.
  const { shelf, loanId } = await lentOut(sql);
  const stranger = await makeMember(sql, shelf.id);

  await expect(
    runCommand(sql, readerContext(shelf.id, stranger), renewLoan, { loanId }),
  ).rejects.toMatchObject({ code: "loan_not_active" });
});

test("a returned loan cannot be renewed", async () => {
  // Returned through the real command rather than by setting `status` directly
  // — `loans_returned_has_condition` refuses the raw update, which is the
  // constraint doing its job and a reminder that a fixture which fights the
  // schema is describing a state the product cannot produce.
  const { shelf, ctx: managerCtx, reader, loanId } = await lentOut(sql);
  await runCommand(sql, managerCtx, receiveReturn, {
    loanId,
    condition: "slightly_worn",
  });

  await expect(
    runCommand(sql, readerContext(shelf.id, reader), renewLoan, { loanId }),
  ).rejects.toMatchObject({ code: "loan_not_active" });
});

test("the renewal is audited, with both dates", async () => {
  // INV-8. `before`/`after` carry the old and new due dates rather than the
  // sentence carrying them: BR §14 puts stored values behind the expansion.
  const { shelf, reader, loanId } = await lentOut(sql);
  await runCommand(sql, readerContext(shelf.id, reader), renewLoan, { loanId });

  const [entry] = await sql<
    { action: string; actor_id: string; before: unknown; after: unknown }[]
  >`
    select action, actor_id, before, after
      from audit_log where action = 'loan.renewed'
  `;
  expect(entry.actor_id).toBe(reader.userId);
  expect(entry.before).toMatchObject({ due_on: "2026-08-21", renewals_used: 0 });
  expect(entry.after).toMatchObject({ due_on: "2026-08-28", renewals_used: 1 });
});
