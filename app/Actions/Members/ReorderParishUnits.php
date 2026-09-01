<?php

namespace App\Actions\Members;

use App\Exceptions\RuleViolated;
use App\Models\ParishUnit;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\ConcurrencyRetry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Phase 3b-ii Task 5, spec D5 — sets `sort_order` across one sibling group
 * (OPS §4.5). Port of the reference's `reorderParishUnits`
 * (old_next/src/domain/members/commands/reorder-parish-units.ts).
 *
 * **WHY THIS COMMAND EXISTS AT ALL**, since a list of names could be
 * sorted: taxonomy design §7 refuses to parse a number out of a name. "Tổ
 * 10" sorting ahead of "Tổ 2" is exactly the kind of detail that makes
 * software feel careless, and the fix is not to parse more cleverly but
 * never to parse. `ParishUnits::options()` orders by `sort_order` then by
 * the Vietnamese-collated name, and this is the only thing in the system
 * that writes the first of those.
 *
 * **THE POSITION COMES FROM THE CALLER'S ARRAY**, never from anything this
 * command derives about the rows: `sort_order` is the 1-based index in
 * `$unitIds`. It starts at 1 rather than 0 because the reference's `WITH
 * ORDINALITY` does; nothing depends on the base — `options()` compares, it
 * does not index — and subtracting one to make the numbers start at zero
 * would be arithmetic for cosmetics.
 *
 * **THE POSTED LIST MUST BE THE ENTIRE SIBLING GROUP.** Mixed, duplicated,
 * empty and unresolvable lists are each refused below; a PARTIAL one is the
 * case that produces the outcome this command exists to prevent. Three
 * level-1 units at 1/2/3 reordered with `[C, A]` end at `C=1, A=2, B=2` — a
 * tie — and `options()` breaks ties by name, so the shelf silently falls
 * back to "Tổ 10 before Tổ 2": the ordering somebody added `sort_order` to
 * escape, arrived at by a command that reported success.
 *
 * Refused rather than repaired, and that is deliberate. Appending the
 * omitted units after the named ones would invent a placement nobody
 * expressed — this command's whole argument is that position comes from the
 * caller — and a caller that omitted a unit did not decide it should go
 * last; more likely it never knew about it, because somebody created one
 * while the screen was open. That is a stale list, and the honest answer to
 * a stale list is to say so. The count is taken IN THE DATABASE rather than
 * from the caller's array, so a list that is stale in the other direction
 * (a unit created since the page loaded) is caught too.
 *
 * **THE GROUP IS `(level, parent_id)`, AND THE SCREEN MUST GROUP THE SAME
 * WAY.** The check below is applied even on a flat shelf, where every
 * level-2 unit's `parent_id` is null and it therefore passes trivially —
 * gating it on `taxonomy.nested` would make the rule depend on a setting a
 * different command can change between two reorders, and "share one parent"
 * needs no such qualification when the shared parent is null. The
 * consequence lands on the SCREEN: a shelf that was nested and had `nested`
 * switched off keeps whatever `parent_id` each unit already had
 * (`UpdateParishTaxonomy` never rewrites a unit row), so two units in one
 * flat visual list can easily not share a parent. Posting that flat display
 * list as one group is what made the reference refuse every click on a
 * shelf shaped like that, found in review on its seeded shelf. The screen
 * groups by real `parent_id` for that reason and this file is the other
 * half of the rule.
 *
 * **ONE AUDIT ROW PER UNIT THAT ACTUALLY MOVED**, and none at all for a
 * reorder that changes nothing. `audit_logs.entity_id` is a single id, so
 * one row for the whole act would have to name an arbitrary unit as its
 * subject; per-unit rows each name a real one and carry the two numbers a
 * log reader can render. A row claiming a change nobody made is what
 * `empty_proposal` exists to prevent elsewhere, and OPS §4.5 lists no
 * refusal for a no-op reorder — dragging a row and dropping it back where
 * it was is not an error. Both numbers are named keys, never a model dump:
 * `ParishUnit` carries `name_scope_key` and `AuditSecrets` would refuse it.
 */
final class ReorderParishUnits
{
    public function __construct(
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  list<string>  $unitIds  the group, in the order it should appear
     */
    public function execute(User $actor, array $unitIds): void
    {
        Gate::forUser($actor)->authorize('reorder', ParishUnit::class);

        if ($unitIds === []) {
            throw new RuleViolated('validation_failed');
        }

        if (count(array_unique($unitIds)) !== count($unitIds)) {
            // A repeated id would give one row two positions and leave
            // which one wins to whichever UPDATE ran last.
            throw new RuleViolated('validation_failed');
        }

        DB::transaction(function () use ($unitIds): void {
            // BookshelfScope supplies the shelf and SoftDeletes excludes
            // retired rows, so another shelf's id and a deleted one are both
            // simply absent here — which is the answer that does not
            // confirm either exists.
            $rows = ParishUnit::query()->whereIn('id', $unitIds)->get()->keyBy('id');

            if ($rows->count() !== count($unitIds)) {
                // The level of an id that resolved to nothing is unknown;
                // every id that DID resolve shares one level by the check
                // below, so that level is the best available guess at what
                // the missing one was meant to be. Level 1's sentence is
                // the fallback when there is nothing to guess from — the
                // reference's `unitNotFound(null)`, a choice rather than a
                // derivation, because OPS §4.5 names no code for "that id
                // names nothing" and one may not be invented with a
                // Vietnamese sentence nobody wrote.
                $level = $rows->isEmpty() ? 1 : (int) $rows->first()->level;

                // TWO LITERAL THROWS AND NOT ONE TERNARY ARGUMENT, which is
                // how this was first written. RuleViolatedCodesHaveSentences
                // Test censuses the refusal constructor's first argument by
                // regex and only matches a quoted string there, so a code
                // computed into the call is invisible to it — measured: with
                // the ternary in place, the census found
                // parish_unit_l1_not_found (thrown as a literal by
                // CreateParishUnit) and never saw parish_unit_l2_not_found at
                // all. A code with no Vietnamese sentence would have shipped
                // silently. The same rule the audit census states for
                // `->record()`: keep the literal at the site.
                if ($level === 2) {
                    throw new RuleViolated('parish_unit_l2_not_found');
                }

                throw new RuleViolated('parish_unit_l1_not_found');
            }

            /** @var ParishUnit $first */
            $first = $rows->get($unitIds[0]);
            $level = (int) $first->level;
            $parentId = $first->parent_id;

            foreach ($rows as $row) {
                if ((int) $row->level !== $level || $row->parent_id !== $parentId) {
                    throw new RuleViolated('validation_failed');
                }
            }

            // Counted in the database, scoped by BookshelfScope. whereNull
            // rather than where(…, null): the shared parent is null for
            // every level-1 unit and for every level-2 unit on a flat
            // shelf, and `= NULL` is never true.
            $siblings = ParishUnit::query()
                ->where('level', $level)
                ->when($parentId === null,
                    fn ($q) => $q->whereNull('parent_id'),
                    fn ($q) => $q->where('parent_id', $parentId),
                )
                ->count();

            if ($siblings !== count($unitIds)) {
                throw new RuleViolated('validation_failed');
            }

            foreach ($unitIds as $index => $id) {
                /** @var ParishUnit $unit */
                $unit = $rows->get($id);
                $before = (int) $unit->sort_order;
                $after = $index + 1;

                if ($before === $after) {
                    continue;
                }

                $unit->update(['sort_order' => $after]);

                $this->audit->record('parish_unit.reordered', 'parish_unit', $unit->id,
                    ['sort_order' => $before],
                    ['sort_order' => $after],
                );
            }
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
