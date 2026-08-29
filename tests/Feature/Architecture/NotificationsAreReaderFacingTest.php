<?php

use App\Support\Notifications\NotificationKind;

/**
 * BR §15 and OPS §7: managers get NO notifications, by design — the
 * requirements give the reason ("avoids notification fatigue for
 * volunteers and removes any dependency on timely background work").
 * "Never" is the hard shape to test, so this enumerates the call sites
 * and pins them against OPS §7's own table. Adding a notification
 * anywhere fails this until the table is updated deliberately.
 *
 * Grown per task: each task that adds a kind adds its writer AND its row
 * here in the same commit (plan divergence 7). comment_approved arrives
 * in 2b with ApproveComment; the profile-change pair BR §15 names has no
 * reference implementation and is Phase 3's to decide (known-gaps).
 */
const OPS_SECTION_7 = [
    'membership_approved' => ['app/Actions/Members/ApproveMembership.php'],
    'membership_rejected' => ['app/Actions/Members/RejectMembership.php'],
];

it('every notification is written where OPERATIONS §7 says it is', function () {
    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(app_path(), FilesystemIterator::SKIP_DOTS)
    );

    $writers = [];
    foreach ($files as $file) {
        $path = $file->getPathname();
        if (! str_ends_with($path, '.php') || str_ends_with($path, 'NotificationKind.php') || str_ends_with($path, 'NotificationSentences.php')) {
            continue;
        }
        $code = stripCommentTokens((string) file_get_contents($path));
        foreach (NotificationKind::cases() as $kind) {
            // The enum case, ONLY. The first draft of this census also
            // matched the raw string "'{$kind->value}'", to catch a direct
            // insert — and it was RED on the commit that introduced it,
            // because app/Support/Audit/AuditSentences.php:138-139 carries
            // the lang keys 'membership_approved' and 'membership_rejected'
            // as live code, which stripCommentTokens rightly does not strip.
            // Renaming those audit keys to dodge a test would churn 1b's
            // shipped sentences, so the test narrows instead: every writer
            // in this system reaches a kind through the enum, the sweep
            // (Task 17) included — it passes NotificationKind::LoanDueSoon
            // to its own tell() helper and writes $kind->value from there,
            // never a literal. If a future writer ever needs the raw
            // string, it adds itself to this census by hand, in the commit
            // that needs it, with the reason.
            if (str_contains($code, 'NotificationKind::'.$kind->name)) {
                $writers[$kind->value][] = str_replace(base_path().'/', '', $path);
            }
        }
    }
    foreach ($writers as &$list) {
        sort($list);
    }

    expect($writers)->toEqual(OPS_SECTION_7);
});

it('the table this guards covers every kind that exists', function () {
    expect(array_keys(OPS_SECTION_7))->toEqualCanonicalizing(
        array_map(fn (NotificationKind $k) => $k->value, NotificationKind::cases()),
    );
});

it('nothing outside the write path and the sweep inserts a notification row', function () {
    // Controllers and queries render notifications and mark them read;
    // they never author one — a page has no command transaction to be
    // inside of. Notification::query()->create / Notification::create
    // may appear ONLY in Notifier and the sweep command.
    $allowed = [
        'app/Support/Notifications/Notifier.php',
        'app/Console/Commands/SweepReminders.php', // Task 17; absent until then is fine
    ];
    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(app_path(), FilesystemIterator::SKIP_DOTS)
    );
    $offenders = [];
    foreach ($files as $file) {
        $path = $file->getPathname();
        if (! str_ends_with($path, '.php')) {
            continue;
        }
        $rel = str_replace(base_path().'/', '', $path);
        if (in_array($rel, $allowed, true)) {
            continue;
        }
        $code = stripCommentTokens((string) file_get_contents($path));
        if (preg_match('/Notification::(query\(\)->)?create\(/', $code) === 1) {
            $offenders[] = $rel;
        }
    }

    expect($offenders)->toEqual([]);
});

