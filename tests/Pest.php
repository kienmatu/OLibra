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
