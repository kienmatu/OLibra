<?php

namespace App\Actions\Community;

use App\Enums\CommentStatus;
use App\Exceptions\RuleViolated;
use App\Models\Book;
use App\Models\Comment;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Community\CommentSettings;
use App\Support\ConcurrencyRetry;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A reader comments on a book — OPS §4.4's CreateComment, and INV-9's
 * entry point. Port of comment-moderation.ts's createComment.
 *
 * comments.author_id is a users(id), the usual direction in this schema
 * and the OPPOSITE of book_donations.donor_membership_id two tables
 * along, which this phase also writes. The parameter is a User for that
 * reason: both ids are 36-char uuid strings, so nothing in the type
 * system or the column's shape tells a membership id from a user id.
 *
 * CORRECTED AGAINST A LIVE RUN. The plan's wording for this paragraph
 * said a membership id here "would insert a row referencing nothing and
 * no FK would stop it". It would not: comments_author_id_foreign
 * references users(id), and writing a memberships(id) into this column
 * was measured in this container as SQLSTATE 23000 / errno 1452 — a 500,
 * loudly, not a silently wrong row. So the database IS the backstop; what
 * it is not is a reason to take the id from anywhere but a User, because
 * a backstop that answers with a 500 to a reader who wrote a comment is
 * not a design.
 *
 * The caller's membership is not an input (plan divergence 4): the
 * session already resolved one for the bound shelf. not_permitted is
 * still reachable and is not defence against nothing — Gate::before
 * grants every act-as-* ability to a super admin, so a super admin with
 * no membership of this shelf passes the policy with a null membership
 * and lands here. It fails closed and CreateCommentTest posts that
 * exact case over HTTP.
 *
 * WHICH STATUS a comment starts in is the SHELF's decision, not this
 * command's: moderation is the default, and OPS §4.4 makes turning it
 * off the only way a comment starts approved. INV-9 is untouched either
 * way — it says approved comments are the visible ones, not that a
 * manager must have looked at them.
 *
 * The BODY IS NOT IN THE AUDIT PAYLOAD. It is the reader's own words on
 * a row that survives, and BR §14 asks the log to record what changed
 * rather than to duplicate it — a second copy is a second thing to
 * redact if a child ever asks for theirs to be removed.
 *
 * No lock: this command re-reads nothing and guards no uniqueness rule.
 * The transaction is here so the row and its audit entry commit
 * together, and it retries because every write transaction in this phase
 * does (plan divergence 1).
 */
final class CreateComment
{
    public function __construct(
        private TenantContext $tenant,
        private AuditRecorder $audit,
    ) {}

    /** @return array{commentId: string, status: CommentStatus} */
    public function execute(User $actor, Book $book, string $body): array
    {
        Gate::forUser($actor)->authorize('create', Comment::class);

        $membership = $this->tenant->membership();
        if ($membership === null || $membership->user_id !== $actor->id) {
            throw new RuleViolated('not_permitted');
        }

        $shelf = $this->tenant->bookshelf();
        if ($shelf === null) {
            throw new RuleViolated('shelf_not_found');
        }

        $settings = CommentSettings::fromShelf($shelf);
        if (! $settings->commentsEnabled) {
            throw new RuleViolated('comments_disabled');
        }

        // Trimmed, so a body of three spaces is the same as none. The
        // column is NOT NULL and would take the whitespace happily.
        $trimmed = trim($body);
        if ($trimmed === '') {
            throw new RuleViolated('empty_body');
        }

        $status = $settings->commentsRequireApproval
            ? CommentStatus::Pending
            : CommentStatus::Approved;

        return DB::transaction(function () use ($actor, $book, $trimmed, $status): array {
            // bookshelf_id is absent on purpose: BelongsToBookshelf's
            // creating hook stamps it from the bound tenant, and naming it
            // here would be the hand-written scope this project bans.
            $comment = Comment::query()->create([
                'book_id' => $book->id,
                'author_id' => $actor->id,
                'body' => $trimmed,
                'status' => $status,
            ]);

            $this->audit->record('comment.created', 'comment', $comment->id, null, [
                'status' => $status->value,
                'book_id' => $book->id,
            ]);

            // status is returned, not re-derived by the controller: it
            // picks between two flash sentences and a second reading of
            // the shelf setting is how a screen and a command start
            // disagreeing about one shelf.
            return ['commentId' => $comment->id, 'status' => $status];
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
