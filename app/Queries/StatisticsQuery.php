<?php

namespace App\Queries;

use App\Enums\StatsPeriod;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Loan;
use App\Models\Membership;
use App\Support\Clock;
use Carbon\CarbonImmutable;

/**
 * OPS §3.3's GetStatistics — BR §16.3's *Thống kê* screen. Port of
 * old_next/src/domain/shelf/queries/get-statistics.ts's getStatistics
 * (opened), one figure at a time, computed at read time over `loans`,
 * `books` and `book_copies` as they stand — nothing here is a materialised
 * counter, so a voided loan stops being counted the moment it is voided.
 *
 * TENANCY IS BookshelfScope's, on Loan, Book and BookCopy. No
 * `bookshelf_id` predicate is written in this file, and no join below
 * names it — TenancyArchitectureTest's filter grep (lines 145, 182,
 * opened) documents a join() naming the column as one of two blind spots
 * left open on purpose, and App\Queries\DonationQueueQuery's docblock
 * records the same choice for its own join. The joins in byCategory,
 * topBooks and topReaders below are safe against that gap for a
 * structural reason, not a promise: `loans` is the driving table in every
 * one of them, already scoped by BookshelfScope before the join is ever
 * planned, and `books`/`categories`/`book_copies`/`users` are joined only
 * to pull a label or a name onto rows the scope already narrowed — no
 * join condition anywhere below tests `bookshelf_id`. `topReaders`' live
 * membership check is deliberately NOT a fourth join for the same reason:
 * it is a `whereIn` against a `Membership::query()` subquery, which is
 * both `BookshelfScope`'d and `SoftDeletes`'d by construction, so it
 * reaches the same restriction the reference's `memberships` join has
 * with no join condition to keep out of the blind spot.
 *
 * THE WINDOW'S LOWER BOUND comes from Clock::periodStart(), computed once
 * in PHP rather than in SQL — the reference does it with Postgres
 * `date_trunc(... at time zone 'Asia/Ho_Chi_Minh')`, which MariaDB has no
 * equivalent for. Doing it in PHP removes the problem instead of porting
 * it, and is what makes the boundary testable with setTestNow() and no
 * database arithmetic to get wrong twice (Task 1, Clock::periodStart's
 * own docblock).
 *
 * DIVERGENCE D2 — LOST COPIES ARE COUNTED BY `lost_reported_at`, NOT
 * `updated_at`. The reference's own predicate, quoted in full:
 *
 *   select count(*) from book_copies
 *   where state = 'lost' and deleted_at is null and updated_at >= ${since}::timestamptz
 *
 * `updated_at` moves on any write, so a copy reported lost years ago
 * re-enters the period the moment someone edits its condition note — this
 * project's copiesLost figure would then count an edit, not a loss. This
 * schema carries `book_copies.lost_reported_at`, written by
 * App\Actions\Catalogue\ReportCopyLost line 70 (opened) at the moment a
 * copy is actually reported lost, so the honest predicate is available
 * here and used: `state = 'lost' and lost_reported_at >= :since`. Ruled by
 * the product owner on 2026-08-31: correctness over parity. SoftDeletes'
 * `deleted_at is null` is implicit ONLY for the model-driven reads —
 * `booksAdded` (Book::query()) and this copiesLost check
 * (BookCopy::query()) — because the trait's global scope runs on those
 * models directly. It buys nothing for the three raw joins below
 * (byCategory, topBooks, topReaders): a joined table carries no global
 * scope of its own, so a trashed row on the far side of `join('books', …)`
 * or `join('users', …)` is invisible to Eloquent's trait machinery and
 * must be excluded by a predicate written here if it matters. topReaders'
 * null check on `users.deleted_at` below is exactly that predicate — its
 * absence was Finding 1 of this task's first review round.
 *
 * THE DAILY CHART GROUPS BY THE NUMERIC OFFSET `'+07:00'`, NOT THE ZONE
 * NAME. `CONVERT_TZ(t, 'UTC', 'Asia/Ho_Chi_Minh')` requires MariaDB's
 * `mysql.time_zone_name` table to be populated. It IS populated on this
 * development container — measured, `SELECT COUNT(*) FROM
 * mysql.time_zone_name` returns 1793 — but the production cPanel host is
 * unverified, and a host with empty timezone tables answers NULL rather
 * than erroring, which would silently empty the chart. Asia/Ho_Chi_Minh
 * has been a fixed UTC+7 with no DST since 1975, so the numeric offset is
 * exact and depends on nothing being loaded. Measured on MariaDB 10.11.19:
 * `DATE(CONVERT_TZ('2026-08-31 18:30:00','+00:00','+07:00'))` returns
 * `2026-09-01`.
 *
 * RETRACTED — a false rationale for dropping the `memberships` join. An
 * earlier draft of `topReaders` omitted joining `memberships`
 * (get-statistics.ts:172-173, opened, joins `users` then `memberships`)
 * and justified the omission as removing a fan-out: "a user with
 * memberships on two shelves would be counted twice through it." That
 * cannot happen. `memberships_one_per_shelf unique (bookshelf_id,
 * user_id)` (old_next/src/db/migrations/0003_identity.sql:107, opened)
 * and `memberships` sits in the RLS table list under `force row level
 * security` (old_next/src/db/migrations/0010_rls.sql:61, opened) — so at
 * most one membership row per user is ever visible within a shelf, and
 * there is no fan-out to remove. What the join actually does, and what
 * this port was silently NOT doing, is exclude a borrower with no live
 * membership on this shelf — the reference's deliberate behaviour
 * (get-statistics.ts:172-173's `join memberships m on m.user_id = u.id and
 * m.deleted_at is null`), and this file now matches it: `topReaders`
 * below filters `loans.borrower_id` through a `Membership::query()`
 * subquery rather than a raw join, so the exclusion is scoped by
 * `BookshelfScope` and `SoftDeletes` by construction, with no join
 * condition anywhere in this file naming `bookshelf_id`.
 *
 * DIVERGENCE — THE ROUTE PARAMETER IS `?period=`, NOT THE REFERENCE'S
 * `?ky=`. get-statistics.ts's docblock and thong-ke/page.tsx read `ky`.
 * This port's route paths are English throughout (`/manage/statistics`,
 * not `/quan-ly/thong-ke`), so an English query parameter is the
 * consistent choice. Cosmetic and reversible, numbered because this
 * project numbers divergences.
 *
 * `topBooks` and `topReaders` both add `id` beside the count as a
 * deterministic tie-break — without one, a tie between two titles or two
 * names orders differently on every read, exactly the failure the
 * reference's own topBooks comment warns it has "measured... three
 * times".
 */
