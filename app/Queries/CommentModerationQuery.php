<?php

namespace App\Queries;

use App\Enums\CommentStatus;
use App\Models\Comment;
use Illuminate\Database\Eloquent\Builder;
use InvalidArgumentException;

/**
 * The manager's three moderation lists and the four chips above them —
 * get-comments.ts's getPendingComments, getRecentComments and
 * countCommentsByStatus, in one class. This is the manager-side
 * counterpart to BookCommentsQuery's reader-side read; the two must not
 * drift on what pending/approved/rejected/hidden mean, and neither
 * redefines CommentStatus — both read the one enum.
 *
 * THREE SHAPES, ONE SHARED BUILDER FOR TWO OF THEM. queue() and
 * decided() share base() — the eager loads (author, book) and nothing
 * else — but each states its OWN order and its OWN cap. This is the
 * reference's own argument, not this port's invention: getRecentComments'
 * docblock explains why getPendingComments stays a separate function
 * rather than folding in as a fourth status — "it is unbounded and
 * ascending (oldest first, because a queue is worked rather than
 * browsed), where this is capped and descending — a different shape, not
 * the same one with a different literal." 2a's Task 11 review argued the
 * opposite for a DIFFERENT pair — two methods repeating one filter
 * character for character — and merged them into one shared builder;
 * that precedent does not transfer here because the thing that differs
 * between queue() and decided() (ordering direction, presence of a cap)
 * is exactly the thing that makes each a queue or an archive, not
 * incidental duplication.
 *
 * `id` beside `created_at` in both orderings, for the reason this
 * codebase has now measured twice (BookCommentsQuery,
 * BorrowRequestQueueQuery): `created_at` carries no unique constraint,
 * so a key that cannot tie is what resolves one deterministically.
 *
 * WHAT PINS THOSE TWO LINES IS THE COMPILED SQL, not the row order —
 * and the fix round measured the two lines separately rather than
 * assuming one answer covered both, because they did not answer alike.
 * Deleting `orderBy('id')` from queue() leaves every row-order fixture
 * in CommentModerationQueryTest green, the same-instant pending pair
 * included: v7 ids rise with creation time and an ascending scan already
 * emits a tied group in ascending id order. Deleting
 * `orderByDesc('id')` from decided() DOES redden its same-instant pair
 * on today's engine. Flipping either line's direction reddens its pair
 * as well.
 *
 * So both lines are pinned where row order cannot reach one of them:
 * CommentModerationQueryTest compiles each statement and reads its ORDER
 * BY text — `created_at` asc, `id` asc for queue(), `created_at` desc,
 * `id` desc for decided() — and the same-instant pairs stay beside those
 * two blocks to fix the direction.
 *
 * The out-of-order seeding in that file's two ordering fixtures buys
 * something different and is worth keeping for its own sake: it refuses
 * a read that dropped `created_at` and sorted by id alone.
 *
 * NO INLINE GATE, the house shape BorrowRequestQueueQuery's docblock
 * argues at length for its own file. The screen that calls this one is
 * Task 7's and its route group's role:manager middleware is where
 * authorization lands.
 *
 * Tenancy is BookshelfScope's, on Comment itself — no bookshelf_id
 * appears here, and neither does deleted_at: SoftDeletes on Comment
 * excludes trashed rows the same way it does in BookCommentsQuery.
 *
 * THE DASHBOARD DELEGATES, STRUCTURALLY. ManagerDashboardQuery's
 * counts.pendingComments calls countPending() below rather than
 * restating `where status = pending` a second time — the pendingRequests
 * precedent (BorrowRequestQueueQuery::countWaiting()), so the card and
 * this queue cannot drift the way two independent counts could. That
 * guarantee is structural for the dashboard card specifically: it is one
 * delegated call, not a second predicate that merely happens to agree.
 * The agreement BETWEEN queue()'s count, counts()['pending'] and
 * countPending() inside THIS class is a different kind of guarantee —
 * three genuinely separate statements (a filtered SELECT, a GROUP BY,
 * and a COUNT), each read the way its own list is selected, and pinned
 * by CommentModerationQueryTest's three agreement blocks — one per
 * reading, each its own it() so that a drift in one cannot short-circuit
 * the check on the other two — rather than by shared code. Mutating
 * countPending() to drop its status filter reddens its agreement block
 * and the dashboard-delegation block together, which is the point: the
 * fact is tested, not merely assumed to hold because the class is small.
 */
