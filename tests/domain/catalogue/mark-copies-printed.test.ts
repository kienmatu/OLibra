import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../../src/db/migrate";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { RuleViolated, ValidationFailed } from "../../../src/domain/kernel/errors";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runCommand } from "../../../src/domain/kernel/unit-of-work";
import { markCopiesPrinted } from "../../../src/domain/catalogue/commands/mark-copies-printed";
import { makeBookWithCopies, makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-13T03:00:00Z");

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

const mark = (ctx: TenantContext, copyIds: string[]) =>
  runCommand(sql, ctx, markCopiesPrinted, { copyIds });

const printRow = async (copyId: string) =>
  (
    await sql<{ qr_print_count: number; qr_printed_at: Date | null }[]>`
      select qr_print_count, qr_printed_at from book_copies where id = ${copyId}
    `
  )[0];

test("stamps the time and counts the print", async () => {
  const { ctx, copyIds } = await onTheShelf(1);
  expect((await printRow(copyIds[0])).qr_print_count).toBe(0);

  const out = await mark(ctx, copyIds);

  expect(out.printed).toBe(1);
  const row = await printRow(copyIds[0]);
  expect(row.qr_print_count).toBe(1);
  expect(row.qr_printed_at).not.toBeNull();
});

/**
 * The reason `qr_print_count` exists beside `qr_printed_at`. A boolean, or a
 * timestamp read as one, cannot tell a reprint from a first print, and the
 * "Chưa in nhãn" filter is exactly that distinction.
 */
test("a reprint increments rather than resetting", async () => {
  const { ctx, copyIds } = await onTheShelf(1);

  await mark(ctx, copyIds);
  await mark(ctx, copyIds);

  expect((await printRow(copyIds[0])).qr_print_count).toBe(2);
});

test("writes one audit entry for the batch, naming the count", async () => {
  const { ctx, copyIds } = await onTheShelf(2);

  await mark(ctx, copyIds);

  const entries = await sql<{ action: string; after: { count: number } }[]>`
    select action, after from audit_log where action = 'copy.qr_printed'
  `;
  expect(entries).toHaveLength(1);
  expect(entries[0].after.count).toBe(2);
});

test("refuses an empty selection", async () => {
  const { ctx } = await onTheShelf(1);

  await expect(mark(ctx, [])).rejects.toThrow(ValidationFailed);
});

test("does not mark a copy on another shelf, and says so in the count", async () => {
  const { ctx } = await onTheShelf(1);
  const other = await makeShelf(sql, { slug: "kien-giang" });
  const { copyIds: otherCopies } = await makeBookWithCopies(sql, other.id, 1);

  const out = await mark(ctx, otherCopies);

  expect(out.printed).toBe(0);
  expect((await printRow(otherCopies[0])).qr_print_count).toBe(0);
});

test("skips a copy soft-deleted since the page was rendered", async () => {
  const { ctx, copyIds } = await onTheShelf(2);
  await sql`update book_copies set deleted_at = now() where id = ${copyIds[1]}`;

  const out = await mark(ctx, copyIds);

  expect(out.printed).toBe(1);
  expect((await printRow(copyIds[1])).qr_print_count).toBe(0);
});

test("refuses a reader", async () => {
  const { shelf, copyIds } = await onTheShelf(1);
  const reader = await makeMember(sql, shelf.id);
  const readerCtx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
    clock,
  };

  await expect(mark(readerCtx, copyIds)).rejects.toThrow(RuleViolated);
});
