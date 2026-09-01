<?php

use App\Exceptions\RuleViolated;
use App\Http\Middleware\EnsureAuthenticatedUserExists;
use App\Http\Middleware\EnsureShelfRole;
use App\Http\Middleware\EnsureSuperAdmin;
use App\Http\Middleware\HandleInertiaRequests;
use App\Http\Middleware\ResolveTenant;
use App\Support\ConcurrencyRetry;
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
        // The residual of the circulation retry, in the same ONE place the
        // rest of this system's refusals are shaped. Every Action under
        // app/Actions/Circulation that OPENS a write transaction passes an
        // attempts argument (pinned by CirculationArchitectureTest), so an
        // InnoDB lock-order cycle is normally re-run and committed; when
        // the attempts are spent, Laravel rethrows the ORIGINAL exception
        // and the caller gets a 500 — a bare server error for a condition
        // whose only meaningful instruction is "send that tap again".
        //
        // map(), not render(): a mapping is applied before the render
        // callbacks, so the RuleViolated hook below is what turns this into
        // the 302 with the Vietnamese sentence — one renderer for every
        // refusal in the system, exactly as spec §7 asks. It is registered
        // against PDOException rather than QueryException because Laravel
        // raises a bare DeadlockException, not a QueryException, when the
        // cycle is hit inside a NESTED transaction — which is every Feature
        // test in this suite, RefreshDatabase holding the outer one. Both are
        // PDOException subclasses; ConcurrencyRetry hands back the original
        // exception, the same object, for everything the BOUND detector
        // does not call a concurrency error, so an ordinary SQL fault stays
        // a 500 with its statement in the log.
        //
        // Deliberately not scoped to circulation: this makes the answer a
        // sentence wherever a concurrency error reaches the handler, so a
        // command outside that directory cannot regress to a 500 on the
        // same condition. What it does not do is retry anything — retrying
        // is the Actions' own argument, made per callback. Nor does it
        // cover every failure the FRAMEWORK would call a concurrency error:
        // AppServiceProvider binds App\Support\DeadlockDetector over the
        // contract, which leaves a lock-wait timeout out of both the retry
        // and this translation, for the reason that class's docblock gives.
        $exceptions->map(fn (PDOException $e) => ConcurrencyRetry::translate($e));

        // Spec §7: RuleViolated maps to "the right response" in ONE place.
        // For the Inertia forms this phase ships, the right response is a
        // redirect back carrying the Vietnamese sentence under the `rule`
        // key — pages read it from the shared `errors` prop. Business-rule
        // refusals are never 500s (OPS §2) and never field errors (those
        // are ValidationException's, rendered per-field).
        //
        // The replacements array is almost always empty; it carries a
        // placeholder value when the sentence has one, so a refusal that
        // must state a number the application also enforces (rate_limited
        // and SubmitFeedback::DAILY_LIMIT) reads that number from the
        // constant instead of from a copy typed into lang/vi/rules.php.
        // Still ONE renderer — the throw site chooses the value, never the
        // response.
        $exceptions->render(function (RuleViolated $e, Request $request) {
            return back()->withErrors(['rule' => __('rules.'.$e->code, $e->replacements)]);
        });
    })->create();

return $app;
