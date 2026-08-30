<?php

use Illuminate\Support\Facades\Route;

// Grep first: `grep -rn "^function actionTransactionCalls" tests/` —
// top-level helpers are process-global (AGENTS.md). One walk, two `it()`
// blocks: Pest short-circuits an expect()->and() chain and a failed
// expect() aborts the whole method, so the rule and the guard's own
// non-vacuity check have to be able to fail independently.
//
// Returns [$callSites, $offenders, $literals]:
//   $callSites  relative path => transaction() call sites the walk saw
//   $offenders  'path (line N)' for each call given no attempts argument
//   $literals   relative paths whose comment-stripped source contains the
//               literal `DB::transaction(` — the walk's own non-vacuity
//               check, derived from the same read rather than a second one
//
// A TOKEN walk, not a regex, for the same reason the notify guard is one:
// "does this call have a second argument" is a nesting question, and
// nesting is not a regular language. The first argument is a multi-line
// closure full of commas — inside `use (...)`, inside array literals,
// inside nested calls — and only a comma at the argument list's OWN depth
// separates arguments.
//
// Three things in the walk are not decoration, and two of them are the
// notify guard's hard-won corrections re-applied here rather than
// rediscovered:
//
//   1. Interpolation braces are COUNTED. `"bản {$code}"` emits its opening
//      brace as the ARRAY token T_CURLY_OPEN (a bare `$t === '{'` never
//      sees it) while its closing brace arrives as a plain `}` character.
//      Uncounted, one ordinary Vietnamese line inside a closure unbalances
//      the ledger, the scan believes the argument list closed early, and a
//      compliant call reports as an offender — or worse, a later comma
//      lands at the wrong depth and an offender reports as compliant.
//      T_ATTRIBUTE (`#[`) is counted for the same reason: its opener is a
//      token, its closer a plain `]`.
//
//   2. Arming requires a CALL to something named `transaction`: the token
//      before is `::`, `->` or `?->` (so `public function transaction()`
//      does not arm) and the token after is `(` (so `$this->transaction`
//      as a property read does not). T_NULLSAFE_OBJECT_OPERATOR is
//      accepted beside T_OBJECT_OPERATOR so `$db?->transaction(...)` is
//      not invisible.
//
//   3. Comments are stripped LINE-PRESERVINGLY, not deleted outright, so
//      the line this reports is the line of the call in the real file. A
//      guard that names a line holding unrelated code is a guard whose
//      next reader concludes it is broken.
//
// Known bounds, stated rather than implied. The walk keys on the METHOD
// NAME, not on the DB facade, so `$connection->transaction(...)` anywhere
// under the directory is held to the same rule. That is the intent — the
// rule is about write transactions, not about one spelling of them — but
// it means a same-named method on some unrelated object would be judged by
// it too. Nothing under the directory has one today.
//
// The other direction is the real bound, and it is the one a reader should
// know before trusting this guard: it pins the CLOSURE spelling only. An
// Action written as `DB::beginTransaction(); … DB::commit();` opens a write
// transaction that this walk cannot see at all — there is no callback for
// an attempts argument to be the second argument OF, so such a command
// would retry nothing and offend nothing. Nothing under app/ uses that
// spelling today (`grep -rn "beginTransaction" app/` is the re-runnable
// check); if one appears, the rule it must be held to is the same one, and
// this walk has to learn that shape rather than be read as having covered
// it.
//
// ROOT-PARAMETERISED (Phase 2b Task 1): $root defaults to
// app/Actions/Circulation, unchanged — CommunityArchitectureTest (Task 2)
// will be the other caller, walking app/Actions/Community with the same
// rule, once that task lands the directory it walks.
/** @return array{0: array<string, int>, 1: list<string>, 2: list<string>} */
function actionTransactionCalls(?string $root = null): array
{
    $root ??= app_path('Actions/Circulation');

    $strip = static function (string $source): string {
        $out = '';
        foreach (token_get_all($source) as $token) {
            if (is_array($token)) {
                [$id, $text] = $token;
                if ($id === T_COMMENT || $id === T_DOC_COMMENT) {
                    $out .= str_repeat("\n", substr_count($text, "\n"));

                    continue;
                }
                $out .= $text;

                continue;
            }
            $out .= $token;
        }

        return $out;
    };

    /** @var array<string, int> $callSites */
    $callSites = [];
    /** @var list<string> $offenders */
    $offenders = [];
    /** @var list<string> $literals */
    $literals = [];

    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)
    );
    foreach ($files as $file) {
        $path = $file->getPathname();
        if (! str_ends_with($path, '.php')) {
            continue;
        }
        $rel = str_replace(base_path().'/', '', $path);
        $code = $strip((string) file_get_contents($path));
        if (str_contains($code, 'DB::transaction(')) {
            $literals[] = $rel;
        }

        $tokens = array_values(array_filter(
            token_get_all($code),
            static fn (array|string $t): bool => ! is_array($t) || $t[0] !== T_WHITESPACE,
        ));
        $count = count($tokens);

        foreach ($tokens as $i => $token) {
            if (! is_array($token) || $token[0] !== T_STRING || $token[1] !== 'transaction') {
                continue;
            }
            $previous = $tokens[$i - 1] ?? null;
            if (! is_array($previous) || ! in_array($previous[0], [T_DOUBLE_COLON, T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR], true)) {
                continue;
            }
            if (($tokens[$i + 1] ?? null) !== '(') {
                continue;
            }

            $callSites[$rel] = ($callSites[$rel] ?? 0) + 1;

            // Walk the argument list from its opening paren. Depth 1 is the
            // list itself; a comma there is an argument separator, and the
            // second argument of Connection::transaction is $attempts.
            $depth = 0;
            $hasAttempts = false;
            for ($j = $i + 1; $j < $count; $j++) {
                $t = $tokens[$j];
                if (is_array($t)) {
                    if (in_array($t[0], [T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES, T_ATTRIBUTE], true)) {
                        $depth++;
                    }

                    continue;
                }
                if ($t === '(' || $t === '[' || $t === '{') {
                    $depth++;

                    continue;
                }
                if ($t === ')' || $t === ']' || $t === '}') {
                    $depth--;
                    if ($depth === 0) {
                        break;
                    }

                    continue;
                }
                if ($t === ',' && $depth === 1) {
                    $hasAttempts = true;
                }
            }

            if (! $hasAttempts) {
                $offenders[] = $rel.' (line '.$token[2].')';
            }
        }
    }

    return [$callSites, $offenders, $literals];
}

