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
    foreach (Route::getRoutes()->getRoutes() as $route) {
        if (! str_contains($route->uri(), '{shelf}')) {
            continue;
        }

        // toContain(...$needles) treats every argument as a needle to find,
        // not a failure message — passing one here would silently assert
        // the array ALSO contains this sentence, which it never does, so
        // the check would always fail. toBeTrue()'s $message parameter is
        // the real assertion-message hook.
        expect(in_array('tenant', $route->gatherMiddleware(), true))
            ->toBeTrue("route without tenant middleware: {$route->uri()}");
    }
});

it('keeps every uri english — no vietnamese path segments', function () {
    foreach (Route::getRoutes()->getRoutes() as $route) {
        // Vietnamese URIs would be non-ascii or the known old segments.
        expect($route->uri())->toMatch('/^[\x20-\x7e]*$/', "non-ascii uri: {$route->uri()}");
        foreach (['tu-sach', 'cho-muon', 'nhan-tra', 'nguoi-doc', 'quan-ly', 'quan-tri', 'dang-nhap'] as $old) {
            expect($route->uri())->not->toContain($old);
        }
    }
});
