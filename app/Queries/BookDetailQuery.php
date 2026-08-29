<?php

namespace App\Queries;

use App\Enums\RequestStatus;
use App\Models\Book;
use App\Models\BorrowRequest;
use App\Models\Loan;
use App\Models\User;
use App\Queries\Concerns\CountsCopies;
use App\Support\Clock;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;

/**
 * GetBookDetail, reader flavour (OPS §3.2) — port of get-book-detail.ts.
 * Everything derived is derived: copiesAvailable from the borrowable
 * predicate, daysRemaining from due_on against the clock (never a stored
 * column — "there is no is_overdue column, and there must never be one"),
 * queueLength from the count of pending requests (BR §7.2: the queue IS
 * the pending set; no separate reservation concept), and — Phase 2a —
 * myRequest, the VIEWER's own live row in that same set, numbered on read
 * rather than stored.
 *
 * The is_published gate is the CONTROLLER's (a draft 404s before this
 * runs) — this query serves an already-resolved model.
 *
 * currentLoan honours two shelf settings, defaults per BR §5.5 because a
 * shelf row need only store what it overrides: public_show_current_borrower
 * (default true) suppresses the whole block when false;
 * public_name_display (default full_name) picks the name — display_name
 * falls back to the full name, hidden keeps the loan facts and drops the
 * name. Manager-only fields (BR §5.3) are never returned regardless.
 */
final class BookDetailQuery
{
    use CountsCopies;

    public function __construct(
        private CatalogueQuery $catalogue,
        private TenantContext $context,
        private Clock $clock,
    ) {}

    /**
     * $viewer is who is READING this page, and it is a parameter rather
     * than an Auth:: call inside the query for the reason
     * MyDashboardQuery::run(User $reader) is: the caller knows. Nullable
     * because the query must answer for a caller with no viewer at all —
     * ReaderQueriesTest calls it that way — though over HTTP today the
     * one route that reaches it sits in an `auth` group, so
     * BookController's $request->user() is never null there.
     *
     * @return array<string, mixed>
     */
    public function run(Book $book, ?User $viewer = null): array
    {
        $withCounts = $this->withCopyCounts(Book::query())
            ->with('category:id,name,slug')
            ->findOrFail($book->id);

        $queueLength = BorrowRequest::query()
            ->where('book_id', $book->id)
            ->where('status', 'pending')
            ->count();

        // The viewer's own place in this title's queue, or null. Own =
        // member_id (a users id, despite the column's name — the schema's
        // recurring trap) equals the signed-in user, never a membership
        // id. Position is derived on read: pending rows ahead + 1, by the
        // queue's own two ordering keys (requested_at, then id — the same
        // pair BorrowRequestQueueQuery numbers by), so it cannot drift
        // from a stored column. An approved request has a hold, not a
        // position.
        $mine = $viewer === null ? null : BorrowRequest::query()
            ->where('book_id', $book->id)
            ->where('member_id', $viewer->id)
            ->whereIn('status', [RequestStatus::Pending, RequestStatus::Approved])
            ->orderBy('requested_at')->orderBy('id')
            ->first();
        $myRequest = null;
        if ($mine !== null) {
            $ahead = $mine->status === RequestStatus::Pending
                ? BorrowRequest::query()
                    ->where('book_id', $book->id)
                    ->where('status', RequestStatus::Pending)
                    ->where(function ($q) use ($mine) {
                        $q->where('requested_at', '<', $mine->requested_at)
                            ->orWhere(fn ($qq) => $qq->where('requested_at', $mine->requested_at)->where('id', '<', $mine->id));
                    })
                    ->count()
                : null;
            $myRequest = [
                'requestId' => $mine->id,
                'status' => $mine->status->value,
                'queuePosition' => $ahead === null ? null : $ahead + 1,
                'holdExpiresAt' => $mine->hold_expires_at?->toISOString(),
            ];
        }

        // Materialise the AsArrayObject (or a null shelf) into a plain
        // array first: `null['key']` is a PHP warning, and PHPUnit treats
        // warnings as failures.
        $shelf = $this->context->bookshelf();
        $settings = (array) ($shelf !== null ? $shelf->settings : []);
        $showBorrower = ($settings['public_show_current_borrower'] ?? true) !== false;

        $currentLoan = null;

        if ($showBorrower) {
            // The earliest-due active loan — ordered, never a bare first().
            $loan = Loan::query()
                ->where('book_id', $book->id)
                ->where('status', 'active')
                ->orderBy('due_on')
                ->first();

            if ($loan instanceof Loan) {
                $holder = User::query()->find($loan->borrower_id);
                $display = $settings['public_name_display'] ?? 'full_name';

                $currentLoan = [
                    'holderName' => match ($display) {
                        'hidden' => null,
                        'display_name' => $holder !== null ? ($holder->display_name ?? $holder->full_name) : null,
                        default => $holder?->full_name,
                    },
                    'daysRemaining' => (int) CarbonImmutable::parse($this->clock->today())
                        ->diffInDays($loan->due_on->toDateString(), false),
                    'dueOn' => $loan->due_on->toDateString(),
                ];
            }
        }

        return array_merge($this->catalogue->row($withCounts), [
            'publisher' => $withCounts->publisher,
            'publishedYear' => $withCounts->published_year,
            'pageCount' => $withCounts->page_count,
            'isbn' => $withCounts->isbn,
            'description' => $withCounts->description,
            'language' => $withCounts->language,
            'onLoan' => (int) $withCounts->getAttribute('on_loan_count'),
            'queueLength' => $queueLength,
            'myRequest' => $myRequest,
            'currentLoan' => $currentLoan,
        ]);
    }
}
