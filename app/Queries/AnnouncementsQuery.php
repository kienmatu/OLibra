<?php

namespace App\Queries;

use App\Models\Announcement;
use App\Support\Clock;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;

/**
 * The read side of shelf news — OPS §3.2's GetAnnouncements,
 * GetAllAnnouncements and GetAnnouncementDetail in one class. Port of
 * old_next/src/domain/community/queries/get-announcements.ts.
 *
 * ONE BOUND INSTANT PER CALL. Each method below opens by reading the
 * injected Clock once into a local, and every comparison that method
 * makes binds that local (plan divergence 6). Two reads inside one
 * method would be two instants that differ in production by however
 * long the statement took and agree to the microsecond under any clock
 * that does not move — so a fixture that wants to see the difference
 * has to make the clock move, and one does. MEASURED: with published()
 * rewritten to read the clock a second time for its per-row comparison,
 * AnnouncementsQueryTest's "binds one instant even against a clock that
 * advances mid-call" is the whole suite's single failure. The tool is
 * Carbon::setTestNow(), which also accepts a Closure and re-evaluates
 * it on every read; that block is where this paragraph stops being a
 * convention.
 *
 * THE STATE IS DECIDED IN PHP, BY ONE HELPER, AND THAT HELPER IS THE
 * DESIGN. state() is called by managed() as a LABEL and by published()
 * and detail() as a FILTER, so the chip beside a notice on the
 * manager's screen and the notice's presence on the reader's page are
 * two uses of one comparison rather than two comparisons that agree
 * today. The reference's docblock on AnnouncementState makes the same
 * argument against a different third party — a `new Date()` inside a
 * React component — and it survives the port: a page handed publishedAt
 * and expiresAt could work the state out for itself, and must not, or a
 * lapsed notice drops off the reader's list while the manager's still
 * reads "Đang hiện" with nothing able to move either.
 *
 * MEASURED, on this class: with the derivation copied into managed() as
 * an inline expression and one comparison flipped to `<`, the boundary
 * pair in AnnouncementsQueryTest splits — the manager's half fails and
 * the reader's half passes, which is that disagreement reproduced.
 *
 * DIVERGENCE FROM THE REFERENCE (plan divergence 7). get-announcements
 * .ts computes the manager's state in SQL, as a CASE over olibra_now(),
 * and applies the reader's filter as a separate WHERE in a separate
 * statement — two spellings of the same two comparisons, which is what
 * lets them drift. Here the comparisons are written once, in PHP.
 *
 * WHY published() IS NARROWED IN SQL AS WELL. showing() puts the two
 * comparisons into the WHERE so a lapsed announcement is not fetched;
 * state() then decides what the caller gets. detail() shares showing()
 * with published() rather than repeating it, so "the same filter" is
 * one expression rather than two.
 *
 * state() DECIDES THE LABEL; EITHER LAYER CAN HIDE A ROW. published()
 * and detail() each require both layers to pass, so whichever of the
 * two hides a row wins — and the SQL half can hide a row state() would
 * have called showing, which is the fractional-published_at case the
 * precision paragraph below describes. What state() is sole authority
 * over is the WORD: it labels the manager's chip and it is what the
 * reader's filter consults, which is what makes the two screens one
 * comparison instead of two.
 *
 * THE SQL HALF CHANGES NO ROW THIS SUITE CAN SEE, which is why it is
 * pinned by its TEXT and not by its answers. Measured rather than
 * argued: deleting the PHP filter alone leaves AnnouncementsQueryTest
 * green — the SQL narrowing already removed every row it would have.
 *
 * The two SQL mutations are a different case and an earlier draft of
 * this paragraph got them wrong, so the correction is stated rather
 * than quietly applied: it claimed deleting showing() from published(),
 * and deleting showing()'s expiry clause, each left the suite green,
 * and then closed by saying deleting the narrowing fails the build.
 * Both halves cannot hold. That draft described the file as it stood
 * BEFORE the statement-text block landed in this same commit; with the
 * block in place both mutations are RED, each as that block's single
 * failure, because either edit changes the compiled where text.
 *
 * The narrowing is kept for something that is not an answer — a shelf
 * accrues lapsed announcements forever while its live set stays small,
 * and the narrowing keeps that archive off the wire on every reader
 * page load. Row assertions cannot see that, which is the whole reason
 * the pin is on the text.
 *
 * PRECISION, MEASURED, because it crosses a language boundary and that
 * is where this project's false claims have come from. state() compares
 * CarbonImmutable values at microsecond precision, while showing()
 * hands its instant to PDO through Laravel's MariaDbGrammar, whose date
 * format is 'Y-m-d H:i:s' — so the SQL side compares against a whole
 * second, floored. The two can only disagree about a row whose stored
 * instant carries a non-zero fraction, and this model writes none:
 * Announcement::getDateFormat() is that same 'Y-m-d H:i:s' (read off
 * the model in laravel-app-1), and a published_at handed in as
 * 04:00:00.250000 comes back out of the datetime(6) column as
 * 04:00:00.000000 (measured through CreateAnnouncement). A $dateFormat
 * carrying '.u', or a backfill written in raw SQL, is the mechanism
 * that would break that and put the two layers a fraction of a second
 * apart.
 *
 * TIMEZONE, MEASURED — the larger sibling of the precision note above,
 * and written in the same shape: the claim, where it holds, and the
 * mechanism that breaks it. state() compares
 * $announcement->published_at against Clock::now(). The left side is
 * materialized by Model::asDateTime, which ends at
 * Date::createFromFormat($format, $value) with NO timezone argument, so
 * the stored string is read in PHP's default zone — the one Laravel
 * sets from config('app.timezone'). The right side is hard-coded 'UTC'
 * inside Clock. The SQL half takes neither: Connection::prepareBindings
 * formats the bound instant with
 * $value->format($grammar->getDateFormat()), i.e. in the value's OWN
 * zone, and MariaDB then compares string to string.
 *
 * So the two layers agree because APP_TIMEZONE is UTC, not because they
 * were built to agree. MEASURED in laravel-app-1: a raw published_at of
 * '2026-09-01 03:00:00' hydrates as 2026-09-01T03:00:00+00:00 under a
 * default zone of UTC and as 2026-09-01T03:00:00+07:00 under
 * Asia/Ho_Chi_Minh, while Clock::now() stays UTC either way — seven
 * hours of skew, on the PHP side of this class only.
 *
 * WHAT CATCHES IT, measured by forcing APP_TIMEZONE=Asia/Ho_Chi_Minh in
 * phpunit.xml and running the suite rather than assumed: the guard is a
 * CONFIGURATION assertion rather than a behavioural one —
 * EnvironmentTest's "stores time as utc and speaks vietnamese" reads
 * config('app.timezone') and fails on the value itself. Inside
 * AnnouncementsQueryTest under that skew exactly one block fails, and
 * it is the advancing-clock block, whose expires_at sits one second
 * from the bound instant; the boundary pair stays green, because its
 * fixtures are seeded and asserted through the same shifted zone. A row
 * fixture written a month either side of its instant cannot see this,
 * which is why the note is written here rather than as a block.
 *
 * NO SHELF FILTER IS WRITTEN HERE, and there must not be one:
 * BookshelfScope on the model confines all three reads, and SoftDeletes
 * drops trashed rows. (Spelled without the column name deliberately:
 * TenancyArchitectureTest's tripwire reads raw source and a where-shaped
 * call beside that literal reddens it from a comment as readily as from
 * code.)
 *
 * THIS CLASS AUTHORIZES NOTHING. The reference opens each of its three
 * functions with requireReader/requireManager; in this codebase the
 * gate is the controller's, which is why managed() can be reached from
 * a manager screen and published() from a public one without either
 * asking a question the caller has already answered.
 */
