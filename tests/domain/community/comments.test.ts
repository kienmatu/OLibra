import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runCommand, runQuery } from "../../../src/domain/kernel/unit-of-work";
import {
  approveComment,
  createComment,
  hideComment,
  rejectComment,
} from "../../../src/domain/community/commands/comment-moderation";
import {
  getBookComments,
  getPendingComments,
  getRecentComments,
} from "../../../src/domain/community/queries/get-comments";
import { migrate } from "../../../src/db/migrate";
import { makeBookWithCopies, makeMember } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";
import { SCENARIO_CLOCK, managerContext } from "../../support/scenarios";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

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

async function scene() {
  const { shelf, ctx } = await managerContext(sql);
  const { bookId } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);
  return { shelf, ctx, bookId, reader, rctx: readerContext(shelf.id, reader) };
}

test("a shelf that has turned comments off refuses them", async () => {
  const { shelf, bookId, rctx } = await scene();
  await sql`
    update bookshelves
       set settings = settings || '{"comments_enabled": false}'::jsonb
     where id = ${shelf.id}
  `;

  await expect(
    runCommand(sql, rctx, createComment, {
      bookId,
      membershipId: rctx.actor.membershipId!,
      body: "Xin chào",
    }),
  ).rejects.toMatchObject({ code: "comments_disabled" });

  expect(await sql`select id from comments`).toHaveLength(0);
});

test("a shelf that does not moderate publishes immediately", async () => {
  // OPS §4.4: a comment starts `pending` "unless `comments_require_approval` is
  // off, in which case it starts `approved` and is immediately public". INV-9 is
  // untouched — it says approved comments are the visible ones, not that a
  // manager must have looked at them.
  const { shelf, bookId, rctx } = await scene();
  await sql`
    update bookshelves
       set settings = settings || '{"comments_require_approval": false}'::jsonb
     where id = ${shelf.id}
  `;

  await runCommand(sql, rctx, createComment, {
    bookId,
    membershipId: rctx.actor.membershipId!,
    body: "Hiện ngay không cần duyệt",
  });

  const visible = await runQuery(sql, rctx, (tx, c) =>
    getBookComments(tx, c, { bookId }),
  );
  expect(visible).toHaveLength(1);
});

test("moderation is the default, so a shelf that never opened settings moderates", async () => {
  // The safe direction, and BR §5.5 chose it. Pinned because a `coalesce`
  // defaulting the other way would be invisible on every configured shelf.
  const { bookId, rctx } = await scene();
  await runCommand(sql, rctx, createComment, {
    bookId,
    membershipId: rctx.actor.membershipId!,
    body: "Mặc định là chờ duyệt",
  });

  const [row] = await sql<{ status: string }[]>`select status from comments`;
  expect(row.status).toBe("pending");
});

test("an empty body is refused, whitespace included", async () => {
  const { bookId, rctx } = await scene();
  for (const body of ["", "   ", "\n\t "]) {
    await expect(
      runCommand(sql, rctx, createComment, {
        bookId,
        membershipId: rctx.actor.membershipId!,
        body,
      }),
    ).rejects.toMatchObject({ code: "empty_body" });
  }
});

test("a reader cannot post as somebody else", async () => {
  // `membershipId` is an OPS-named input, so it is checked against the context
  // rather than trusted — `comments.author_id` is written from `ctx`, never from
  // the argument, and this pins that the argument cannot disagree silently.
  const { shelf, bookId, rctx } = await scene();
  const other = await makeMember(sql, shelf.id);

  await expect(
    runCommand(sql, rctx, createComment, {
      bookId,
      membershipId: other.id,
      body: "Giả danh",
    }),
  ).rejects.toMatchObject({ code: "not_permitted" });
});

test("approving notifies the author, and nobody else", async () => {
  // OPS §7's table: `ApproveComment` is the one command in this slice that
  // notifies. BR §15's rule is that the manager gets none, so the row count is
  // asserted as well as the recipient.
  const { ctx, bookId, reader, rctx } = await scene();
  const { commentId } = await runCommand(sql, rctx, createComment, {
    bookId,
    membershipId: rctx.actor.membershipId!,
    body: "Sẽ được duyệt",
  });

  await runCommand(sql, ctx, approveComment, { commentId });

  const rows = await sql<{ user_id: string; kind: string }[]>`
    select user_id, kind from notifications
  `;
  expect(rows).toHaveLength(1);
  expect(rows[0].user_id).toBe(reader.userId);
  expect(rows[0].kind).toBe("comment_approved");
});

test("rejecting notifies nobody — the reason is on the row", async () => {
  // OPS §7's table lists no notification for a rejected comment, and this slice
  // does not invent one. The reason reaches the author through the moderation
  // note, which is what the screen's copy promises.
  const { ctx, bookId, rctx } = await scene();
  const { commentId } = await runCommand(sql, rctx, createComment, {
    bookId,
    membershipId: rctx.actor.membershipId!,
    body: "Sẽ bị từ chối",
  });

  await runCommand(sql, ctx, rejectComment, { commentId, reason: "Chưa phù hợp" });

  expect(await sql`select id from notifications`).toHaveLength(0);
  const [row] = await sql<{ moderation_note: string }[]>`
    select moderation_note from comments
  `;
  expect(row.moderation_note).toBe("Chưa phù hợp");
});

test("rejecting requires a reason, and whitespace is not one", async () => {
  const { ctx, bookId, rctx } = await scene();
  const { commentId } = await runCommand(sql, rctx, createComment, {
    bookId,
    membershipId: rctx.actor.membershipId!,
    body: "Cần lý do",
  });

  await expect(
    runCommand(sql, ctx, rejectComment, { commentId, reason: "   " }),
  ).rejects.toMatchObject({ code: "reject_reason_required" });

  const [row] = await sql<{ status: string }[]>`select status from comments`;
  expect(row.status).toBe("pending");
});

