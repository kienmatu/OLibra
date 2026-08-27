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

/** @return array<class-string<Model>> */
function allModelClasses(): array
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
    foreach (allModelClasses() as $class) {
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

it('confines bookshelf_id filtering to the two named files', function () {
    $allowed = [
        'app/Models/Scopes/BookshelfScope.php',
        'app/Http/Middleware/ResolveTenant.php',   // the population step itself (Task 16)
    ];

    // Filter-shaped patterns, not assignments: where('bookshelf_id'),
    // whereIn/whereNot/orWhere variants, array syntax
    // where(['bookshelf_id' => ...]), named arguments, whereRaw and raw SQL
    // fragments on the same call line, and the dynamic whereBookshelfId.
    // Deliberately NOT a bare /bookshelf_id\s*=>/ — factories and seeders
    // assign bookshelf_id legitimately (system jobs name their shelf), and
    // the ban is on FILTERING, not naming.
    $patterns = [
        '/where[A-Za-z]*\s*\([^;]*bookshelf_id/i',
        '/whereBookshelfId/i',
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
    // is a tripwire, not a proof — a DB::raw fragment on its own line still
    // slips it, which is what review is for.
    expect($offenders)->toBe([]);
});
