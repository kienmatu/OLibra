<?php

use Illuminate\Support\Facades\Route;

/**
 * Inertia v3 ships devtools.enabled as null, which
 * Inertia\DevTools\DevTools::enabled() resolves to app()->environment('local'),
 * and Inertia\DevTools\Http\Authorize::allows() then short-circuits to true
 * for the local environment before it looks at a user or a gate. .env and
 * .env.example both ship APP_ENV=local, so an unpublished config would leave
 * GET /_inertia/devtools/entries returning 200 to a request with no cookies
 * at all, carrying every prop the app has recently rendered.
 *
 * config/inertia.php is published with a hard `false` default
 * (INERTIA_DEVTOOLS_ENABLED defaulting to false, not null) specifically so
 * Inertia\DevTools\DevToolsServiceProvider::boot() returns before it ever
 * registers the _inertia/devtools routes — not merely so a gate blocks them
 * after the fact.
 */
it('resolves devtools.enabled to false in this booted app', function () {
    expect(config('inertia.devtools.enabled'))->toBeFalse();
});

it('defaults devtools.enabled to false in the config file itself, not the package null, when INERTIA_DEVTOOLS_ENABLED is unset', function () {
    // .env and phpunit.xml both happen to set INERTIA_DEVTOOLS_ENABLED, so
    // the assertion above alone cannot tell a hard `false` default in
    // config/inertia.php apart from the package's own `null` default plus
    // an env var that merely resolves false today. Clears every layer
    // env()/config() can read from (mirrors EnvironmentTest's SESSION_DRIVER
    // check) and reloads the config file fresh to see the bare default.
    $original = [
        'getenv' => getenv('INERTIA_DEVTOOLS_ENABLED'),
        'ENV' => $_ENV['INERTIA_DEVTOOLS_ENABLED'] ?? null,
        'SERVER' => $_SERVER['INERTIA_DEVTOOLS_ENABLED'] ?? null,
    ];

    putenv('INERTIA_DEVTOOLS_ENABLED');
    unset($_ENV['INERTIA_DEVTOOLS_ENABLED'], $_SERVER['INERTIA_DEVTOOLS_ENABLED']);

    try {
        $inertiaConfig = require config_path('inertia.php');

        // A hard `false` default resolves to exactly `false`. The package's
        // own `null` default would resolve to `null` here, which is the
        // exact value that later makes DevTools::enabled() consult
        // app()->environment('local') instead.
        expect($inertiaConfig['devtools']['enabled'])->toBe(false);
    } finally {
        if ($original['getenv'] !== false) {
            putenv("INERTIA_DEVTOOLS_ENABLED={$original['getenv']}");
        }
        if ($original['ENV'] !== null) {
            $_ENV['INERTIA_DEVTOOLS_ENABLED'] = $original['ENV'];
        }
        if ($original['SERVER'] !== null) {
            $_SERVER['INERTIA_DEVTOOLS_ENABLED'] = $original['SERVER'];
        }
    }
});

it('registers no devtools route at all', function () {
    // phpunit.xml forces APP_ENV=testing, not local, so this suite alone
    // cannot exercise Authorize::allows()'s local-environment short-circuit.
    // What it can prove — and the point of publishing config/inertia.php —
    // is that DevToolsServiceProvider::boot() never even reaches
    // Route::prefix('_inertia/devtools') when devtools.enabled resolves
    // false, regardless of which environment the app is booted into. .env
    // and .env.example both ship APP_ENV=local, which is exactly the
    // environment where Authorize::allows() would otherwise grant every
    // caller access with no gate at all.
    foreach (Route::getRoutes() as $route) {
        expect($route->uri())->not->toContain('_inertia/devtools');
    }
});

it('refuses an unauthenticated request to the devtools entries endpoint', function () {
    // No session, no cookies, nothing. Under this suite's APP_ENV=testing,
    // Authorize::allows() could never return 200 for this request even with
    // devtools force-enabled -- its local-environment short-circuit only
    // fires for 'local', so a force-enabled testing run gets a 403 here
    // instead. The 200-to-an-unauthenticated-caller finding is established
    // separately, against this app's real APP_ENV=local, by `route:list`
    // (no _inertia/devtools route exists at all) and by hand with curl. What
    // this test proves — with the route unregistered, as it always is here
    // — is that the endpoint 404s rather than reaching Authorize at all.
    $response = $this->get('/_inertia/devtools/entries');

    expect($response->status())->not->toBe(200);
    $response->assertNotFound();
});
