<?php

declare(strict_types=1);

namespace App\Queries\Admin;

use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Queries\Concerns\ReadsAuditLog;
use Collator;
use Illuminate\Database\Eloquent\Builder;

/**
 * BR:606's cross-shelf audit browser — the screen `/admin/audit` was a
 * placeholder for since Phase 0, and the reader six administration actions
 * have been writing rows for with nobody able to open them.
 *
 * WHAT WAS INVISIBLE UNTIL THIS CLASS. `system_settings.updated`,
 * `site_contact.updated` and the three `category.*` (phase 3b-ii) plus
 * `user.promoted_super_admin` (3b-i) all belong to the installation rather
 * than to any parish, so they are written with no shelf recorded.
 * `App\Queries\AuditLogQuery` compares the tenant column for equality, and
 * an equality never matches an absent value — every one of those six rows
 * fell outside the only reader the table had. docs/known-gaps.md carried
 * that as an open entry from 3b-ii; this file closes it.
 *
 * THE UNFILTERED CASE NEEDS NO PREDICATE AT ALL, which is the thing that
 * took a draft to get right. `AuditLog` is one of the two models
 * TenancyArchitectureTest pins as EXEMPT from BelongsToBookshelf, so no
 * scope is applied underneath and a plain query over the table already
 * returns every parish's rows AND the installation's own. "Show me
 * everything" is the absence of work, not work.
 *
 * THE SHELF FILTER IS THE ONE THAT COSTS SOMETHING, and it is why this
 * file carries a TenancyArchitectureTest allow-list entry of its own. Two
 * of its three answers have to name the tenant column directly: one parish
 * (an equality) and site-wide-only (the absence of a value). A relation
 * constraint cannot express the second at all — there is no related shelf
 * to constrain — so `whereHas` was not an escape from the allow-list, only
 * a way of getting half the filter. That test reads RAW SOURCE and its
 * pattern is satisfied by prose, so this paragraph describes the shape of
 * those predicates rather than spelling either of them; a comment that
 * spelled one would make this file its own offender, which is exactly the
 * trap that bit phase 3c-ii Task 4.
 *
 * NO WIDENING, DESPITE THE DIRECTORY. `app/Queries/Admin/` is where
 * WideningArchitectureTest permits TenantContext::systemWide(), and this
 * class does not use it: the three models it reads — AuditLog, User
 * (through the trait's joins) and Bookshelf — are all unscoped, so there
 * is no BookshelfScope to step around. It lives here because it is a
 * cross-shelf read for the `/admin` area, not because it needs the fence.
 *
 * EVERYTHING BELOW THE SCOPE IS SHARED with the manager's own log, through
 * App\Queries\Concerns\ReadsAuditLog — the joins with their collation
 * guards, the four-way coalesce, the page size, the total order and the
 * four filters BR:606 asks for — actor, group, from, to.
 *
 * Of those four, ONE is new work here: the actor filter. The group chips and
 * the date range's two ends (`from`/`to`, with their Asia/Ho_Chi_Minh
 * civil-day boundary) were already implemented and paid for by the manager's
 * log, and re-deriving that boundary was the mistake spec D5 exists to stop.
 * An earlier wording of this paragraph ran the two lists into one sentence and
 * so appeared to claim the actor filter was both new and already implemented.
 */
final class AuditBrowserQuery
{
    use ReadsAuditLog;

    /**
     * The `?shelf=` value meaning "the installation's own rows, and no
     * parish's" — the half of this filter that has no id to name, since
     * the whole point of those rows is that they record no shelf.
     *
     * A word rather than a blank, because a blank is already taken: an
     * absent `?shelf=` means every shelf AND the installation, which is
     * the screen's default and a genuinely different answer. It cannot
     * collide with a real option either — every shelf option below is a
     * uuid, and this is four letters.
     */
    public const string SITE_WIDE = 'site';

    /**
     * One page of the log across the whole installation.
     *
     * $shelf is null (everything), self::SITE_WIDE (the installation's own
     * rows only) or a bookshelf id. Every parameter is the CONTROLLER's to
     * validate, the same contract AuditLogQuery::run() states.
     *
     * @return array{rows: list<array<string, mixed>>, page: int, pageCount: int, total: int}
     */
    public function run(?string $shelf = null, ?string $actorId = null, ?string $group = null, ?string $from = null, ?string $to = null, int $page = 1): array
    {
        return $this->auditPage($this->visible($shelf), $actorId, $group, $from, $to, $page);
    }

