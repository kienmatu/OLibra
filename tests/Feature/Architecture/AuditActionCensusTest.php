<?php

use App\Support\Audit\AuditSentences;

// Grep first: `grep -rn "^function stripCommentTokens" tests/` — top-level
// helpers are process-global (AGENTS.md).
//
// Removes every T_COMMENT / T_DOC_COMMENT token's text, leaving string
// literals, identifiers and real code untouched — so `->record('x.y', …)`
// written inside a `//` line or a `/** … */` block is gone before the
// census regex ever sees it, while the same call inside a string literal
// (already outside this test's concern) or in live code still matches.
function stripCommentTokens(string $source): string
{
    $stripped = '';
    foreach (token_get_all($source) as $token) {
        if (is_array($token)) {
            [$id, $text] = $token;
            if ($id === T_COMMENT || $id === T_DOC_COMMENT) {
                continue;
            }
            $stripped .= $text;
        } else {
            $stripped .= $token;
        }
    }

    return $stripped;
}

it('every audit action written under app/ has a sentence, and every sentence has a writer', function () {
    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(app_path(), FilesystemIterator::SKIP_DOTS)
    );

    $written = [];
    foreach ($files as $file) {
        if (! str_ends_with($file->getPathname(), '.php')) {
            continue;
        }
        // Comments stripped BEFORE matching: a docblock line that mentions
        // `->record('fake.action', …)` in prose is not a writer, and a
        // plain str_contains/regex census over raw source cannot tell the
        // two apart. That failure mode cuts the wrong way — it means a
        // REAL call site commented out (e.g. mid-refactor) still counts as
        // written, silently masking the staleness this test exists to
        // catch. token_get_all is used, not a comment-stripping regex,
        // because a regex for "a comment" has to itself get `//` inside a
        // string literal, `#` inside a string, and `/* */` spanning a
        // string boundary right — exactly the class of bug this guard is
        // trying to not reintroduce one layer up.
        $code = stripCommentTokens((string) file_get_contents($file->getPathname()));
        // AuditRecorder::record's first argument, as a literal. A dynamic
        // action name would be invisible here — and is therefore banned:
        // if one ever appears, this census is the test to extend, loudly.
        preg_match_all(
            '/->record\(\s*\n?\s*[\'"]([a-z_]+\.[a-z_]+)[\'"]/',
            $code,
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
