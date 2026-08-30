<?php

use App\Models\AuditLog;
use App\Models\Concerns\BelongsToBookshelf;
use App\Models\Feedback;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;

/**
 * Models allowed to carry a bookshelf_id column WITHOUT the trait, each for
 * a recorded reason: nullable shelf link, scoped-by-hand in app/Queries.
 * A function, not a top-level const: Pest loads every test file into one
 * process, and a second file declaring the same const would fatal.
 *
 * @return list<class-string>
 */
function tenancyExemptModels(): array
{
    return [Feedback::class, AuditLog::class];
}

// This test enumerates Eloquent MODELS, not tables: a table carrying a
// NOT NULL bookshelf_id with no corresponding Eloquent model is invisible to
// it. Nothing in this codebase currently queries such a table directly, but
// a future raw-query-only table would slip past this check entirely.
/** @return array<class-string<Model>> */
function tenancyModelClasses(): array
{
    // allFiles, recursively: a model moved into app/Models/Catalogue/ must
    // stay visible to the trait check — an invisible model is exactly the
    // unscoped-model bug this test exists to catch.
    return collect(File::allFiles(app_path('Models')))
        ->filter(fn ($file) => $file->getExtension() === 'php')
        ->map(fn ($file) => 'App\\Models\\'.str_replace(
            ['/', '.php'], ['\\', ''], $file->getRelativePathname(),
        ))
        ->filter(fn (string $class) => class_exists($class)
            && is_subclass_of($class, Model::class))
        ->values()
        ->all();
}

