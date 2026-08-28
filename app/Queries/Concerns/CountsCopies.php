<?php

namespace App\Queries\Concerns;

use App\Enums\CopyState;
use App\Models\Book;
use App\Models\BookCopy;
use App\Support\Catalogue\Availability;
use App\Support\Clock;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\DB;

/**
 * The copy aggregates every catalogue query shares. borrowable() is the
 * copies_borrowable view as a predicate (spec §4: views "encode read
 * shapes, not invariants"; divergence 3 in the plan header) — BR §8's "a
 * copy is borrowable when it is available and no unexpired hold references
 * it", evaluated against the injected clock at read time, so a hold that
 * lapsed a minute ago is already gone from the count with no job having
 * run. If a copies_available column ever appears in a migration, this is
 * the rule it broke.
 *
 * copies_total excludes BOTH retired and lost copies (post-review fix
 * wave item 7): "N bản trong tủ" must not claim a location for a book
 * that is, definitionally, not there — and it must mean the same thing on
 * the list, the reader detail and the manager detail.
 */
trait CountsCopies
{
    /** @return Closure(Builder<BookCopy>|QueryBuilder): void */
    protected function borrowable(): Closure
    {
        $now = app(Clock::class)->now();

        return function ($q) use ($now): void {
            $q->where('state', CopyState::Available)
                ->whereNotExists(function (QueryBuilder $sub) use ($now): void {
                    $sub->select(DB::raw(1))
                        ->from('borrow_requests')
                        ->whereColumn('borrow_requests.copy_id', 'book_copies.id')
                        ->where('borrow_requests.status', 'approved')
                        ->whereNull('borrow_requests.deleted_at')
                        ->where('borrow_requests.hold_expires_at', '>', $now);
                });
        };
    }

    /**
     * @param  Builder<Book>  $query
     * @return Builder<Book>
     */
    protected function withCopyCounts(Builder $query): Builder
    {
        return $query
            ->withCount([
                'copies as copies_total' => fn (Builder $q) => $q->whereNotIn('state', [CopyState::Retired, CopyState::Lost]),
                'copies as available_count' => fn (Builder $q) => tap($q, $this->borrowable()),
                'copies as on_loan_count' => fn (Builder $q) => $q->where('state', CopyState::OnLoan),
                'copies as held_count' => fn (Builder $q) => $q->where('state', CopyState::Held),
                'copies as lost_count' => fn (Builder $q) => $q->where('state', CopyState::Lost),
                'copies as retired_count' => fn (Builder $q) => $q->where('state', CopyState::Retired),
            ])
            ->withMin(['copies as code_min' => fn (Builder $q) => $q->where('state', '!=', CopyState::Retired)], 'code')
            ->withMax(['copies as code_max' => fn (Builder $q) => $q->where('state', '!=', CopyState::Retired)], 'code');
    }

    /**
     * The M8 ladder over the aggregates withCopyCounts() loaded.
     * getAttribute(), not magic property reads, for every aggregate alias
     * throughout this plan's queries: Larastan level 8 rejects the magic
     * form on columns no @property declares (verified in review — five
     * errors), and annotating the MODELS with query-shape aliases would
     * be worse than the explicit accessor.
     */
    protected function availabilityFor(Book $book): string
    {
        return Availability::derive(
            (int) $book->getAttribute('available_count'),
            (int) $book->getAttribute('on_loan_count'),
            (int) $book->getAttribute('held_count'),
            (int) $book->getAttribute('lost_count'),
            (int) $book->getAttribute('retired_count') > 0,
        );
    }

    /** 'DT-0215 – DT-0217', a single code plain, '' when copyless. */
    protected function codesFor(Book $book): string
    {
        $min = $book->getAttribute('code_min');
        $max = $book->getAttribute('code_max');

        return match (true) {
            $min === null => '',
            $min === $max => (string) $min,
            default => $min.' – '.$max,
        };
    }
}
