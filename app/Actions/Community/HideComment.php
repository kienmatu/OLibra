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
 * A manager pulls a comment that was already public — BR §7.5's
 * approved -> hidden. Port of comment-moderation.ts's hideComment.
 *
 * The reason is OPTIONAL here, where RejectComment's is required, and
 * OPS §4.4 draws the line: a rejection is a message to an author who is
 * waiting to hear whether their comment will ever be seen; hiding
 * removes something already published, often hours or months later, and
 * there may be nobody left to tell. Nothing about hiding NEEDS a reason
 * to be well-formed — the reader who wrote it already saw it go up.
 *
 * NO notification, same as RejectComment: OPS §7's table lists none for
 * a hidden comment.
 *
 * What this command does, and the whole of it: one UPDATE moving an
 * existing row from approved to hidden. It inserts nothing, and it
 * writes no other status — a row that is not approved is refused rather
 * than rewritten.
 *
 * One lock, the comment row, taken as the transaction's first statement —
 * ApproveComment's shape, mirrored.
 */
final class HideComment
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    /** @return array{commentId: string} */
    public function execute(User $actor, Comment $comment, ?string $reason = null): array
    {
        Gate::forUser($actor)->authorize('hide', $comment);

        // Optional, and trimmed to null rather than to an empty string —
        // a hide with a blank reason is the same fact as a hide with
        // none, the reference's own `input.reason?.trim() ? ... : null`.
        $trimmed = ($reason === null || trim($reason) === '') ? null : trim($reason);

        return DB::transaction(function () use ($actor, $comment, $trimmed): array {
            // FIRST statement — the only lock this command takes.
            $locked = Comment::query()->lockForUpdate()->findOrFail($comment->id);

            if ($locked->status !== CommentStatus::Approved) {
                throw new RuleViolated('comment_not_approved');
            }

            $locked->update([
                'status' => CommentStatus::Hidden,
                'moderated_by' => $actor->id,
                'moderated_at' => $this->clock->now(),
                'moderation_note' => $trimmed,
            ]);

            // The reference's own conditional shape (`reason ? {status,
            // reason} : {status}`), ported rather than a `'reason' =>
            // null`: AuditSentences::payloadRows renders an ABSENT key as
            // an em dash and a STORED null as the string "null", which are
            // different facts, and a reasonless hide has no reason to
            // record — not a recorded absence of one.
            $this->audit->record('comment.hidden', 'comment', $locked->id,
                ['status' => 'approved'],
                $trimmed !== null ? ['status' => 'hidden', 'reason' => $trimmed] : ['status' => 'hidden'],
            );

            return ['commentId' => $locked->id];
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
