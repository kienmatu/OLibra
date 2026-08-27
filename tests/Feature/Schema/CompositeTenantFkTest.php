<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Two shelves; a parish unit and a user on each. */
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

/**
 * Assert that $attempt() fails with the given composite FK constraint
 * (MariaDB errno 1452, SQLSTATE 23000) firing specifically — not merely
 * *some* QueryException, which on these tables can also come from an
 * unrelated FK on the same insert or a generated-column unique violation.
 */
function assertFkRefusal(callable $attempt, string $constraint): void
{
    try {
        $attempt();
        test()->fail("expected foreign key constraint `{$constraint}` to fire");
    } catch (QueryException $e) {
        expect($e->getCode())->toBe('23000')
            ->and($e->errorInfo[1])->toBe(1452)
            ->and($e->errorInfo[2])->toContain("CONSTRAINT `{$constraint}`");
    }
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
    assertFkRefusal(fn () => DB::table('memberships')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $b['shelf'],
        'user_id' => $b['user'], 'parish_unit_l1_id' => $a['unit'],
    ]), 'memberships_parish_unit_l1_fk');
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

    // Shelf B's own book, so book_id is NOT cross-shelf here — only copy_id
    // is, isolating the failure to loans_copy_fk specifically.
    $bookB = (string) Str::uuid7();
    DB::table('books')->insert([
        'id' => $bookB, 'bookshelf_id' => $b['shelf'], 'title' => 'Sách khác', 'slug' => 'sach-khac-loan',
    ]);

    assertFkRefusal(fn () => DB::table('loans')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $b['shelf'],
        'copy_id' => $copy, 'book_id' => $bookB,
        'borrower_id' => $b['user'], 'lent_by' => $b['user'], 'due_on' => '2026-09-09',
    ]), 'loans_copy_fk');
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

    // borrow_requests.fulfilled_loan_id -> loans: bookB and member_b are both
    // shelf B's own, so fulfilled_loan_id is the only cross-shelf column.
    assertFkRefusal(fn () => DB::table('borrow_requests')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $b['shelf'],
        'book_id' => $bookB, 'member_id' => $b['user'],
        'fulfilled_loan_id' => $loan,
    ]), 'borrow_requests_fulfilled_loan_fk');

    // The other side of the circular pair: loans.request_id -> borrow_requests.
    $requestA = (string) Str::uuid7();
    DB::table('borrow_requests')->insert([
        'id' => $requestA, 'bookshelf_id' => $a['shelf'],
        'book_id' => $book, 'member_id' => $a['user'],
    ]);

    // Shelf B's own copy (on shelf B's own book), so copy_id and book_id are
    // NOT cross-shelf here — only request_id is, isolating the failure to
    // loans_request_fk specifically. Without a shelf-B copy/book, this insert
    // fails on loans_copy_fk instead and would pass even if loans_request_fk
    // were dropped entirely.
    $copyB = (string) Str::uuid7();
    DB::table('book_copies')->insert([
        'id' => $copyB, 'bookshelf_id' => $b['shelf'], 'book_id' => $bookB, 'code' => 'DT-0003',
    ]);

    assertFkRefusal(fn () => DB::table('loans')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $b['shelf'],
        'copy_id' => $copyB, 'book_id' => $bookB, 'request_id' => $requestA,
        'borrower_id' => $b['user'], 'lent_by' => $b['user'], 'due_on' => '2026-09-09',
    ]), 'loans_request_fk');
});

it('refuses a self-referencing parish unit naming another shelf\'s parent', function () {
    [$a, $b] = twoShelves();

    assertFkRefusal(fn () => DB::table('parish_units')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $b['shelf'],
        'level' => 2, 'parent_id' => $a['unit'], 'name' => 'Nhóm nhỏ',
    ]), 'parish_units_parent_fk');
});