    /**
     * The actor `<select>`'s options, ACROSS EVERY SHELF.
     *
     * This is deliberately not narrowed by the shelf filter. Task 6's link
     * from `/admin/managers` arrives carrying an actor and no shelf, and a
     * list that moved under the shelf chips would make the actor a filter
     * whose options depend on the order the volunteer pressed things in.
     * It is also what the controller validates `?actor=` against, so a
     * narrowed list would silently reject the very link the managers
     * screen offers.
     *
     * @return list<array{userId: string, name: string, entries: int}>
     */
    public function actors(): array
    {
        return $this->auditActors(AuditLog::query());
    }

    /**
     * The shelf `<select>`'s options: every parish this log actually names,
     * plus the installation itself when it has rows of its own.
     *
     * ONLY WHAT THE LOG NAMES, the same rule actors() follows and for the
     * same reason — a filter control that points at a shelf with nothing to
     * show is a control that answers "no activity" and cannot say whether
     * that means "nothing happened" or "you filtered wrongly". The cost is
     * that a brand new parish is absent from this list until its first
     * recorded act, which is the honest reading of a log.
     *
     * `name` IS NULL FOR THE SITE-WIDE OPTION, never a Vietnamese word.
     * The label is resources/js/lib/copy.ts's, the shape
     * FeedbackInboxQuery::listRow already uses for the same distinction —
     * the server says "no parish", the screen says what that is called.
     *
     * ARCHIVED SHELVES RESOLVE. Bookshelf archives by status rather than by
     * deleted_at, so an ordinary lookup reaches one, and a parish whose
     * shelf was closed last month still has a history worth reading.
     *
     * @return list<array{shelfId: string, name: string|null, entries: int}>
     */
    public function shelves(): array
    {
        $rows = AuditLog::query()
            ->groupBy('audit_log.bookshelf_id')
            ->selectRaw('audit_log.bookshelf_id as shelf_id, count(*) as entries')
            ->get();

        $names = [];
        $ids = array_values(array_filter(array_map(
            fn (AuditLog $row): ?string => $row->getAttribute('shelf_id') === null
                ? null
                : (string) $row->getAttribute('shelf_id'),
            $rows->all(),
        )));
        if ($ids !== []) {
            foreach (Bookshelf::query()->findMany($ids) as $shelf) {
                $names[(string) $shelf->id] = (string) $shelf->name;
            }
        }

        $options = [];
        foreach ($rows as $row) {
            $rawId = $row->getAttribute('shelf_id');
            $entries = (int) $row->getAttribute('entries');

            if ($rawId === null) {
                $options[] = ['shelfId' => self::SITE_WIDE, 'name' => null, 'entries' => $entries];

                continue;
            }

            $id = (string) $rawId;
            // A row naming a shelf that no longer exists cannot happen —
            // bookshelves are never hard-deleted and the column is
            // RESTRICT — but the lookup is still a map read, so it answers
            // null rather than throwing, and such a row sorts with the
            // unnamed ones below.
            $options[] = ['shelfId' => $id, 'name' => $names[$id] ?? null, 'entries' => $entries];
        }

        // The installation first — it is the option nothing else can reach,
        // and the reason this screen exists. Then parish names in
        // Vietnamese collation (Đà Lạt before Vũng Tàu; byte order files
        // every Đ after z), then the id as the stable tiebreak so the
        // options never move between renders. The count does NOT sort this
        // list, unlike actors(): a volunteer looks a parish up by name.
        $collator = new Collator('vi');
        usort($options, function (array $a, array $b) use ($collator): int {
            if (($a['shelfId'] === self::SITE_WIDE) !== ($b['shelfId'] === self::SITE_WIDE)) {
                return $a['shelfId'] === self::SITE_WIDE ? -1 : 1;
            }

            return ($collator->compare($a['name'] ?? '', $b['name'] ?? '') ?: 0)
                ?: ($a['shelfId'] <=> $b['shelfId']);
        });

        return $options;
    }

    /**
     * Which rows this read may see — the whole of what distinguishes this
     * class from the manager's own log.
     *
     * Three answers, and the first is the default: no narrowing whatever,
     * which returns every parish's rows and the installation's together
     * because nothing scopes this model. The other two are described in
     * the class docblock; between them they are the reason this file is
     * named in TenancyArchitectureTest's allow-list.
     *
     * @return Builder<AuditLog>
     */
    private function visible(?string $shelf): Builder
    {
        $query = AuditLog::query();

        if ($shelf === self::SITE_WIDE) {
            return $query->whereNull('audit_log.bookshelf_id');
        }

        if ($shelf !== null) {
            return $query->where('audit_log.bookshelf_id', $shelf);
        }

        return $query;
    }
}
