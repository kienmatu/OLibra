import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../../src/db/migrate";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { RuleViolated } from "../../../src/domain/kernel/errors";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runQuery } from "../../../src/domain/kernel/unit-of-work";
import { listTitlesForLabels } from "../../../src/domain/catalogue/queries/list-titles-for-labels";
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

async function onTheShelf(copies = 3) {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, copies);
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  return { shelf, ctx, bookId, copyIds };
}

const titles = (ctx: TenantContext, onlyUnprinted: boolean) =>
  runQuery(sql, ctx, (tx, scoped) =>
    listTitlesForLabels(tx, scoped, { onlyUnprinted }),
  );

test("groups every copy under its own title, in code order", async () => {
  const { ctx, bookId, copyIds } = await onTheShelf(3);

  const found = await titles(ctx, false);

  expect(found).toHaveLength(1);
  expect(found[0].bookId).toBe(bookId);
  expect(found[0].copies).toHaveLength(3);
  expect(found[0].copies.map((c) => c.id).sort()).toEqual([...copyIds].sort());
  expect(found[0].copies.map((c) => c.code)).toEqual(
    [...found[0].copies.map((c) => c.code)].sort(),
  );
});

/**
 * The reason the grouping happens in the query rather than on the page: a title
 * whose every copy is printed must disappear entirely, not render as an
 * accordion row that opens onto nothing.
 */
test("drops a title whose every copy is already printed", async () => {
  const { ctx } = await onTheShelf(2);
  await sql`update book_copies set qr_print_count = 1`;

  expect(await titles(ctx, true)).toEqual([]);
  expect(await titles(ctx, false)).toHaveLength(1);
});

test("keeps a title with one unprinted copy, listing only that copy", async () => {
  const { ctx, copyIds } = await onTheShelf(3);
  await sql`
    update book_copies set qr_print_count = 1 where id <> ${copyIds[1]}
  `;

  const found = await titles(ctx, true);

  expect(found).toHaveLength(1);
  expect(found[0].copies.map((c) => c.id)).toEqual([copyIds[1]]);
});

test("reports each copy's print count", async () => {
  const { ctx, copyIds } = await onTheShelf(1);
  await sql`update book_copies set qr_print_count = 3 where id = ${copyIds[0]}`;

  expect((await titles(ctx, false))[0].copies[0].printCount).toBe(3);
});

test("omits a soft-deleted copy and the title it leaves empty", async () => {
  const { ctx } = await onTheShelf(1);
  await sql`update book_copies set deleted_at = now()`;

  expect(await titles(ctx, false)).toEqual([]);
});

test("shows nothing from another shelf", async () => {
  const { ctx } = await onTheShelf(1);
  const other = await makeShelf(sql, { slug: "kien-giang" });
  await makeBookWithCopies(sql, other.id, 2);

  expect(await titles(ctx, false)).toHaveLength(1);
});

test("refuses a reader", async () => {
  const { shelf } = await onTheShelf(1);
  const reader = await makeMember(sql, shelf.id);
  const readerCtx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
    clock,
  };

  await expect(titles(readerCtx, false)).rejects.toThrow(RuleViolated);
});
