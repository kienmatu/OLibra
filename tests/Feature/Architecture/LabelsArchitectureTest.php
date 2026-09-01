<?php

use Illuminate\Support\Facades\Route;

// Grep first: `grep -rn "^function actionTransactionCalls" tests/` —
// top-level helpers are process-global (AGENTS.md). This file CALLS that
// helper (defined in CirculationArchitectureTest.php:74, root-parameterised
// in Phase 2b Task 1) and defines none of its own.
//
// THAT HAS A COST, and it is the sibling's cost too rather than one this
// file introduces: run this file ALONE and the transaction block dies on
// "Call to undefined function actionTransactionCalls()", because nothing
// loaded the file that declares it. MEASURED on
// CommunityArchitectureTest.php run alone — 2 failed, 5 passed, same cause.
// The suite runs every file, so `make test` is green; a single-file run of
// either needs the circulation file in the same invocation.
//
// Phase 2c's architecture pins. Three properties this phase's prose claims
// and nothing else in the suite held: that the phase introduced no new
// timezone literal, that the label export route is declared where it has to
// be, and that the slice's one write command retries.

it('adds no new Asia/Ho_Chi_Minh literal — the census, comments stripped', function () {
    // BR §5.4's one named civil zone. Clock::ZONE (app/Support/Clock.php:39)
    // is the declaration everything written from Phase 2c onward reads;
    // App\Support\Clock's own docblock says so. What this refuses is a
    // THIRTEENTH occurrence appearing without an argument for it.
    //
    // A CENSUS, NOT AN ALLOW-LIST OF TWO — and that correction is recorded
    // rather than quietly applied, because the number came out of this
    // task's own brief. The brief said to allow-list "only Clock::ZONE's
    // declaration and MyLoanHistoryQuery's two known pre-existing ones, by
    // name". MEASURED: with comments stripped, app/ holds twelve
    // occurrences across eleven files, not three. Nine of them are
    // Phase 1/2a/2b sites the brief did not know about — an allow-list of
    // three would have been red the day it was written, and "fixing" the
    // tree to match it would have meant nine unrelated refactors inside a
    // documentation sweep. The list below is what is actually there.
    //
    // COMMENTS ARE STRIPPED before matching, deliberately, and this is the
    // one place in this repo's guards where that is true. The sibling
    // guards (CommunityArchitectureTest's clock grep, TenancyArchitectureTest's
    // bookshelf_id grep) read raw source and therefore fire on prose —
    // measured twice this phase, in Tasks 2 and 7, where correct docblock
    // prose was reworded to clear a tripwire. docs/known-gaps.md carries
    // that finding. This block would be unusable raw: the literal appears
    // in a dozen more docblocks that are explaining the rule.
    $strip = static function (string $source): string {
        $out = '';
        foreach (token_get_all($source) as $token) {
            if (is_array($token)) {
                if ($token[0] === T_COMMENT || $token[0] === T_DOC_COMMENT) {
                    continue;
                }
                $out .= $token[1];

                continue;
            }
            $out .= $token;
        }

        return $out;
    };

    // path => number of occurrences in the comment-stripped source.
    //
    // app/Support/Clock.php ................. the ZONE declaration itself.
    // app/Queries/MyLoanHistoryQuery.php .... TWO, deliberately not switched
    //   to Clock::ZONE; recorded in docs/known-gaps.md since Task 1 (D3).
    // The other nine predate this phase. Each is a formatter or a const
    // reached before Clock::ZONE existed as the single door; none was
    // touched by Phase 2c. SweepReminders' is not even a timezone argument —
    // it is the words "07:00 Asia/Ho_Chi_Minh" inside the command's
    // $description sentence, which is why this census counts occurrences
    // rather than claiming every one of them is a zone lookup.
    $census = [
        'app/Actions/Circulation/ApproveBorrowRequest.php' => 1,
        'app/Actions/Circulation/ReceiveReturn.php' => 1,
        'app/Console/Commands/SweepReminders.php' => 1,
        'app/Http/Controllers/Manage/AnnouncementController.php' => 1,
        'app/Http/Controllers/Manage/BorrowRequestController.php' => 1,
        // MOVED, NOT ADDED, in phase 3c-ii Task 5: this was
        // app/Queries/AuditLogQuery.php's until the audit browser's joins,
        // ordering and four filters — the civil-day boundary among them —
        // were extracted so /admin/audit could share them rather than
        // re-derive a timezone rule this repo has already paid for. The
        // count is still one, and it is still the same declaration.
        'app/Queries/Concerns/ReadsAuditLog.php' => 1,
        'app/Queries/Exports/LoansExportQuery.php' => 1,
        'app/Queries/Exports/ReadersExportQuery.php' => 1,
        'app/Queries/MyDashboardQuery.php' => 1,
        'app/Queries/MyLoanHistoryQuery.php' => 2,
        'app/Support/Clock.php' => 1,
    ];

    $found = [];
    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(app_path(), FilesystemIterator::SKIP_DOTS)
    );
    foreach ($files as $file) {
        $path = $file->getPathname();
        if (! str_ends_with($path, '.php')) {
            continue;
        }
        $count = substr_count($strip((string) file_get_contents($path)), 'Asia/Ho_Chi_Minh');
        if ($count > 0) {
            $found[str_replace(base_path().'/', '', $path)] = $count;
        }
    }
    ksort($found);

    // Non-vacuity first, in its own expect(): a walk that found nothing at
    // all would otherwise have to be read out of an equality failure.
    expect($found)->not->toBe([]);
    expect($found)->toBe($census);
});