final class CommentModerationQuery
{
    /**
     * The eager loads and columns queue() and decided() share — NOT the
     * ordering or the cap. See the class docblock for why those two stay
     * unshared.
     *
     * @return Builder<Comment>
     */
    private function base(): Builder
    {
        return Comment::query()->with(['author', 'book']);
    }

    /** @return array{id: string, body: string, authorName: string, createdAt: string, bookId: string, title: string} */
    private function present(Comment $comment): array
    {
        return [
            'id' => $comment->id,
            'body' => $comment->body,
            // Nullsafe on author/book, cast to string: both reach
            // Larastan as a possibly-null belongsTo accessor even though
            // author_id/book_id are non-nullable columns — the same
            // asymmetry BookCommentsQuery's docblock measures for
            // author?->full_name versus created_at's plain cast.
            'authorName' => (string) $comment->author?->full_name,
            'createdAt' => (string) $comment->created_at->toISOString(),
            'bookId' => $comment->book_id,
            'title' => (string) $comment->book?->title,
        ];
    }

    /**
     * The moderation queue — pending only, oldest first, unbounded. A
     * queue is worked, not paged; get-comments.ts's getPendingComments
     * docblock gives that as the reason it stays ascending and uncapped where
     * decided() below is neither.
     *
     * @return list<array{id: string, body: string, authorName: string, createdAt: string, bookId: string, title: string}>
     */
    public function queue(): array
    {
        // array_values is a level-8 requirement, not belt and braces —
        // BookCommentsQuery::run's own comment gives the reason:
        // ->values()->all() gives PHPStan array<int, ...>, not list<...>.
        return array_values($this->base()
            ->where('status', CommentStatus::Pending)
            ->orderBy('created_at')
            ->orderBy('id')
            ->get()
            ->map(fn (Comment $comment): array => $this->present($comment))
            ->values()
            ->all());
    }

    /**
     * The three archive tabs — one already-decided status, newest first,
     * capped rather than paged. get-comments.ts's getRecentComments
     * docblock gives the reason: "a 'recently' list beside a queue, not
     * a browsable archive."
     *
     * PENDING IS REFUSED AT RUNTIME BECAUSE THE TYPE CANNOT REFUSE IT.
     * The reference types this parameter `"approved" | "rejected" |
     * "hidden"`, so a pending read here is unwritable there; PHP's enum
     * carries all four cases and cannot express the subset. Left
     * unguarded, decided(Pending) would answer a capped, newest-first
     * pending list — the opposite order and a different cardinality from
     * queue(), which is the pending read — and a screen whose ?status=
     * chip picks a list uniformly would render that under the pending
     * chip without anything failing.
     *
     *
     * @return list<array{id: string, body: string, authorName: string, createdAt: string, bookId: string, title: string}>
     *
     * @throws InvalidArgumentException when $status is Pending
     */
    public function decided(CommentStatus $status, int $limit = 10): array
    {
        if ($status === CommentStatus::Pending) {
            throw new InvalidArgumentException('decided() reads an already-decided status; the pending list is queue()\'s, which is oldest-first and uncapped.');
        }

        return array_values($this->base()
            ->where('status', $status)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit($limit)
            ->get()
            ->map(fn (Comment $comment): array => $this->present($comment))
            ->values()
            ->all());
    }

    /**
     * The four chips. ONE grouped statement, not four count(*) queries —
     * a `group by` only returns statuses with rows, and a well-moderated
     * shelf usually has some with none, so the zeroes are filled in from
     * CommentStatus::cases() rather than trusted to the database to
     * report.
     *
     * @return array{pending: int, approved: int, rejected: int, hidden: int}
     */
    public function counts(): array
    {
        /** @var array<string, int> $filled */
        $filled = array_fill_keys(
            array_map(fn (CommentStatus $c): string => $c->value, CommentStatus::cases()),
            0,
        );

        foreach (Comment::query()
            ->select('status')
            ->selectRaw('count(*) as aggregate')
            ->groupBy('status')
            ->get() as $row) {
            $filled[$row->status->value] = (int) $row->getAttribute('aggregate');
        }

        return [
            'pending' => $filled[CommentStatus::Pending->value],
            'approved' => $filled[CommentStatus::Approved->value],
            'rejected' => $filled[CommentStatus::Rejected->value],
            'hidden' => $filled[CommentStatus::Hidden->value],
        ];
    }

    /**
     * The dashboard card's number — counted the way queue() selects its
     * rows (status = pending), from its own statement. See the class
     * docblock for what this delegation does and does not guarantee.
     */
    public function countPending(): int
    {
        return Comment::query()->where('status', CommentStatus::Pending)->count();
    }
}
