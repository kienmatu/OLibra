import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../../src/db/migrate";
import { createBorrowRequest } from "../../../src/domain/circulation/commands/create-borrow-request";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { NotFound } from "../../../src/domain/kernel/errors";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runCommand } from "../../../src/domain/kernel/unit-of-work";
import { makeBookWithCopies, makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const AT = "2026-08-13T10:00:00Z";

/**
 * BR §19: a reader scans the sticker on a book they are holding, and the
 * request records *that copy*, not merely the title. The manager then knows
 * which physical object is in the child's hands.
 */
async function shelf(slug = "dong-thap") {
  const s = await makeShelf(sql, { slug });
  await makeMember(sql, s.id, { role: "manager" });
  const { bookId, copyIds } = await makeBookWithCopies(sql, s.id, 2);
  const reader = await makeMember(sql, s.id);
  const ctx: TenantContext = {
    bookshelfId: s.id,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
    clock: fixedClock(AT),
  };
  return { s, bookId, copyIds, reader, ctx };
}

const copyIdOf = async (requestId: string) =>
  (
    await sql<{ copy_id: string | null }[]>`
      select copy_id from borrow_requests where id = ${requestId}
    `
  )[0].copy_id;

test("records the scanned copy alongside the title", async () => {
  const { bookId, copyIds, reader, ctx } = await shelf();

  const { requestId } = await runCommand(sql, ctx, createBorrowRequest, {
    bookId,
    membershipId: reader.id,
    copyId: copyIds[0],
  });

  expect(await copyIdOf(requestId)).toBe(copyIds[0]);
});

/**
 * The title-level "Xin mượn" predates the scanner and is unchanged: a request
 * about a title, with no copy named, stays exactly that.
 */
test("leaves copy_id null when no copy was scanned", async () => {
  const { bookId, reader, ctx } = await shelf();

  const { requestId } = await runCommand(sql, ctx, createBorrowRequest, {
    bookId,
    membershipId: reader.id,
  });

  expect(await copyIdOf(requestId)).toBeNull();
});

test("names the copy in the audit entry, and null when there was none", async () => {
  const { bookId, copyIds, reader, ctx } = await shelf();

  await runCommand(sql, ctx, createBorrowRequest, {
    bookId,
    membershipId: reader.id,
    copyId: copyIds[1],
  });

  const [entry] = await sql<{ after: { copy_id: string | null } }[]>`
    select after from audit_log where action = 'request.created'
  `;
  expect(entry.after.copy_id).toBe(copyIds[1]);
});

/**
 * The contradiction this guard exists to prevent: a queue row saying a reader
 * wants DT-0142 of one title, when DT-0142 is a copy of another. Nothing but a
 * manager untangling it by hand fixes that after the fact.
 */
test("refuses a copy belonging to a different title", async () => {
  const { s, bookId, reader, ctx } = await shelf();
  const other = await makeBookWithCopies(sql, s.id, 1);

  await expect(
    runCommand(sql, ctx, createBorrowRequest, {
      bookId,
      membershipId: reader.id,
      copyId: other.copyIds[0],
    }),
  ).rejects.toThrow(NotFound);
});

test("refuses a copy from another shelf", async () => {
  const { bookId, reader, ctx } = await shelf();
  const elsewhere = await makeShelf(sql, { slug: "kien-giang" });
  const { copyIds } = await makeBookWithCopies(sql, elsewhere.id, 1);

  await expect(
    runCommand(sql, ctx, createBorrowRequest, {
      bookId,
      membershipId: reader.id,
      copyId: copyIds[0],
    }),
  ).rejects.toThrow(NotFound);
});

test("refuses a copy soft-deleted since its label was printed", async () => {
  const { bookId, copyIds, reader, ctx } = await shelf();
  await sql`update book_copies set deleted_at = now() where id = ${copyIds[0]}`;

  await expect(
    runCommand(sql, ctx, createBorrowRequest, {
      bookId,
      membershipId: reader.id,
      copyId: copyIds[0],
    }),
  ).rejects.toThrow(NotFound);
});
