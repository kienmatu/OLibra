<?php

namespace App\Actions\Members;

use App\Exceptions\RuleViolated;
use App\Models\ParishUnit;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\ConcurrencyRetry;
use App\Support\UniqueViolation;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Phase 3b-ii Task 5, spec D5 — a unit's name changes and nothing else
 * moves (OPS §4.5). Port of the reference's `renameParishUnit`
 * (old_next/src/domain/members/commands/rename-parish-unit.ts).
 *
 * **`sort_order` AND `parent_id` ARE NOT IN THE STATEMENT AT ALL.** OPS is
 * explicit that a rename is a label change only, and BR §5.6's whole
 * argument for units-as-rows is that renaming stays cheap because every
 * membership references the unit by id rather than by name. Writing the
 * other two columns back with values this command read a moment earlier is
 * the whole-row-rewrite lesson `RenameCategory` states for the same reason:
 * it silently discards a concurrent reorder committed between the read and
 * the write. `update(['name' => …])` names the one column.
 *
 * **A DUPLICATE NAME IS THE 1062 AGAIN.** `CreateParishUnit`'s docblock has
 * the whole of it — the unique is over a generated, soft-delete-aware
 * `name_scope_key` no Form Request rule can see, and an uncaught collision
 * is a 500 rather than a refusal. Renaming "Tổ 2" to "Tổ 1" while a live
 * "Tổ 1" sits under the same parent is exactly that case.
 *
 * **A RENAME TO THE SAME NAME IS NOT A FAILURE AND STILL AUDITS.** There is
 * no `empty_proposal` equivalent in OPS §4.5, and unlike a reader's profile
 * correction — where the log would carry an entry claiming a change nobody
 * made — the `before`/`after` here name the same string on both sides,
 * which reads as exactly what happened. Refusing it would need a Vietnamese
 * sentence nobody has written.
 *
 * **THE UNIT ARRIVES ROUTE-BOUND, WHICH IS WHERE THE NOT-FOUND LIVES.** The
 * reference re-reads the row and picks between its two not-found sentences;
 * here `{parishUnit}` resolves through `Bookshelf::parishUnits()` under the
 * route group's `scopeBindings()` and through `BookshelfScope`, with
 * `SoftDeletes` excluding a retired row — so another shelf's unit and an
 * already-deleted one are both a 404 before this command runs, which is the
 * answer that does not confirm the id exists.
 */
final class RenameParishUnit
{
    public function __construct(
        private AuditRecorder $audit,
    ) {}

    public function execute(User $actor, ParishUnit $unit, string $name): void
    {
        Gate::forUser($actor)->authorize('update', $unit);

        $name = trim($name);

        if ($name === '') {
            throw new RuleViolated('validation_failed');
        }

        DB::transaction(function () use ($unit, $name): void {
            $before = (string) $unit->name;

            try {
                $unit->update(['name' => $name]);
            } catch (QueryException $e) {
                UniqueViolation::translate($e, [
                    'parish_units_name_unique_in_scope' => 'validation_failed',
                ]);
            }

            // Both names, spelled out — never $unit->getChanges(), which on
            // this model would carry name_scope_key and throw
            // audit_forbidden_field (AuditSecrets forbids the token `key`).
            $this->audit->record('parish_unit.renamed', 'parish_unit', $unit->id,
                ['name' => $before],
                ['name' => $name],
            );
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