it('every circulation write transaction retries — the attempts argument, tokenised', function () {
    // THE PROPERTY, not a list of the commands that happen to be in the
    // cycle today. Phase 2a's divergence 1 records an AB–BA edge over a
    // copy row and a request row that no ordering inside one transaction
    // removes, and the reachability argument about WHICH commands sit on
    // which side of it has now been wrong twice — the plan's version and
    // the whole-branch review's. A rule that only covered the commands
    // named by the latest correct-so-far argument would go stale on the
    // third. So: every Action under app/Actions/Circulation that opens a
    // write transaction passes an attempts count, and a new one cannot
    // become a silent non-retrying participant merely by being written.
    //
    // Connection::transaction's second parameter IS the retry: it runs the
    // callback in a loop and its handleTransactionException returns
    // instead of rethrowing — after rolling the whole transaction back —
    // exactly when the framework's concurrency detector matches and
    // attempts remain. With the implicit $attempts = 1 the loop runs once
    // and an InnoDB 1213 leaves the transaction as a raw QueryException.
    //
    // This asserts the argument is PRESENT, not that it is
    // ConcurrencyRetry::ATTEMPTS or any particular number — pinning the
    // spelling would make a deliberate per-command count a test failure,
    // and the value is argued in ConcurrencyRetry's own docblock, which is
    // where it belongs.
    [, $offenders] = actionTransactionCalls();

    expect($offenders)->toEqual([]);
});