it('declares POST exports/qr-labels before POST exports/{kind}', function () {
    // LOAD-BEARING, not habitual, and the difference matters — see
    // CommunityArchitectureTest's two route-order blocks, where one is each.
    // These two share a path prefix AND a verb: both are POST, both are one
    // segment past `exports`. Declared the other way round, every label
    // export POST matches {kind} = 'qr-labels' and reaches ExportController
    // instead of LabelController, which answers about a report that does not
    // exist rather than a PDF.
    //
    // A RETRACTION, by name. An earlier draft of the Phase 2c plan pinned
    // "/ma-qr before /ma-qr/xuat" and called it "the same trap" as
    // CommunityArchitectureTest's existing blocks. That was false twice
    // over: the URIs are English here, and those two were distinct LITERALS
    // on different verbs, where declaration order cannot matter. The trap
    // the sibling file pins is a literal before a PARAMETER
    // (announcements/create before announcements/{announcement}). This block
    // is the version of that claim which is actually true.
    //
    // Positional over the POST routes in declaration order, which is what
    // makes it independent of tests/Feature/Labels/LabelExportTest.php's
    // blocks that actually post to this address.
    $uris = collect(Route::getRoutes()->getRoutes())
        ->filter(fn ($route) => in_array('POST', $route->methods(), true))
        ->map(fn ($route) => $route->uri())
        ->values();

    $posLiteral = $uris->search('shelves/{shelf}/manage/exports/qr-labels');
    $posBound = $uris->search('shelves/{shelf}/manage/exports/{kind}');

    expect($posLiteral)->not->toBeFalse();
    expect($posBound)->not->toBeFalse();
    expect($posLiteral)->toBeLessThan($posBound);
});

it('MarkCopiesPrinted — the label slice\'s only write — opens a retrying transaction', function () {
    // The property CirculationArchitectureTest and CommunityArchitectureTest
    // each state for their whole directory, through the same token walk,
    // narrowed HERE TO ONE FILE — and the narrowing is the honest shape, not
    // a shortcut. MEASURED: app/Actions/Catalogue holds nine
    // DB::transaction( call sites and eight of them pass no attempts
    // argument, all predating this phase. A directory-wide assertion copied
    // from the siblings would have been red on arrival, and going green
    // would have meant editing eight Phase 1 commands from inside a
    // documentation sweep.
    //
    // This asserts the argument is PRESENT, not that it is
    // ConcurrencyRetry::ATTEMPTS or any particular number — the siblings'
    // sentence, for the siblings' reason: the value is argued in
    // ConcurrencyRetry's own docblock.
    [$callSites, $offenders] = actionTransactionCalls(app_path('Actions/Catalogue'));

    $file = 'app/Actions/Catalogue/MarkCopiesPrinted.php';

    // The walk must actually SEE this file's transaction. Without this the
    // block below would pass on a MarkCopiesPrinted that had lost its
    // DB::transaction( altogether, since a file with no call site cannot
    // offend.
    expect($callSites[$file] ?? 0)->toBe(1);

    // PREFIX, NOT EQUALITY, and this is a defect this block CAUGHT IN
    // ITSELF rather than a subtlety noticed while reading. The first
    // version of this line was `in_array($file, $offenders, true)`. The
    // walk does not put bare paths in $offenders — it puts
    // "app/…/Foo.php (line 61)" — so the needle could never match and the
    // assertion was vacuously green. MEASURED: with
    // `, ConcurrencyRetry::ATTEMPTS` deleted from MarkCopiesPrinted the
    // whole architecture directory still reported 55 passed. It is the
    // falsification run that found it, which is the argument for running
    // one on every pin rather than on the ones that look risky.
    $offending = array_values(array_filter(
        $offenders,
        static fn (string $entry): bool => str_starts_with($entry, $file.' '),
    ));

    expect($offending)->toBe([]);
});

it('MarkCopiesPrinted takes no lock, and increments in SQL — which is why it needs none', function () {
    // A RETRACTION of this task's own brief, which asked to pin that the
    // slice's write transaction "opens with its lock", matching
    // CommunityArchitectureTest's FOR UPDATE block. MEASURED: it does not,
    // and it should not. That sibling block is hand-maintained precisely
    // because not every command takes a lock — CreateComment is absent from
    // it, on the ground that it re-reads no existing row — and
    // MarkCopiesPrinted falls on the same side for a sharper reason: it
    // performs no read at all. It is one UPDATE ... WHERE id IN (...) whose
    // new value is computed by the database from the old one.
    //
    // So what the lock would buy is bought instead by the atomic SQL
    // increment, and THAT is the property worth pinning. A rewrite to
    // read-modify-write in PHP — a foreach over the copies bumping
    // $copy->qr_print_count — would be lost-update-prone under the
    // REPEATABLE-READ this server was measured at, and would then genuinely
    // need the lock. This block reddens on that rewrite, which is the moment
    // someone has to make the decision again.
    //
    // Two separate expects rather than a chain: the absence and the presence
    // are independent facts and a chained ->and() would hide the second.
    $source = (string) file_get_contents(app_path('Actions/Catalogue/MarkCopiesPrinted.php'));

    expect(str_contains($source, 'lockForUpdate'))
        ->toBeFalse('MarkCopiesPrinted grew a lockForUpdate — read this block before removing it');
    expect(str_contains($source, "DB::raw('qr_print_count + 1')"))
        ->toBeTrue('MarkCopiesPrinted no longer increments in SQL — it now needs the lock it does not take');
});