final class StatisticsQuery
{
    public function __construct(private Clock $clock) {}

    /** The window's lower bound, delegated to Task 1's Clock — never recomputed here. */
    private function since(StatsPeriod $period): CarbonImmutable
    {
        return $this->clock->periodStart($period);
    }

    /**
     * @return array{period: string, loans: int, borrowers: int, booksAdded: int, copiesLost: int, daily: list<array{day: string, count: int}>, byCategory: list<array{label: string, count: int}>, topBooks: list<array{bookId: string, slug: string, title: string, count: int}>, topReaders: list<array{name: string, count: int}>}
     */
    public function run(StatsPeriod $period): array
    {
        $since = $this->since($period);

        // Voided loans are excluded everywhere below — BR §11 keeps the row
        // so "why is there no loan here" has an answer, and a void is a
        // correction of a mistake rather than a lending event.
        $loansInPeriod = Loan::query()
            ->where('lent_at', '>=', $since)
            ->where('status', '!=', 'voided');

        $loans = (int) $loansInPeriod->clone()->count();
        $borrowers = (int) $loansInPeriod->clone()->distinct()->count('borrower_id');

        $booksAdded = (int) Book::query()->where('created_at', '>=', $since)->count();

        $copiesLost = (int) BookCopy::query()
            ->where('state', 'lost')
            ->where('lost_reported_at', '>=', $since)
            ->count();

        $daily = array_values($loansInPeriod->clone()
            ->selectRaw("DATE(CONVERT_TZ(lent_at, '+00:00', '+07:00')) as day, COUNT(*) as n")
            ->groupBy('day')
            ->orderBy('day')
            ->get()
            ->map(fn (Loan $row): array => [
                'day' => (string) $row->getAttribute('day'),
                'count' => (int) $row->getAttribute('n'),
            ])
            ->all());

        $byCategory = array_values($loansInPeriod->clone()
            ->join('books', 'books.id', '=', 'loans.book_id')
            ->leftJoin('categories', 'categories.id', '=', 'books.category_id')
            ->selectRaw("COALESCE(categories.name, 'Chưa phân loại') as label, COUNT(*) as n")
            ->groupBy('label')
            ->orderByDesc('n')
            ->orderBy('label')
            ->get()
            ->map(fn (Loan $row): array => [
                'label' => (string) $row->getAttribute('label'),
                'count' => (int) $row->getAttribute('n'),
            ])
            ->all());

        $topBooks = array_values($loansInPeriod->clone()
            ->join('books', 'books.id', '=', 'loans.book_id')
            ->selectRaw('books.id as book_id, books.slug as slug, books.title as title, COUNT(*) as n')
            ->groupBy('books.id', 'books.slug', 'books.title')
            ->orderByDesc('n')
            ->orderBy('books.title')
            ->orderBy('books.id')
            ->limit(5)
            ->get()
            ->map(fn (Loan $row): array => [
                'bookId' => (string) $row->getAttribute('book_id'),
                'slug' => (string) $row->getAttribute('slug'),
                'title' => (string) $row->getAttribute('title'),
                'count' => (int) $row->getAttribute('n'),
            ])
            ->all());

        // Both restrictions the reference's memberships/users joins carry
        // (get-statistics.ts:172-173, opened) are restored here without a
        // raw join naming the shelf column: a null check on
        // users.deleted_at is a plain predicate on the joined table (a
        // joined table carries no SoftDeletes scope of its own — see the
        // class docblock), and the membership restriction is a subquery
        // through Membership::query(), which carries BookshelfScope and
        // SoftDeletes by construction, so it excludes a borrower with no
        // live membership on THIS shelf without a join condition ever
        // testing that column.
        $topReaders = array_values($loansInPeriod->clone()
            ->join('users', 'users.id', '=', 'loans.borrower_id')
            ->whereNull('users.deleted_at')
            ->whereIn('loans.borrower_id', Membership::query()->select('user_id'))
            ->selectRaw("COALESCE(NULLIF(users.display_name, ''), users.full_name) as name, users.id as user_id, COUNT(*) as n")
            ->groupBy('name', 'users.id')
            ->orderByDesc('n')
            ->orderBy('name')
            ->orderBy('users.id')
            ->limit(5)
            ->get()
            ->map(fn (Loan $row): array => [
                'name' => (string) $row->getAttribute('name'),
                'count' => (int) $row->getAttribute('n'),
            ])
            ->all());

        return [
            'period' => $period->value,
            'loans' => $loans,
            'borrowers' => $borrowers,
            'booksAdded' => $booksAdded,
            'copiesLost' => $copiesLost,
            'daily' => $daily,
            'byCategory' => $byCategory,
            'topBooks' => $topBooks,
            'topReaders' => $topReaders,
        ];
    }
}
