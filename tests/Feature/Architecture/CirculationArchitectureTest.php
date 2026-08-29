<?php

use Illuminate\Support\Facades\Route;

it('every circulation write transaction opens with a FOR UPDATE — the grep pin', function () {
    // Belt to the per-command query-log braces: each Action file named
    // below must contain lockForUpdate. Position is pinned per command in
    // its own test.
    //
    // The list is hand-maintained, and since Phase 2a it has its first
    // documented exemption — so it no longer catches a NEW circulation
    // Action shipped without a lock merely by existing. It catches a lock
    // REMOVED from one of the four commands that must keep theirs; adding
    // a fifth Action means deciding, in this file, which side it is on.
    //
    // CreateBorrowRequest is that exemption: it takes no lock at all (plan
    // divergence 2 — an exclusive re-read of the books row here closes an
    // AB-BA cycle against UpdateBook). Its duplicate rule is the
    // borrow_requests_one_live_per_title_member index, and
    // CreateBorrowRequestTest greps that file for both spellings the
    // Global Constraint names, so the absence stays true.
    foreach ([
        app_path('Actions/Circulation/LendCopy.php'),
        app_path('Actions/Circulation/ReceiveReturn.php'),
        app_path('Actions/Circulation/RenewLoan.php'),
        app_path('Actions/Circulation/VoidLoan.php'),
    ] as $file) {
        expect(str_contains((string) file_get_contents($file), 'lockForUpdate'))
            ->toBeTrue(basename($file).' has no lockForUpdate');
    }
});

it('HandoverRequest and the borrow-request commands have no route — Phase 2\'s, by decision', function () {
    // The 1a DeleteBook / 1b ManagerRegisterReader precedent: absence is
    // pinned so wiring one later is a decision, not an accident.
    $uris = collect(Route::getRoutes()->getRoutes())->map(fn ($r) => $r->uri());

    foreach (['handover', 'borrow-requests/{', 'requests/{'] as $fragment) {
        expect($uris->first(fn (string $uri) => str_contains($uri, $fragment)))
            ->toBeNull("unexpected Phase-2 route: {$fragment}");
    }
});

it('the lend and return POST routes are manager-gated, the renew POST reader-gated', function () {
    $routes = collect(Route::getRoutes()->getRoutes());

    $lend = $routes->first(fn ($r) => $r->getName() === 'shelves.manage.lend.store');
    $return = $routes->first(fn ($r) => $r->getName() === 'shelves.manage.returns.store');
    $void = $routes->first(fn ($r) => $r->getName() === 'shelves.manage.loans.void');
    $renew = $routes->first(fn ($r) => $r->getName() === 'shelves.profile.loans.renew');

    foreach ([$lend, $return, $void] as $route) {
        expect($route)->not->toBeNull()
            ->and($route->gatherMiddleware())->toContain('role:manager');
    }
    expect($renew)->not->toBeNull()
        ->and($renew->gatherMiddleware())->toContain('role:reader')
        ->and($renew->gatherMiddleware())->not->toContain('role:manager');
});

it('returns/lost is declared before returns/{loan} — spec §6\'s declaration-order rule', function () {
    $uris = collect(Route::getRoutes()->getRoutes())
        ->map(fn ($r) => $r->uri())
        ->filter(fn (string $uri) => str_contains($uri, 'returns'))
        ->values();

    $lost = $uris->search(fn (string $uri) => str_ends_with($uri, 'returns/lost'));
    $bound = $uris->search(fn (string $uri) => str_contains($uri, 'returns/{loan}'));

    expect($lost)->toBeInt()->and($bound)->toBeInt()
        ->and($lost)->toBeLessThan($bound);
});

it('no Action under app/Actions/Circulation calls now() — the Clock rule, greppable', function () {
    // REVIEW FIX: the title this replaces said "nothing under app/" while
    // the body walks app/Actions/Circulation only. Either widen the walk to
    // app_path() with an allow-list (Clock.php itself, and any 1a/1b file
    // that already trips it — measure before widening), or keep the narrow
    // walk and this narrow title. A test whose name overclaims its body is
    // how a rule gets believed without being enforced.
    // Clock is the only place Carbon reads the wall clock. A circulation
    // file calling now() bypasses setTestNow-driven derivations and BR
    // §5.4's timezone rule at once.
    $offenders = [];
    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(app_path('Actions/Circulation'), FilesystemIterator::SKIP_DOTS)
    );
    foreach ($files as $file) {
        $src = (string) file_get_contents($file->getPathname());
        // (?<!>) excludes `$this->clock->now()` — the Clock's own method IS
        // the sanctioned door; what this bans is the bare now() helper and
        // the static Carbon reads.
        if (preg_match('/(?<![->])\bnow\(\)|Carbon::now|CarbonImmutable::now/', $src) === 1) {
            $offenders[] = basename($file->getPathname());
        }
    }
    expect($offenders)->toBe([]);
});
