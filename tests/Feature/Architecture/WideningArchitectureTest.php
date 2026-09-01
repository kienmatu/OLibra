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

it('the widening wrapper is confined to app/Queries/Admin and app/Actions/Admin', function () {
    $pattern = '/->\s*systemWide\s*\(/';

    $allowed = [
        // Every cross-shelf read lives here. 3a ships one; 3b and 3c add more.
        // A new entry outside these directories is a spec amendment, not a fix.
    ];

    // Two directories, not one. 3a fenced cross-shelf READS to
    // app/Queries/Admin/. 3b-i's spec (D0) is the amendment that adds
    // cross-shelf WRITES, which are Actions and so cannot live in a Queries
    // namespace. A controller still never calls systemWide() itself.
    $sanctioned = ['app/Queries/Admin/', 'app/Actions/Admin/'];

    $offenders = collect(offendersFor($pattern, $allowed))
        ->reject(fn (string $path) => collect($sanctioned)->contains(
            fn (string $dir) => str_starts_with($path, $dir),
        ))
        ->values()
        ->all();

    expect($offenders)->toBe([]);
});

/**
 * The audit half of the same capability, fenced the same way.
 *
 * AuditRecorder::record() throws with no bound tenant, and that throw guards
 * every shelf-scoped command in the app. 3b-i's `/admin` group binds no
 * tenant, so administration commands configure the recorder first —
 * global() for a cross-shelf act, forShelf($id) for an act against one shelf
 * — and only a configured recorder may write without a bound tenant.
 *
 * That is a way past a fail-closed guard, so it is fenced exactly like
 * systemWide(): reachable only from app/Actions/Admin/. Anywhere else it
 * would be a shelf-scoped command quietly opting out of the tenancy it was
 * supposed to fail on.
 *
 * A SECOND it() IN THIS FILE, NOT A NEW ONE. offendersFor() above is a
 * top-level function and Pest loads every test file into one process, so a
 * new file redeclaring it is a fatal error, not a duplicated helper.
 *
 * The pattern anchors on `->`, so AuditRecorder's own declarations
 * (`public function global(): self`) and its prose do not match — the fence
 * means "someone called it", and the declaring file needs no exemption.
 */
it('the audit configurator is confined to app/Actions/Admin', function () {
    $pattern = '/->\s*(global|forShelf)\s*\(/';

    // ONE FILE, NOT THE DIRECTORY (Phase 3c-ii, spec D7). SubmitFeedback is
    // a community write open to guests, so it cannot live in
    // app/Actions/Admin/ — but the public contact page has no shelf and no
    // tenant, and a site-wide message's audit row has to say so. The grant
    // is one file because app/Actions/Community/ also holds
    // CreateAnnouncement, the pin/unpin pair and the comment and donation
    // commands: allow-listing the directory would open the configurator to
    // exactly the shelf-scoped writes this fence exists to hold inside
    // tenancy. The shelf's own Góp ý route needs no entry at all — it runs
    // under a bound tenant, so the recorder never throws for it.
    // ONE FILE, not the directory: app/Actions/Community/ also holds the
    // announcement, comment and donation writes, which are shelf-scoped and
    // are exactly what this fence exists to hold.
    //
    // ITS COST, stated the way the two TenancyArchitectureTest exemptions
    // state theirs: the allow-list is whole-FILE, so a second and wrongly
    // scoped configurator call added to SubmitFeedback.php later is invisible
    // here. What stands behind it instead is identity: SubmitFeedbackTest's
    // site-wide block and ReaderFeedbackScreenTest's shelf blocks pin both
    // branches by the row they write.
    $allowed = ['app/Actions/Community/SubmitFeedback.php'];

    $offenders = collect(offendersFor($pattern, $allowed))
        ->reject(fn (string $path) => str_starts_with($path, 'app/Actions/Admin/'))
        ->values()
        ->all();

    expect($offenders)->toBe([]);
});
