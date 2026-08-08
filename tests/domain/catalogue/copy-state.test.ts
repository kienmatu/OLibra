import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import {
  NotFound,
  RuleViolated,
  ValidationFailed,
} from "../../../src/domain/kernel/errors";
import { runCommand } from "../../../src/domain/kernel/unit-of-work";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { assessCondition } from "../../../src/domain/catalogue/commands/assess-condition";
import { reportCopyLost } from "../../../src/domain/catalogue/commands/report-copy-lost";
import { markCopyFound } from "../../../src/domain/catalogue/commands/mark-copy-found";
import { retireCopy } from "../../../src/domain/catalogue/commands/retire-copy";
import { migrate } from "../../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-08T03:00:00Z");

// `slug` defaults to "dong-thap" but is overridable, mirroring
// `create-book.test.ts`'s `shelfWithManager` — a test that stands up two
// shelves at once must pass distinct slugs, since `bookshelves_slug_unique`
// is a plain, shelf-independent unique index.
async function onTheShelf(copies = 2, slug = "dong-thap") {
  const shelf = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, copies);
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  return { shelf, manager, ctx, bookId, copyIds };
}

async function lendOut(
  shelfId: string,
  bookId: string,
  copyId: string,
  lentBy: string,
) {
  const borrower = await makeMember(sql, shelfId);
  const [loan] = await sql<{ id: string }[]>`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on)
    values (${shelfId}, ${copyId}, ${bookId}, ${borrower.userId}, ${lentBy}, date '2026-08-22')
    returning id
  `;
  await sql`update book_copies set state = 'on_loan' where id = ${copyId}`;
  return loan.id;
}

const stateOf = async (copyId: string) =>
  (
    await sql<
      { state: string }[]
    >`select state from book_copies where id = ${copyId}`
  )[0].state;

// — AssessCondition —

test("a manager may assess a copy at any time, not only at return", async () => {
  // BR §5.4, and why ConditionAssessment is its own table rather than columns
  // on the loan. The copy is available and there is no loan in sight.
  const { ctx, copyIds } = await onTheShelf();

  const { assessmentId } = await runCommand(sql, ctx, assessCondition, {
    copyId: copyIds[0],
    condition: "torn",
    note: "Bìa bị rách góc dưới",
  });

  const [row] = await sql<
    {
      condition: string;
      note: string;
      loan_id: string | null;
      assessed_by: string;
    }[]
  >`select condition, note, loan_id, assessed_by from condition_assessments where id = ${assessmentId}`;
  expect(row.condition).toBe("torn");
  expect(row.loan_id).toBeNull();
  expect(row.assessed_by).toBe(ctx.actor.userId);

  // The current condition moves with it; the assessment is the history.
  const [copy] = await sql<
    { condition: string; condition_note: string; state: string }[]
  >`
    select condition, condition_note, state from book_copies where id = ${copyIds[0]}
  `;
  expect(copy.condition).toBe("torn");
  expect(copy.condition_note).toBe("Bìa bị rách góc dưới");
  // A condition is not a state (BR §9). Assessing does not move the copy.
  expect(copy.state).toBe("available");
});

test("assessing writes copy.condition_assessed with before and after", async () => {
  const { ctx, copyIds } = await onTheShelf();
  await runCommand(sql, ctx, assessCondition, {
    copyId: copyIds[0],
    condition: "worn",
  });

  const [entry] = await sql<
    {
      action: string;
      before: { condition: string };
      after: { condition: string };
    }[]
  >`select action, before, after from audit_log where action = 'copy.condition_assessed'`;
  expect(entry.before.condition).toBe("perfect");
  expect(entry.after.condition).toBe("worn");
});

test("a condition outside BR §9's six is a named validation failure, not a driver error", async () => {
  // Without this check the enum cast raises PostgresError 22P02 from inside
  // the transaction — a raw failure at the kernel boundary, which OPS §2
  // forbids.
  const { ctx, copyIds } = await onTheShelf();
  await expect(
    runCommand(sql, ctx, assessCondition, {
      copyId: copyIds[0],
      condition: "lost" as never,
    }),
  ).rejects.toBeInstanceOf(ValidationFailed);
});

test("assessing an unknown copy is copy_not_found", async () => {
  const { ctx } = await onTheShelf();
  await expect(
    runCommand(sql, ctx, assessCondition, {
      copyId: "00000000-0000-0000-0000-000000000000",
      condition: "worn",
    }),
  ).rejects.toMatchObject({ code: "copy_not_found" });
});

// — ReportCopyLost —

