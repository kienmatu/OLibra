import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../../src/db/migrate";
import { fixedClock } from "../../../src/domain/kernel/clock";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runQuery } from "../../../src/domain/kernel/unit-of-work";
import { resolveCopyById } from "../../../src/domain/catalogue/queries/resolve-copy-by-id";
import { payloadFor, uuidFromPayload } from "../../../src/lib/qr";
import { makeBookWithCopies, makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-13T03:00:00Z");

async function onTheShelf(role: "manager" | "reader" = "manager") {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const member = await makeMember(sql, shelf.id, { role });
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: member.userId, membershipId: member.id, role },
    clock,
  };
  return { shelf, ctx, bookId, copyId: copyIds[0] };
}

const resolve = (ctx: TenantContext, copyId: string) =>
  runQuery(sql, ctx, (tx, scoped) => resolveCopyById(tx, scoped, copyId));

test("resolves a copy on this shelf", async () => {
  const { ctx, copyId, bookId } = await onTheShelf();

  const found = await resolve(ctx, copyId);

  expect(found?.id).toBe(copyId);
  expect(found?.bookId).toBe(bookId);
  expect(found?.state).toBe("available");
  expect(found?.code).toMatch(/^DT-/);
  expect(found?.bookSlug).toMatch(/^sach-/);
});

/**
 * The whole point of the reader-facing half: a child scanning a sticker is not
 * a manager, and this read must serve them.
 */
test("serves a reader, not only a manager", async () => {
  const { ctx, copyId } = await onTheShelf("reader");

  expect((await resolve(ctx, copyId))?.id).toBe(copyId);
});

test("answers null for a copy on another shelf", async () => {
  const { ctx } = await onTheShelf();
  const other = await makeShelf(sql, { slug: "kien-giang" });
  const { copyIds } = await makeBookWithCopies(sql, other.id, 1);

  expect(await resolve(ctx, copyIds[0])).toBeNull();
});

test("answers null for a soft-deleted copy", async () => {
  const { ctx, copyId } = await onTheShelf();
  await sql`update book_copies set deleted_at = now() where id = ${copyId}`;

  expect(await resolve(ctx, copyId)).toBeNull();
});

test("answers null for a uuid naming nothing", async () => {
  const { ctx } = await onTheShelf();

  expect(await resolve(ctx, "00000000-0000-4000-a000-000000000000")).toBeNull();
});

/**
 * The seam between the codec and the domain, exercised end to end: what a
 * scanner would read off a printed sticker resolves to the copy that sticker
 * was printed for.
 */
test("resolves the uuid decoded from that copy's own printed payload", async () => {
  const { ctx, copyId } = await onTheShelf();

  const decoded = uuidFromPayload(payloadFor(copyId));

  expect(decoded).toBe(copyId);
  expect((await resolve(ctx, decoded!))?.id).toBe(copyId);
});