it('puts BelongsToBookshelf on every model whose table carries bookshelf_id', function () {
    foreach (tenancyModelClasses() as $class) {
        $table = (new $class)->getTable();
        $hasColumn = DB::selectOne('
            select count(*) as n from information_schema.columns
            where table_schema = database() and table_name = ? and column_name = ?
        ', [$table, 'bookshelf_id'])->n > 0;

        $hasTrait = in_array(BelongsToBookshelf::class, class_uses_recursive($class), true);

        if (! $hasColumn) {
            expect($hasTrait)->toBeFalse("{$class} has the trait but no bookshelf_id column");

            continue;
        }

        if (in_array($class, tenancyExemptModels(), true)) {
            // The exemption is only legitimate while the column is nullable —
            // a later migration making it NOT NULL must break this test.
            $nullable = DB::selectOne('
                select is_nullable from information_schema.columns
                where table_schema = database() and table_name = ? and column_name = ?
            ', [$table, 'bookshelf_id'])->is_nullable;

            expect($nullable)->toBe('YES', "{$class} is exempt but its bookshelf_id is NOT NULL")
                ->and($hasTrait)->toBeFalse("{$class} is exempt and must not carry the trait");

            continue;
        }

        // The teeth: a model added in any later phase without the trait
        // fails the build here rather than quietly serving every shelf.
        expect($hasTrait)->toBeTrue("{$class} is shelf-scoped but does not use BelongsToBookshelf");
    }
});

it('confines bookshelf_id filtering to the files this allow-list names', function () {
    $allowed = [
        'app/Models/Scopes/BookshelfScope.php',
        'app/Http/Middleware/ResolveTenant.php',   // the population step itself (Task 16)
        // Phase 1d: AuditLog is one of the two models this file pins as
        // EXEMPT from BelongsToBookshelf (nullable bookshelf_id — global
        // rows exist), so no scope filters it and its one read query must
        // write the where itself. The isolation property this grep can no
        // longer guarantee for that file moves to
        // tests/Feature/Oversight/AuditLogQueryTest.php's two-shelf-plus-
        // global-row test, which proves it by identity, not by convention.
        'app/Queries/AuditLogQuery.php',
        // Phase 2a Task 17: the reminder sweep is the one non-seeder caller
        // of TenantContext::actSystemWide(), so BookshelfScope adds no WHERE
        // to anything it reads. Its "has this reader already been told"
        // probe therefore has to draw the shelf boundary itself — the same
        // situation AuditLogQuery is in above, arrived at from the other
        // direction (that model is unscoped; this CALLER is). Without the
        // filter one reader with the same title due the same day on two
        // shelves is told once, on one bell; the notification the sweep
        // WRITES is scoped by the bookshelf_id it copies off each loan, and
        // SweepIsHousekeepingTest pins both halves.
        //
        // WHAT THIS COSTS, concretely, because an allow-list entry is
        // whole-FILE and not per-clause: that file today holds exactly one
        // hand-written bookshelf_id filter — the probe's — and any SECOND
        // one a later edit adds is now silent, correct or mis-scoped alike,
        // where before it would have failed the build and forced whoever
        // wrote it to come here and justify it. That matters more in this
        // file than it would in an ordinary shelf-scoped one: the sweep
        // runs under actSystemWide(), so BookshelfScope adds nothing
        // underneath to make a rogue where() redundant-but-harmless. This
        // was one of the few automated backstops on manual-filter
        // correctness in the file with the widest blast radius, and it is
        // spent. Reviewing a change to SweepReminders.php means reading its
        // filters by hand. Kept whole-file for consistency with
        // AuditLogQuery above rather than because per-clause was weighed
        // and rejected — a per-clause tripwire is the fix if a second
        // filter ever lands.
        'app/Console/Commands/SweepReminders.php',
    ];

    // Filter-shaped patterns, not assignments: where('bookshelf_id'),
    // whereIn/whereNot/orWhere variants, array syntax
    // where(['bookshelf_id' => ...]), named arguments, whereRaw and raw SQL
    // fragments on the same call line, and the dynamic whereBookshelfId.
    // Deliberately NOT a bare /bookshelf_id\s*=>/ — factories and seeders
    // assign bookshelf_id legitimately (system jobs name their shelf), and
    // the ban is on FILTERING, not naming.
    //
    // A third pattern closes the most dangerous gap: DB::select/statement/
    // raw is a straight-to-SQL path that bypasses the model layer (and
    // therefore BookshelfScope) entirely, so a literal SQL "where ...
    // bookshelf_id" inside one of those calls is exactly a hand-written
    // filter with no Eloquent guard behind it. The pattern requires the
    // literal keyword WHERE ahead of bookshelf_id in the same call — not a
    // bare "DB::statement(...bookshelf_id...)" — because that call is also
    // how every migration in database/migrations legitimately defines the
    // bookshelf_id column itself (ALTER TABLE, ADD CONSTRAINT, generated
    // columns); those are schema definition, not filtering, and a bare
    // match would fail the build on every one of them.
    //
    // Two gaps remain open on purpose, both found in review and left as
    // known limits of a grep-based tripwire rather than closed here: a
    // column name held in a variable ($col = 'bookshelf_id';
    // ->where($col, $id)) and a join() condition naming the column
    // (->join('loans', 'loans.bookshelf_id', ...)) — neither is a literal
    // "bookshelf_id" adjacent to a where-shaped or raw-SQL call, so this
    // regex cannot see them. Closing those needs either static analysis or
    // a stricter convention, not a fatter regex.
    $patterns = [
        '/where[A-Za-z]*\s*\([^;]*bookshelf_id/i',
        '/whereBookshelfId/i',
        '/DB::(?:select|statement|raw)\s*\([^;]*\bwhere\b[^;]*bookshelf_id/i',
    ];

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

            foreach ($patterns as $pattern) {
                if (preg_match($pattern, $file->getContents())) {
                    $offenders[] = str_replace(base_path().'/', '', $file->getPathname());

                    break;
                }
            }
        }
    }

    // Spec §10 risk 1: read-side protection now lives in the model layer,
    // and a hand-written filter is the tell of code bypassing it. This grep
    // is a tripwire, not a proof — a column name held in a variable, or a
    // join() condition naming the column, still slips it (see the comment
    // above the pattern list), which is what review is for.
    expect($offenders)->toBe([]);
});
