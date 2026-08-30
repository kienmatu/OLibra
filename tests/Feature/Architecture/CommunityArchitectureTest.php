<?php

// Grep first: `grep -rn "^function wallClockOffenders" tests/` —
// top-level helpers are process-global (AGENTS.md).
//
// THE COMMUNITY HALF OF THE NO-WALL-CLOCK GREP. This is a second copy of
// the four-token regex CirculationArchitectureTest's own clock block
// carries, and the duplication is DELIBERATE and disclosed rather than
// left to be discovered: sharing it would mean editing a shipped guard to
// extract a helper, and this phase already made one such exception (Task
// 1's root-parameterised transaction walk). docs/known-gaps.md carries
// the same note.
//
// (?<![->]) excludes `$this->clock->now()` — the Clock's own method IS the
// sanctioned door; what this bans is the bare now() helper and the static
// Carbon reads. It reads RAW SOURCE, comments included, so the literal
// `Clock::now()` written into a docblock reddens this too; that is the
// bound, not a defect.
/** @return list<string> basenames of the offending files */
function wallClockOffenders(string $root): array
{
    $offenders = [];
    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)
    );
    foreach ($files as $file) {
        $src = (string) file_get_contents($file->getPathname());
        if (preg_match('/(?<![->])\bnow\(\)|Carbon::now|CarbonImmutable::now/', $src) === 1) {
            $offenders[] = basename($file->getPathname());
        }
    }

    return $offenders;
}

// NO is_dir() GUARD ANYWHERE IN THIS FILE, and that is the point of it
// existing in Task 2's commit rather than Task 1's. Measured both ways,
// and RE-measured after the fix round made the audit block recurse like
// its two siblings: with app/Actions/Community absent entirely this file
// is 4 failed (0 assertions) — all four blocks die on
// UnexpectedValueException from RecursiveDirectoryIterator, where before
// the recursion change three did and the fourth failed on an empty
// glob(); with the directory present but EMPTY it is 2 failed, 2 passed,
// because the retry block and the clock block have nothing to offend and
// pass on absence. A block that passes on absence is exactly what these
// guards exist to refuse, so the fix for a red run here is the Action,
// never an is_dir().

it('every community write transaction retries — the attempts argument, tokenised', function () {
    // The same property CirculationArchitectureTest states for its own
    // directory, through the same token walk (renamed and
    // root-parameterised in Task 1 for this caller): every Action under
    // app/Actions/Community that opens a write transaction passes an
    // attempts count, so a new one cannot become a silent non-retrying
    // participant merely by being written.
    //
    // This asserts the argument is PRESENT, not that it is
    // ConcurrencyRetry::ATTEMPTS or any particular number — pinning the
    // spelling would make a deliberate per-command count a test failure,
    // and the value is argued in ConcurrencyRetry's own docblock.
    [, $offenders] = actionTransactionCalls(app_path('Actions/Community'));

    expect($offenders)->toEqual([]);
});

it('the community attempts guard actually inspects the transactions it claims to guard', function () {
    // The sibling file's derivation, and it has teeth from this commit
    // because the directory now holds a file that really opens one: any
    // file whose comment-stripped source contains the literal
    // `DB::transaction(` must appear in the walk's own tally, and the
    // tally must not be empty. Break the token walk and a file drops out
    // of the tally while its call is still plainly there.
    //
    // One-directional by design: the walk legitimately finds calls this
    // substring cannot (a `$connection->transaction(` spelling), so a
    // file in the tally but not in the substring set is not an offence.
    [$callSites, , $literals] = actionTransactionCalls(app_path('Actions/Community'));

    $blind = [];
    foreach ($literals as $rel) {
        if (($callSites[$rel] ?? 0) === 0) {
            $blind[] = $rel;
        }
    }

    // Chained rather than split, and that is not the usual short-circuit
    // trap: the two can never both fail, because $blind is built out of
    // $literals and an empty $literals forces an empty $blind.
    expect($literals)->not->toBeEmpty()
        ->and($blind)->toEqual([]);
});

it('no Action under app/Actions/Community reads the wall clock', function () {
    // The title names the directory this actually walks. A test whose
    // name overclaims its body is how a rule gets believed without being
    // enforced — the sibling file carries the same correction.
    //
    // Clock is the only place Carbon reads the wall clock. A community
    // file calling now() bypasses setTestNow-driven derivations and BR
    // §5.4's timezone rule at once.
    expect(wallClockOffenders(app_path('Actions/Community')))->toBe([]);
});

