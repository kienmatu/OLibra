<?php

namespace App\Actions\Community;

use App\Enums\CommentStatus;
use App\Exceptions\RuleViolated;
use App\Models\Comment;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use App\Support\ConcurrencyRetry;
use App\Support\Notifications\NotificationKind;
use App\Support\Notifications\Notifier;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A manager publishes a comment — BR §7.6's pending -> approved, and the
 * ONLY transition that makes one publicly visible (INV-9). Port of
 * comment-moderation.ts's approveComment.
 *
 * INV-9 itself is not enforced here and must not be. "A comment is
 * publicly visible only when approved" belongs in the read path's status
 * predicate — BookCommentsQuery, this phase's Task 5, which does not
 * exist at this commit (nothing under app/Queries reads comments yet, so
 * no screen shows one either way). This command CHANGES the status, which
 * is a different thing from where the rule is kept. A moderation screen
 * that also filtered would be a second definition of visibility that a
 * book page could disagree with.
 *
 * The AUTHOR is told, never the manager who approved it — BR §15's rule
 * that managers get none, and OPS §7's table names this command as the
 * writer. comments.author_id is a users(id), which is what
 * Notifier::notify takes. The notification carries no payload, matching
 * the reference: a reader with two approved comments reads the same
 * sentence twice, and adding a title would be a product change rather
 * than a port (plan divergence 10).
 *
 * moderation_note is cleared rather than left, so an approval cannot
 * leave a stale reason attached to a published comment. The reference
 * does the same. Nothing shipped today writes a note onto a PENDING row
 * — the two commands that write one, RejectComment and HideComment, are
 * this phase's later tasks and both leave a decided status behind — so
 * ApproveCommentTest builds that row by hand rather than pretend the
 * clearing has a witness it does not have.
 *
 * One lock, the comment row, taken as the transaction's first statement.
 * A row that does not exist, or belongs to another shelf, never reaches
 * this command: the binding 404s it (plan divergence 3), and
 * lockForUpdate()->findOrFail() would answer the two the same way in any
 * case. "Already decided" is a RuleViolated, which bootstrap/app.php
 * renders as a redirect carrying the Vietnamese sentence and leaks
 * nothing, because reaching it already means the row is this shelf's.
 */
final class ApproveComment
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
        private Notifier $notifier,
    ) {}

    /** @return array{commentId: string} */
    public function execute(User $actor, Comment $comment): array
    {
        Gate::forUser($actor)->authorize('approve', $comment);

        return DB::transaction(function () use ($actor, $comment): array {
            // FIRST statement — the only lock this command takes.
            $locked = Comment::query()->lockForUpdate()->findOrFail($comment->id);

            if ($locked->status !== CommentStatus::Pending) {
                throw new RuleViolated('comment_not_pending');
            }

            $locked->update([
                'status' => CommentStatus::Approved,
                'moderated_by' => $actor->id,
                'moderated_at' => $this->clock->now(),
                'moderation_note' => null,
            ]);

            $this->audit->record('comment.approved', 'comment', $locked->id,
                ['status' => 'pending'],
                ['status' => 'approved'],
            );

            $this->notifier->notify($locked->author_id, NotificationKind::CommentApproved);

            return ['commentId' => $locked->id];
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
