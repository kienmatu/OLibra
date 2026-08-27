<?php

use Illuminate\Support\Facades\Route;

it('declares books/create and books/lost before books/{book}', function () {
    // Spec §6: otherwise Laravel binds "lost" as a slug — an easy, silent bug.
    $uris = collect(Route::getRoutes()->getRoutes())
        ->map(fn ($route) => $route->uri())
        ->filter(fn (string $uri) => str_starts_with($uri, 'shelves/{shelf}/manage/books'))
        ->values();

    $posCreate = $uris->search('shelves/{shelf}/manage/books/create');
    $posLost = $uris->search('shelves/{shelf}/manage/books/lost');
    $posShow = $uris->search('shelves/{shelf}/manage/books/{book}');

    expect($posCreate)->not->toBeFalse()
        ->and($posLost)->not->toBeFalse()
        ->and($posShow)->not->toBeFalse()
        ->and($posCreate)->toBeLessThan($posShow)
        ->and($posLost)->toBeLessThan($posShow);
});

it('puts the tenant middleware on every route that names {shelf}', function () {
    // The scope fails closed, so a {shelf} route without the middleware is a
    // 500 in dev — but only once someone visits it. This makes it a build
    // failure instead.
    $shelfRoutes = collect(Route::getRoutes()->getRoutes())
        ->filter(fn ($route) => str_contains($route->uri(), '{shelf}'))
        ->values();

    // A loop with no matches passes vacuously — pin that the filter itself
    // still finds routes, so a future refactor that renames {shelf} away
    // (or breaks the group registration) fails loudly here instead of
    // silently emptying this whole test.
    expect($shelfRoutes)->not->toBeEmpty();

    foreach ($shelfRoutes as $route) {
        $middleware = $route->gatherMiddleware();

        // toContain(...$needles) treats every argument as a needle to find,
        // not a failure message — passing one here would silently assert
        // the array ALSO contains this sentence, which it never does, so
        // the check would always fail. toBeTrue()'s $message parameter is
        // the real assertion-message hook.
        expect(in_array('tenant', $middleware, true))
            ->toBeTrue("route without tenant middleware: {$route->uri()}");

        // Every {shelf} route gated by a role:* ability MUST also carry
        // 'auth' explicitly. EnsureShelfRole redirects a guest to login,
        // but it runs after ResolveTenant, so 'auth' is what makes
        // bootstrap/app.php's Authenticate-before-ResolveTenant priority
        // ordering actually apply to the route. Without it, a guest on an
        // UNKNOWN slug 404s straight out of ResolveTenant while a guest on
        // a KNOWN slug still redirects via EnsureShelfRole's own guest
        // branch — an unauthenticated existence oracle over the shelf URL
        // space. This is the exact regression a hand-verified fix for this
        // task found and closed; without this assertion it was unpinned.
        $hasRoleMiddleware = collect($middleware)->contains(fn (string $m) => str_starts_with($m, 'role:'));

        if ($hasRoleMiddleware) {
            expect(in_array('auth', $middleware, true))
                ->toBeTrue("role-gated {shelf} route without auth middleware: {$route->uri()}");
        }
    }
});

it('keeps every uri english — no vietnamese path segments', function () {
    $routes = Route::getRoutes()->getRoutes();

    expect(iterator_to_array($routes))->not->toBeEmpty();

    foreach ($routes as $route) {
        // Vietnamese URIs would be non-ascii or the known old segments.
        expect($route->uri())->toMatch('/^[\x20-\x7e]*$/', "non-ascii uri: {$route->uri()}");
        foreach (['tu-sach', 'cho-muon', 'nhan-tra', 'nguoi-doc', 'quan-ly', 'quan-tri', 'dang-nhap'] as $old) {
            expect($route->uri())->not->toContain($old);
        }
    }
});
