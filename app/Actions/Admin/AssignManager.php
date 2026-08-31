<?php

namespace App\Actions\Admin;

use App\Enums\MembershipRole;
use App\Enums\MembershipStatus;
use App\Exceptions\RuleViolated;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\ConcurrencyRetry;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * OPS §4.5's `AssignManager` — port of the reference's command of the same
 * name (`old_next/src/domain/admin/commands/managers.ts:22`). Spec D7.
 *
 * **A person holds at most one role per shelf** (§4 assumption 8), so this
 * either creates a membership or overwrites the `role` on the one that
 * already exists. It never adds a second row, which is why the audit action
 * is `membership.role_assigned` rather than `manager.appointed`: the fact
 * recorded is about a membership, and the same person may run one parish
 * while reading at another.
 *
 * **An existing membership is also set active.** Somebody being handed the
 * keys is a member of this shelf whatever their application said; leaving a
 * promoted manager `pending` would put them in the approval queue they are
 * now meant to be working. The reference makes the same move and says so.
 *
 * **The role is `manager` or `admin`, never `reader`.** The enum's third
 * case is a real grant (rank 3, and `act-as-admin` is a defined gate), so
 * the form offers both; a request naming `reader` is refused by the Form
 * Request before it reaches here, and by the enum cast if it ever did not.
 *
 * WHY THIS WIDENS. `Membership` is shelf-scoped and the `/admin` group
 * binds no tenant (spec D0), so the scope would throw on every read below.
 * Widening is the sanctioned way past that, and it is confined to this
 * directory and `app/Queries/Admin/` by `WideningArchitectureTest`.
 *
 * WHY EVERY MEMBERSHIP READ AND WRITE GOES THROUGH `$shelf->memberships()`.
 * Under a widening the scope adds no narrowing at all and the creating hook
 * stamps no shelf column, so an unrelated read would reach every parish and
 * an unrelated create would write a row belonging to none. The relation
 * carries its own constraint whatever the widening state and stamps the
 * column from itself — one move that answers both hazards, and the only one
 * `TenancyArchitectureTest` permits in this directory.
 */
final class AssignManager
{
    public function __construct(
        private AuditRecorder $audit,
        private TenantContext $context,
    ) {}

    public function execute(User $actor, Bookshelf $shelf, string $userId, MembershipRole $role): Membership
    {
        Gate::forUser($actor)->authorize('assignManager', $shelf);

        if ($role === MembershipRole::Reader) {
            // Belt to the Form Request's braces. A caller that reached this
            // method with `reader` would be silently DEMOTING somebody
            // through the appoint path, writing an audit row that says a
            // grant was given.
            throw new RuleViolated('validation_failed');
        }

        return $this->context->systemWide(fn (): Membership => DB::transaction(function () use ($shelf, $userId, $role): Membership {
            $target = User::query()->find($userId);

            // A soft-deleted person is no candidate, and the binding above
            // this command never resolves one — this is the guard for a
            // hand-posted id, which is the only way such a value arrives.
            if ($target === null) {
                throw new RuleViolated('membership_not_found');
            }

            $existing = $shelf->memberships()->where('user_id', $target->id)->lockForUpdate()->first();

            if ($existing !== null) {
                $before = ['role' => $existing->role->value, 'status' => $existing->status->value];

                $existing->update(['role' => $role, 'status' => MembershipStatus::Active]);
                $membership = $existing;
            } else {
                $before = null;

                $membership = $shelf->memberships()->create([
                    'user_id' => $target->id,
                    'role' => $role,
                    'status' => MembershipStatus::Active,
                ]);
            }

            // `subject` in the payload as well as the entity id: the audit
            // screen resolves a subject name from the membership id on the
            // row, and this is the fallback for a row whose person is later
            // soft-deleted — the shape every other membership action here
            // already uses.
            $this->audit->forShelf($shelf->id)->record(
                'membership.role_assigned',
                'membership',
                $membership->id,
                $before,
                ['role' => $role->value, 'subject' => $target->full_name],
            );

            return $membership;
        }, ConcurrencyRetry::ATTEMPTS));
    }
}
