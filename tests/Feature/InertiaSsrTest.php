<?php

use Illuminate\Support\Facades\Http;

/**
 * Inertia ships INERTIA_SSR_ENABLED defaulting to true, and
 * Inertia\Ssr\HttpGateway::dispatch() only skips SSR when there is no
 * bundle WHEN Vite::isRunningHot() is false. docker-compose.laravel.yml
 * runs a continuous vite service, so public/hot exists for the whole life
 * of the container and isRunningHot() is true — the bundle-exists check is
 * skipped entirely and every Inertia render POSTs to the vite dev server's
 * /__inertia_ssr path, which is not a rendering service.
 *
 * phpunit.xml pins INERTIA_SSR_ENABLED=false via <server> (outranking
 * whatever a developer's real .env sets — see phpunit.xml's own comment).
 * This test pins both the config value and the actual behaviour, so a
 * regression here fails loudly instead of the suite quietly starting to
 * make a stray HTTP call from every Inertia-rendering feature test.
 */
it('has ssr forced off for the test environment', function () {
    expect(config('inertia.ssr.enabled'))->toBeFalse();
});

it('never dispatches an inertia render to the vite ssr endpoint, even though public/hot exists', function () {
    // public/hot is committed and present right now (that is the trap this
    // guards against), so this assertion is only meaningful if the file is
    // actually there — otherwise it would pass for the wrong reason.
    expect(file_exists(public_path('hot')))->toBeTrue();

    Http::fake();

    $this->get('/')->assertOk();

    Http::assertNothingSent();
});
