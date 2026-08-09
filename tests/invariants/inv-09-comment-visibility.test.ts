import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import type { TenantContext } from "../../src/domain/kernel/tenant";
import { runCommand, runQuery } from "../../src/domain/kernel/unit-of-work";
import {
  approveComment,
  createComment,
  hideComment,
  rejectComment,
} from "../../src/domain/community/commands/comment-moderation";
import {
  getBookComments,
  getPendingComments,
} from "../../src/domain/community/queries/get-comments";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeMember } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";
import { SCENARIO_CLOCK, managerContext } from "../support/scenarios";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/**
 * INV-9 — "A comment is publicly visible only when *approved*." (BR §6.)
 *
 * **Asserted through the member-facing query, never by filtering here.** Master
 * §7.3 asks for exactly that, and the reason is worth stating: a test that read
 * every comment and filtered on `status` in TypeScript would pass against a
 * query with **no `status` predicate at all** — which is the defect INV-9
 * exists to prevent. So every assertion below goes through `getBookComments`,
 * and what it does not return is the evidence.
 *
 * `0006_community.sql:24` puts a partial index behind that predicate, so the
 * exclusion is in the access path rather than in a filter somebody could drop.
 */

function readerContext(
  bookshelfId: string,
  reader: { id: string; userId: string },
): TenantContext {
  return {
    bookshelfId,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
    clock: fixedClock(SCENARIO_CLOCK),
  };
}

async function shelfWithBookAndReader() {
  const { shelf, ctx } = await managerContext(sql);
  const { bookId } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);
  return { shelf, ctx, bookId, reader, rctx: readerContext(shelf.id, reader) };
}

test("a pending comment is absent from the member-facing query", async () => {
  const { ctx, bookId, rctx } = await shelfWithBookAndReader();

  await runCommand(sql, rctx, createComment, {
    bookId,
    membershipId: rctx.actor.membershipId!,
    body: "Cuốn này hay lắm ạ",
  });

  // Present in the database…
  const stored = await sql<{ status: string }[]>`select status from comments`;
  expect(stored).toHaveLength(1);
  expect(stored[0].status).toBe("pending");

  // …and absent from what a member sees. This is the assertion that matters:
  // an empty array from the query, not a filtered array from the test.
  const visible = await runQuery(sql, rctx, (tx, c) =>
    getBookComments(tx, c, { bookId }),
  );
  expect(visible).toEqual([]);

  // And present in the moderation queue, so the test cannot pass by the comment
  // simply never having been written.
  const queue = await runQuery(sql, ctx, (tx, c) => getPendingComments(tx, c));
  expect(queue).toHaveLength(1);
  expect(queue[0].body).toBe("Cuốn này hay lắm ạ");
});

test("approving is what makes it visible, and nothing else does", async () => {
  const { ctx, bookId, rctx } = await shelfWithBookAndReader();
  const { commentId } = await runCommand(sql, rctx, createComment, {
    bookId,
    membershipId: rctx.actor.membershipId!,
    body: "Em thích chú Dế Mèn",
  });

  await runCommand(sql, ctx, approveComment, { commentId });

  const visible = await runQuery(sql, rctx, (tx, c) =>
    getBookComments(tx, c, { bookId }),
  );
  expect(visible).toHaveLength(1);
  expect(visible[0].body).toBe("Em thích chú Dế Mèn");

  // And it leaves the queue, so a manager does not decide it twice.
  const queue = await runQuery(sql, ctx, (tx, c) => getPendingComments(tx, c));
  expect(queue).toEqual([]);
});

test("a rejected comment is never visible, to anyone", async () => {
  const { ctx, bookId, rctx } = await shelfWithBookAndReader();
  const { commentId } = await runCommand(sql, rctx, createComment, {
    bookId,
    membershipId: rctx.actor.membershipId!,
    body: "nội dung không phù hợp",
  });

  await runCommand(sql, ctx, rejectComment, {
    commentId,
    reason: "Nội dung chưa phù hợp với tủ sách",
  });

  // Not to a member…
  expect(
    await runQuery(sql, rctx, (tx, c) => getBookComments(tx, c, { bookId })),
  ).toEqual([]);
  // …and not to its own author. INV-9 as written makes no exception for them;
  // if a reader should see their own comment awaiting or refused, that is a
  // product decision and a different query, not a loosened predicate on this one.
  expect(
    await runQuery(sql, rctx, (tx, c) => getBookComments(tx, c, { bookId })),
  ).toEqual([]);
});

test("hiding pulls a comment that was already public", async () => {
  // BR §7.5's `approved → hidden`. The interesting half is that it goes back
  // through the same query: a comment can stop being visible after having been
  // visible, which a predicate written as "not rejected" would get wrong.
  const { ctx, bookId, rctx } = await shelfWithBookAndReader();
  const { commentId } = await runCommand(sql, rctx, createComment, {
    bookId,
    membershipId: rctx.actor.membershipId!,
    body: "Bình luận này sẽ bị ẩn",
  });
  await runCommand(sql, ctx, approveComment, { commentId });

  expect(
    await runQuery(sql, rctx, (tx, c) => getBookComments(tx, c, { bookId })),
  ).toHaveLength(1);

  await runCommand(sql, ctx, hideComment, { commentId });

  expect(
    await runQuery(sql, rctx, (tx, c) => getBookComments(tx, c, { bookId })),
  ).toEqual([]);
});

test("a body containing <script> round-trips as literal text", async () => {
  // BR §5.4: comments are plain text, rendered escaped. The failure this guards
  // is not "the database rejected it" — it is somebody later adding a sanitiser
  // and silently rewriting what a child wrote. Rendering escaped is React's
  // default; what needs pinning is that nothing on the way in or out alters the
  // bytes.
  const { ctx, bookId, rctx } = await shelfWithBookAndReader();
  const body = '<script>alert("xin chào")</script> & <b>đậm</b>';

  const { commentId } = await runCommand(sql, rctx, createComment, {
    bookId,
    membershipId: rctx.actor.membershipId!,
    body,
  });
  await runCommand(sql, ctx, approveComment, { commentId });

  const [visible] = await runQuery(sql, rctx, (tx, c) =>
    getBookComments(tx, c, { bookId }),
  );
  expect(visible.body).toBe(body);

  // Byte for byte in the column too — no entity encoding, no stripping.
  const [stored] = await sql<{ body: string }[]>`select body from comments`;
  expect(stored.body).toBe(body);
});

test("one shelf's comments never appear on another's book page", async () => {
  // INV-10, through this query. `comments` is RLS-scoped, and the join to
  // `books` is not what does it — a query that dropped the tenant scope would
  // still pass a same-shelf test.
  const a = await shelfWithBookAndReader();
  const b = await shelfWithBookAndReader();

  const { commentId } = await runCommand(sql, a.rctx, createComment, {
    bookId: a.bookId,
    membershipId: a.rctx.actor.membershipId!,
    body: "Bình luận của tủ sách A",
  });
  await runCommand(sql, a.ctx, approveComment, { commentId });

  // B's manager, asking for A's book by id.
  const leaked = await runQuery(sql, b.ctx, (tx, c) =>
    getBookComments(tx, c, { bookId: a.bookId }),
  );
  expect(leaked).toEqual([]);

  const queue = await runQuery(sql, b.ctx, (tx, c) => getPendingComments(tx, c));
  expect(queue).toEqual([]);
});