final class AnnouncementsQuery
{
    /** Characters, matching the reference's 200-character slice. */
    private const EXCERPT = 200;

    public function __construct(
        private Clock $clock,
    ) {}

    /**
     * What a member sees: published, not yet lapsed, pinned first, then
     * most recent, then id.
     *
     * BR §16.1 gives that ordering in as many words. Pinned
     * announcements are ordered among themselves by recency, which only
     * means something if more than one may be pinned — the reading
     * PinAnnouncement's docblock records as plan divergence 8.
     *
     * `id desc` beside published_at because that column carries no
     * unique constraint — and here the tiebreak is NOT redundant.
     * MEASURED on this statement rather than carried over: this project
     * has twice found the answer to differ by query shape, so neither
     * earlier explanation was reused. EXPLAIN, against a 400-row
     * two-shelf copy of this table in laravel-mariadb-1:
     *
     *   type: ALL | key: NULL | rows: 400
     *   Extra: Using where; Using filesort
     *
     * Neither is_pinned nor published_at is indexed on this table (read
     * off `show create table announcements`), so the ordering is a
     * filesort's rather than an index's. With `->orderByDesc('id')`
     * deleted, AnnouncementsQueryTest's same-instant block is the run's
     * single failure — the two tied rows come back id ASCENDING where
     * id desc wants the reverse, which is what makes that block
     * deterministically red rather than luckily red. managed() gets the
     * same treatment on its own middle key, with its own tie block and
     * the same measured result.
     *
     * array_values() around the collection is for PHPStan, not for the
     * runtime: `values()->all()` is typed array<int, T>, which level 8
     * rejects against this method's `list<…>`. MEASURED — with the call
     * dropped here and in managed(), `make analyse` reports return.type
     * on both.
     *
     * @return list<array{id: string, slug: string, title: string, body: string, excerpt: string, isPinned: bool, publishedAt: ?string, expiresAt: ?string}>
     */
    public function published(): array
    {
        $at = $this->clock->now();

        return array_values($this->showing($at)
            ->orderByDesc('is_pinned')
            ->orderByDesc('published_at')
            ->orderByDesc('id')
            ->get()
            ->filter(fn (Announcement $a): bool => self::state($a, $at) === 'showing')
            ->map(fn (Announcement $a): array => self::row($a))
            ->values()
            ->all());
    }

