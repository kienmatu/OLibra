<?php

namespace App\Queries;

use App\Enums\CopyState;
use App\Enums\RequestStatus;
use App\Models\BookCopy;
use App\Models\BorrowRequest;
use App\Support\Circulation\LendingSettings;
use App\Support\Clock;
use App\Support\Members\ParishUnits;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use RuntimeException;

/**
 * OPS §3.3's GetBorrowRequestQueue — requests grouped by book in
 * request-time order, with position, hold expiry and the free copies a
 * manager may approve somebody onto. Port of
 * get-borrow-request-queue.ts; its docblock's three arguments travel:
 *
 * WHAT COUNTS AS QUEUED: pending and approved, nothing else. The
 * approved row is the one the manager most needs — the child whose copy
 * waits on the shelf. `expired` is the status a lapsed hold WOULD carry
 * if anything wrote it, and nothing does: holdExpired below is computed
 * per row against the injected clock, and the lapsed row STAYS, flagged
 * — hiding it would hide the one thing on the screen going wrong.
 *
 * THE ORDER IS TOTAL and one half of it is folded: title_folded then
 * book id between titles (byte order puts every Đất above every Alice —
 * the defect the reference shipped twice), requested_at then id within
 * one (two children queueing after the same Sunday mass tie to the
 * second, and untied rows renumber between reads). position's window
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
 * NO INLINE GATE, and that is the house shape, not an omission: every
 * shipped query in app/Queries/ relies on the route's role middleware
 * plus the controller's own Gate — OverdueLoansQuery::run(string $sort),
 * ManagerDashboardQuery::run() and MyDashboardQuery::run(User) each carry
 * none (verified by opening all three, 2026-08-30). An inline
 * Gate::authorize here would also break the one legitimate non-HTTP
 * caller this plan creates, ManagerDashboardQuery's delegation to
 * countWaiting(). Task 14's routes carry role:manager and its
 * architecture test asserts so.
 */
final class BorrowRequestQueueQuery
{
    public function __construct(
        private Clock $clock,
        private TenantContext $tenant,
        private ParishContextQuery $parishContext,
    ) {}

    /** @return list<array<string, mixed>> */
    public function run(?string $bookId = null): array
    {
        $shelf = $this->tenant->bookshelf();
        if ($shelf === null) {
            throw new RuntimeException('BorrowRequestQueueQuery needs a bound tenant.');
        }
        $holdDays = LendingSettings::fromShelf($shelf)->holdDays;
        $now = $this->clock->now();

        $rows = BorrowRequest::query()
            ->join('books', function ($join) {
                $join->on('books.id', '=', 'borrow_requests.book_id')->whereNull('books.deleted_at');
            })
            ->join('users', function ($join) {
                $join->on('users.id', '=', 'borrow_requests.member_id')->whereNull('users.deleted_at');
            })
            ->leftJoin('memberships', function ($join) {
                // Column-to-column shelf equality: a JOIN predicate — the
                // person may hold memberships of several shelves, and the
                // parish line must be THIS shelf's. Not a tenant filter
                // (BookshelfScope on borrow_requests already did that);
                // TenancyArchitectureTest's grep looks for a WHERE-shaped
                // Eloquent call, the dynamic magic-where variant, or a
                // raw-SQL WHERE clause, naming the shelf column, and this
                // is an ON clause instead, so the join predicate below
                // stays green — confirmed by running
                // TenancyArchitectureTest against this file.
                $join->on('memberships.user_id', '=', 'borrow_requests.member_id')
                    ->on('memberships.bookshelf_id', '=', 'borrow_requests.bookshelf_id')
                    ->whereNull('memberships.deleted_at');
            })
            ->leftJoin('book_copies', 'book_copies.id', '=', 'borrow_requests.copy_id')
            ->whereIn('borrow_requests.status', [RequestStatus::Pending, RequestStatus::Approved])
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
            $holdExpiresAt = $r->getAttribute('hold_expires_at');
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
                'requestedAt' => CarbonImmutable::parse((string) $r->getAttribute('requested_at'), 'UTC')->toISOString(),
                // ->status->value, NOT (string) $r->getAttribute('status').
                // $r is a BorrowRequest and the model casts status to
                // RequestStatus (app/Models/BorrowRequest.php:21), so the
                // cast form is (string) on an enum OBJECT — a fatal on
                // every row, taking down every queue test, the manager
                // queue screen, the return screen's waiting panel and the
                // dashboard card.
                'status' => $r->status->value,
                'copyId' => $r->getAttribute('copy_id'),
                'copyCode' => $r->getAttribute('copy_code'),
                'holdExpiresAt' => $holdExpiresAt === null ? null : CarbonImmutable::parse((string) $holdExpiresAt, 'UTC')->toISOString(),
                // BR §8, derived against the injected clock; false for a
                // pending row, which has no hold to have expired. A
                // FOURTH reader of a hold, alongside the three
                // CancelOwnRequest.php:44-61 enumerates — that comment is
                // updated, to say FOUR and to name this one, in the same
                // commit as this file.
                'holdExpired' => $holdExpiresAt !== null
                    && CarbonImmutable::parse((string) $holdExpiresAt, 'UTC')->lessThanOrEqualTo($now),
            ];
            $queues[$bid]['waiting'] = count($queues[$bid]['requests']);
        }

        return array_values($queues);
    }

    /**
     * The badge/card count — counted the way the list is selected, never
     * a shorter way that happens to agree today: same statuses, same
     * live-book and live-user joins that could drop a row.
     */
    public function countWaiting(): int
    {
        return BorrowRequest::query()
            ->join('books', function ($join) {
                $join->on('books.id', '=', 'borrow_requests.book_id')->whereNull('books.deleted_at');
            })
            ->join('users', function ($join) {
                $join->on('users.id', '=', 'borrow_requests.member_id')->whereNull('users.deleted_at');
            })
            ->whereIn('borrow_requests.status', [RequestStatus::Pending, RequestStatus::Approved])
            ->count();
    }
}
