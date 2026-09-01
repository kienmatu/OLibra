<?php

namespace App\Actions\Admin;

use App\Models\Bookshelf;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\ConcurrencyRetry;
use App\Support\Members\ParishTaxonomy;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * BR §5.6's *Phân chia giáo xứ*: how one parish subdivides its people —
 * how many levels it uses, what it calls each of them, and whether the
 * smaller level sits inside the bigger. Port of the reference's
 * `updateParishTaxonomy`
 * (old_next/src/domain/members/commands/update-parish-taxonomy.ts).
 *
 * THE SHAPE ONLY, NEVER THE UNITS (spec D5). The units themselves — the
 * rows a reader picks from at registration — are edited on the shelf's own
 * `manage/units` screen, which binds a tenant. That placement is the
 * spec's second reversal and the reason is mechanical: `ParishUnit` uses
 * `BelongsToBookshelf` and the `/admin` group binds no tenant, so unit CRUD
 * here would make every one of its reads and writes require `systemWide()`,
 * the capability `WideningArchitectureTest` fences so that it stays rare.
 * The shape is a property of the shelf, stored in the shelf's own
 * `settings` column, so it belongs on the shelf editor and needs no
 * widening at all — `Bookshelf` carries no shelf scope.
 *
 * THE FOUR KEYS ARE App\Support\Members\ParishTaxonomy's, TAKEN FROM THAT
 * CLASS AND NOT FROM THE REQUIREMENTS: `levels`, `nested`, `level1_label`,
 * `level2_label`, snake_case in the column and camelCase in PHP, with
 * `default()` = one level, "Tổ", not nested. That class is the one place
 * the translation happens on the read side and this command is the one
 * place it happens on the write side. A key spelled from prose would save
 * successfully, report success, and change nothing a screen reads — the
 * shape of 3b-i's `allow_comments`/`comments_enabled` near-miss.
 *
 * THE FOUR KEYS ARE MERGED INTO `settings`, NOT WRITTEN OVER IT. That bag
 * also holds `UpdateBookshelfPolicy`'s eight keys and the two public
 * display settings `App\Queries\BookDetailQuery` reads, so assigning a
 * fresh array here would delete a shelf's whole lending policy the first
 * time somebody renamed its units. The merge writes exactly these four and
 * leaves the rest, which is what the reference's `settings || jsonb` does.
 *
 * THE FORM POSTS ALL FOUR EVERY TIME, so unlike the reference's optional
 * inputs there is nothing here to leave undefined — and OPS §4.5's
 * invariant ("`nested` is stored even when `levels` is 1 rather than
 * cleared") survives because the editor renders the stored value in a
 * control and posts it back unchanged, rather than because a merge skips
 * an absent field. `ParishUnits::validateSelection()` gates its nesting
 * rule on `levels === 2 && nested` and depends on that.
 *
 * ITS OWN COMMAND, ITS OWN SUBMIT AND ITS OWN REFUSAL (spec D2, D5). The
 * three commands beside it in this directory each own one section of the
 * same screen for the same reason: a shelf whose loan period is mistyped
 * must still be able to rename its tổ.
 *
 * THE AUDIT ROW BELONGS TO THE SHELF, unlike the category commands' global
 * rows: the taxonomy is one parish's own arrangement. The `/admin` group
 * binds no tenant, so `AuditRecorder::record()` fails closed unless the
 * shelf is named on the recorder — which is why this command lives in
 * `app/Actions/Admin/`, the directory `WideningArchitectureTest` fences the
 * audit configurator to. The sentence takes no substitution (the
 * reference's own phrase names no field), so the payload carries the four
 * values for the reader who opens the row rather than for the sentence.
 */
final class UpdateParishTaxonomy
{
    /**
     * The storage keys, in the order the editor shows them. Written once:
     * the merge and both audit bags walk this list.
     *
     * @var list<string>
     */
    public const KEYS = ['levels', 'nested', 'level1_label', 'level2_label'];

    public function __construct(
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array{levels: int, nested: bool, level1_label: string, level2_label: string}  $shape
     */
    public function execute(User $actor, Bookshelf $shelf, array $shape): void
    {
        Gate::forUser($actor)->authorize('update', $shelf);

        DB::transaction(function () use ($shelf, $shape): void {
            $settings = (array) $shelf->settings;

            // Through ParishTaxonomy rather than off the raw bag, so a
            // shelf that has never been configured records what it
            // BEHAVED as — one level, "Tổ" — instead of four nulls that
            // would read as "these values were unset" when the
            // application had been answering with the defaults all along.
            $current = ParishTaxonomy::fromSettings($settings['parish_taxonomy'] ?? null);

            $before = [
                'levels' => $current->levels,
                'nested' => $current->nested,
                'level1_label' => $current->level1Label,
                'level2_label' => $current->level2Label,
            ];

            $after = [];

            foreach (self::KEYS as $key) {
                $after[$key] = $shape[$key];
            }

            // ONE KEY OF THE BAG REPLACED; every other key of it left
            // exactly as it was. `$settings = [...]` here instead — the
            // whole-column write — deletes the shelf's lending policy and
            // both public-display settings, and
            // AdminShelfTaxonomyTest's key-preservation block was watched
            // reddening on exactly that mutation.
            $settings['parish_taxonomy'] = $after;

            $shelf->update(['settings' => $settings]);

            $this->audit->forShelf($shelf->id)->record('parish_taxonomy.updated', 'bookshelf', $shelf->id, $before, $after);
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
