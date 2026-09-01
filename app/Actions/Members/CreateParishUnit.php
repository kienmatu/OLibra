<?php

namespace App\Actions\Members;

use App\Exceptions\RuleViolated;
use App\Models\ParishUnit;
use App\Models\User;
use App\Queries\ParishContextQuery;
use App\Support\AuditRecorder;
use App\Support\ConcurrencyRetry;
use App\Support\UniqueViolation;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Phase 3b-ii Task 5, spec D5 — one new parish unit (BR §5.6, OPS §4.5).
 * Port of the reference's `createParishUnit`
 * (old_next/src/domain/members/commands/create-parish-unit.ts).
 *
 * **NO WIDENING ANYWHERE IN THIS FAMILY, AND THAT IS WHY IT LIVES HERE.**
 * `ParishUnit` carries `BelongsToBookshelf` and `manage/units` binds a
 * tenant, so the insert below reaches the right shelf through the trait's
 * `creating` hook and every read through `BookshelfScope` — no
 * `systemWide()`, no audit configurator, nothing fenced by
 * `WideningArchitectureTest`. Spec D5 reversed twice before landing on that
 * placement: on the `/admin` shelf editor, which binds no tenant, every one
 * of this command's reads and writes would have needed the widening instead.
 *
 * **THE LEVEL CHECK IS THIS COMMAND'S, NOT THE TABLE'S.**
 * `parish_units_l1_has_no_parent` is `CHECK (level = 2 OR parent_id IS
 * NULL)`, which reads like the hierarchy's integrity constraint and is half
 * of one: it forbids a level-1 unit having a parent and says nothing about
 * what a level-2 unit's parent is. A level-2 unit parented to another
 * level-2 unit satisfies every constraint on the table — and fails
 * silently, because `ParishUnits::options()` filters level-2 rows by
 * `parentId`, so the malformed child appears under no level-1 parent and
 * `hasVisibleLevel2()` reports the shelf has no level-2 field to show. A
 * unit that exists, is live, is offered nowhere, and looks in the database
 * exactly like one that should be. So `level = 1` is in the parent lookup
 * below, in the same transaction as the insert.
 *
 * **A DUPLICATE NAME IS A DATABASE CONSTRAINT, NOT A VALIDATION NICETY.**
 * `parish_units_name_unique_in_scope` is a UNIQUE over a generated
 * `name_scope_key` — SHA-256 of `(bookshelf_id, level, parent_id, name)`,
 * NULL when soft-deleted, so a retired unit frees its name for reuse. No
 * Form Request rule can see it: the scope includes `parent_id`, which the
 * form posts, and the soft-delete partition, which it does not. Left
 * uncaught it is a raw errno 1062 — a 500 where a Vietnamese sentence
 * belongs. `UniqueViolation::translate()` matches BY CONSTRAINT NAME so an
 * unrelated collision is never dressed up as this refusal, and the code is
 * the shared `validation_failed` the reference uses ("Vui lòng kiểm tra lại
 * thông tin." — vague but honest; OPS §4.5 names no failure mode for the
 * 1062 and an `ErrorCode` may not be invented with a sentence nobody wrote).
 *
 * **`sort_order` DEFAULTS TO 0, NOT TO "the end of the list".** The
 * column's own default, deliberately not a `max(sort_order) + 1` this
 * command derives — that is `CreateCategory`'s rule and the opposite of
 * this one. Taxonomy design §7 is explicit that ordering here is EXPLICIT
 * and `ReorderParishUnits` owns it; a clever default would be a second,
 * invisible source of order for `ParishUnits::options()` to sort by. Two
 * units at 0 still order predictably, because that sort breaks ties on the
 * Vietnamese-collated name.
 *
 * **THE AUDIT PAYLOAD NAMES ITS KEYS.** `AuditSecrets` forbids any payload
 * key containing the token `key` matched whole within snake splits, and
 * `ParishUnit` carries `name_scope_key` — so `->record(…, $unit->toArray())`
 * or a `getChanges()` dump throws `audit_forbidden_field` rather than
 * writing the row. Every payload in this family is spelled out for that
 * reason as well as the ordinary one.
 */
final class CreateParishUnit
{
    public function __construct(
        private AuditRecorder $audit,
        private ParishContextQuery $parish,
    ) {}

    public function execute(User $actor, int $level, ?string $parentId, string $name): ParishUnit
    {
        Gate::forUser($actor)->authorize('create', ParishUnit::class);

        if ($level !== 1 && $level !== 2) {
            throw new RuleViolated('validation_failed');
        }

        $name = trim($name);

        if ($name === '') {
            throw new RuleViolated('validation_failed');
        }

        if ($level === 1 && $parentId !== null) {
            // OPS §4.5 lists this among validation_failed's cases by name.
            // It is also the one the table itself would catch, and it is
            // checked here anyway so the answer is a sentence rather than a
            // CHECK violation from inside the transaction.
            throw new RuleViolated('validation_failed');
        }

        if ($level === 2 && $parentId === null && $this->parish->run()['taxonomy']->nested) {
            // parentId is "required only when the shelf's taxonomy is nested
            // and level is 2" (OPS §4.5). On a FLAT shelf a level-2 unit
            // legitimately has no parent — ParishUnits::options() is called
            // without a parent filter there — so this is not a blanket rule.
            throw new RuleViolated('validation_failed');
        }

        return DB::transaction(function () use ($level, $parentId, $name): ParishUnit {
            if ($parentId !== null) {
                // `level = 1` is the clause the docblock above exists for.
                // BookshelfScope supplies the shelf. The soft-delete scope
                // refuses a RETIRED parent, because adding a child to a unit
                // that has stopped being offered creates precisely the
                // orphan ParishUnits::hasVisibleLevel2() has to defend
                // against.
                $parent = ParishUnit::query()
                    ->where('id', $parentId)
                    ->where('level', 1)
                    ->first();

                if ($parent === null) {
                    throw new RuleViolated('parish_unit_l1_not_found');
                }
            }

            try {
                $unit = ParishUnit::query()->create([
                    'level' => $level,
                    'parent_id' => $parentId,
                    'name' => $name,
                    'sort_order' => 0,
                ]);
            } catch (QueryException $e) {
                UniqueViolation::translate($e, [
                    'parish_units_name_unique_in_scope' => 'validation_failed',
                ]);
            }

            $this->audit->record('parish_unit.created', 'parish_unit', $unit->id, null, [
                'level' => $level,
                'parent_id' => $parentId,
                'name' => $name,
                'sort_order' => 0,
            ]);

            return $unit;
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