it('the attempts guard actually inspects the transactions it claims to guard', function () {
    // A guard that inspected nothing would pass silently, so the walk has
    // to prove it SAW the calls. NOT a frozen floor and not a hardcoded
    // list of files — NotificationsAreReaderFacingTest records what a
    // magic `>= 2` costs: it stayed green while a writer went quiet. The
    // expectation is DERIVED instead, from the raw source of the same
    // files: any file whose comment-stripped text contains the literal
    // `DB::transaction(` must appear in the walk's own tally. Break the
    // token walk — mis-handle an interpolation brace, drop the nullsafe
    // operator, arm on the wrong token — and the file drops out of the
    // tally while its call is still plainly there, which is exactly the
    // failure this names.
    //
    // One-directional by design: the walk legitimately finds calls this
    // substring cannot (a `$connection->transaction(` spelling), so a file
    // in the tally but not in the substring set is not an offence.
    [$callSites, , $literals] = actionTransactionCalls();

    $blind = [];
    foreach ($literals as $rel) {
        if (($callSites[$rel] ?? 0) === 0) {
            $blind[] = $rel;
        }
    }

    // Chained rather than split into two it() blocks, and that is not the
    // usual short-circuit trap: the two can never both fail. $blind is
    // built out of $literals, so an empty $literals forces an empty
    // $blind. One asserts the read found the calls; the other asserts the
    // walk did not miss any it found.
    expect($literals)->not->toBeEmpty()
        ->and($blind)->toEqual([]);
});

it('the no-argument call walks exactly app/Actions/Circulation — the rename pinned by identity, not by a mutation', function () {
    // Phase 2b Task 1 edits this shipped guard to take a root, a
    // deliberate exception to "a task satisfies a guard rather than
    // editing it" — so the mutation that would normally prove a default's
    // correctness has to prove the WALK'S EXTENT here instead. The plan's
    // first draft proposed pointing the default at
    // app_path('Actions/Members') and expecting the non-vacuity block
    // above to redden; measured, it does not — every file under
    // Actions/Members contains a literal DB::transaction(, and
    // Actions/Catalogue would redden identically, so that mutation only
    // proves the default is READ, never that it points at THIS directory.
    // An identity check on the call-site keys is falsified by any default
    // that is not app/Actions/Circulation, including a sibling one.
    [$defaultCallSites] = actionTransactionCalls();
    [$explicitCallSites] = actionTransactionCalls(app_path('Actions/Circulation'));

    // Self-sufficient rather than leaning on the sibling non-vacuity
    // block above, this file's own house style (see the literals/$blind
    // chain there): an empty $defaultCallSites would make the identity
    // check below pass vacuously against an equally-empty
    // $explicitCallSites, which is not evidence the rename walks
    // anywhere real.
    expect($defaultCallSites)->not->toBeEmpty()
        ->and(array_keys($defaultCallSites))->toEqualCanonicalizing(array_keys($explicitCallSites));
});

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
    // LendCopy's own guarded request update (the ->update([...]) that
    // closes the collected hold). That
    // inverse mistake is pinned executably, not by this comment:
    // HandoverRequestTest's two query-log braces assert the first FOR
    // UPDATE of the whole flow is on book_copies and that no locking read
    // of borrow_requests appears in it at all.
    //
    // What that exemption costs is NOT nothing, and this comment is not
    // the place to imply otherwise: HandoverRequest's pre-flight reads
    // pick a sentence, and only some of what they read is re-established
    // afterwards. LendCopy re-reads the COPY and the MEMBERSHIP rows FOR
    // UPDATE (its two opening lockForUpdate calls) and takes its hold
    // probe and loan
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
        app_path('Actions/Circulation/ReleaseExpiredHold.php'),
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
        // Task 18's fourth POST (ruling 1). Bodiless like the handover,
        // so it has no Form Request either and role:manager is the whole
        // of its 404 — and the measurement above was RE-TAKEN for it, not
        // inherited: dropping 'role:manager' and running the reader block
        // reduced to this POST alone (an earlier failed assertion would
        // otherwise abort the method before reaching it) answered 403,
        // from ReleaseExpiredHold's own Gate. Restored afterwards.
        'shelves.manage.borrow-requests.release',
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
