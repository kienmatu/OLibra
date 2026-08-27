<?php

namespace App\Providers;

use App\Enums\MembershipRole;
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
        // everyone else.
        Gate::before(fn (User $user) => $user->is_super_admin ? true : null);

        // Role gates read TenantContext and nothing else (Task 17's
        // interface contract) — ResolveTenant (Task 16) is the only place
        // that resolves a membership, and it already excludes anything but
        // an active, non-soft-deleted row (see its docstring and the
        // known-gaps entry on withoutGlobalScopes()). So a membership
        // reaching here is by construction active; these gates need only
        // compare role rank.
        $roleGate = fn (MembershipRole $required) => function (User $user) use ($required): bool {
            $membership = app(TenantContext::class)->membership();

            // The membership row was resolved for THIS user by
            // ResolveTenant; the guard is belt and braces against a gate
            // checked for a different user object.
            if ($membership === null || $membership->user_id !== $user->id) {
                return false;
            }

            return $membership->role->atLeast($required);
        };

        Gate::define('act-as-reader', $roleGate(MembershipRole::Reader));
        Gate::define('act-as-manager', $roleGate(MembershipRole::Manager));
        Gate::define('act-as-admin', $roleGate(MembershipRole::Admin));
    }
}
