<?php

namespace App\Providers;

use App\Enums\MembershipRole;
use App\Enums\MembershipStatus;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Membership;
use App\Models\User;
use App\Policies\BookCopyPolicy;
use App\Policies\BookPolicy;
use App\Policies\MembershipPolicy;
use App\Support\HashedDatabaseSessionHandler;
use App\Support\TenantContext;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Application;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
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

        // Open question 3 (plan header): OPS §8 records RegisterMembership
        // rate limiting as unaddressed in both source documents. This is
        // the infrastructure-level answer, at the edge of the route, not a
        // domain rule. Known-gaps records the decision, and both numbers,
        // as taken on the product owner's behalf.
        //
        // TWO keys on purpose. Per-IP ALONE is wrong here: BR §16.1's
        // scenario is a room of people on one parish connection, so a tight
        // per-IP minute budget throttles the legitimate event and stops no
        // script (addresses rotate; a parish's does not). The day budget is
        // keyed on a HASHED phone number, the shape OPS §8 already specifies
        // for the other guest-open write (SubmitFeedback: 3 per phone per
        // day, hashed, §5.4), falling back to the IP when the phone is blank
        // so the phone-missing-reason route is not an open bypass.
        RateLimiter::for('register', fn (Request $request) => [
            Limit::perMinute(30)->by('ip:'.($request->ip() ?? 'unknown')),
            Limit::perDay(20)->by('reg:'.hash('sha256', (string) (
                $request->string('phone')->trim()->value() ?: 'ip:'.($request->ip() ?? 'unknown')
            ))),
        ]);

        // The global flag outranks every shelf role — ROLE_RANK.super_admin —
        // but ONLY for the role-hierarchy abilities this file defines
        // (act-as-reader/manager/admin), matched by name prefix, never
        // unconditionally across every ability a future Gate::define adds.
        // Returning null (not false) for anything else lets that ability's
        // own definition run for the super admin exactly as it would for
        // anyone. This is deliberately narrower than the shape this
        // comment originally described (a blanket Gate::before): an
        // unconditional bypass would have silently pre-approved a future
        // `Gate::define('decide-proposal', …)` for a super admin, the
        // opposite of BR §2's "nobody decides their own proposal, including
        // a super administrator" — that invariant must not depend on every
        // future ability remembering to check for it itself.
        Gate::before(function (User $user, string $ability) {
            if (! str_starts_with($ability, 'act-as-')) {
                return null;
            }

            return $user->is_super_admin ? true : null;
        });

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

            // The same belt-and-braces reasoning as the status check just
            // above, for the same reason it exists: ResolveTenant's own
            // query already excludes a soft-deleted row (see its docstring
            // and the known-gaps entry on withoutGlobalScopes() stripping
            // SoftDeletingScope, which is the exact incident this line
            // guards against happening a second way), but nothing besides
            // that one caller's discipline stops a future binder handing
            // this gate a $membership fetched with withTrashed() or
            // withoutGlobalScopes() while status is untouched — a "removed"
            // membership whose status column was never flipped. Checked
            // here so the gate fails closed on its own terms instead of
            // trusting, forever, that every future caller of
            // TenantContext::set() remembers to filter deleted_at itself.
            if ($membership->trashed()) {
                return false;
            }

            return $membership->role->atLeast($required);
        };

        Gate::define('act-as-reader', $roleGate(MembershipRole::Reader));
        Gate::define('act-as-manager', $roleGate(MembershipRole::Manager));
        Gate::define('act-as-admin', $roleGate(MembershipRole::Admin));

        // Phase 1a: policies arrive with the Actions they gate. They
        // delegate to the act-as-* gates above — registered here, after
        // those definitions, so the file reads in dependency order.
        Gate::policy(Book::class, BookPolicy::class);
        Gate::policy(BookCopy::class, BookCopyPolicy::class);
        Gate::policy(Membership::class, MembershipPolicy::class);
    }
}
