<?php

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Vite;

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

it('never dispatches an inertia render to the vite ssr endpoint, even when vite is running hot', function () {
    // Does not rely on the real public/hot -- that file is gitignored and
    // only exists while the docker-compose vite service happens to be
    // running (see .gitignore:84 and docker-compose.laravel.yml). A fresh
    // clone, `docker compose up app mariadb` alone, or CI running the
    // Laravel suite without the vite service would otherwise fail this
    // test for a reason unrelated to the trap it guards against. Instead,
    // this test manufactures the exact condition the trap depends on --
    // Vite::isRunningHot() returning true -- by pointing the Vite facade
    // at a temporary hot file it creates and removes itself.
    $hotFile = tempnam(sys_get_temp_dir(), 'inertia-ssr-test-hot');
    file_put_contents($hotFile, 'http://localhost:5175');
    Vite::useHotFile($hotFile);

    try {
        expect(Vite::isRunningHot())->toBeTrue();

        Http::fake();

        $this->get('/')->assertOk();

        Http::assertNothingSent();
    } finally {
        Vite::useHotFile(public_path('hot'));
        unlink($hotFile);
    }
});
