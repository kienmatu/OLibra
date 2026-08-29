<?php

namespace App\Queries;

use App\Enums\CopyState;
use App\Enums\RequestStatus;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Support\Circulation\LendingSettings;
use App\Support\Clock;
use App\Support\Members\ParishUnits;
use App\Support\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use RuntimeException;

/**
 * OPS §3.3's GetBorrowRequestQueue — requests grouped by book in
 * request-time order, with position, hold expiry and the free copies a
 * manager may approve somebody onto. Port of
 * get-borrow-request-queue.ts; its docblock's three arguments travel:
 *
 * WHAT COUNTS AS QUEUED: pending and approved, nothing else. The
 * approved row is the one the manager most needs — the child whose copy
 * waits on the shelf. A lapsed hold is not a status here: holdExpired
 * below is computed per row against the injected clock, and the lapsed
 * row STAYS, flagged — hiding it would hide the one thing on the screen
 * going wrong. `expired` IS written, by exactly one command
 * (ReleaseExpiredHold, ruling 1, Task 18) and only when a manager presses
 * Trả về kệ on such a row; that is what takes the row out of this
 * where-in and off the screen, which is the point of pressing it. Nothing
 * else writes the status and no job does.
 *
 * THE ORDER IS TOTAL and one half of it is folded: title_folded then
 * book id between titles (byte order puts every Đất above every Alice —
 * a defect found in three instances across two audits, U2's two
 * catalogue queries and U3's getReadersList), requested_at then id
 * within one (two children queueing after the same Sunday mass tie to
 * the second, and untied rows renumber between reads — BR §7.2 (this
 * project's own docs/BUSINESS-REQUIREMENTS.md, not the reference) says
 * only "ordered by request time" and names no tiebreak at all; the
 * missing tiebreak is a SEPARATE defect the reference shipped twice —
 * U2 measured a 304→229 paged-walk collapse, U3 found two tiebreak
 * tests green against the broken query). `borrow-request-queue.test.ts:
 * 367-452` is the reference's answer to that: a 28-row, four-title/
 * three-instant fixture built non-degenerate on purpose, asserted
 * against the full lexicographic order rather than "ascending by id" —
 * the shape a BROKEN query produces on its own when nothing ties.
 * Ported (BorrowRequestQueueQueryTest.php), but ITS DESIGN DOES NOT
 * TRANSFER TO MARIADB (review fix round 2): the reference's own comment
 * says the fixture works by pushing Postgres past "the seven-tuple
 * threshold below which Postgres sorts with a stable insertion sort"
 * into an UNSTABLE sort that actively reorders ties
 * (borrow-request-queue.test.ts:370-390); MariaDB's in-memory filesort
 * does the opposite at this row count — it preserves input order for a
 * tied group — so dropping either id tiebreak (book id OR request id)
 * entirely produces the SAME row order here, measured directly against
 * this query, not inferred. What actually holds the line on this
 * engine is BorrowRequestQueueQueryTest's SECOND ordering test,
 * asserting the tiebreak's presence in the generated SQL itself rather
 * than in its output — see that test's own comment for the bound this
 * carries (in-memory filesort, this row count; untested past a sort
 * that spills to merge passes or a plan change). position's window
 * uses the SAME two keys as the outer order, so the number printed
 * beside a row and the row's place cannot disagree. Not paged: the set
 * is bounded by its own state.
 *
 * SCOPING: BookshelfScope on BorrowRequest does the tenancy; users
 * carries no scope and is joined directly (it can only narrow);
 * memberships is joined OUTWARD, on user AND the shelf column
 * (column-to-column — a join predicate, not a hand-written tenant
 * filter), for the id and parish placement alone: an inner join would
 * drop every request whose reader has left, precisely the row a manager
 * needs in order to clear it.
 *
 * run() AND countWaiting() SHARE waiting() below — one builder, one
 * predicate, one bound-tenant guard — rather than two statements that
 * merely read identically today: identical text in two method bodies is
 * still a drift-capable pair (review, fix round 1), and the earlier
 * shape let countWaiting() answer a cross-tenant count under
 * TenantContext::actSystemWide() while run() correctly refused — the
 * badge and the list disagreeing in exactly the mode the headline
 * requirement forbids. TenancyArchitectureTest's grep does not reach
 * ANY of this: it looks for a WHERE-shaped Eloquent call, the dynamic
 * magic-where variant, or a raw-SQL WHERE clause naming the shelf
 * column; waiting()'s memberships join is an ON clause instead, and the
 * scoping itself is BookshelfScope on the base BorrowRequest query, not
 * a hand-written filter here — confirmed by running
 * TenancyArchitectureTest against this file.
 *
 * NO INLINE GATE, and that is the house shape, not an omission: the
 * shipped queries in app/Queries/ leave authorization to the route's role
 * middleware — OverdueLoansQuery::run(string $sort),
 * ManagerDashboardQuery::run() and MyDashboardQuery::run(User) each carry
 * none (verified by opening all three, 2026-08-30).
 *
 * CORRECTED (review fix round 1, item 3): this sentence used to read
 * "the route's role middleware PLUS the controller's own Gate", and that
 * overstates the layering by one. The controllers behind those three
 * queries — OverdueController::index, DashboardController::index,
 * MyLoansController::overview — are bare Inertia::render with a query and
 * carry no Gate at all (opened, 2026-08-30), and neither do this query's
 * two run() callers, Manage\BorrowRequestController::index and (Phase 2a
 * Task 15) Manage\ReturnController::index, which narrows run() to the
 * chosen loan's title for the return screen's waiting panel — both sit
 * inside the same 'manage' route group's role:manager middleware
 * (routes/web.php), so the guard this paragraph is arguing about is the
 * same one either way. A controller Gate is real on some manage READ
 * screens (BookController, LostCopiesController, ReaderController,
 * RegistrationQueueController all call Gate::authorize('viewAny', ...))
 * and simply absent on others; the middleware is the layer common to all
 * of them.
 *
 * An inline Gate::authorize here would also break the one legitimate
 * non-HTTP caller this plan creates, ManagerDashboardQuery's delegation
 * to countWaiting(). The manager routes that call run() carry role:manager
 * and CirculationArchitectureTest asserts so; with that middleware
 * removed the GET was measured answering 200 to a reader (Task 14),
 * which is what the middleware, not this class, is there to prevent.
 */