    /**
     * What a manager sees: everything, including drafts and lapsed
     * announcements, because managing them is the job the reader-facing
     * filter gets in the way of. Each row carries the state its chip
     * renders.
     *
     * THE ORDERING DIFFERS FROM published() DELIBERATELY. A draft's
     * publication time is null, so it would sort last forever under
     * `published_at desc`, where a manager wants the thing they typed
     * this morning in front of them — so the manager's middle key falls
     * back to created_at. Both lists keep `is_pinned desc` first and
     * `id desc` last.
     *
     * EXPLAIN on THIS statement, same 400-row scratch copy:
     *
     *   type: ALL | key: NULL | rows: 400
     *   Extra: Using where; Using filesort
     *
     * so the coalesce is sorted, not indexed, and the tiebreak below it
     * is load-bearing for the same measured reason published()'s is.
     *
     * @return list<array{id: string, slug: string, title: string, body: string, excerpt: string, isPinned: bool, publishedAt: ?string, expiresAt: ?string, state: 'showing'|'draft'|'expired'}>
     */
    public function managed(): array
    {
        $at = $this->clock->now();

        return array_values(Announcement::query()
            ->orderByDesc('is_pinned')
            ->orderByRaw('coalesce(announcements.published_at, announcements.created_at) desc')
            ->orderByDesc('id')
            ->get()
            ->map(function (Announcement $a) use ($at): array {
                $row = self::row($a);
                $row['state'] = self::state($a, $at);

                return $row;
            })
            ->values()
            ->all());
    }

    /**
     * One announcement's full body — OPS §3.2's GetAnnouncementDetail.
     *
     * THE SAME FILTER AS published(), and that is the point rather than
     * a copy: an announcement that has lapsed must not be readable by
     * pasting its address, or the list's expiry would be a presentation
     * choice instead of a rule. Both halves are here — showing() in the
     * WHERE and state() after it — for the reason the class docblock
     * gives.
     *
     * `null` for a draft, for a lapsed one, and for a slug naming
     * nothing; a foreign shelf's slug is a fourth route to the same
     * null, because the scope has already dropped that row. The
     * controller turns one answer into one 404.
     *
     * @return array{id: string, slug: string, title: string, body: string, excerpt: string, isPinned: bool, publishedAt: ?string, expiresAt: ?string}|null
     */
    public function detail(string $slug): ?array
    {
        $at = $this->clock->now();

        $announcement = $this->showing($at)->where('slug', $slug)->first();

        if ($announcement === null || self::state($announcement, $at) !== 'showing') {
            return null;
        }

        return self::row($announcement);
    }

    /**
     * The reader-facing narrowing, in SQL, shared by published() and
     * detail() so the two screens narrow identically by construction.
     *
     * @return Builder<Announcement>
     */
    private function showing(CarbonImmutable $at): Builder
    {
        return Announcement::query()
            ->whereNotNull('published_at')
            ->where('published_at', '<=', $at)
            ->where(fn (Builder $q) => $q
                ->whereNull('expires_at')
                ->orWhere('expires_at', '>', $at));
    }

    /**
     * The two comparisons, once, against the instant its caller bound.
     *
     * Static and parameterised on $at rather than reading the clock:
     * a helper that read the clock for itself would be the second
     * instant per call the class docblock rules out, once per row.
     *
     * `expires_at > $at` is the live condition, so an expiry EQUAL to
     * the bound instant has lapsed — pinned from both sides by
     * AnnouncementsQueryTest's boundary pair.
     *
     * @return 'showing'|'draft'|'expired'
     */
    private static function state(Announcement $announcement, CarbonImmutable $at): string
    {
        $publishedAt = $announcement->published_at;

        if ($publishedAt === null || $publishedAt->greaterThan($at)) {
            return 'draft';
        }

        $expiresAt = $announcement->expires_at;

        if ($expiresAt !== null && $expiresAt->lessThanOrEqualTo($at)) {
            return 'expired';
        }

        return 'showing';
    }

    /**
     * THE EXCERPT IS THE PLAIN COLUMN TRUNCATED, which is what an
     * excerpt is for: a rich body cut mid-tag is how a list renders half
     * an element. True today only in principle — CreateAnnouncement
     * writes body_text from the same trimmed plain body as body (its own
     * divergence 5) — and body_text is read anyway, so this row shape
     * stays put when a rich editor lands.
     *
     * mb_substr, not substr: the reference slices a JS string, and 200
     * bytes of Vietnamese ends mid-sequence. Pinned by
     * AnnouncementsQueryTest's excerpt block, whose fixture is 250 × 'ế'.
     *
     * @return array{id: string, slug: string, title: string, body: string, excerpt: string, isPinned: bool, publishedAt: ?string, expiresAt: ?string}
     */
    private static function row(Announcement $announcement): array
    {
        return [
            'id' => $announcement->id,
            'slug' => $announcement->slug,
            'title' => $announcement->title,
            'body' => $announcement->body,
            'excerpt' => mb_substr((string) $announcement->body_text, 0, self::EXCERPT),
            'isPinned' => $announcement->is_pinned,
            'publishedAt' => $announcement->published_at?->toIso8601String(),
            'expiresAt' => $announcement->expires_at?->toIso8601String(),
        ];
    }
}
