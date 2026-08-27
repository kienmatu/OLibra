<?php

use App\Http\Middleware\EnsureAuthenticatedUserExists;
use App\Http\Middleware\EnsureShelfRole;
use App\Http\Middleware\EnsureSuperAdmin;
use App\Http\Middleware\HandleInertiaRequests;
use App\Http\Middleware\ResolveTenant;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Middleware\AddLinkHeadersForPreloadedAssets;
use Illuminate\Routing\Middleware\SubstituteBindings;

// The framework's own convention (Illuminate\Foundation\Application::path(),
// via lib/find-pages-dir.js's `findDir`) would otherwise collide head-on with
// the Next.js tree this Laravel migration was scaffolded beside: Next always
// prefers a root-level `app/` over `src/app/`, unconditionally and silently —
// it does not check what's inside `app/`, only that it exists. With Laravel's
// PHP application directory sitting at `<root>/app`, Next.js's build/dev
// server picked THAT UP as its App Router root instead of `src/app`, found no
// page.tsx anywhere in it, and silently built nothing but the built-in
// _not-found/_global-error pages — every real route 404'd, `next dev` health
// checks failed, and `docker build --target smoke` looped on a ChunkLoadError
// for a page that was never generated. See docs/known-gaps.md.
//
// `useAppPath()` (below, after `create()`) is the supported way to move this
// away from the collision: it only changes where Laravel *looks*, not the
// `App\` namespace, so nothing under `laravel_app/` needed touching. It has
// to run after `->create()`, not passed into `configure()`, because
// `configure()` has no such parameter and by the time it returns, withKernels/
// withEvents/withCommands/withProviders have already run — none of them
// resolve `app_path()`, so setting it here is not too late for anything that
// does (config/route/service-provider boot, `php artisan` commands).
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
        //
    })->create();

$app->useAppPath($app->basePath('laravel_app'));

return $app;