final class BorrowRequestQueueQuery
{
    public function __construct(
        private Clock $clock,
        private TenantContext $tenant,
        private ParishContextQuery $parishContext,
    ) {}

    /**
     * The one place the bound-tenant guard lives — waiting() calls this
     * for its side effect (the throw); run() calls it again for the
     * Bookshelf itself, non-null by construction, so Larastan sees a
     * real narrowing rather than a comment asserting one.
     */
    private function boundShelf(): Bookshelf
    {
        $shelf = $this->tenant->bookshelf();
        if ($shelf === null) {
            throw new RuntimeException('BorrowRequestQueueQuery needs a bound tenant.');
        }

        return $shelf;
    }

    /**
     * The joined, status-filtered builder run() and countWaiting() both
     * build on — so a caller under TenantContext::actSystemWide()
     * (boundShelf() throwing) gets the SAME refusal from countWaiting()
     * that run() has always given, instead of a cross-tenant count with
     * no list to match it.
     *
     * @return Builder<BorrowRequest>
     */
    private function waiting(): Builder
    {
        $this->boundShelf();

        return BorrowRequest::query()
            ->join('books', function ($join) {
                $join->on('books.id', '=', 'borrow_requests.book_id')->whereNull('books.deleted_at');
            })
            ->join('users', function ($join) {
                $join->on('users.id', '=', 'borrow_requests.member_id')->whereNull('users.deleted_at');
            })
            ->whereIn('borrow_requests.status', [RequestStatus::Pending, RequestStatus::Approved]);
    }

