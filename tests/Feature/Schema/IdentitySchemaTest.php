<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

it('creates the identity tables', function () {
    foreach (['users', 'sessions', 'bookshelves', 'parish_units', 'memberships'] as $table) {
        expect(Schema::hasTable($table))->toBeTrue("missing table {$table}");
    }
});

it('gives users the columns the final postgres schema has', function () {
    expect(Schema::hasColumns('users', [
        'id', 'username', 'password_hash', 'saint_name', 'full_name',
        'date_of_birth', 'father_name', 'mother_name', 'phone',
        'phone_missing_reason', 'email', 'display_name', 'locale',
        'avatar_object', 'is_super_admin', 'created_at', 'updated_at', 'deleted_at',
    ]))->toBeTrue();

    // avatar_url was dropped by 20260813_02; it must not reappear.
    expect(Schema::hasColumn('users', 'avatar_url'))->toBeFalse();
});

it('keeps the dropped 20260812_01 columns dropped', function () {
    expect(Schema::hasColumn('bookshelves', 'keeper_name'))->toBeFalse()
        ->and(Schema::hasColumn('bookshelves', 'keeper_phone'))->toBeFalse()
        ->and(Schema::hasColumn('bookshelves', 'opening_hours'))->toBeFalse()
        ->and(Schema::hasColumn('memberships', 'leaderboard_opt_in'))->toBeFalse();
});

it('stores uuid keys as varchar(36) ascii_bin — varchar so generated columns may reference them', function () {
    $row = DB::selectOne("
        select data_type, character_maximum_length as len, character_set_name as cs, collation_name as col
        from information_schema.columns
        where table_schema = database() and table_name = 'users' and column_name = 'id'
    ");

    // CHAR(36) here would make errno 1901 of every generated column that
    // names a uuid — reproduced on 10.11.19. See Global Constraints.
    expect($row->data_type)->toBe('varchar')
        ->and($row->len)->toEqual(36)
        ->and($row->cs)->toBe('ascii')
        ->and($row->col)->toBe('ascii_bin');
});

it('stores timestamps as datetime(6), never timestamp', function () {
    $rows = DB::select("
        select table_name, column_name, data_type
        from information_schema.columns
        where table_schema = database()
          and table_name in ('users', 'bookshelves', 'parish_units', 'memberships')
          and column_name in ('created_at', 'updated_at', 'deleted_at', 'approved_at')
    ");

    foreach ($rows as $row) {
        expect($row->data_type)->toBe('datetime', "{$row->table_name}.{$row->column_name} is {$row->data_type}");
    }
});

it('gives the generated username key a binary collation', function () {
    $row = DB::selectOne("
        select collation_name as col, generation_expression as expr
        from information_schema.columns
        where table_schema = database() and table_name = 'users' and column_name = 'username_active'
    ");

    expect($row->col)->toBe('utf8mb4_bin')
        ->and($row->expr)->not->toBeNull();
});

// One behavioural probe per generated unique lives in Task 13's DbGuarantees
// suite; this schema test only proves shape. But the soft-delete-awareness of
// username uniqueness is the design's headline property, so it gets its probe
// here too, early:
it('lets a soft-deleted username be reused, case-insensitively blocks a live one', function () {
    $insert = fn (string $username, ?string $deletedAt) => DB::table('users')->insert([
        'id' => (string) Str::uuid7(),
        'username' => $username,
        'password_hash' => 'x',
        'saint_name' => 'Maria',
        'full_name' => 'Nguyễn Thị Lan',
        'father_name' => 'Cha',
        'mother_name' => 'Mẹ',
        'deleted_at' => $deletedAt,
    ]);

    $insert('lan', now());       // soft-deleted: never blocks
    $insert('lan', null);        // live: takes the name

    expect(fn () => $insert('LAN', null))->toThrow(QueryException::class);
});
