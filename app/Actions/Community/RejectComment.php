<?php

namespace App\Actions\Community;

use App\Enums\CommentStatus;
use App\Exceptions\RuleViolated;
use App\Models\Comment;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use App\Support\ConcurrencyRetry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A manager turns away a pending comment — BR §7.6's pending -> rejected.
 * Port of comment-moderation.ts's rejectComment.
 *
 * The REASON is required, and this is the asymmetry the sibling command,
 * HideComment, does not share: OPS §4.4 quotes the screen's own copy —
 * "Từ chối cần ghi lý do, bạn đọc sẽ thấy lý do này." A rejection is a
 * message to an author who is waiting to hear whether their comment will
 * ever be seen, and the reason IS the message — it lands in
 * moderation_note; this command sends no notification of its own.
 *
 * NO notification. OPS §7's table lists none for a rejected comment and
 * this command does not invent one — the reason on the row is the whole
 * of what the author is told, the same way the reference's rejectComment
 * calls no notify() at all.
 *
 * What this command does, and the whole of it: one UPDATE moving an
 * existing row from pending to rejected. It inserts nothing, and it
 * writes no other status — a row that is not pending is refused rather
 * than rewritten.
 *
 * One lock, the comment row, taken as the transaction's first statement —
 * ApproveComment's shape, mirrored. A row that does not exist, or
 * belongs to another shelf, never reaches this command: the binding 404s
 * it, and lockForUpdate()->findOrFail() would answer the two the same
 * way in any case.
 */
final class RejectComment
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    /** @return array{commentId: string} */
    public function execute(User $actor, Comment $comment, string $reason): array
    {
        Gate::forUser($actor)->authorize('reject', $comment);

        // Required, and trimmed. OPS §4.4 quotes the screen's own copy for
        // why: "Từ chối cần ghi lý do, bạn đọc sẽ thấy lý do này." A reason
        // the author reads is the point, and three spaces is not one. The
        // code is 1b's reject_reason_required, reused rather than split a
        // fifth time — OPS §4.4 gives this command that same sentence.
        $trimmed = trim($reason);
        if ($trimmed === '') {
            throw new RuleViolated('reject_reason_required');
        }

        return DB::transaction(function () use ($actor, $comment, $trimmed): array {
            // FIRST statement — the only lock this command takes.
            $locked = Comment::query()->lockForUpdate()->findOrFail($comment->id);

            if ($locked->status !== CommentStatus::Pending) {
                throw new RuleViolated('comment_not_pending');
            }

            $locked->update([
                'status' => CommentStatus::Rejected,
                'moderated_by' => $actor->id,
                'moderated_at' => $this->clock->now(),
                'moderation_note' => $trimmed,
            ]);

            $this->audit->record('comment.rejected', 'comment', $locked->id,
                ['status' => 'pending'],
                ['status' => 'rejected', 'reason' => $trimmed],
            );

            return ['commentId' => $locked->id];
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