test("hiding takes an optional reason where rejecting requires one", async () => {
  // The distinction OPS §4.4 draws: a rejection is a message to an author who
  // is waiting to hear; hiding removes something already published, possibly
  // months later, and there may be nobody to tell.
  const { ctx, bookId, rctx } = await scene();
  const { commentId } = await runCommand(sql, rctx, createComment, {
    bookId,
    membershipId: rctx.actor.membershipId!,
    body: "Sẽ bị ẩn không kèm lý do",
  });
  await runCommand(sql, ctx, approveComment, { commentId });

  await runCommand(sql, ctx, hideComment, { commentId });

  const [row] = await sql<{ status: string; moderation_note: string | null }[]>`
    select status, moderation_note from comments
  `;
  expect(row.status).toBe("hidden");
  expect(row.moderation_note).toBeNull();
});

test("a comment already decided cannot be decided again", async () => {
  const { ctx, bookId, rctx } = await scene();
  const { commentId } = await runCommand(sql, rctx, createComment, {
    bookId,
    membershipId: rctx.actor.membershipId!,
    body: "Chỉ xử lý một lần",
  });
  await runCommand(sql, ctx, approveComment, { commentId });

  await expect(
    runCommand(sql, ctx, approveComment, { commentId }),
  ).rejects.toMatchObject({ code: "comment_not_pending" });
  await expect(
    runCommand(sql, ctx, rejectComment, { commentId, reason: "muộn" }),
  ).rejects.toMatchObject({ code: "comment_not_pending" });
});

test("only an approved comment can be hidden", async () => {
  const { ctx, bookId, rctx } = await scene();
  const { commentId } = await runCommand(sql, rctx, createComment, {
    bookId,
    membershipId: rctx.actor.membershipId!,
    body: "Đang chờ duyệt",
  });

  await expect(
    runCommand(sql, ctx, hideComment, { commentId }),
  ).rejects.toMatchObject({ code: "comment_not_approved" });
});

test("a reader cannot moderate", async () => {
  const { bookId, rctx } = await scene();
  const { commentId } = await runCommand(sql, rctx, createComment, {
    bookId,
    membershipId: rctx.actor.membershipId!,
    body: "Bạn đọc không được duyệt",
  });

  await expect(
    runCommand(sql, rctx, approveComment, { commentId }),
  ).rejects.toMatchObject({ code: "not_permitted" });
});

test("the four decisions are audited, and the reason travels with them", async () => {
  const { ctx, bookId, rctx } = await scene();
  const { commentId } = await runCommand(sql, rctx, createComment, {
    bookId,
    membershipId: rctx.actor.membershipId!,
    body: "Nội dung riêng tư của bạn đọc",
  });
  await runCommand(sql, ctx, rejectComment, { commentId, reason: "Lạc đề" });

  const entries = await sql<
    { action: string; after: Record<string, unknown> }[]
  >`select action, after from audit_log order by id`;
  expect(entries.map((e) => e.action)).toEqual([
    "comment.created",
    "comment.rejected",
  ]);
  expect(entries[1].after.reason).toBe("Lạc đề");

  // The body is deliberately not in the audit payload — it is the reader's own
  // words, and a second copy is a second thing to redact if a child ever asks
  // for theirs to be removed.
  expect(JSON.stringify(entries[0].after)).not.toContain("riêng tư");
});

/**
 * The `bookId` filter both moderation queries gained when the manager's own
 * book page started showing that title's waiting comments (U7).
 *
 * **Two books, deliberately.** A filter that was ignored entirely — the shape a
 * mistyped parameter name actually takes — returns both rows and passes any
 * assertion that only checks the wanted one is present. So each case asserts the
 * *other* book's comment is absent, which is the half that fails when the
 * predicate does nothing.
 */
test("the moderation queries narrow to one book, and the shelf-wide call is unchanged", async () => {
  const { shelf, ctx, bookId: wanted, rctx } = await scene();
  const { bookId: other } = await makeBookWithCopies(sql, shelf.id, 1);

  await runCommand(sql, rctx, createComment, {
    bookId: wanted,
    membershipId: rctx.actor.membershipId!,
    body: "Bình luận về cuốn được hỏi",
  });
  await runCommand(sql, rctx, createComment, {
    bookId: other,
    membershipId: rctx.actor.membershipId!,
    body: "Bình luận về cuốn khác",
  });

  // Absent `bookId` is every book — what `/quan-ly/binh-luan` asks for, and the
  // behaviour every existing caller depends on.
  const wholeShelf = await runQuery(sql, ctx, (tx, c) => getPendingComments(tx, c));
  expect(wholeShelf).toHaveLength(2);

  const justThisBook = await runQuery(sql, ctx, (tx, c) =>
    getPendingComments(tx, c, { bookId: wanted }),
  );
  expect(justThisBook.map((r) => r.body)).toEqual(["Bình luận về cuốn được hỏi"]);

  // And the same for the approved list the book page shows under "Đang hiện
  // trên trang sách", so **Ẩn** can never name another title's comment.
  for (const row of wholeShelf) {
    await runCommand(sql, ctx, approveComment, { commentId: row.id });
  }
  const approvedHere = await runQuery(sql, ctx, (tx, c) =>
    getRecentComments(tx, c, { status: "approved", bookId: wanted }),
  );
  expect(approvedHere.map((r) => r.body)).toEqual(["Bình luận về cuốn được hỏi"]);
});
