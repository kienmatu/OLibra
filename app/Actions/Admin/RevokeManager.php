<?php

namespace App\Actions\Admin;

use App\Enums\MembershipRole;
use App\Exceptions\RuleViolated;
use App\Models\Bookshelf;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\ConcurrencyRetry;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * OPS §4.5's `RevokeManager`, spec D5 — `manager`/`admin` → `reader`, at one
 * shelf.
 *
 * **THIS IS A DEMOTION, NOT A DELETION, and that is the whole rule.** The
 * membership row survives with its id unchanged, so the person's loans, their
 * comments, their registration and every audit row that names this membership
 * still resolve. BR §16.4 requires the confirmation to state plainly that
 * history is retained; this command is what makes that statement true, and a
 * delete here would turn the sentence on the screen into a lie while every
 * status assertion stayed green.
 *
 * **Revoking somebody who is already a reader is refused.** There is no grant
 * to take, so the alternative is an audit row saying a revocation happened
 * when nothing moved — the same no-op-entry objection spec D9 raises for
 * archiving an archived shelf.
 *
 * The refusal code is `not_a_manager` rather than the reference's shared
 * `not_permitted`. That code's Vietnamese sentence reads "you do not have
 * permission to do this", which is a false statement about the ACTOR — a
 * super administrator has every permission there is — when the truth is
 * about the subject. BR §2 asks for errors that are named rather than
 * generic, and a named code is what lets this one say what is actually so.
 *
 * **Revoking a shelf's LAST manager is permitted** (spec D6). The reference
 * counts nothing and this port invents no refusal; the defence is that
 * `AdminOverviewQuery` flags the shelf as `managersMissing` immediately
 * afterwards, and `/admin/shelves` shows the flag.
 *
 * **There is deliberately no super-admin demotion anywhere in this port.**
 * Removing the last administrator's own grant would lock the installation
 * out of its own administration surface and the requirements say nothing
 * about what should happen instead, so spec D5 ports the omission as an
 * omission. It is recorded in `known-gaps.md`, not implemented here.
 *
 * Widened, and reached through the shelf's own relation, for the reasons
 * `AssignManager` states at length.
 */
final class RevokeManager
{
    public function __construct(
        private AuditRecorder $audit,
        private TenantContext $context,
    ) {}

    public function execute(User $actor, Bookshelf $shelf, string $membershipId): void
    {
        Gate::forUser($actor)->authorize('revokeManager', $shelf);

        $this->context->systemWide(fn () => DB::transaction(function () use ($shelf, $membershipId): void {
            $membership = $shelf->memberships()->lockForUpdate()->find($membershipId);

            if ($membership === null || $membership->user === null) {
                throw new RuleViolated('membership_not_found');
            }

            if ($membership->role === MembershipRole::Reader) {
                throw new RuleViolated('not_a_manager');
            }

            $before = ['role' => $membership->role->value];

            $membership->update(['role' => MembershipRole::Reader]);

            $this->audit->forShelf($shelf->id)->record(
                'membership.role_revoked',
                'membership',
                $membership->id,
                $before,
                ['role' => MembershipRole::Reader->value, 'subject' => $membership->user->full_name],
            );
        }, ConcurrencyRetry::ATTEMPTS));
    }
}
