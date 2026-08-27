<?php

namespace App\Providers;

use App\Enums\MembershipRole;
use App\Enums\MembershipStatus;
use App\Models\User;
use App\Support\HashedDatabaseSessionHandler;
use App\Support\TenantContext;
use Illuminate\Foundation\Application;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Session;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // scoped(), not singleton(): a fresh context per request lifecycle, so a
        // long-running test process (or Octane, ever) cannot leak one request's
        // shelf into the next.
        $this->app->scoped(TenantContext::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Laravel's database session store, keyed on sha256(session id)
        // instead of the raw id — see HashedDatabaseSessionHandler's
        // docstring for why the raw id must never reach the table.
        Session::extend('hashed-database', function (Application $app) {
            $config = $app->make('config');
            $db = $app->make('db');

            return new HashedDatabaseSessionHandler(
                $db->connection($config->get('session.connection')),
                $config->get('session.table', 'sessions'),
                $config->get('session.lifetime'),
                $app,
            );
        });

        // The global flag outranks every shelf role — ROLE_RANK.super_admin.
        // Returning null (not false) lets the per-gate checks run for
        // everyone else. Deliberately UNCONDITIONAL, across every ability
        // this or any future Gate::define adds, not just act-as-*: BR §2's
        // "nobody decides their own proposal, including a super
        // administrator" is enforced inside the relevant Phase 1 command,
        // the same way src/domain/kernel does it — not through a rank gate
        // here. A future `Gate::define('decide-proposal', …)` is silently
        // bypassed for a super admin unless that command checks for it
        // itself; this is a known, accepted shape, not an oversight.
        Gate::before(fn (User $user) => $user->is_super_admin ? true : null);

        // Role gates read TenantContext and nothing else (Task 17's
        // interface contract). ResolveTenant (Task 16) is the only place
        // that resolves a membership INTO TenantContext via the request
        // pipeline, and it already excludes anything but an active,
        // non-soft-deleted row (see its docstring and the known-gaps entry
        // on withoutGlobalScopes()) — so on that path a membership reaching
        // here is active by construction. But TenantContext::set() is
        // public, and nothing besides a code-review convention stops a
        // future console command, seeder or Phase 1 controller from
        // populating it from a query that does NOT filter on status. The
        // status check below makes the gate fail closed on its own terms
        // instead of trusting a single upstream caller forever — belt and
        // braces on the same principle as the user_id check just under it.
        $roleGate = fn (MembershipRole $required) => function (User $user) use ($required): bool {
            $membership = app(TenantContext::class)->membership();

            // The membership row was resolved for THIS user by
            // ResolveTenant; the guard is belt and braces against a gate
            // checked for a different user object.
            if ($membership === null || $membership->user_id !== $user->id) {
                return false;
            }

            if ($membership->status !== MembershipStatus::Active) {
                return false;
            }

            return $membership->role->atLeast($required);
        };

        Gate::define('act-as-reader', $roleGate(MembershipRole::Reader));
        Gate::define('act-as-manager', $roleGate(MembershipRole::Manager));
        Gate::define('act-as-admin', $roleGate(MembershipRole::Admin));
    }
}
