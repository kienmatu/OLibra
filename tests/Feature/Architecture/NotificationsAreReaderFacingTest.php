<?php

use App\Support\Notifications\NotificationKind;

/**
 * BR §15 and OPS §7: managers get NO notifications, by design — the
 * requirements give the reason ("avoids notification fatigue for
 * volunteers and removes any dependency on timely background work").
 * "Never" is the hard shape to test, so this enumerates the call sites
 * and pins them against a HAND TRANSCRIPTION of OPS §7's table. Adding a
 * notification anywhere fails this until the table is updated
 * deliberately.
 *
 * The bound, stated rather than implied: nothing mechanically ties the
 * constant below to docs/OPERATIONS.md §7, so a wrong transcription is
 * invisible to this test. It currently holds four of §7's eight rows —
 * the four whose commands exist — and all four were checked against the
 * document by hand at this commit (Task 6 added "Yêu cầu mượn bị từ
 * chối" | `RejectBorrowRequest`, matching §7's table row for row). §7's
 * own "Sách đã sẵn sàng để nhận" row is NOT a fifth: the document itself
 * calls it the same trigger as "Yêu cầu mượn được duyệt", which is why
 * request_approved is one KIND — not two — however many commands write
 * it. Task 10 made that distinction load-bearing: the table's
 * request_approved row now names TWO writers, because §7's own
 * ApproveBorrowRequest cell says "(and the equivalent effect inside
 * ReceiveReturn when it holds for the next reader)". Re-transcribed from
 * docs/OPERATIONS.md:1112-1124 by hand at that commit, all four rows.
 * Every task that adds a row transcribes its own; the same care is the
 * only thing keeping this honest.
 *
 * Grown per task: each task that adds a kind adds its writer AND its row
 * here in the same commit (plan divergence 7). comment_approved arrives
 * in 2b with ApproveComment; the profile-change pair BR §15 names has no
 * reference implementation and is Phase 3's to decide (known-gaps).
 */