test("reporting an on-loan copy lost closes its loan in the same transaction", async () => {
  // OPS §4.1: "if the copy has an active loan, that loan is closed out
  // (loan.status = lost, not left dangling as active)".
  const { ctx, shelf, manager, bookId, copyIds } = await onTheShelf();
  const loanId = await lendOut(shelf.id, bookId, copyIds[0], manager.userId);

  await runCommand(sql, ctx, reportCopyLost, {
    copyId: copyIds[0],
    note: "Cháu để quên ở lớp",
  });

  expect(await stateOf(copyIds[0])).toBe("lost");
  const [copy] = await sql<{ lost_reported_at: Date | null }[]>`
    select lost_reported_at from book_copies where id = ${copyIds[0]}
  `;
  expect(copy.lost_reported_at).not.toBeNull();

  const [loan] = await sql<
    { status: string; lost_reported_by: string | null }[]
  >`select status, lost_reported_by from loans where id = ${loanId}`;
  expect(loan.status).toBe("lost");
  expect(loan.lost_reported_by).toBe(ctx.actor.userId);
});

test("two audit entries, because two things changed state", async () => {
  // INV-8: "every state transition writes an audit record". OPS §4.1 names
  // copy.lost_reported; the loan's own transition earns its own row.
  const { ctx, shelf, manager, bookId, copyIds } = await onTheShelf();
  await lendOut(shelf.id, bookId, copyIds[0], manager.userId);

  await runCommand(sql, ctx, reportCopyLost, { copyId: copyIds[0] });

  const actions = await sql<
    { action: string }[]
  >`select action from audit_log order by id`;
  expect(actions.map((a) => a.action)).toEqual(["copy.lost_reported", "loan.lost"]);
});

test("Q3: an available copy cannot be reported lost", async () => {
  // The decision this plan records. BR §7.1 draws only on_loan → lost; the
  // manager screen's "Báo mất" on every row is an unwired fixture, and E must
  // hide it on any row that is not on_loan.
  const { ctx, copyIds } = await onTheShelf();

  await expect(
    runCommand(sql, ctx, reportCopyLost, { copyId: copyIds[0] }),
  ).rejects.toMatchObject({ code: "copy_not_on_loan" });
  expect(await stateOf(copyIds[0])).toBe("available");
});

test("an already-lost or already-retired copy says which, not just no", async () => {
  const { ctx, shelf, manager, bookId, copyIds } = await onTheShelf(2);
  await lendOut(shelf.id, bookId, copyIds[0], manager.userId);
  await runCommand(sql, ctx, reportCopyLost, { copyId: copyIds[0] });
  await runCommand(sql, ctx, retireCopy, { copyId: copyIds[1], reason: "Mục nát" });

  await expect(
    runCommand(sql, ctx, reportCopyLost, { copyId: copyIds[0] }),
  ).rejects.toMatchObject({ code: "already_lost" });
  await expect(
    runCommand(sql, ctx, reportCopyLost, { copyId: copyIds[1] }),
  ).rejects.toMatchObject({ code: "already_retired" });
});

// — MarkCopyFound —

test("a lost copy that turns up goes back to available", async () => {
  // BR §3 lists "a book reported lost is found months later" as a case the
  // system must handle, and BR §16.3 built the Sách đã mất screen for it.
  const { ctx, shelf, manager, bookId, copyIds } = await onTheShelf();
  await lendOut(shelf.id, bookId, copyIds[0], manager.userId);
  await runCommand(sql, ctx, reportCopyLost, { copyId: copyIds[0] });

  await runCommand(sql, ctx, markCopyFound, {
    copyId: copyIds[0],
    note: "Tìm thấy ở nhà xứ",
  });

  expect(await stateOf(copyIds[0])).toBe("available");
  const [copy] = await sql<{ lost_reported_at: Date | null }[]>`
    select lost_reported_at from book_copies where id = ${copyIds[0]}
  `;
  // Cleared, so the copy is not still described as reported-lost on a screen
  // that reads that column.
  expect(copy.lost_reported_at).toBeNull();
  const [entry] = await sql<{ action: string }[]>`
    select action from audit_log where action = 'copy.found'
  `;
  expect(entry.action).toBe("copy.found");
});

test("marking a copy found when it is not lost says so", async () => {
  const { ctx, copyIds } = await onTheShelf();
  await expect(
    runCommand(sql, ctx, markCopyFound, { copyId: copyIds[0] }),
  ).rejects.toMatchObject({ code: "not_lost" });
});

