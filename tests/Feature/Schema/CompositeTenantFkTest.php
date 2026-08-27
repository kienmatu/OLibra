<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Two shelves; a parish unit, a user and a membership on each. */
function twoShelves(): array
{
    $make = function (string $suffix): array {
        $shelf = (string) Str::uuid7();
        DB::table('bookshelves')->insert([
            'id' => $shelf, 'slug' => "shelf-{$suffix}-".substr($shelf, -8),
            'name' => 'Tủ sách', 'settings' => '{}',
        ]);

        $unit = (string) Str::uuid7();
        DB::table('parish_units')->insert([
            'id' => $unit, 'bookshelf_id' => $shelf, 'level' => 1, 'name' => 'Giới trẻ',
        ]);

        $user = (string) Str::uuid7();
        DB::table('users')->insert([
            'id' => $user, 'saint_name' => 'Anna', 'full_name' => 'Phạm Thu Hà',
            'father_name' => 'Cha', 'mother_name' => 'Mẹ',
        ]);

        return ['shelf' => $shelf, 'unit' => $unit, 'user' => $user];
    };

    return [$make('a'), $make('b')];
}

it('refuses a membership naming another shelf\'s parish unit', function () {
    [$a, $b] = twoShelves();

    // Within the shelf: fine.
    DB::table('memberships')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $a['shelf'],
        'user_id' => $a['user'], 'parish_unit_l1_id' => $a['unit'],
    ]);

    // Across shelves: unstorable. This exact insert once SUCCEEDED under
    // RLS alone (20260808_04's recorded demonstration); the composite FK is
    // what makes it impossible rather than merely invisible.
    try {
        DB::table('memberships')->insert([
            'id' => (string) Str::uuid7(), 'bookshelf_id' => $b['shelf'],
            'user_id' => $b['user'], 'parish_unit_l1_id' => $a['unit'],
        ]);
        test()->fail('expected the cross-shelf parish unit reference to be refused');
    } catch (QueryException $e) {
        expect($e->getCode())->toBe('23000')
            ->and($e->errorInfo[1])->toBe(1452);   // foreign key constraint fails
    }
});

it('refuses a loan naming another shelf\'s copy', function () {
    [$a, $b] = twoShelves();

    $book = (string) Str::uuid7();
    DB::table('books')->insert([
        'id' => $book, 'bookshelf_id' => $a['shelf'], 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be',
    ]);
    $copy = (string) Str::uuid7();
    DB::table('book_copies')->insert([
        'id' => $copy, 'bookshelf_id' => $a['shelf'], 'book_id' => $book, 'code' => 'DT-0001',
    ]);

    expect(fn () => DB::table('loans')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $b['shelf'],
        'copy_id' => $copy, 'book_id' => $book,
        'borrower_id' => $b['user'], 'lent_by' => $b['user'], 'due_on' => '2026-09-09',
    ]))->toThrow(QueryException::class);
});

it('refuses a request naming another shelf\'s fulfilled loan (circular pair)', function () {
    [$a, $b] = twoShelves();

    $book = (string) Str::uuid7();
    DB::table('books')->insert([
        'id' => $book, 'bookshelf_id' => $a['shelf'], 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be-2',
    ]);
    $copy = (string) Str::uuid7();
    DB::table('book_copies')->insert([
        'id' => $copy, 'bookshelf_id' => $a['shelf'], 'book_id' => $book, 'code' => 'DT-0002',
    ]);
    $loan = (string) Str::uuid7();
    DB::table('loans')->insert([
        'id' => $loan, 'bookshelf_id' => $a['shelf'],
        'copy_id' => $copy, 'book_id' => $book,
        'borrower_id' => $a['user'], 'lent_by' => $a['user'], 'due_on' => '2026-09-09',
    ]);

    $bookB = (string) Str::uuid7();
    DB::table('books')->insert([
        'id' => $bookB, 'bookshelf_id' => $b['shelf'], 'title' => 'Sách khác', 'slug' => 'sach-khac',
    ]);

    expect(fn () => DB::table('borrow_requests')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $b['shelf'],
        'book_id' => $bookB, 'member_id' => $b['user'],
        'fulfilled_loan_id' => $loan,
    ]))->toThrow(QueryException::class);

    // The other side of the circular pair: loans.request_id -> borrow_requests.
    $requestA = (string) Str::uuid7();
    DB::table('borrow_requests')->insert([
        'id' => $requestA, 'bookshelf_id' => $a['shelf'],
        'book_id' => $book, 'member_id' => $a['user'],
    ]);

    expect(fn () => DB::table('loans')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $b['shelf'],
        'copy_id' => $copy, 'book_id' => $book, 'request_id' => $requestA,
        'borrower_id' => $b['user'], 'lent_by' => $b['user'], 'due_on' => '2026-09-09',
    ]))->toThrow(QueryException::class);
});

