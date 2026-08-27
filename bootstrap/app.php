<?php

use App\Exceptions\RuleViolated;
use App\Http\Middleware\EnsureAuthenticatedUserExists;
use App\Http\Middleware\EnsureShelfRole;
use App\Http\Middleware\EnsureSuperAdmin;
use App\Http\Middleware\HandleInertiaRequests;
use App\Http\Middleware\ResolveTenant;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Middleware\AddLinkHeadersForPreloadedAssets;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\SubstituteBindings;

// This app directory once collided with the Next.js tree this Laravel
// migration was scaffolded beside: Next.js's router prefers a root-level
// `app/` over `src/app/`, unconditionally and silently, so with Laravel's PHP
// application directory sitting at `<root>/app`, Next picked THAT up as its
// App Router root instead of `src/app`, found no page.tsx anywhere in it, and
// silently built nothing but its two built-in pages — every real route
// 404'd. The fix at the time (PR #57) renamed this directory to
// `laravel_app/`, with `useAppPath()` pointing Laravel at the new name. The
// Next.js tree has since moved to `old_next/` instead (see AGENTS.md), which
// removed the collision at its root rather than routing around it a second
// time — `app/` is Laravel's own directory again, and `useAppPath()` is gone.
// See docs/known-gaps.md for the original incident.
$app = Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->web(append: [
            EnsureAuthenticatedUserExists::class,
            HandleInertiaRequests::class,
            AddLinkHeadersForPreloadedAssets::class,
        ]);

        $middleware->alias([
            'tenant' => ResolveTenant::class,
            'role' => EnsureShelfRole::class,
            'super-admin' => EnsureSuperAdmin::class,
        ]);

        // prependToPriorityList, not priority([...]): the array form
        // REPLACES Laravel's own default priority list wholesale rather
        // than extending it — found in review, reproduced live: it drops
        // five framework entries, including the one that keeps
        // Illuminate\Auth\Middleware\Authenticate ahead of route-model
        // binding. Under the array form, ['web','auth','tenant'] put
        // Authenticate AFTER ResolveTenant and SubstituteBindings, so an
        // anonymous request to a Task-18 shelf route got a 404 from
        // ResolveTenant/the scoped binding instead of the framework's
        // uniform redirect-to-login — an unauthenticated existence oracle
        // over the shelf and book URL space. prependToPriorityList only
        // inserts these two entries into the default list, so
        // Authenticate's own ordering (and everything else Laravel already
        // guarantees) survives untouched.
        //
        // EnsureAuthenticatedUserExists must run before ResolveTenant, not
        // after: in the exact stale-guard-cache scenario it exists for
        // (Octane; a Pest test spanning two requests in one process — see
        // that middleware's own docstring), ResolveTenant would otherwise
        // read a deleted user's still-cached, still-"active" membership
        // into TenantContext and only log the user out afterwards.
        // Order of these two calls matters: prependPriority is a plain
        // array keyed by the middleware being inserted, processed via a
        // foreach in ApplicationBuilder, and addToMiddlewarePriorityBefore
        // only anchors against middleware ALREADY in the priority list. So
        // ResolveTenant is anchored to SubstituteBindings (already in
        // Laravel's default list) first; only once ResolveTenant itself is
        // in the list can EnsureAuthenticatedUserExists be anchored to IT.
        // Reversing the order would silently anchor EnsureAuthenticated-
        // UserExists to nothing and drop it at the tail instead.
        $middleware->prependToPriorityList(
            before: SubstituteBindings::class,
            prepend: ResolveTenant::class,
        );
        $middleware->prependToPriorityList(
            before: ResolveTenant::class,
            prepend: EnsureAuthenticatedUserExists::class,
        );
    })
    ->withExceptions(function (Exceptions $exceptions) {
        // Spec §7: RuleViolated maps to "the right response" in ONE place.
        // For the Inertia forms this phase ships, the right response is a
        // redirect back carrying the Vietnamese sentence under the `rule`
        // key — pages read it from the shared `errors` prop. Business-rule
        // refusals are never 500s (OPS §2) and never field errors (those
        // are ValidationException's, rendered per-field).
        $exceptions->render(function (RuleViolated $e, Request $request) {
            return back()->withErrors(['rule' => __('rules.'.$e->code)]);
        });
    })->create();

return $app;