const OPS_SECTION_7 = [
    'membership_approved' => ['app/Actions/Members/ApproveMembership.php'],
    'membership_rejected' => ['app/Actions/Members/RejectMembership.php'],
    'request_approved' => [
        'app/Actions/Circulation/ApproveBorrowRequest.php',
        // "…and the equivalent effect inside ReceiveReturn when it holds
        // for the next reader" — OPS §7, verbatim. One kind, two doors.
        'app/Actions/Circulation/ReceiveReturn.php',
    ],
    'request_rejected' => ['app/Actions/Circulation/RejectBorrowRequest.php'],
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
            // \b-anchored, not str_contains: kinds grow per task by
            // design, and the first nesting pair (a RequestApproved beside
            // a RequestApprovedByReturn, say) would make every writer of
            // the longer name register as a writer of the shorter one — a
            // census that silently over-reports writers is worse than one
            // that under-reports, because it goes green on a lie.
            if (preg_match('/\bNotificationKind::'.$kind->name.'\b/', $code) === 1) {
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
    // Four things in the walk are corrections to earlier versions that
    // reviews broke in BOTH directions, and none of them is decoration:
    //
    //   1. T_NULLSAFE_OBJECT_OPERATOR is accepted beside T_OBJECT_OPERATOR.
    //      Without it `$this->notifier?->notify(...)` moved AFTER the
    //      transaction is INVISIBLE — zero call sites counted and no
    //      offender. One Action written with `?->` would walk straight
    //      through the phase's headline guarantee in silence: Phase 1d's
    //      finding reproduced inside the guard built to prevent it.
    //
    //   2. Interpolation braces are COUNTED, not skipped. `"bản {$code}"`
    //      emits its `{` as the array token T_CURLY_OPEN (so a bare
    //      `$token === '{'` never increments depth) while its `}` arrives
    //      as a plain character (so depth IS decremented). One ordinary
    //      Vietnamese line inside a transaction closure therefore made a
    //      COMPLIANT notify() report as an offender.
    //
    //      The first fix for that was to skip everything inside a string,
    //      tracking `"` characters as a toggle. That fix was itself wrong,
    //      and a harness of 35 shapes found it: a `"` token cannot tell an
    //      opening quote from a closing one, and interpolations NEST, so
    //      `"a {$o->m("b {$p->q}")} c"` — legal PHP — walks the toggle
    //      1,0,1,0 where the truth is 1,2,1,0. The inner `}` then landed
    //      OUTSIDE the toggle's idea of the string and closed the
    //      transaction closure's range early, reporting a compliant call
    //      as an offender. Measured in the real file, not theorised: with
    //      that line added above ApproveMembership's unmoved notify, this
    //      test went red naming it.
    //
    //      Counting T_CURLY_OPEN and T_DOLLAR_OPEN_CURLY_BRACES as opening
    //      braces removes the need to know where strings are at all. Every
    //      brace, in code or in an interpolation, is now balanced by the
    //      plain `}` that closes it, at any nesting depth. Braces inside a
    //      single-quoted string, a nowdoc, or a flat "abc" never reach the
    //      walk as characters — those are single tokens — so there is
    //      nothing left for a string tracker to do.
    //
    //   3. A call site requires the NEXT token to be `(`. This is what
    //      replaced the string-skipping half of the old fix: `"$obj->notify"`
    //      tokenises as T_VARIABLE + T_OBJECT_OPERATOR + T_STRING, so a
    //      property read inside a string used to register as a CALL SITE.
    //      A property read is not followed by `(`; a call is. (Whitespace
    //      is filtered out below, so `->notify ("u", $k)` — Pint rejects
    //      that spelling anyway — is still seen as a call.)
    //
    //   4. Arming requires a CALL to something named `transaction`, not
    //      merely the token. It used to arm on any T_STRING whose text was
    //      `transaction`, and a review broke that with two ordinary shapes
    //      that reported no offender for a call inside no transaction:
    //
    //          if ($this->transaction) { $this->notifier->notify(...); }
    //          public function transaction(): void { $this->notifier->notify(...); }
    //
    //      A property read and a method DECLARATION, neither of which opens
    //      a transaction. Arming now needs both halves of a call: the token
    //      before is `::`, `->` or `?->` (rejecting the declaration, whose
    //      predecessor is `function`) and the token after is `(` (rejecting
    //      the property read).
    //
    // The pre-filter is `->notify` with NO paren, so it admits both
    // `?->notify(` and `->notify (`; anything narrower than the walk means
    // a file never reaches the walk at all.
    //
    // Known and deliberate: the walk is CONSERVATIVE about transactions it
    // cannot see. It recognises a transaction body only when a `{` follows
    // a call to something named `transaction` LEXICALLY — so all three of
    // these report a correct call as an offender: a helper wrapper
    // (`$this->atomically(fn () => … notify …)`), a closure assigned to a
    // variable first (`$work = function () { … notify … }; DB::transaction($work);`)
    // and a first-class callable (`DB::transaction($this->work(...))`). No
    // shipped Action uses any of the three; if one appears, teach the walk
    // that shape rather than concluding the guard is wrong.
    //
    // The remaining known gaps are therefore all false ALARMS — the three
    // wrapper shapes above. No silent pass is known, and none of the 35
    // shapes this walk has been run against produces one. That is a
    // stronger claim than this file used to make and it is still not a
    // proof: what is asserted here is "no silent pass is known", never
    // "never a silent pass". The earlier version DID assert the stronger
    // sentence, and the two shapes in correction 4 falsified it.
    //
    // Second known bound: there is NO receiver filter. Any `->notify(`
    // under app/ outside a transaction is an offender, whatever the object
    // — `$this->slack->notify('deploy finished')` would redden this. That
    // is harmless today — re-grepped at Task 10, because the count this
    // sentence used to carry ("this task's own two call sites") went stale
    // the moment 2a started adding writers: `grep -rn -- "->notify(" app/`
    // finds FIVE call sites, in ApproveMembership, RejectMembership,
    // ApproveBorrowRequest, RejectBorrowRequest and ReceiveReturn, all of
    // them this system's own Notifier, and no class USES Laravel's
    // Notifiable trait (`grep -rn "use Notifiable|Notifications\\Notifiable"
    // app/` finds one hit and it is a comment — Bookshelf.php:134, flagging
    // that its own notifications() relation would collide with the trait's
    // if the trait were ever added) — but `$user->notify(new Foo)` is idiomatic
    // Laravel, so the first person to write one will redden the phase's
    // headline guard on correct code. Add a receiver check then —
    // reddening correct code is precisely how a guard ends up deleted by
    // someone in a hurry.
    //
    // stripCommentTokens (used by the three censuses above, which report
    // FILE names only) deletes a comment's text outright, newlines and
    // all. This test reports a LINE, so it strips comments the
    // line-preserving way instead — measured, not tidied. ApproveMembership's
    // notify call is on line 71; comments deleted outright, it lands on
    // line 55, and 55 in the real file is unrelated code. (Re-measure
    // rather than trusting these two numbers if the file moves: the point
    // is the sixteen-line class docblock, not the arithmetic.) A guard
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
    /** @var array<string, int> $callSites */
    $callSites = [];        // relative path => notify() call sites the walk saw
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

        // Whitespace is dropped up front so "the token before" and "the
        // token after" mean the previous and next MEANINGFUL ones, and the
        // arming condition can look one token ahead without re-deriving
        // the skip at three separate call sites.
        $tokens = array_values(array_filter(
            token_get_all($code),
            static fn (array|string $t): bool => ! is_array($t) || $t[0] !== T_WHITESPACE,
        ));

        $depth = 0;
        $txDepths = [];     // brace depths whose body is a DB::transaction closure
        $armed = false;     // a `transaction(` call seen; its body not yet opened
        foreach ($tokens as $i => $token) {
            $previous = $tokens[$i - 1] ?? null;
            $next = $tokens[$i + 1] ?? null;

            if (is_array($token)) {
                // An interpolation's opening brace arrives as one of these
                // ARRAY tokens while its closing brace arrives as a plain
                // `}` character. Counting them here is what keeps the brace
                // ledger balanced through `"bản {$code}"` — see the note
                // above on why this replaced string-skipping.
                if ($token[0] === T_CURLY_OPEN || $token[0] === T_DOLLAR_OPEN_CURLY_BRACES) {
                    $depth++;

                    continue;
                }
                if ($token[0] === T_STRING && $token[1] === 'transaction'
                    && is_array($previous)
                    && in_array($previous[0], [T_DOUBLE_COLON, T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR], true)
                    && $next === '(') {
                    $armed = true;

                    continue;
                }
                if ($token[0] === T_STRING && $token[1] === 'notify'
                    && is_array($previous)
                    && ($previous[0] === T_OBJECT_OPERATOR || $previous[0] === T_NULLSAFE_OBJECT_OPERATOR)
                    && $next === '(') {
                    $callSites[$rel] = ($callSites[$rel] ?? 0) + 1;
                    if ($txDepths === []) {
                        $offenders[] = $rel.' (line '.$token[2].')';
                    }
                }

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
        }
    }

    // A guard that inspected nothing would pass silently, so the walk has
    // to prove it SAW every writer. The first version asserted a magic
    // `$checked >= 2` instead, and a review broke it while it was green:
    // it added a second compliant notify inside ApproveMembership's
    // closure (standing in for any future writer) and renamed
    // RejectMembership's call while MOVING IT OUTSIDE its transaction.
    // $checked was still 2, the floor was still met, and the phase's
    // headline guard stayed GREEN while a notification was written after
    // its transaction returned. A frozen number goes inert the moment a
    // third writer lands; worse, a global count lets one file's calls pay
    // for another file's silence.
    //
    // So the floor is per-FILE and derived from the census table above:
    // every command the table names must contribute at least one call site
    // the walk actually saw. It grows with every task that adds a row, and
    // no amount of inflation elsewhere can cover a writer that went quiet.
    //
    // One exclusion, and it is not a fudge: the sweep (Task 17) is OPS §7's
    // argued non-command exception. It writes through
    // Notification::query()->create under actSystemWide(), never through
    // Notifier, so the two census rows it will own contribute no `->notify`
    // call site for the walk to find — by design, not by omission.
    $sweep = 'app/Console/Commands/SweepReminders.php';
    $silent = [];
    foreach (OPS_SECTION_7 as $writers) {
        foreach ($writers as $writer) {
            if ($writer !== $sweep && ($callSites[$writer] ?? 0) === 0) {
                $silent[] = $writer;
            }
        }
    }

    expect($offenders)->toEqual([])
        ->and($silent)->toEqual([]);
});
