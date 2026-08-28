<?php

use App\Actions\Catalogue\AllocateCopyCodes;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use Illuminate\Support\Facades\DB;
use Tests\Support\TenantHarness;

function catCodesShelf(array $attributes = []): Bookshelf
{
    $shelf = Bookshelf::factory()->create(array_merge(['slug' => 'dong-thap', 'settings' => []], $attributes));
    TenantHarness::actAs($shelf);

    return $shelf;
}

function catCodesBookWithCopies(Bookshelf $shelf, array $codes): Book
{
    $book = Book::factory()->for($shelf)->create();
    foreach ($codes as $code) {
        BookCopy::factory()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => $code]);
    }

    return $book;
}

it('starts at 0001 on an empty shelf and continues the sequence', function () {
    $shelf = catCodesShelf();

    expect(app(AllocateCopyCodes::class)->execute(2))->toBe(['DT-0001', 'DT-0002']);

    catCodesBookWithCopies($shelf, ['DT-0001', 'DT-0002']);

    expect(app(AllocateCopyCodes::class)->execute(3))->toBe(['DT-0003', 'DT-0004', 'DT-0005']);
});

it('a soft-deleted code is never handed out again', function () {
    // BR §5.4: a code is printed on a label stuck to a physical book —
    // handing it out twice is worse than a gap. The scan deliberately does
    // NOT filter deleted_at, even though the unique index does.
    $shelf = catCodesShelf();
    $book = catCodesBookWithCopies($shelf, ['DT-0001', 'DT-0002']);
    BookCopy::query()->where('code', 'DT-0002')->get()->each->delete();

    expect(app(AllocateCopyCodes::class)->execute(1))->toBe(['DT-0003']);
});

it('a hand-imported code that does not end in digits does not break the sequence', function () {
    $shelf = catCodesShelf();
    catCodesBookWithCopies($shelf, ['DT-0007', 'DT-CU']);

    expect(app(AllocateCopyCodes::class)->execute(1))->toBe(['DT-0008']);
});

it('M7: a copy_code_prefix override containing an underscore is not a LIKE wildcard', function () {
    // Unescaped, 'KHO_1' matches 'KHOX1-9000' and inflates max past the
    // prefix's own sequence.
    $shelf = catCodesShelf(['slug' => 'kho-sach', 'settings' => ['copy_code_prefix' => 'KHO_1']]);
    catCodesBookWithCopies($shelf, ['KHOX1-9000', 'KHO_1-0002']);

    expect(app(AllocateCopyCodes::class)->execute(1))->toBe(['KHO_1-0003']);
});

it('another shelf\'s codes never enter this shelf\'s scan', function () {
    ['a' => $a, 'b' => $b] = TenantHarness::twoCollidingShelves();   // both hold DT-0142
    TenantHarness::actAs($a);

    // 0142 exists on BOTH shelves; the next code counts only this shelf's.
    expect(app(AllocateCopyCodes::class)->execute(1))->toBe(['DT-0143']);
});

it('returns no codes for a zero or negative count instead of a malformed one', function () {
    // Review finding 1: PHP's range(1, $count) is descending (not empty)
    // for $count < 1 — range(1, 0) is [1, 0], range(1, -1) is [1, 0, -1] —
    // unlike the reference's Array.from({length: count}), which is [] for
    // count <= 0. Without the guard, execute(0) mints an unrequested
    // 'DT-0000' and execute(-1) mints a malformed 'DT-00-1' too, both past
    // any unique index that would object.
    $shelf = catCodesShelf();

    expect(app(AllocateCopyCodes::class)->execute(0))->toBe([])
        ->and(app(AllocateCopyCodes::class)->execute(-1))->toBe([]);
});

it('takes the shelf-row lock as the FIRST statement of the transaction', function () {
    // Divergence 2 (plan header): a real two-connection race cannot run
    // under RefreshDatabase — and no single-connection test ever could,
    // because the suite's own outer transaction has already established a
    // read view. So pin the mechanism, position included: under
    // REPEATABLE READ the first consistent read pins the snapshot, and a
    // lock taken after ANY read cannot un-pin it (reproduced live on
    // 10.11 in this plan's review). The FOR UPDATE on bookshelves must
    // therefore be query index 0 — a lock that merely EXISTS somewhere in
    // the log certifies nothing. Dropping lockForUpdate(), or reading
    // anything first, turns this red; the errno-1062 backstop lives in
    // DbGuaranteesTest.
    $shelf = catCodesShelf();
    DB::enableQueryLog();

    DB::transaction(fn () => app(AllocateCopyCodes::class)->execute(1));

    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect($log)->not->toBe([])
        ->and(str_contains($log[0]['query'], 'bookshelves'))->toBeTrue('first query is not on bookshelves: '.$log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue('first query is not FOR UPDATE: '.$log[0]['query']);
});

// No test covers "throws when DB::transactionLevel() === 0" (review
// finding 2): every test in this suite runs under RefreshDatabase, whose
// outer transaction means the level is always >= 1 for the whole run —
// there is no way, from inside this suite, to observe the class running
// with no transaction open. The guard exists for production misuse (a
// caller invoking execute() outside DB::transaction, where the FOR UPDATE
// below would autocommit and its row lock would release before the MAX
// scan even runs), not for a scenario this harness can reproduce.
