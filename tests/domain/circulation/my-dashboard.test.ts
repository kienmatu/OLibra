import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runCommand, runQuery } from "../../../src/domain/kernel/unit-of-work";
import {
  getMyDashboard,
  getMyLoanHistory,
} from "../../../src/domain/circulation/queries/get-my-dashboard";
import { renewLoan } from "../../../src/domain/circulation/commands/renew-loan";
import { createBorrowRequest } from "../../../src/domain/circulation/commands/create-borrow-request";
import { receiveReturn } from "../../../src/domain/circulation/commands/receive-return";
import { migrate } from "../../../src/db/migrate";
import { makeBookWithCopies, makeMember } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";
import { SCENARIO_CLOCK, lentOut } from "../../support/scenarios";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const LATE = "2026-09-10T10:00:00Z";

/**
 * The `ErrorCode` `renewLoan` actually throws for this loan.
 *
 * The expected value in the agreement tests comes from here rather than from a
 * literal, so the query and the command cannot drift apart without the test
 * noticing — which is the whole point of the rule C1's review established.
 */
async function codeThrownBy(
  ctx: TenantContext,
  loanId: string,
): Promise<string | undefined> {
  try {
    await runCommand(sql, ctx, renewLoan, { loanId });
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

function readerContext(
  bookshelfId: string,
  reader: { id: string; userId: string },
  instant = SCENARIO_CLOCK,
): TenantContext {
  return {
    bookshelfId,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
    clock: fixedClock(instant),
  };
}

test("a reader sees their own loan with days remaining from the view", async () => {
  const { shelf, reader, loanId } = await lentOut(sql);
  const rctx = readerContext(shelf.id, reader);

  const { loans } = await runQuery(sql, rctx, getMyDashboard);
  expect(loans).toHaveLength(1);
  expect(loans[0].loanId).toBe(loanId);
  expect(loans[0].dueOn).toBe("2026-08-21");
  expect(loans[0].isOverdue).toBe(false);
  expect(loans[0].daysRemaining).toBe(14);
});

test("overdue and days remaining follow the clock, with no write", async () => {
  // G5. The screen where recomputing from `due_on` is most tempting, so this is
  // the assertion that stops it: the numbers move because `loans_current`
  // derives them from `olibra_now()`, and nothing here has run.
  const { shelf, reader } = await lentOut(sql);

  const before = await sql`select id from audit_log`;
  const { loans } = await runQuery(
    sql,
    readerContext(shelf.id, reader, LATE),
    getMyDashboard,
  );
  expect(loans[0].isOverdue).toBe(true);
  expect(loans[0].daysRemaining).toBe(-20);
  expect(await sql`select id from audit_log`).toHaveLength(before.length);
});

test("the renew refusal is the code renewLoan throws — not a literal", async () => {
  // The rule C1's review established after finding a query and a command
  // disagreeing. The expected value is taken from the *thrown* error, so the
  // two cannot drift apart without this failing.
  const { shelf, reader, loanId } = await lentOut(sql);
  const rctx = readerContext(shelf.id, reader);

  // Exhaust the single default renewal.
  await runCommand(sql, rctx, renewLoan, { loanId });

  const thrown = await codeThrownBy(rctx, loanId);
  const { loans } = await runQuery(sql, rctx, getMyDashboard);

  expect(loans[0].renewBlockedBy).toBe(thrown);
  expect(loans[0].renewBlockedBy).toBe("no_renewals_remaining");
});

test("somebody queued for the title blocks renewal, and the screen says which", async () => {
  const { shelf, ctx, bookId, reader, loanId } = await lentOut(sql);
  const rctx = readerContext(shelf.id, reader);

  expect(
    (await runQuery(sql, rctx, getMyDashboard)).loans[0].renewBlockedBy,
  ).toBeNull();

  const waiting = await makeMember(sql, shelf.id);
  await runCommand(
    sql,
    {
      ...ctx,
      actor: {
        ...ctx.actor,
        userId: waiting.userId,
        membershipId: waiting.id,
        role: "reader",
      },
    },
    createBorrowRequest,
    { bookId, membershipId: waiting.id },
  );

  const thrown = await codeThrownBy(rctx, loanId);
  const { loans } = await runQuery(sql, rctx, getMyDashboard);
  expect(loans[0].renewBlockedBy).toBe(thrown);
  expect(loans[0].renewBlockedBy).toBe("title_has_queue");
});

test("renewing from the dashboard moves the date the dashboard shows", async () => {
  const { shelf, reader, loanId } = await lentOut(sql);
  const rctx = readerContext(shelf.id, reader);

  await runCommand(sql, rctx, renewLoan, { loanId });

  const { loans } = await runQuery(sql, rctx, getMyDashboard);
  expect(loans[0].dueOn).toBe("2026-08-28");
  expect(loans[0].renewalsUsed).toBe(1);
});

test("queue position is derived, and moves when somebody ahead is served", async () => {
  const { shelf, ctx, bookId } = await lentOut(sql);
  const first = await makeMember(sql, shelf.id);
  const second = await makeMember(sql, shelf.id);

  // **Two different instants, and that is not incidental.**
  // `createBorrowRequest` writes `requested_at` from `ctx.clock`, so two
  // requests made under the *same* fixed clock tie exactly and the queue order
  // falls to the `id` tiebreak — a random uuid. The tuple comparison is still a
  // total order, so the query is right either way, but a fixture that ties
  // makes this test a coin flip: it passed in isolation and failed in the full
  // suite. Real requests are minutes apart; the fixture should be too. Same
  // degenerate-fixture trap U3's review found in two tiebreak tests.
  const asReader = (m: { id: string; userId: string }, instant: string) => ({
    ...ctx,
    actor: {
      ...ctx.actor,
      userId: m.userId,
      membershipId: m.id,
      role: "reader" as const,
    },
    clock: fixedClock(instant),
  });

  const a = await runCommand(
    sql,
    asReader(first, "2026-08-07T10:00:00Z"),
    createBorrowRequest,
    { bookId, membershipId: first.id },
  );
  await runCommand(
    sql,
    asReader(second, "2026-08-07T11:00:00Z"),
    createBorrowRequest,
    { bookId, membershipId: second.id },
  );

  expect(
    (await runQuery(sql, readerContext(shelf.id, second), getMyDashboard))
      .requests[0].queuePosition,
  ).toBe(2);

  // The person in front is served — no column changes, the count simply finds
  // one fewer pending request ahead.
  await sql`
    update borrow_requests set status = 'rejected' where id = ${a.requestId}
  `;

  expect(
    (await runQuery(sql, readerContext(shelf.id, second), getMyDashboard))
      .requests[0].queuePosition,
  ).toBe(1);
});

test("a reader sees only their own loans and requests", async () => {
  // Cross-*reader*, not just cross-shelf: RLS scopes the shelf, and both of
  // these readers are in it. What keeps them apart is the `borrower_id` and
  // `member_id` predicates, which is the thing a same-shelf test can check and
  // an INV-10 test cannot.
  const { shelf, ctx, reader } = await lentOut(sql);
  const other = await makeMember(sql, shelf.id);
  const { bookId: otherBook, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const { lendCopy } =
    await import("../../../src/domain/circulation/commands/lend-copy");
  await runCommand(sql, ctx, lendCopy, {
    copyId: copyIds[0],
    membershipId: other.id,
  });
  expect(otherBook).toBeTruthy();

  const mine = await runQuery(sql, readerContext(shelf.id, reader), getMyDashboard);
  expect(mine.loans).toHaveLength(1);
  const theirs = await runQuery(
    sql,
    readerContext(shelf.id, other),
    getMyDashboard,
  );
  expect(theirs.loans).toHaveLength(1);
  expect(mine.loans[0].loanId).not.toBe(theirs.loans[0].loanId);
});

test("history keeps a returned loan and says how it came back", async () => {
  const { shelf, ctx, reader, loanId } = await lentOut(sql);
  await runCommand(sql, ctx, receiveReturn, { loanId, condition: "slightly_worn" });

  const rctx = readerContext(shelf.id, reader);
  const history = await runQuery(sql, rctx, (tx, c) => getMyLoanHistory(tx, c));
  expect(history).toHaveLength(1);
  expect(history[0].status).toBe("returned");
  expect(history[0].returnCondition).toBe("slightly_worn");
  expect(history[0].returnedOn).not.toBeNull();

  // And it leaves the dashboard, which shows what is *out*.
  expect((await runQuery(sql, rctx, getMyDashboard)).loans).toEqual([]);
});
