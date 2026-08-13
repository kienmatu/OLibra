import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../../src/db/migrate";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { RuleViolated } from "../../../src/domain/kernel/errors";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runQuery } from "../../../src/domain/kernel/unit-of-work";
import { listCopiesForLabels } from "../../../src/domain/catalogue/queries/list-copies-for-labels";
import {
  makeBookWithCopies,
  makeMember,
  makeShelf,
} from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-13T03:00:00Z");

async function onTheShelf(copies = 3, slug = "dong-thap") {
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

const read = (ctx: TenantContext, input: Parameters<typeof listCopiesForLabels>[2]) =>
  runQuery(sql, ctx, (tx, scoped) => listCopiesForLabels(tx, scoped, input));

const codesOf = async (
  ctx: TenantContext,
  input: Parameters<typeof listCopiesForLabels>[2],
) => (await read(ctx, input)).map((r) => r.code);

test("returns every live copy of the named books, in code order", async () => {
  const { ctx, bookId } = await onTheShelf(3);

  const rows = await read(ctx, { bookIds: [bookId] });

  expect(rows).toHaveLength(3);
  expect(rows.map((r) => r.code)).toEqual([...rows.map((r) => r.code)].sort());
  expect(rows[0].printCount).toBe(0);
  expect(rows[0].title).toMatch(/^Sách /);
});

test("returns exactly the named copies when copyIds is given", async () => {
  const { ctx, copyIds } = await onTheShelf(3);

  const rows = await read(ctx, { copyIds: [copyIds[1]] });

  expect(rows.map((r) => r.id)).toEqual([copyIds[1]]);
});

test("unions bookIds and copyIds without listing a copy twice", async () => {
  const { ctx, bookId, copyIds } = await onTheShelf(3);

  const rows = await read(ctx, { bookIds: [bookId], copyIds: [copyIds[1]] });

  expect(rows).toHaveLength(3);
  expect(new Set(rows.map((r) => r.id)).size).toBe(3);
});

test("keeps only never-printed copies when onlyUnprinted is set", async () => {
  const { ctx, bookId, copyIds } = await onTheShelf(3);
  await sql`update book_copies set qr_print_count = 2 where id = ${copyIds[1]}`;

  const rows = await read(ctx, { bookIds: [bookId], onlyUnprinted: true });

  expect(rows.map((r) => r.id)).not.toContain(copyIds[1]);
  expect(rows).toHaveLength(2);
});

test("reports how many times each copy has already been printed", async () => {
  const { ctx, copyIds } = await onTheShelf(1);
  await sql`update book_copies set qr_print_count = 4 where id = ${copyIds[0]}`;

  const [row] = await read(ctx, { copyIds });

  expect(row.printCount).toBe(4);
});

test("omits a soft-deleted copy", async () => {
  const { ctx, bookId, copyIds } = await onTheShelf(3);
  await sql`update book_copies set deleted_at = now() where id = ${copyIds[2]}`;

  const rows = await read(ctx, { bookIds: [bookId] });

  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.id)).not.toContain(copyIds[2]);
});

/**
 * The tenancy check, and it is deliberately phrased as "another shelf's copy id
 * is simply not here" rather than as an error: RLS answers by returning no
 * rows, and a manager who mistypes is told the same thing as one who is
 * fishing.
 */
test("returns nothing for a copy belonging to another shelf", async () => {
  const { ctx } = await onTheShelf(1);
  const other = await makeShelf(sql, { slug: "kien-giang" });
  const { copyIds: otherCopies } = await makeBookWithCopies(sql, other.id, 1);

  expect(await read(ctx, { copyIds: otherCopies })).toEqual([]);
});

test("returns nothing when nothing is selected", async () => {
  const { ctx } = await onTheShelf(1);

  expect(await read(ctx, {})).toEqual([]);
  expect(await codesOf(ctx, { bookIds: [], copyIds: [] })).toEqual([]);
});

test("refuses a reader", async () => {
  const { shelf, bookId } = await onTheShelf(1);
  const reader = await makeMember(sql, shelf.id);
  const readerCtx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
    clock,
  };

  await expect(read(readerCtx, { bookIds: [bookId] })).rejects.toThrow(
    RuleViolated,
  );
});
