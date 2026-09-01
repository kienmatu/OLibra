<?php

use App\Support\FoldExpression;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

pest()->extend(TestCase::class)
    ->use(RefreshDatabase::class)
    ->in('Feature');

/**
 * Shared by tests/Feature/FoldParityTest.php. Lives here, not as a global
 * function inside that test file, because Pest loads every test file into
 * one process: a second top-level function definition anywhere else in the
 * suite with this name would be a fatal redeclaration.
 */
function dbFold(string $input): string
{
    $row = DB::selectOne('SELECT '.FoldExpression::sql('?').' AS folded', [$input]);

    return (string) $row->folded;
}

/**
 * A page component's source with its COMMENTS STRIPPED, for the tests that
 * read the rendering layer — `tests/Feature/Admin/AdminScreensRenderFeedback
 * Test.php` (whose forty-line docblock is the argument for reading component
 * source at all) and `tests/Feature/Members/ManagerUnitsScreenTest.php`.
 *
 * **THE STRIPPING IS THE POINT, NOT A DETAIL.** Every one of these pages
 * explains what it does in a comment that names the very prop the test greps
 * for, so a grep over the raw file is satisfied by the prose alone: with the
 * block itself deleted and only its comment left, the first version of the
 * admin file stayed green — measured, it did. `TenancyArchitectureTest`
 * documents the same blindness from the other side, where a where-shaped
 * call inside a comment makes a file its own offender. A guard a comment can
 * satisfy is not a guard.
 *
 * Lives here rather than as a top-level function inside one of those test
 * files, for `dbFold`'s reason and one more. Pest loads every test file into
 * ONE process, so a second definition of this name anywhere would be a fatal
 * redeclaration — and the admin file's own helper hard-codes
 * `pages/admin/`, so a manager screen could not use it without either
 * widening that signature or copying the stripping into a second place where
 * the two could silently drift.
 *
 * $page is relative to `resources/js/pages/` — e.g. 'admin/settings/index.tsx'
 * or 'manage/units.tsx'.
 */
function screenSource(string $page): string
{
    $path = __DIR__.'/../resources/js/pages/'.$page;

    expect(file_exists($path))->toBeTrue("missing screen: {$page}");

    $source = (string) file_get_contents($path);

    // Block comments (JSX's `{/* … */}` included) and line comments. Crude
    // by design: it over-strips a `//` inside a string literal, which costs
    // nothing here because every prop these tests look for is code.
    $stripped = preg_replace('#/\*.*?\*/#s', '', $source);
    $stripped = preg_replace('#//[^\n]*#', '', (string) $stripped);

    return (string) $stripped;
}