    /** @return list<array<string, mixed>> */
    public function run(?string $bookId = null): array
    {
        $shelf = $this->boundShelf();
        $base = $this->waiting();
        $holdDays = LendingSettings::fromShelf($shelf)->holdDays;
        $now = $this->clock->now();

        $rows = $base
            ->leftJoin('memberships', function ($join) {
                // Column-to-column shelf equality: a JOIN predicate — the
                // person may hold memberships of several shelves, and the
                // parish line must be THIS shelf's. Not a tenant filter
                // (BookshelfScope on borrow_requests already did that).
                $join->on('memberships.user_id', '=', 'borrow_requests.member_id')
                    ->on('memberships.bookshelf_id', '=', 'borrow_requests.bookshelf_id')
                    ->whereNull('memberships.deleted_at');
            })
            ->leftJoin('book_copies', 'book_copies.id', '=', 'borrow_requests.copy_id')
            ->when($bookId !== null, fn ($q) => $q->where('borrow_requests.book_id', $bookId))
            ->select([
                'borrow_requests.id as request_id', 'borrow_requests.book_id',
                'borrow_requests.member_id as reader_user_id', 'borrow_requests.requested_at',
                'borrow_requests.status', 'borrow_requests.copy_id', 'borrow_requests.hold_expires_at',
                'books.title', 'books.author', 'books.slug', 'books.cover_url',
                'users.full_name as reader_name',
                'memberships.id as membership_id', 'memberships.parish_unit_l1_id', 'memberships.parish_unit_l2_id',
                'book_copies.code as copy_code',
            ])
            // DIVERGENCE from the reader's own place in this same queue,
            // recorded rather than reconciled (Task 12 review round 1,
            // item 5; MyDashboardQuery named alongside BookDetailQuery,
            // Task 13 fix round 1, item 4). This ROW_NUMBER partitions
            // over the whole where-in set at :165 — pending AND approved —
            // while BookDetailQuery's myRequest counts PENDING rows ahead
            // only. For a title with one live hold, this screen shows
            // position 2 for the first pending row and the reader's own
            // book page tells them "vị trí 1" about it. Both are faithful
            // ports of their own reference screens; the two ship in the
            // same phase, so the disagreement is written down on both
            // sides instead of being discovered from a volunteer and a
            // child comparing phones. MyDashboardQuery::run's own requests
            // list runs the identical PENDING-only count as
            // BookDetailQuery for the reader's dashboard — a second
            // reader-facing surface this screen's number disagrees with
            // the same way.
            ->selectRaw('ROW_NUMBER() OVER (PARTITION BY borrow_requests.book_id ORDER BY borrow_requests.requested_at ASC, borrow_requests.id ASC) as position')
            ->orderBy('books.title_folded')->orderBy('books.id')
            ->orderBy('borrow_requests.requested_at')->orderBy('borrow_requests.id')
            ->get();

        // The copies a manager may choose from, per queued title. One
        // grouped query, not a per-row subquery. state=available IS the
        // borrowable set here: every hold-creating command sets `held` in
        // the same transaction (Tasks 5/10), so no available copy carries
        // a live hold — and ApproveBorrowRequest's two-clause predicate
        // still refuses the theoretical divergent row, so the list this
        // screen offers and the command's answer cannot disagree in the
        // promise-it-twice direction. Ordered by code: stable between two
        // loads.
        $bookIds = $rows->pluck('book_id')->unique()->values();
        $freeByBook = BookCopy::query()
            ->whereIn('book_id', $bookIds)
            ->where('state', CopyState::Available)
            ->orderBy('code')
            ->get(['id', 'book_id', 'code'])
            ->groupBy('book_id');

        $context = $this->parishContext->run();

        $queues = [];
        foreach ($rows as $r) {
            $bid = (string) $r->getAttribute('book_id');
            if (! isset($queues[$bid])) {
                $queues[$bid] = [
                    'bookId' => $bid,
                    'title' => (string) $r->getAttribute('title'),
                    'author' => $r->getAttribute('author'),
                    'slug' => (string) $r->getAttribute('slug'),
                    'coverUrl' => $r->getAttribute('cover_url'),
                    'waiting' => 0,
                    'holdDays' => $holdDays,
                    'requests' => [],
                    'freeCopies' => ($freeByBook[$bid] ?? collect())->map(fn (BookCopy $c) => [
                        'copyId' => $c->id, 'code' => $c->code,
                    ])->values()->all(),
                ];
            }
            // Magic property, not getAttribute(): requested_at and
            // hold_expires_at are real casts() entries (unlike the
            // select-aliased columns below), so $r already hands back a
            // Carbon instance — reading it as (string) and reparsing
            // (the shape this line replaced, review fix round 1) throws
            // away Carbon's default __toString() has no microseconds,
            // silently truncating the DATETIME(6) column to whole
            // seconds in both the emitted ISO string and the expiry
            // comparison below.
            $holdExpiresAt = $r->hold_expires_at;
            $queues[$bid]['requests'][] = [
                'requestId' => (string) $r->getAttribute('request_id'),
                'position' => (int) $r->getAttribute('position'),
                'membershipId' => $r->getAttribute('membership_id'),
                'readerUserId' => (string) $r->getAttribute('reader_user_id'),
                'readerName' => (string) $r->getAttribute('reader_name'),
                'parishLine' => ParishUnits::describeSelection(
                    $context['taxonomy'], $context['units'],
                    $r->getAttribute('parish_unit_l1_id'), $r->getAttribute('parish_unit_l2_id'),
                ),
                'requestedAt' => $r->requested_at->toISOString(),
                // ->status->value, NOT (string) $r->getAttribute('status').
                // $r is a BorrowRequest and the model casts status to
                // RequestStatus (app/Models/BorrowRequest.php:22), so the
                // cast form is (string) on an enum OBJECT — a fatal on
                // every row, taking down every queue test, the manager
                // queue screen, the return screen's waiting panel and the
                // dashboard card.
                'status' => $r->status->value,
                'copyId' => $r->getAttribute('copy_id'),
                'copyCode' => $r->getAttribute('copy_code'),
                'holdExpiresAt' => $holdExpiresAt?->toISOString(),
                // BR §8, derived against the injected clock; false for a
                // pending row, which has no hold to have expired. A
                // FOURTH reader of a hold, alongside the three
                // CancelOwnRequest.php:44-62 enumerates — that comment
                // says FOUR and names this one, in the same commit as
                // this file.
                //
                // And the only CLOCK COMPARISON in the app: Task 12's
                // reader book page renders holdExpiresAt as a deadline
                // with no comparison at all, so a lapsed hold still reads
                // "nhận trước ..." to the child while reading expired to
                // the volunteer. This flag now has two consumers — Task
                // 14's resources/js/pages/manage/borrow-requests.tsx picks
                // the holdExpiredNote/holdNote wording off it and Task 18
                // shows its Trả về kệ button off it, neither doing the
                // comparison itself. Recorded on both sides
                // (resources/js/pages/shelves/book.tsx's myRequest
                // docblock carries the twin) rather than fixed: no job
                // sweeps a lapsed hold, and until a manager releases one
                // the reader's line goes on reading "nhận trước ...".
                // After a release the row is `expired` and leaves this
                // query and both reader screens alike.
                'holdExpired' => $holdExpiresAt !== null && $holdExpiresAt->lessThanOrEqualTo($now),
            ];
            $queues[$bid]['waiting'] = count($queues[$bid]['requests']);
        }

        return array_values($queues);
    }

    /**
     * The badge/card count — counted the way the list is selected, never
     * a shorter way that happens to agree today: waiting() is the same
     * builder run() starts from, so the two cannot drift.
     */
    public function countWaiting(): int
    {
        return $this->waiting()->count();
    }
}
