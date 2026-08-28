<?php

use App\Exceptions\RuleViolated;
use App\Support\UniqueViolation;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

// The Unit test pins UniqueViolation::translate's parsing against a
// hand-built QueryException. That proves the parser matches its own
// fixture, not a real driver message. This pins the same behaviour against
// an actual MariaDB errno 1062 raised by users_username_key — the same
// generated-column unique DbGuaranteesTest provokes — so a MariaDB message
// format this parser cannot handle would be caught here, not just in
// production.
it('translates a real users_username_key collision into username_taken', function () {
    $insert = fn () => DB::table('users')->insert([
        'id' => (string) Str::uuid7(),
        'saint_name' => 'Maria',
        'full_name' => 'Nguyễn Thị Lan',
        'father_name' => 'Cha',
        'mother_name' => 'Mẹ',
        'username' => 'lan',
        'password_hash' => 'x',
    ]);

    $insert();

    try {
        $insert();
        test()->fail('expected a real errno 1062 from users_username_key, the second insert succeeded');
    } catch (QueryException $e) {
        expect(fn () => UniqueViolation::translate($e, ['users_username_key' => 'username_taken']))
            ->toThrow(RuleViolated::class, 'username_taken');
    }
});
