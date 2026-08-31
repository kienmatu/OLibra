<?php

namespace App\Queries;

use App\Enums\RequestStatus;
use App\Models\Book;
use App\Models\BorrowRequest;
use App\Models\Loan;
use App\Models\User;
use App\Queries\Concerns\CountsCopies;
use App\Support\Clock;
use App\Support\Community\CommentSettings;
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
        private BookCommentsQuery $comments,
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
        //
        // DIVERGENCE from the manager's own numbering of the same queue,
        // recorded rather than reconciled (review round 1, item 5;
        // MyDashboardQuery named alongside this one, Task 13 fix round 1,
        // item 4). The count below is over PENDING rows only;
        // BorrowRequestQueueQuery's ROW_NUMBER partitions over its whole
        // where-in set, pending AND approved (BorrowRequestQueueQuery.php
        // :173). So for a title with one live hold, the manager's screen
        // shows position 2 for the first pending row while this page tells
        // that same reader "vị trí 1". Both are faithful ports of their
        // own reference screens, and both readings are defensible — the
        // reader is being told how many people are ahead of them IN THE
        // QUEUE, the manager is being shown every live row in order — but
        // the two ship in the same phase and nothing else in the code says
        // they number different sets, so it is said here and in the twin
        // comment on the manager side. MyDashboardQuery::run's own
        // requests list runs the identical PENDING-only count for the
        // reader's dashboard, a second reader-facing surface that agrees
        // with this one and diverges from the manager's the same way.
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

        // WHETHER THE SHELF TAKES COMMENTS AT ALL, so the page can leave
        // the box off rather than offer one that will answer
        // comments_disabled. The key's spelling stays in
        // CommentSettings::fromShelf (App\Support\Community\
        // CommentSettings, opened at this commit) and is not repeated in
        // this file; a second copy is what that class's own docblock
        // argues against.
        //
        // The null shelf takes the same defaults an empty settings blob
        // does, which is the precedent set three statements above — a
        // null shelf becomes [] there and every read falls to its ??.
        // fromShelf's signature requires a Bookshelf, so the fallback is
        // spelled at this call site rather than inside it.
        //
        // MEASURED, not assumed: the null branch is dead over HTTP on the
        // one route that reaches this query. BookController::show sits in
        // routes/web.php's shelves/{shelf} group behind the `tenant`
        // middleware, and ResolveTenant (both files opened at this
        // commit) abort(404)s an unresolvable slug before it ever calls
        // TenantContext::set, so $shelf is a Bookshelf there. Replacing
        // this branch with a throw and running the whole suite is how
        // that was checked — no block reached it, ReaderQueriesTest's
        // direct calls included, because that fixture binds a shelf too.
        // And were run() ever reached with no tenant bound AND not
        // system-wide, the branch would not survive being alive: the
        // return below reads Comment through BookCommentsQuery, and
        // BookshelfScope::apply (opened at this commit) throws a
        // RuntimeException on a null bookshelfId. The both-conditions
        // wording is load-bearing and a first draft dropped half of it —
        // apply() RETURNS EARLY under TenantContext::isSystemWide(), which
        // BookCommentsScreenTest's own fixture calls, so under that mode a
        // null-shelf run() would not throw at all. The branch is dead over
        // HTTP for the measured reason above, not for this one.
        $commentsEnabled = $shelf === null || CommentSettings::fromShelf($shelf)->commentsEnabled;

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
            // THROUGH BookCommentsQuery, never a status predicate written
            // again here. INV-9 lives in that query's access path, and a
            // page that re-spelled `status = approved` would be a second
            // place for it to drift — the same structural rule
            // counts.pendingComments was held to.
            //
            // GATED ON THE SETTING, because resources/js/pages/shelves/
            // book.tsx (opened at this commit) hides the whole comments
            // section when commentsEnabled is false: an unconditional
            // read would ship every approved body to a page that has
            // already hidden the list, and run a SELECT to do it. Not a
            // confidentiality fix — the recipient is the same signed-in
            // reader of the same shelf, and the rows were on their screen
            // before the shelf turned comments off — but props a page
            // cannot use should not be built. BookCommentsScreenTest pins
            // the empty array on a comments-off shelf.
            'comments' => $commentsEnabled ? $this->comments->run($book) : [],
            'commentsEnabled' => $commentsEnabled,
        ]);
    }
}