it('every notify() call sits inside its command\'s own DB::transaction closure', function () {
    // THE PHASE'S HEADLINE GUARANTEE, made falsifiable. Global Constraints
    // claims "a notification cannot outlive a rolled-back approval, and an
    // approval cannot commit without its notification" — and without this
    // test, moving $this->notifier->notify(...) to AFTER
    // DB::transaction(...) returns in ApproveBorrowRequest,
    // RejectBorrowRequest or ReceiveReturn leaves every behavioural test in
    // this plan green. That is Phase 1d's finding verbatim (a headline
    // guard deletable with 1,028 tests passing), and this project decided
    // not to accept it a second time.
    //
    // A token walk, not a regex: brace depth is not a regular language and
    // "inside the closure" is exactly a brace-range question. Comments are
    // stripped first (line-preservingly — see $strip below) so a docblock
    // showing a notify() call is not a call site.
    //
    // Three things in the walk are corrections to a first version that a
    // review broke in both directions, and none of them is decoration:
    //
    //   1. T_NULLSAFE_OBJECT_OPERATOR is accepted beside T_OBJECT_OPERATOR.
    //      Without it `$this->notifier?->notify(...)` moved AFTER the
    //      transaction is INVISIBLE — zero call sites counted, no offender,
    //      and the $checked floor below satisfied by other files. One
    //      Action written with `?->` would walk straight through the
    //      phase's headline guarantee in silence: Phase 1d's finding
    //      reproduced inside the guard built to prevent it.
    //   2. Anything inside a string is skipped entirely, tracked by the
    //      `"` / backtick character tokens and T_START_HEREDOC /
    //      T_END_HEREDOC. Two reasons, both measured. `"$obj->notify"`
    //      tokenises as T_VARIABLE + T_OBJECT_OPERATOR + T_STRING — a
    //      property read in a string registers as a CALL SITE. And an
    //      interpolation unbalances the brace ledger: `"bản {$code}"`
    //      emits its `{` as the ARRAY token T_CURLY_OPEN (so `$token ===
    //      '{'` is false and depth is never incremented) while its `}`
    //      arrives as a plain character (so depth IS decremented). One
    //      ordinary Vietnamese line — `"Đã cho mượn bản {$code}"` — inside
    //      a transaction closure therefore made a COMPLIANT notify()
    //      report as an offender. A red architecture test on correct code
    //      is how a guard gets deleted. Skipping strings fixes both at
    //      once and subsumes the narrower fix of counting T_CURLY_OPEN and
    //      T_DOLLAR_OPEN_CURLY_BRACES as opening braces.
    //   3. The pre-filter is `->notify` with NO paren, so it admits both
    //      `?->notify(` and `->notify (`; anything narrower than the walk
    //      means a file never reaches the walk at all.
    //
    // Known and deliberate: the walk is CONSERVATIVE about transactions it
    // cannot see. It recognises a transaction body only when a `{` follows
    // the token `transaction` LEXICALLY — so all three of these report a
    // correct call as an offender: a helper wrapper
    // (`$this->atomically(fn () => … notify …)`), a closure assigned to a
    // variable first (`$work = function () { … notify … }; DB::transaction($work);`)
    // and a first-class callable (`DB::transaction($this->work(...))`). No
    // shipped Action uses any of the three, and the failure direction is
    // the safe one (a false alarm, never a silent pass). If one appears,
    // teach the walk that shape; do not conclude the guard is wrong.
    //
    // Second known bound: there is NO receiver filter. Any `->notify(`
    // under app/ outside a transaction is an offender, whatever the object
    // — `$this->slack->notify('deploy finished')` would redden this. That
    // is harmless today (`grep -rn -- "->notify(" app/` finds nothing but
    // this task's own two call sites, and no class uses Laravel's
    // Notifiable trait), but `$user->notify(new Foo)` is idiomatic
    // Laravel, so the first person to write one will redden the phase's
    // headline guard on correct code. Add a receiver check then —
    // reddening correct code is precisely how a guard ends up deleted by
    // someone in a hurry.
    // stripCommentTokens (used by the three censuses above, which report
    // FILE names only) deletes a comment's text outright, newlines and
    // all. This test reports a LINE, so it strips comments the
    // line-preserving way instead — measured, not tidied: with the shared
    // helper, mutation 4 (the moved notify) reported
    // `ApproveMembership.php (line 53)` for a call that is on line 69,
    // because the class docblock above it is sixteen lines long. A guard
    // that names a line holding unrelated code is a guard whose next
    // reader concludes it is broken, and this is the guard this project
    // decided must survive.
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

    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(app_path(), FilesystemIterator::SKIP_DOTS)
    );

    $offenders = [];
    $checked = 0;
    foreach ($files as $file) {
        $path = $file->getPathname();
        if (! str_ends_with($path, '.php')) {
            continue;
        }
        $code = $strip((string) file_get_contents($path));
        // Notifier's own declaration is `public function notify(`, never
        // `->notify(`, so the class that defines the method is skipped
        // here and pinned by the rollback test instead.
        // Deliberately '->notify' without the paren: `->notify ('u', $k)`
        // (space before the paren) would otherwise never reach the walk,
        // which matches on TOKENS and would have caught it. Pint's
        // no_spaces_after_function_name flags that spelling too, so this is
        // belt-and-braces — but a pre-filter narrower than the walk it
        // guards is a hole in the cheapest possible place.
        if (! str_contains($code, '->notify')) {
            continue;
        }
        $rel = str_replace(base_path().'/', '', $path);

        $depth = 0;
        $txDepths = [];     // brace depths whose body is a DB::transaction closure
        $armed = false;     // `transaction` seen; its closure body not yet opened
        $inString = 0;      // inside a double-quoted string, backtick or heredoc
        $previous = null;
        foreach (token_get_all($code) as $token) {
            if (is_array($token)) {
                if ($token[0] === T_WHITESPACE) {
                    continue;
                }
                if ($token[0] === T_START_HEREDOC) {
                    $inString++;
                    $previous = $token;

                    continue;
                }
                if ($token[0] === T_END_HEREDOC) {
                    $inString--;
                    $previous = $token;

                    continue;
                }
                if ($inString > 0) {
                    $previous = $token;

                    continue;
                }
                if ($token[0] === T_STRING && $token[1] === 'transaction') {
                    $armed = true;
                    $previous = $token;

                    continue;
                }
                if ($token[0] === T_STRING && $token[1] === 'notify'
                    && is_array($previous)
                    && ($previous[0] === T_OBJECT_OPERATOR || $previous[0] === T_NULLSAFE_OBJECT_OPERATOR)) {
                    $checked++;
                    if ($txDepths === []) {
                        $offenders[] = $rel.' (line '.$token[2].')';
                    }
                }
                $previous = $token;

                continue;
            }
            // A plain `"` or backtick token only appears around a string
            // that interpolates or escapes — a flat "abc" arrives as one
            // T_CONSTANT_ENCAPSED_STRING and never gets here — so these
            // come in pairs and toggling is sound.
            if ($token === '"' || $token === '`') {
                $inString = $inString === 0 ? 1 : 0;
                $previous = $token;

                continue;
            }
            if ($inString > 0) {
                $previous = $token;

                continue;
            }
            if ($token === '{') {
                $depth++;
                if ($armed) {
                    $txDepths[] = $depth;
                    $armed = false;
                }
            } elseif ($token === '}') {
                if ($txDepths !== [] && end($txDepths) === $depth) {
                    array_pop($txDepths);
                }
                $depth--;
            } elseif ($token === ';') {
                // A `DB::transaction(fn () => …);` opens no brace — disarm
                // so the next unrelated `{` is not mistaken for its body.
                $armed = false;
            }
            $previous = $token;
        }
    }

    expect($offenders)->toEqual([])
        // A guard that inspected nothing would pass silently. This task
        // ships two call sites; Tasks 5, 6 and 10 add three more.
        ->and($checked)->toBeGreaterThanOrEqual(2);
});