/**
 * The full shape of every composite tenant FK: constraint name, owning
 * table, both referencing columns (in order), and the parent table. Keyed
 * on constraint_name so a regression that repoints a FK at the wrong parent,
 * or pairs bookshelf_id with the wrong second column, changes the value
 * under an unchanged key rather than silently vanishing from the set.
 *
 * @return array<string, array{table: string, columns: string, parent: string}>
 */
function compositeTenantFkShapes(): array
{
    $rows = DB::select("
        select constraint_name, table_name, column_name, referenced_table_name, ordinal_position
        from information_schema.key_column_usage
        where table_schema = database()
          and referenced_table_name is not null
          and constraint_name like '%\\_fk'
        order by constraint_name, ordinal_position
    ");

    $shapes = [];
    foreach ($rows as $row) {
        $shapes[$row->constraint_name]['table'] ??= $row->table_name;
        $shapes[$row->constraint_name]['parent'] ??= $row->referenced_table_name;
        $shapes[$row->constraint_name]['columns'][] = $row->column_name;
    }

    foreach ($shapes as &$shape) {
        $shape['columns'] = implode(',', $shape['columns']);
    }

    ksort($shapes);

    return $shapes;
}

it('carries all fifteen composite fks, each pointing at the right parent and columns', function () {
    expect(compositeTenantFkShapes())->toBe([
        'book_copies_acquired_from_membership_fk' => ['table' => 'book_copies', 'parent' => 'memberships', 'columns' => 'bookshelf_id,acquired_from_membership_id'],
        'book_copies_book_fk' => ['table' => 'book_copies', 'parent' => 'books', 'columns' => 'bookshelf_id,book_id'],
        'book_donations_donor_membership_fk' => ['table' => 'book_donations', 'parent' => 'memberships', 'columns' => 'bookshelf_id,donor_membership_id'],
        'borrow_requests_book_fk' => ['table' => 'borrow_requests', 'parent' => 'books', 'columns' => 'bookshelf_id,book_id'],
        'borrow_requests_copy_fk' => ['table' => 'borrow_requests', 'parent' => 'book_copies', 'columns' => 'bookshelf_id,copy_id'],
        'borrow_requests_fulfilled_loan_fk' => ['table' => 'borrow_requests', 'parent' => 'loans', 'columns' => 'bookshelf_id,fulfilled_loan_id'],
        'comments_book_fk' => ['table' => 'comments', 'parent' => 'books', 'columns' => 'bookshelf_id,book_id'],
        'condition_assessments_copy_fk' => ['table' => 'condition_assessments', 'parent' => 'book_copies', 'columns' => 'bookshelf_id,copy_id'],
        'condition_assessments_loan_fk' => ['table' => 'condition_assessments', 'parent' => 'loans', 'columns' => 'bookshelf_id,loan_id'],
        'loans_book_fk' => ['table' => 'loans', 'parent' => 'books', 'columns' => 'bookshelf_id,book_id'],
        'loans_copy_fk' => ['table' => 'loans', 'parent' => 'book_copies', 'columns' => 'bookshelf_id,copy_id'],
        'loans_request_fk' => ['table' => 'loans', 'parent' => 'borrow_requests', 'columns' => 'bookshelf_id,request_id'],
        'memberships_parish_unit_l1_fk' => ['table' => 'memberships', 'parent' => 'parish_units', 'columns' => 'bookshelf_id,parish_unit_l1_id'],
        'memberships_parish_unit_l2_fk' => ['table' => 'memberships', 'parent' => 'parish_units', 'columns' => 'bookshelf_id,parish_unit_l2_id'],
        'parish_units_parent_fk' => ['table' => 'parish_units', 'parent' => 'parish_units', 'columns' => 'bookshelf_id,parent_id'],
    ]);
});

it('records the correct on delete action for each composite fk', function () {
    $rows = DB::select("
        select constraint_name, delete_rule
        from information_schema.referential_constraints
        where constraint_schema = database()
          and constraint_name like '%\\_fk'
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