test("the loan a found copy came from is not reopened", async () => {
  // BR §7.1 draws lost → available for the *copy*. The loan's own machine
  // (BR §7.3) has no arrow out of lost, and INV-11 forbids deleting it. What
  // happened, happened.
  const { ctx, shelf, manager, bookId, copyIds } = await onTheShelf();
  const loanId = await lendOut(shelf.id, bookId, copyIds[0], manager.userId);
  await runCommand(sql, ctx, reportCopyLost, { copyId: copyIds[0] });
  await runCommand(sql, ctx, markCopyFound, { copyId: copyIds[0] });

  const [loan] = await sql<
    { status: string }[]
  >`select status from loans where id = ${loanId}`;
  expect(loan.status).toBe("lost");
});

// — RetireCopy —

test("retiring records the reason the constraint requires", async () => {
  const { ctx, copyIds } = await onTheShelf();
  await runCommand(sql, ctx, retireCopy, {
    copyId: copyIds[0],
    reason: "Mục nát, không đọc được",
  });

  const [copy] = await sql<
    { state: string; retired_reason: string; retired_at: Date | null }[]
  >`select state, retired_reason, retired_at from book_copies where id = ${copyIds[0]}`;
  expect(copy.state).toBe("retired");
  expect(copy.retired_reason).toBe("Mục nát, không đọc được");
  expect(copy.retired_at).not.toBeNull();
});

test("retiring with no reason is a named failure, not a check-constraint violation", async () => {
  // book_copies_retired_has_reason would raise 23514 from inside the
  // transaction otherwise — the unstructured failure OPS §2 forbids. The
  // sentence is its own, because the shipped `reason_required` says "lý do
  // huỷ" — a cancellation, which this is not.
  const { ctx, copyIds } = await onTheShelf();
  await expect(
    runCommand(sql, ctx, retireCopy, { copyId: copyIds[0], reason: "   " }),
  ).rejects.toMatchObject({ code: "retire_reason_required" });
});

test("a copy on loan cannot be retired, and is told what to do instead", async () => {
  // Master §7.1's acceptance criterion, and BR §7.1's own note: "A copy that is
  // on_loan cannot be retired directly; it must first be returned or reported
  // lost."
  const { ctx, shelf, manager, bookId, copyIds } = await onTheShelf();
  await lendOut(shelf.id, bookId, copyIds[0], manager.userId);

  await expect(
    runCommand(sql, ctx, retireCopy, { copyId: copyIds[0], reason: "Mục nát" }),
  ).rejects.toMatchObject({ code: "copy_on_loan" });
  expect(await stateOf(copyIds[0])).toBe("on_loan");
});

test("a lost copy may be written off; a held one may not", async () => {
  const { ctx, shelf, manager, bookId, copyIds } = await onTheShelf(2);
  await lendOut(shelf.id, bookId, copyIds[0], manager.userId);
  await runCommand(sql, ctx, reportCopyLost, { copyId: copyIds[0] });
  await runCommand(sql, ctx, retireCopy, {
    copyId: copyIds[0],
    reason: "Chắc chắn không quay lại",
  });
  expect(await stateOf(copyIds[0])).toBe("retired");

  await sql`update book_copies set state = 'held' where id = ${copyIds[1]}`;
  await expect(
    runCommand(sql, ctx, retireCopy, { copyId: copyIds[1], reason: "x" }),
  ).rejects.toMatchObject({ code: "copy_not_available" });
});

test("none of the four is reachable across a shelf boundary", async () => {
  // G4. RLS filters the copy lookup to zero rows, and each command turns that
  // into copy_not_found rather than a silent success.
  const a = await onTheShelf(2, "dong-thap");
  const b = await onTheShelf(2, "can-tho");

  await expect(
    runCommand(sql, a.ctx, retireCopy, { copyId: b.copyIds[0], reason: "x" }),
  ).rejects.toBeInstanceOf(NotFound);
  await expect(
    runCommand(sql, a.ctx, assessCondition, {
      copyId: b.copyIds[0],
      condition: "worn",
    }),
  ).rejects.toBeInstanceOf(NotFound);
  expect(await stateOf(b.copyIds[0])).toBe("available");
  expect(await sql`select 1 from audit_log`).toHaveLength(0);
});

test("a reader may not touch any of them", async () => {
  const { ctx, shelf, copyIds } = await onTheShelf();
  const reader = await makeMember(sql, shelf.id);
  const readerCtx: TenantContext = {
    ...ctx,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
  };
  await expect(
    runCommand(sql, readerCtx, retireCopy, { copyId: copyIds[0], reason: "x" }),
  ).rejects.toBeInstanceOf(RuleViolated);
});
