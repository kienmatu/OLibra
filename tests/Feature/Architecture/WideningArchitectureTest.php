<?php

use Illuminate\Support\Facades\File;

/**
 * Walk the same three roots TenancyArchitectureTest walks, skip anything the
 * caller allow-lists by path suffix, and return repo-relative paths for every
 * remaining file whose contents match $pattern.
 *
 * A function, not a top-level const or closure: Pest loads every test file
 * into one process, so this name is process-global. Grep before adding one
 * (`grep -rn "^function offendersFor" tests/`).
 *
 * @param  list<string>  $allowed  repo-relative path suffixes
 * @return list<string>
 */
function offendersFor(string $pattern, array $allowed): array
{
    $roots = [app_path(), database_path(), base_path('routes')];
    $offenders = [];

    foreach ($roots as $root) {
        foreach (File::allFiles($root) as $file) {
            if ($file->getExtension() !== 'php') {
                continue;
            }

            if (collect($allowed)->contains(fn (string $path) => str_ends_with($file->getPathname(), $path))) {
                continue;
            }

            if (preg_match($pattern, $file->getContents())) {
                $offenders[] = str_replace(base_path().'/', '', $file->getPathname());
            }
        }
    }

    return $offenders;
}

/**
 * Two pins, because the capability has two doors.
 *
 * WHY BOTH. An earlier draft of the spec pinned actSystemWide() alone. After
 * TenantContext::systemWide() exists, no admin query calls actSystemWide() —
 * so that pin would have guarded a method the new code never uses, while
 * systemWide() stayed callable from anywhere with nothing pinning it. The
 * fence has to name the capability, not one method.
 *
 * ROOTS ARE STATED, NOT COPIED. TenancyArchitectureTest scans
 * [app_path(), database_path(), base_path('routes')] — and database_path()
 * is why DemoShelfSeeder is allow-listed below. A pin that copied those
 * roots without it reddens on day one, which is precisely how this phase's
 * spec was wrong three times before review caught it.
 */
it('raw widening is funnelled through TenantContext::systemWide()', function () {
    // The `->` anchor matters: a bare /systemWide\(/ would also match inside
    // actSystemWide(, and /actSystemWide\(/ unanchored matches this file's
    // own prose. Anchoring on the call site is what makes the pattern mean
    // "someone called it".
    $pattern = '/->\s*actSystemWide\s*\(/';

    $allowed = [
        // The wrapper itself — the one sanctioned raw caller.
        'app/Support/TenantContext.php',
        // Phase 2a's nightly cross-shelf sweep, already allow-listed by
        // TenancyArchitectureTest for the same reason.
        'app/Console/Commands/SweepReminders.php',
        // A seeder, widening by design. database_path() is in $roots.
        'database/seeders/DemoShelfSeeder.php',
    ];

    expect(offendersFor($pattern, $allowed))->toBe([]);
});

it('the widening wrapper is confined to app/Queries/Admin', function () {
    $pattern = '/->\s*systemWide\s*\(/';

    $allowed = [
        // Every cross-shelf read lives here. 3a ships one; 3b and 3c add more.
        // A new entry outside this directory is a spec amendment, not a fix.
    ];

    $offenders = collect(offendersFor($pattern, $allowed))
        ->reject(fn (string $path) => str_starts_with($path, 'app/Queries/Admin/'))
        ->values()
        ->all();

    expect($offenders)->toBe([]);
});