it('refuses a self-referencing parish unit naming another shelf\'s parent', function () {
    [$a, $b] = twoShelves();

    expect(fn () => DB::table('parish_units')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $b['shelf'],
        'level' => 2, 'parent_id' => $a['unit'], 'name' => 'Nhóm nhỏ',
    ]))->toThrow(QueryException::class);
});

it('carries all fifteen composite fks', function () {
    $rows = DB::select("
        select constraint_name
        from information_schema.key_column_usage
        where table_schema = database()
          and referenced_table_name is not null
          and column_name = 'bookshelf_id'
          and position_in_unique_constraint = 1
          and referenced_table_name <> 'bookshelves'
    ");

    $names = array_map(fn ($r) => $r->constraint_name, $rows);
    sort($names);

    expect($names)->toBe([
        'book_copies_acquired_from_membership_fk',
        'book_copies_book_fk',
        'book_donations_donor_membership_fk',
        'borrow_requests_book_fk',
        'borrow_requests_copy_fk',
        'borrow_requests_fulfilled_loan_fk',
        'comments_book_fk',
        'condition_assessments_copy_fk',
        'condition_assessments_loan_fk',
        'loans_book_fk',
        'loans_copy_fk',
        'loans_request_fk',
        'memberships_parish_unit_l1_fk',
        'memberships_parish_unit_l2_fk',
        'parish_units_parent_fk',
    ]);
});

it('records the correct on delete action for each composite fk', function () {
    $rows = DB::select("
        select kcu.constraint_name, rc.delete_rule
        from information_schema.key_column_usage kcu
        join information_schema.referential_constraints rc
          on rc.constraint_schema = kcu.table_schema
         and rc.constraint_name = kcu.constraint_name
         and rc.table_name = kcu.table_name
        where kcu.table_schema = database()
          and kcu.referenced_table_name is not null
          and kcu.column_name = 'bookshelf_id'
          and kcu.position_in_unique_constraint = 1
          and kcu.referenced_table_name <> 'bookshelves'
    ");

    $rules = [];
    foreach ($rows as $row) {
        $rules[$row->constraint_name] = $row->delete_rule;
    }
    ksort($rules);

    expect($rules)->toBe([
        'book_copies_acquired_from_membership_fk' => 'RESTRICT',
        'book_copies_book_fk' => 'CASCADE',
        'book_donations_donor_membership_fk' => 'RESTRICT',
        'borrow_requests_book_fk' => 'CASCADE',
        'borrow_requests_copy_fk' => 'RESTRICT',
        'borrow_requests_fulfilled_loan_fk' => 'RESTRICT',
        'comments_book_fk' => 'CASCADE',
        'condition_assessments_copy_fk' => 'RESTRICT',
        'condition_assessments_loan_fk' => 'RESTRICT',
        'loans_book_fk' => 'RESTRICT',
        'loans_copy_fk' => 'RESTRICT',
        'loans_request_fk' => 'RESTRICT',
        'memberships_parish_unit_l1_fk' => 'RESTRICT',
        'memberships_parish_unit_l2_fk' => 'RESTRICT',
        'parish_units_parent_fk' => 'RESTRICT',
    ]);
});