it('no Action under app/Actions/Community skips the audit recorder', function () {
    // CatalogueArchitectureTest's tripwire, ported by shape rather than
    // by copy: each file must constructor-inject an AuditRecorder AND
    // call ->record( on whatever the constructor named the property, so
    // an Action pasted without audit fails the build rather than quietly
    // shipping unaudited. Asserting the class name merely APPEARED in the
    // source would pass on a file that imports AuditRecorder and never
    // calls it.
    //
    // There is NO allow-list here, unlike the catalogue file's code
    // allocator: every command in this directory audits. Adding an
    // exemption means arguing for it in this comment, not adding a
    // str_ends_with.
    //
    // RECURSIVE, deliberately diverging from the catalogue file this is
    // ported from: that one globs a single level, and this file's other
    // two directory walks both recurse, so a shallow glob under a title
    // saying "under app/Actions/Community" would give an Action at
    // Community/Moderation/Foo.php the retry and clock rules while
    // silently exempting it from this one. This file elsewhere makes a
    // point of titles not overclaiming their bodies.
    //
    // INV-8 has a second, sharper reason to be pinned by a tripwire in
    // THIS namespace: AuditSentences::phrase() ends in a default arm, so
    // a community action shipped with no match arm renders the
    // undescribed-action fallback to a volunteer instead of failing the
    // build the way a missing NotificationSentences arm does.
    //
    // CORRECTED IN THE FIX ROUND, and the correction is measured: this
    // comment used to say AuditActionCensusTest's set-equality catches
    // the missing ARM. It does not — both of that file's blocks compare
    // ->record('x.y') string literals against array_keys(ACTIONS) and
    // neither ever calls phrase() or sentence(), so deleting an arm
    // leaves it green (measured, twice: in the original commit and
    // again in this one). What catches a missing arm is
    // AuditSentencesTest's "every action in the map renders a real
    // sentence" sweep, added in this fix round for exactly that gap.
    // What THIS block catches is the missing CALL.
    $files = [];
    $found = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(app_path('Actions/Community'), FilesystemIterator::SKIP_DOTS)
    );
    foreach ($found as $file) {
        if (str_ends_with($file->getPathname(), '.php')) {
            $files[] = $file->getPathname();
        }
    }
    // Non-vacuity, the same job the glob's own empty check did: with the
    // directory present but empty this block still fails rather than
    // passing on absence.
    expect($files)->not->toBe([]);

    foreach ($files as $file) {
        $source = (string) file_get_contents($file);

        expect(preg_match('/private\s+(?:readonly\s+)?AuditRecorder\s+\$(\w+)/', $source, $ctor))
            ->toBe(1, basename($file).' does not constructor-inject an AuditRecorder');

        expect(preg_match('/\$this->'.$ctor[1].'->record\s*\(/', $source))
            ->toBe(1, basename($file).' never calls ->record() on its AuditRecorder');
    }
});

it('every community write transaction that re-reads an existing row opens with a FOR UPDATE — the grep pin', function () {
    // Task 4 fix round 1. ApproveCommentTest carries its own query-log
    // block proving lockForUpdate is that command's transaction's FIRST
    // statement; RejectComment and HideComment's docblocks made the same
    // claim ("FIRST statement — the only lock this command takes") with
    // nothing in the suite pinning it. Rather than port ApproveCommentTest's
    // query-log block twice more, this follows CirculationArchitectureTest's
    // own precedent for the same shape ('every circulation write
    // transaction opens with a FOR UPDATE — the grep pin'): a
    // hand-maintained, presence-only grep, which covers every Action this
    // phase's remaining tasks (5-19) add to this directory without a
    // per-command block for each one.
    //
    // Presence only, like the Circulation precedent it is ported from —
    // this does not re-derive POSITION (that stays ApproveCommentTest's
    // query-log job); it only refuses a lock silently dropped from one of
    // the commands that must keep theirs.
    //
    // Hand-maintained rather than a directory-wide walk, because not
    // every community Action takes a lock: CreateComment INSERTS a fresh
    // row and never re-reads an existing one, so it has no lockForUpdate
    // to check for — a directory-wide "every file must contain
    // lockForUpdate" would be false on that ground the day it was
    // written. Adding a new community Action later means deciding, in
    // this comment, which side of that line it falls on — CreateComment's
    // absence from the list below is that decision already made, once.
    foreach ([
        app_path('Actions/Community/ApproveComment.php'),
        app_path('Actions/Community/RejectComment.php'),
        app_path('Actions/Community/HideComment.php'),
    ] as $file) {
        expect(str_contains((string) file_get_contents($file), 'lockForUpdate'))
            ->toBeTrue(basename($file).' has no lockForUpdate');
    }
});
