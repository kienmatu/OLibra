<?php

use Illuminate\Support\Facades\Route;

it('every manage write route carries auth and a role gate', function () {
    // The write surface this phase added must never ship open. Census, not
    // sample: every non-GET route under shelves/{shelf}/manage.
    $writes = collect(Route::getRoutes())->filter(fn ($route) => str_starts_with($route->uri(), 'shelves/{shelf}/manage')
        && ! in_array('GET', $route->methods(), true));

    expect($writes->count())->toBeGreaterThanOrEqual(6);   // store, update, copies.store, 4 copy commands

    foreach ($writes as $route) {
        $middleware = $route->gatherMiddleware();
        expect(in_array('auth', $middleware, true))
            ->toBeTrue("write route without auth: {$route->uri()}");
        expect(in_array('role:manager', $middleware, true))
            ->toBeTrue("write route without role:manager: {$route->uri()}");
        expect(in_array('tenant', $middleware, true))
            ->toBeTrue("write route without tenant: {$route->uri()}");
    }
});

it('books/create and books/lost still precede books/{book}', function () {
    // Spec §6's route-order hazard, re-pinned against THIS phase's route
    // file edits — RouteOrderTest guards the reader group; this guards the
    // manage books block the same way.
    $uris = collect(Route::getRoutes())
        ->filter(fn ($route) => in_array('GET', $route->methods(), true))
        ->map(fn ($route) => $route->uri())
        ->values();

    $create = $uris->search('shelves/{shelf}/manage/books/create');
    $lost = $uris->search('shelves/{shelf}/manage/books/lost');
    $show = $uris->search('shelves/{shelf}/manage/books/{book}');

    expect($create)->not->toBeFalse()
        ->and($lost)->not->toBeFalse()
        ->and($show)->not->toBeFalse()
        ->and($create < $show)->toBeTrue('books/create declared after books/{book}')
        ->and($lost < $show)->toBeTrue('books/lost declared after books/{book}');
});

it('there is deliberately no delete-book route', function () {
    // Q7: the DeleteBook Action exists and is tested; the UI entry point
    // does not, matching the reference and OPS §4.1's open question. If
    // this test surprises you, read the known-gaps entry before "fixing"
    // it — adding the route is a product decision, not a cleanup.
    $delete = collect(Route::getRoutes())->first(fn ($route) => $route->uri() === 'shelves/{shelf}/manage/books/{book}'
        && in_array('DELETE', $route->methods(), true));

    expect($delete)->toBeNull();
});

it('no Action skips the audit recorder', function () {
    // Tripwire, INV-8: every command class in app/Actions/Catalogue except
    // the code allocator (not a command — it writes nothing) must actually
    // call ->record() on a constructor-injected AuditRecorder. Asserting
    // just the class name appeared in the source (a prior version of this
    // test did) would pass on a file that merely imports or mentions
    // AuditRecorder without ever calling record() — this ties the pin to
    // the call itself, keyed off whatever the constructor names the
    // property, so a new Action pasted without audit fails the build
    // rather than quietly shipping unaudited.
    $files = glob(app_path('Actions/Catalogue/*.php'));
    expect($files)->not->toBe([]);

    foreach ($files as $file) {
        if (str_ends_with($file, 'AllocateCopyCodes.php')) {
            continue;
        }

        $source = (string) file_get_contents($file);

        expect(preg_match('/private\s+(?:readonly\s+)?AuditRecorder\s+\$(\w+)/', $source, $ctor))
            ->toBe(1, basename($file).' does not constructor-inject an AuditRecorder');

        expect(preg_match('/\$this->'.$ctor[1].'->record\s*\(/', $source))
            ->toBe(1, basename($file).' never calls ->record() on its AuditRecorder');
    }
});

it('no catalogue query or action re-implements folding', function () {
    // BR §12: one normalisation. Fold::fold and the frozen generated
    // columns are the two halves; anything else matching diacritics by
    // hand (strtr over Vietnamese letters, a REPLACE chain in a query)
    // would be a third copy that drifts.
    $files = array_merge(
        glob(app_path('Actions/Catalogue/*.php')) ?: [],
        glob(app_path('Queries/*.php')) ?: [],
        glob(app_path('Support/Catalogue/*.php')) ?: [],
    );

    foreach ($files as $file) {
        $source = (string) file_get_contents($file);
        expect(str_contains($source, 'strtr('))
            ->toBeFalse(basename($file).' contains a strtr( call — folding belongs to App\Support\Fold alone');
    }
});
