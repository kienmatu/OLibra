<?php

use Illuminate\Support\Facades\Route;

it('every circulation write transaction opens with a FOR UPDATE — the grep pin', function () {
    // Belt to the per-command query-log braces: each Action file named
    // below must contain lockForUpdate. Position is pinned per command in
    // its own test.
    //
    // The list is hand-maintained, and since Phase 2a it has documented
    // exemptions — so it no longer catches a NEW circulation Action
    // shipped without a lock merely by existing. It catches a lock
    // REMOVED from one of the commands that must keep theirs; adding a new
    // Action means deciding, in this file, which side it is on.
    //
    // CreateBorrowRequest is the first: it takes no lock at all (plan
    // divergence 2 — an exclusive re-read of the books row here closes an
    // AB-BA cycle against UpdateBook). Its duplicate rule is the
    // borrow_requests_one_live_per_title_member index, and
    // CreateBorrowRequestTest greps that file for both spellings the
    // Global Constraint names, so the absence stays true.
    //
    // HandoverRequest is the second: it takes no locks of its own (plan
    // divergence 11) — its one write transaction is LendCopy's, whose
    // lock position LendCopyTest already pins. Taking a borrow_requests
    // lock here before delegating would invert divergence 1's
    // copy-then-request order and manufacture an AB-BA cycle against
    // LendCopy's own guarded request update (LendCopy.php:241). That
    // inverse mistake is pinned executably, not by this comment:
    // HandoverRequestTest's two query-log braces assert the first FOR
    // UPDATE of the whole flow is on book_copies and that no locking read
    // of borrow_requests appears in it at all.
    //
    // What that exemption costs is NOT nothing, and this comment is not
    // the place to imply otherwise: HandoverRequest's pre-flight reads
    // pick a sentence, and only some of what they read is re-established
    // afterwards. LendCopy re-reads the COPY and the MEMBERSHIP rows FOR
    // UPDATE (LendCopy.php:79, :81) and takes its hold probe and loan
    // count after both; it never reads borrow_requests by the id this
    // command was asked about — its probe is by copy_id and compares
    // member_id (:108-118, :142) — so that request's status, its copy_id
    // and its identity as the hold being collected are pre-flight facts
    // only. HandoverRequest's own docblock is the longer form of this
    // note and bounds what a race there can produce.
    foreach ([
        app_path('Actions/Circulation/ApproveBorrowRequest.php'),
        app_path('Actions/Circulation/CancelOwnRequest.php'),
        app_path('Actions/Circulation/LendCopy.php'),
        app_path('Actions/Circulation/ReceiveReturn.php'),
        app_path('Actions/Circulation/RejectBorrowRequest.php'),
        app_path('Actions/Circulation/RenewLoan.php'),
        app_path('Actions/Circulation/VoidLoan.php'),
    ] as $file) {
        expect(str_contains((string) file_get_contents($file), 'lockForUpdate'))
            ->toBeTrue(basename($file).' has no lockForUpdate');
    }
});

it('the borrow-request manager routes exist, manager-gated — 2a\'s decision, no longer an absence', function () {
    // This REPLACES the absence pin that stood here through Task 13
    // ("HandoverRequest and the manager's borrow-request screens have no
    // route — still Task 14's, by decision"). Its forbidden fragments
    // were 'handover' and 'borrow-requests/{', and Task 14 is the
    // decision that wires both, so the loop is gone rather than narrowed
    // around its own subject. The 1a DeleteBook precedent said an absence
    // is pinned so that wiring one later is a decision — this is that
    // decision, and this is the presence pin that replaces it.
    //
    // role:manager is what produces the 404 on these routes today:
    // EnsureShelfRole abort(404)s before a controller or a Form Request
    // is resolved. What it costs to lose it was MEASURED for Task 14, by
    // dropping 'role:manager' from the manage group and re-running
    // ManagerQueueScreenTest's reader block — the GET answered 200 with
    // the shelf's queue rendered for a reader; approve and reject still
    // answered 404, from their own Form Requests' abort_unless; and
    // handover, which has no Form Request, answered 403 — HandoverRequest's
    // Gate::forUser()->authorize(), which Laravel renders as an
    // AuthorizationException. A 403 is the existence oracle spec §5.4
    // forbids, so this middleware is load-bearing for the handover POST
    // in particular, not merely tidy. ManagerQueueScreenTest asserts the
    // 404 over HTTP; this asserts the middleware that makes it.
    $routes = collect(Route::getRoutes()->getRoutes());
    foreach ([
        'shelves.manage.borrow-requests',
        'shelves.manage.borrow-requests.approve',
        'shelves.manage.borrow-requests.reject',
        'shelves.manage.borrow-requests.handover',
    ] as $name) {
        $route = $routes->first(fn ($r) => $r->getName() === $name);
        expect($route)->not->toBeNull($name)
            ->and($route->gatherMiddleware())->toContain('role:manager');
    }
});

it('the reader request routes exist, reader-gated — 2a\'s decision, no longer an absence', function () {
    // Reader-gated is the whole of the 404: neither POST carries a field,
    // so neither has a Form Request to hold an abort_unless(..., 404), and
    // EnsureShelfRole's abort(404) is the only producer. Lose role:reader
    // here and a non-member's refusal becomes the Action's
    // AuthorizationException, which Laravel renders 403 — an existence
    // oracle over the URL space (spec §5.4). ReaderRequestSurfaceTest
    // asserts the 404 over HTTP; this asserts the middleware that makes it.
    $routes = collect(Route::getRoutes()->getRoutes());
    $create = $routes->first(fn ($r) => $r->getName() === 'shelves.books.request');
    $cancel = $routes->first(fn ($r) => $r->getName() === 'shelves.profile.requests.cancel');

    foreach ([$create, $cancel] as $route) {
        expect($route)->not->toBeNull()
            ->and($route->gatherMiddleware())->toContain('role:reader');
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
