<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/** @return array{shelf: string, book: string, copy: string, user: string} */
function circulationFixture(): array
{
    $shelf = (string) Str::uuid7();
    DB::table('bookshelves')->insert([
        'id' => $shelf, 'slug' => 'shelf-'.substr($shelf, -8), 'name' => 'Tủ sách Đồng Tháp', 'settings' => '{}',
    ]);

    $user = (string) Str::uuid7();
    DB::table('users')->insert([
        'id' => $user, 'saint_name' => 'Giuse', 'full_name' => 'Trần Minh',
        'father_name' => 'Cha', 'mother_name' => 'Mẹ',
    ]);

    $book = (string) Str::uuid7();
    DB::table('books')->insert([
        'id' => $book, 'bookshelf_id' => $shelf, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men',
    ]);

    $copy = (string) Str::uuid7();
    DB::table('book_copies')->insert([
        'id' => $copy, 'bookshelf_id' => $shelf, 'book_id' => $book, 'code' => 'DT-0142',
    ]);

    return ['shelf' => $shelf, 'book' => $book, 'copy' => $copy, 'user' => $user];
}

function insertLoan(array $fx, string $status = 'active', array $extra = []): string
{
    $id = (string) Str::uuid7();
    DB::table('loans')->insert(array_merge([
        'id' => $id, 'bookshelf_id' => $fx['shelf'], 'copy_id' => $fx['copy'],
        'book_id' => $fx['book'], 'borrower_id' => $fx['user'], 'lent_by' => $fx['user'],
        'due_on' => '2026-09-09', 'status' => $status,
    ], $extra));

    return $id;
}

function assertUniqueViolation(callable $attempt): void
{
    try {
        $attempt();
        test()->fail('expected a unique constraint violation (SQLSTATE 23000 / errno 1062)');
    } catch (QueryException $e) {
        expect($e->getCode())->toBe('23000')
            ->and($e->errorInfo[1])->toBe(1062);
    }
}

it('creates the circulation tables', function () {
    foreach (['loans', 'borrow_requests', 'condition_assessments'] as $table) {
        expect(Schema::hasTable($table))->toBeTrue("missing table {$table}");
    }
});

it('gives loans no deleted_at column — loans are voided, never deleted', function () {
    expect(Schema::hasColumn('loans', 'deleted_at'))->toBeFalse();
});

it('enforces one active loan per copy, and frees the slot on return', function () {
    $fx = circulationFixture();

    insertLoan($fx, 'returned', ['returned_at' => now(), 'return_condition' => 'perfect']);
    insertLoan($fx, 'active');

    // Two managers, same copy, same second — the second insert must fail
    // with a clean unique violation (SQLSTATE 23000 / errno 1062), which the
    // application will translate to "Bản sách này vừa được mượn" (BR §2).
    assertUniqueViolation(fn () => insertLoan($fx, 'active'));
});

it('frees the slot when the active loan is voided, not just returned', function () {
    $fx = circulationFixture();

    $active = insertLoan($fx, 'active');

    // Still active — a second active loan on the same copy must still collide.
    assertUniqueViolation(fn () => insertLoan($fx, 'active'));

    DB::table('loans')->where('id', $active)->update([
        'status' => 'voided', 'voided_at' => now(), 'voided_by' => $fx['user'], 'void_reason' => 'entered by mistake',
    ]);

    // Voided must free the copy exactly like returned does — a generated
    // column that stays non-NULL for 'voided' would make this copy
    // permanently unlendable, which is the failure mode INV-1 exists to
    // prevent.
    $newActive = insertLoan($fx, 'active');
    expect(DB::table('loans')->where('id', $newActive)->value('status'))->toBe('active');
});

it('frees the slot when the active loan is marked lost, not just returned', function () {
    $fx = circulationFixture();

    $active = insertLoan($fx, 'active');

    DB::table('loans')->where('id', $active)->update([
        'status' => 'lost', 'lost_reported_at' => now(), 'lost_reported_by' => $fx['user'],
    ]);

    // Lost must also free the copy — same reasoning as voided above.
    $newActive = insertLoan($fx, 'active');
    expect(DB::table('loans')->where('id', $newActive)->value('status'))->toBe('active');

    // And now the newly active loan blocks a third.
    assertUniqueViolation(fn () => insertLoan($fx, 'active'));
});

it('rejects a voided loan with no void_reason', function () {
    $fx = circulationFixture();

    expect(fn () => insertLoan($fx, 'voided', ['voided_at' => now(), 'voided_by' => $fx['user']]))
        ->toThrow(QueryException::class);
});

it('rejects a returned loan with no return_condition', function () {
    $fx = circulationFixture();

    expect(fn () => insertLoan($fx, 'returned', ['returned_at' => now()]))
        ->toThrow(QueryException::class);
});

it('rejects a loan status outside the enum', function () {
    $fx = circulationFixture();

    expect(fn () => insertLoan($fx, 'overdue'))->toThrow(QueryException::class);
});

it('rejects a return_condition outside the enum', function () {
    $fx = circulationFixture();

    expect(fn () => insertLoan($fx, 'returned', [
        'returned_at' => now(), 'return_condition' => 'pristine',
    ]))->toThrow(QueryException::class);
});

it('rejects a borrow_requests status outside the enum', function () {
    $fx = circulationFixture();

    expect(function () use ($fx) {
        DB::table('borrow_requests')->insert([
            'id' => (string) Str::uuid7(), 'bookshelf_id' => $fx['shelf'], 'book_id' => $fx['book'],
            'member_id' => $fx['user'], 'status' => 'archived',
        ]);
    })->toThrow(QueryException::class);
});

it('accepts a borrow_requests row through the default pending status', function () {
    $fx = circulationFixture();

    $id = (string) Str::uuid7();
    DB::table('borrow_requests')->insert([
        'id' => $id, 'bookshelf_id' => $fx['shelf'], 'book_id' => $fx['book'], 'member_id' => $fx['user'],
    ]);

    expect(DB::table('borrow_requests')->where('id', $id)->value('status'))->toBe('pending');
});

it('rejects a condition_assessments condition outside the enum', function () {
    $fx = circulationFixture();

    expect(function () use ($fx) {
        DB::table('condition_assessments')->insert([
            'id' => (string) Str::uuid7(), 'bookshelf_id' => $fx['shelf'], 'copy_id' => $fx['copy'],
            'assessed_by' => $fx['user'], 'condition' => 'pristine',
        ]);
    })->toThrow(QueryException::class);
});

it('accepts a condition_assessments row with a valid condition', function () {
    $fx = circulationFixture();

    $id = (string) Str::uuid7();
    DB::table('condition_assessments')->insert([
        'id' => $id, 'bookshelf_id' => $fx['shelf'], 'copy_id' => $fx['copy'],
        'assessed_by' => $fx['user'], 'condition' => 'worn',
    ]);

    expect(DB::table('condition_assessments')->where('id', $id)->value('condition'))->toBe('worn');
});
