<?php

namespace App\Queries;

use App\Enums\CopyState;
use App\Models\BookCopy;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * BR §16.3's Sách đã mất — the shelf-wide lost list that gives
 * lost → available a screen to happen on ("Báo mất appears in three places
 * in the built interface, and marking a copy found appears in none of
 * them"). Port of get-lost-copies.ts.
 *
 * OPS §3.3 tabulates no GetLostCopies; OPS §4.1 names this exact view as
 * MarkCopyFound's UI trigger — the read is implied by the catalogue even
 * though the catalogue forgot to tabulate it (the reference makes the same
 * point of order).
 *
 * lastBorrowerName comes from the most recent lost loan — a copy can be
 * lost, found, lent and lost again, so the subquery orders by
 * lost_reported_at desc; never a bare first(). Straight to users, not
 * through memberships: a borrower who has since left the shelf is exactly
 * the person a lost copy is most likely to be with. A name and NO phone:
 * BR:574 asks for neither — a lost copy's way back is MarkCopyFound, not
 * a call — so the most identifying field on the shelf is not carried here.
 *
 * Ordered newest-report-first; a copy with no report time (import shape)
 * is the LEAST recent thing on the screen, so nulls sort last — which IS
 * MariaDB's own behaviour under DESC (NULLs last; first under ASC —
 * verified live, and the opposite of Postgres's default), but it is
 * stated as an explicit IS NULL key so the intent survives a reader's
 * doubt and any future port. The lastBorrowerName subquery's
 * orderByDesc(lost_reported_at) leans on the same NULLs-last behaviour.
 * code ends the order: unique per shelf, so the order is total.
 *
 * Not paged, knowingly: this set grows until somebody acts, but nothing
 * breaks at a few hundred rows, the order is already total, and adding a
 * paginate() later is two lines. The reference's docstring carries the
 * full accounting.
 */
final class LostCopiesQuery
{
    /** @return list<array<string, mixed>> */
    public function rows(): array
    {
        return array_values($this->base()
            ->with('book:id,slug,title,author,cover_url')
            ->addSelect(['last_borrower_name' => DB::table('loans')
                ->join('users', 'users.id', '=', 'loans.borrower_id')
                ->whereColumn('loans.copy_id', 'book_copies.id')
                ->where('loans.status', 'lost')
                ->orderByDesc('loans.lost_reported_at')
                ->limit(1)
                ->select('users.full_name'),
            ])
            ->orderByRaw('book_copies.lost_reported_at IS NULL ASC, book_copies.lost_reported_at DESC')
            ->orderBy('code')
            ->get()
            ->map(fn (BookCopy $copy) => [
                'copyId' => $copy->id,
                'code' => $copy->code,
                'bookId' => $copy->book_id,
                // Nullsafe for the analyser only — whereHas('book') makes
                // the relation non-null at runtime.
                'bookSlug' => $copy->book?->slug,
                'title' => $copy->book?->title,
                'coverUrl' => $copy->book?->cover_url,
                'author' => $copy->book?->author,
                'condition' => $copy->condition->value,
                'reportedAt' => $copy->lost_reported_at?->toIso8601String(),
                'lastBorrowerName' => $copy->getAttribute('last_borrower_name'),
            ])
            ->all());
    }

    /**
     * The Đã mất (n) chip's number — the SAME predicate as rows(), and
     * LostCopiesTest asserts the two agree rather than trusting that they
     * look alike: a chip whose count disagrees with the screen it opens is
     * the defect the reference spent a paragraph on.
     */
    public function count(): int
    {
        return $this->base()->count();
    }

    /** @return Builder<BookCopy> */
    private function base(): Builder
    {
        return BookCopy::query()
            ->where('state', CopyState::Lost)
            ->whereHas('book');   // a soft-deleted book takes its lost copies off both
    }
}
