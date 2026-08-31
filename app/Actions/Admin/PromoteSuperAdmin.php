<?php

namespace App\Actions\Admin;

use App\Exceptions\RuleViolated;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\ConcurrencyRetry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * OPS §4.5's `PromoteSuperAdmin` — the global grant, and the only act in the
 * whole catalogue that belongs to no shelf. Spec D5.
 *
 * **THIS IS THE COMMAND TASK 1's CONFIGURATOR EXISTS FOR.** Its audit row
 * carries a null shelf, because the fact recorded is about a person and
 * about the installation, not about any parish. `AuditRecorder::record()`
 * fails closed on an unbound tenant — that guard protects every shelf-scoped
 * command in the application — so this row is written through the
 * configurator's cross-shelf arm, which is the sanctioned way to say
 * "explicitly no shelf" as opposed to "nobody said".
 *
 * **`is_super_admin` IS NOT MASS-ASSIGNABLE, AND THE FLAG IS SET DIRECTLY.**
 * `User::$fillable` is narrow on purpose and says so in its own docblock, so
 * an update passing an array would silently discard the key and return
 * `true` — a promotion that promoted nobody, with an audit row saying it
 * happened and every status assertion green. The test for this asserts the
 * flag on the person afterwards for exactly that reason.
 *
 * **A person who already holds the grant is refused.** The alternative is an
 * audit row recording a promotion that changed nothing.
 *
 * **THERE IS NO DEMOTION COMMAND, and its absence is the design.** OPS §4.5
 * lists none: removing the last administrator's own grant would lock the
 * installation out of its own administration surface, and nothing in the
 * requirements says what should happen instead. Spec D5 ports that omission
 * as an omission and `known-gaps.md` records it. Do not add one here.
 *
 * NO WIDENING, and none is needed: `User` carries no `BelongsToBookshelf`,
 * so nothing narrows this read. The recorder is the only fail-closed guard
 * in the path.
 */
final class PromoteSuperAdmin
{
    public function __construct(
        private AuditRecorder $audit,
    ) {}

    public function execute(User $actor, User $target): void
    {
        Gate::forUser($actor)->authorize('promoteSuperAdmin', $target);

        DB::transaction(function () use ($target): void {
            $person = User::query()->lockForUpdate()->findOrFail($target->id);

            if ($person->is_super_admin) {
                throw new RuleViolated('already_super_admin');
            }

            // Assigned, not updated. See this class's docblock: the array
            // form is silently a no-op against a narrow $fillable.
            $person->is_super_admin = true;
            $person->save();

            $this->audit->global()->record(
                'user.promoted_super_admin',
                'user',
                $person->id,
                ['is_super_admin' => false],
                ['is_super_admin' => true, 'subject' => $person->full_name],
            );
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
