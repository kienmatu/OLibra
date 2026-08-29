<?php

use App\Support\Audit\AuditSentences;

it('every audit action written under app/ has a sentence, and every sentence has a writer', function () {
    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(app_path(), FilesystemIterator::SKIP_DOTS)
    );

    $written = [];
    foreach ($files as $file) {
        if (! str_ends_with($file->getPathname(), '.php')) {
            continue;
        }
        // AuditRecorder::record's first argument, as a literal. A dynamic
        // action name would be invisible here — and is therefore banned:
        // if one ever appears, this census is the test to extend, loudly.
        preg_match_all(
            '/->record\(\s*\n?\s*[\'"]([a-z_]+\.[a-z_]+)[\'"]/',
            (string) file_get_contents($file->getPathname()),
            $matches,
        );
        foreach ($matches[1] as $action) {
            $written[$action] = true;
        }
    }

    // Set-equal in BOTH directions: an action with no sentence renders
    // the fallback to a volunteer (a failure, §3.1), and a sentence with
    // no writer is a stale map that looks maintained. A later phase adds
    // its writer and its map entry in the same commit, or this goes red.
    expect(array_keys($written))->toEqualCanonicalizing(array_keys(AuditSentences::ACTIONS));
});
