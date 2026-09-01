<?php

namespace App\Actions\Members;

use App\Models\ParishUnit;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use App\Support\ConcurrencyRetry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Phase 3b-ii Task 5, spec D5 and D6 — retires a unit, and its live level-2
 * children when it is a level-1 unit (OPS §4.5; taxonomy design §7). Port
 * of the reference's `deleteParishUnit`
 * (old_next/src/domain/members/commands/delete-parish-unit.ts).
 *
 * **"SOFT" IS THE MEANING, NOT A CONVENTION.** BR §5.6 and §11: a
 * membership pointing at a deleted unit is history, not an error. The unit
 * stops being OFFERED and keeps describing the people already in it —
 * `ParishUnits::options()` filters on `deletedAt`, while
 * `describeSelection()`, `unitName()` and `validateSelection()` deliberately
 * do not, which is what keeps a reader's stored unit rendering the day a
 * parish retires it.
 *
 * **THE CASCADE, AND WHAT BREAKS WITHOUT IT.** Deleting a level-1 unit
 * soft-deletes its live level-2 children in the same transaction. Taxonomy
 * design §7 argues it as meaning — a tổ inside a deleted giáo họ is not a
 * place anyone belongs — and `ParishUnits::hasVisibleLevel2()` records the
 * mechanical consequence of skipping it: the orphaned children keep
 * `options($units, 2)` non-empty, so the level-2 field claims it has
 * something to show, while the grouped rendering hangs options under LIVE
 * level-1 parents and finds none. A `<select>` holding nothing but its own
 * empty option — BR §5.6's "zero, one or two" broken by an implementation
 * detail rather than by a real absence of units. A level-2 unit has no
 * children and cascades to nothing.
 *
 * **ONE AUDIT ROW PER DELETED ROW, CHILDREN MARKED `cascaded` (spec D6).**
 * OPS §4.5 asks for exactly this, and `audit_logs.entity_id` is a single
 * id: one row saying "deleted a unit" would have to name one of the
 * deleted units and stay silent about the rest — precisely the history BR
 * §11 wants kept, and a volunteer reading the log would never learn that
 * four sub-units went with the click. `cascaded` rides on the payload
 * rather than becoming a second action name, so BR §13.2's oversight view
 * can still filter every retirement of a unit under one name while a reader
 * of a single row can see it was not clicked.
 *
 * **THE PAYLOADS NAME THEIR KEYS.** Never `$unit->toArray()`: `ParishUnit`
 * carries the generated `name_scope_key`, and `AuditSecrets` forbids any
 * payload key containing the token `key` matched whole within snake splits,
 * so a wholesale dump throws `audit_forbidden_field` instead of writing the
 * row. Spec D6's one-row-per-deleted-row shape is exactly what invites the
 * dump, which is why this is said here as well as on `CreateParishUnit`.
 *
 * **THE INSTANT COMES FROM `Clock`**, not from a timestamp the database
 * supplies, for DATABASE.md §6's reason: it is an instant the domain means,
 * and a test on a frozen clock has to be able to place it. Every row this
 * command retires — the parent and its children — carries the SAME instant,
 * which is what makes "these went together" readable off the log.
 *
 * **ALREADY-DELETED IS A 404 AND NOT AN IDEMPOTENT PASS**, decided one
 * layer up rather than here: `{parishUnit}` binds through
 * `Bookshelf::parishUnits()` with `SoftDeletes` in force, so a second
 * "Xoá" on a row a stale screen still shows never reaches this command.
 * The reference refuses the same case by hand for the same reason — a
 * screen showing state that is gone should be told so.
 */
final class DeleteParishUnit
{
    public function __construct(
        private AuditRecorder $audit,
        private Clock $clock,
    ) {}

    /**
     * @return list<string> the retired rows, the named unit first
     */
    public function execute(User $actor, ParishUnit $unit): array
    {
        Gate::forUser($actor)->authorize('delete', $unit);

        return DB::transaction(function () use ($unit): array {
            $now = $this->clock->now();

            // Read the children BEFORE anything is retired, and read them
            // as models rather than as a bulk UPDATE: each one needs its
            // own name on its own audit row, and a query-builder update
            // would hand back a count instead of the rows.
            $children = (int) $unit->level === 1
                ? ParishUnit::query()
                    ->where('parent_id', $unit->id)
                    ->where('level', 2)
                    ->get()
                    ->all()
                : [];

            $record = function (ParishUnit $row, bool $cascaded) use ($now): void {
                $this->audit->record('parish_unit.deleted', 'parish_unit', $row->id,
                    ['name' => $row->name, 'deleted_at' => null],
                    ['name' => $row->name, 'deleted_at' => $now->toIso8601String(), 'cascaded' => $cascaded],
                );
            };

            $unit->deleted_at = $now;
            $unit->save();
            $record($unit, false);

            $ids = [(string) $unit->id];

            foreach ($children as $child) {
                $child->deleted_at = $now;
                $child->save();
                $record($child, true);
                $ids[] = (string) $child->id;
            }

            return $ids;
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
