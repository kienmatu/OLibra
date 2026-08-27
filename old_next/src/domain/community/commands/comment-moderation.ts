import { RuleViolated, ValidationFailed } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command } from "../../kernel/unit-of-work";
import { requireManager, requireReader } from "../../catalogue/policy";
import { notify } from "../../notifications/write";
import type { CommentStatus } from "../policy";
import { commentsEnabled, commentsRequireApproval } from "../policy";

/**
 * The comment lifecycle: written by a reader, decided by a manager.
 * OPS §4.4, and INV-9 throughout — "a comment is publicly visible only when
 * *approved*."
 *
 * All four live in one file because they are one state machine over one table,
 * and splitting them across four files would put the transition rules four
 * places. `lend-copy.ts` and its siblings are separate because each writes a
 * different table and enforces a different invariant; these do not.
 *
 * **`comments.author_id` is a `users(id)`** (`0006_community.sql:13`) — the
 * usual direction in this schema, and the opposite of `book_donations`'
 * `donor_membership_id` two tables along. The input is a `membershipId` because
 * OPS §4.4 names one; it is resolved to a user id through the caller's own
 * membership rather than trusted, since `users` has no RLS.
 */

export interface CreateCommentInput {
  bookId: string;
  /** The caller's own membership — checked against the context, not trusted. */
  membershipId: string;
  body: string;
}

export const createComment: Command<
  CreateCommentInput,
  { commentId: string }
> = async (tx, ctx, input) => {
  requireReader(ctx);
  requireIdentifiedActor(ctx);

  if (input.membershipId !== ctx.actor.membershipId) {
    throw new RuleViolated("not_permitted");
  }

  if (!(await commentsEnabled(tx, ctx.bookshelfId))) {
    throw new RuleViolated("comments_disabled");
  }

  // Trimmed, so a body of three spaces is the same as none. The column is
  // `not null` and would take the whitespace happily.
  const body = input.body.trim();
  if (!body) throw new ValidationFailed("empty_body", "body");

  // OPS §4.4: a comment starts `pending` "unless `comments_require_approval`
  // is off, in which case it starts `approved` and is immediately public".
  // INV-9 is untouched either way — it says approved comments are the visible
  // ones, not that a manager must have looked at them.
  const status: CommentStatus = (await commentsRequireApproval(tx, ctx.bookshelfId))
    ? "pending"
    : "approved";

  const [comment] = await tx<{ id: string }[]>`
      insert into comments (bookshelf_id, book_id, author_id, body, status)
      values (${ctx.bookshelfId}, ${input.bookId}, ${ctx.actor.userId}, ${body},
              ${status})
      returning id
    `;

  return {
    result: { commentId: comment.id },
    audit: {
      action: "comment.created",
      entityType: "comment",
      entityId: comment.id,
      before: null,
      // The body is **not** in the audit payload. It is the reader's own words
      // on a row that survives, and BR §14 asks the log to record what changed
      // rather than to duplicate it — a second copy is a second thing to
      // redact if a child ever asks for theirs to be removed.
      after: { status, book_id: input.bookId },
    },
  };
};

/** Reads a comment in this shelf, or refuses with `code`. RLS scopes the shelf. */
async function pendingComment(
  tx: Parameters<typeof createComment>[0],
  commentId: string,
  expected: CommentStatus,
  code: "comment_not_pending" | "comment_not_approved",
): Promise<{
  id: string;
  status: CommentStatus;
  author_id: string;
  book_id: string;
}> {
  const [comment] = await tx<
    { id: string; status: CommentStatus; author_id: string; book_id: string }[]
  >`
    select id, status, author_id, book_id from comments
     where id = ${commentId} and deleted_at is null
  `;
  // One code for "no such comment" and "already decided", the reasoning
  // `voidLoan` and `approveBorrowRequest` both record: OPS §4.4 lists no
  // `comment_not_found`, an ErrorCode may not gain a sentence nobody wrote, and
  // RLS has already filtered another shelf's comment out of this select — so
  // telling the two apart would confirm it exists.
  if (!comment || comment.status !== expected) throw new RuleViolated(code);
  return comment;
}

export const approveComment: Command<{ commentId: string }, void> = async (
  tx,
  ctx,
  input,
) => {
  requireManager(ctx);
  requireIdentifiedActor(ctx);

  const comment = await pendingComment(
    tx,
    input.commentId,
    "pending",
    "comment_not_pending",
  );

  await tx`
    update comments
       set status = 'approved',
           moderated_by = ${ctx.actor.userId},
           moderated_at = ${ctx.clock.now()},
           moderation_note = null
     where id = ${comment.id}
  `;

  // OPS §7's table names this one: "Bình luận được duyệt" is written by
  // `ApproveComment`. The author, never the manager who approved it — BR §15's
  // rule that managers get none.
  await notify(tx, { userId: comment.author_id, kind: "comment_approved" });

  return {
    result: undefined,
    audit: {
      action: "comment.approved",
      entityType: "comment",
      entityId: comment.id,
      before: { status: "pending" },
      after: { status: "approved" },
    },
  };
};

export const rejectComment: Command<
  { commentId: string; reason: string },
  void
> = async (tx, ctx, input) => {
  requireManager(ctx);
  requireIdentifiedActor(ctx);

  // Required, and trimmed. OPS §4.4 quotes the screen's own copy for why: "Từ
  // chối cần ghi lý do, bạn đọc sẽ thấy lý do này." A reason the author reads
  // is the point, and three spaces is not one.
  const reason = input.reason.trim();
  if (!reason) throw new ValidationFailed("reject_reason_required", "reason");

  const comment = await pendingComment(
    tx,
    input.commentId,
    "pending",
    "comment_not_pending",
  );

  await tx`
    update comments
       set status = 'rejected',
           moderated_by = ${ctx.actor.userId},
           moderated_at = ${ctx.clock.now()},
           moderation_note = ${reason}
     where id = ${comment.id}
  `;

  return {
    result: undefined,
    audit: {
      action: "comment.rejected",
      entityType: "comment",
      entityId: comment.id,
      before: { status: "pending" },
      after: { status: "rejected", reason },
    },
  };
};

/**
 * `approved → hidden` — pulls a comment that was already public (BR §7.5).
 *
 * The reason is **optional** here where rejection's is required, and OPS §4.4
 * makes that distinction: a rejection is a message to the author, who is waiting
 * to hear; hiding is a manager removing something already published, often
 * hours or months later, and there may be nobody to tell.
 */
export const hideComment: Command<
  { commentId: string; reason?: string },
  void
> = async (tx, ctx, input) => {
  requireManager(ctx);
  requireIdentifiedActor(ctx);

  const comment = await pendingComment(
    tx,
    input.commentId,
    "approved",
    "comment_not_approved",
  );

  const reason = input.reason?.trim() ? input.reason.trim() : null;

  await tx`
    update comments
       set status = 'hidden',
           moderated_by = ${ctx.actor.userId},
           moderated_at = ${ctx.clock.now()},
           moderation_note = ${reason}
     where id = ${comment.id}
  `;

  return {
    result: undefined,
    audit: {
      action: "comment.hidden",
      entityType: "comment",
      entityId: comment.id,
      before: { status: "approved" },
      after: reason ? { status: "hidden", reason } : { status: "hidden" },
    },
  };
};
