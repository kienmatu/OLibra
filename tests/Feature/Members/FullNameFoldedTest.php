<?php

use App\Models\User;
use App\Support\Fold;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

it('stores the fold of every name, đ included, and agrees with Fold::fold', function () {
    // Đặng is the roster's own regression: unfolded, Đ sorted after every
    // ASCII letter and every Đặng child landed on the roster's last page.
    $names = ['Đặng Văn Bút', 'Nguyễn Thị Lan', 'Trần Minh', 'D\'Artagnan Lê'];

    foreach ($names as $name) {
        $user = User::factory()->create(['full_name' => $name]);
        $stored = DB::table('users')->where('id', $user->id)->value('full_name_folded');

        expect($stored)->toBe(Fold::fold($name), $name);
    }

    expect(Fold::fold('Đặng Văn Bút'))->toBe('dang van but');
});

it('a name whose fold is LONGER than the name itself still stores whole', function () {
    // Fold::MAP expands ß→ss, æ→ae, œ→oe, ĳ→ij. A VARCHAR(255) generated
    // column would truncate or refuse this (errno 1406); TEXT does not.
    // 200 ß folds to 400 characters.
    $name = str_repeat('ß', 200);
    $user = User::factory()->create(['full_name' => $name]);

    $stored = DB::table('users')->where('id', $user->id)->value('full_name_folded');
    expect($stored)->toBe(Fold::fold($name))
        ->and(mb_strlen((string) $stored))->toBe(400);
});

it('the column is generated — writing it directly is refused by the engine', function () {
    $user = User::factory()->create();

    // errno 3105 on MySQL is 1906 on MariaDB: "The value specified for
    // generated column ... has been ignored" is sqlstate HY000 error 1906
    // in strict mode. Same pin dbgExpectViolation uses for member_key.
    expect(fn () => DB::table('users')->where('id', $user->id)->update(['full_name_folded' => 'x']))
        ->toThrow(QueryException::class);
});
