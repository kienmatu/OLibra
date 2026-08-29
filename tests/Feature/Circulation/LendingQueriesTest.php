<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\SearchBooksForLendingQuery;
use App\Queries\SearchLoansForReturnQuery;
use App\Queries\SearchReadersForLendingQuery;
use App\Support\TenantContext;
use Carbon\Carbon;

afterEach(fn () => Carbon::setTestNow());

/**
 * One shelf: a manager (acting), two readers, one title with three copies —
 * one available, one on loan to reader 1, one lost.
 *
 * @return array{Bookshelf, User, Membership, Membership, Book, Loan}
 */
function lqFix(string $slug = 'dong-thap-lq'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Tìm Sách Giúp']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader1 = User::factory()->create(['full_name' => 'Têrêsa Đặng Ngọc Ánh']);
    $m1 = Membership::factory()->for($shelf)->create([
        'user_id' => $reader1->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $reader2 = User::factory()->create(['full_name' => 'Anna Đặng Thu Hà']);
    $m2 = Membership::factory()->for($shelf)->create([
        'user_id' => $reader2->id, 'role' => 'reader', 'status' => 'suspended',
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký',
        'author' => 'Tô Hoài', 'slug' => 'de-men-plk',
    ]);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0101', 'state' => 'available']);
    $out = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0102', 'state' => 'on_loan']);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0103', 'state' => 'lost']);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $out->id, 'book_id' => $book->id,
        'borrower_id' => $reader1->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-04', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    return [$shelf, $manager, $m1, $m2, $book, $loan];
}

it('finds a book without diacritics and reports honest counts', function () {
    lqFix();
    $rows = app(SearchBooksForLendingQuery::class)->run('de men');

    expect($rows)->toHaveCount(1)
        ->and($rows[0]['title'])->toBe('Dế Mèn Phiêu Lưu Ký')
        ->and($rows[0]['copiesTotal'])->toBe(2)      // lost excluded — "N bản trong tủ" must not count a book that is not there
        ->and($rows[0]['copiesAvailable'])->toBe(1)
        ->and($rows[0]['blocked'])->toBeFalse()
        ->and($rows[0]['reason'])->toBeNull();
});

it('a book is findable by a copy code, without collapsing its counts', function () {
    // The exists-not-filter shape: matching by ONE copy's code must not
    // narrow the aggregates to that copy (the reference's own fix — a
    // code-matched book once reported copiesTotal 1 regardless of reality).
    lqFix();
    $rows = app(SearchBooksForLendingQuery::class)->run('dt-0102');

    expect($rows)->toHaveCount(1)
        ->and($rows[0]['copiesTotal'])->toBe(2)
        ->and($rows[0]['copiesAvailable'])->toBe(1);
});

it('books come back title-ordered, not in the creation order UUID v7 would give an unordered scan', function () {
    [$shelf] = lqFix(slug: 'dong-thap-lq-order');
    app(TenantContext::class)->actSystemWide();
    // Created in reverse of title order — a sort seeded in creation order
    // would never catch a dropped ORDER BY, because UUID v7 ids are
    // chronologically monotonic and an unordered scan already returns rows
    // in creation order.
    $zzz = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Order Zzz Sách', 'slug' => 'order-zzz-lq']);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $zzz->id, 'code' => 'DT-0301', 'state' => 'available']);
    $aaa = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Order Aaa Sách', 'slug' => 'order-aaa-lq']);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $aaa->id, 'code' => 'DT-0302', 'state' => 'available']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('role', 'manager')->firstOrFail());

    $rows = app(SearchBooksForLendingQuery::class)->run('order');

    expect($rows)->toHaveCount(2)
        ->and($rows[0]['title'])->toBe('Order Aaa Sách')
        ->and($rows[1]['title'])->toBe('Order Zzz Sách');
});

it('the book search\'s block reason is the code LendCopy throws, in every copy state', function () {
    [$shelf] = lqFix();
    app(TenantContext::class)->actSystemWide();

    // All copies out → copy_not_available (a copy can still come back).
    $allOut = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'htb-lq']);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $allOut->id, 'code' => 'DT-0110', 'state' => 'on_loan']);

    // Every copy lost or retired → copy_lost_or_retired (nothing can come back).
    $allGone = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Totto-chan Bên Cửa Sổ', 'slug' => 'ttc-lq']);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $allGone->id, 'code' => 'DT-0111', 'state' => 'lost']);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $allGone->id, 'code' => 'DT-0112', 'state' => 'retired', 'retired_reason' => 'Hư hỏng nặng']);

    // No copies recorded at all → title_has_no_copies (settled decision 4:
    // the owner ruled the reference's false "đang được mượn hoặc đang giữ
    // chỗ." out; this is the third code, and ChooseCopy returns the same one).
    Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Sách Chưa Có Bản Nào', 'slug' => 'chua-co-lq']);

    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('role', 'manager')->firstOrFail());

    $q = app(SearchBooksForLendingQuery::class);
    $out = $q->run('hoang tu be');
    $gone = $q->run('totto chan');
    $none = $q->run('sach chua co ban nao');

    expect($out[0]['blocked'])->toBeTrue()->and($out[0]['reason'])->toBe('copy_not_available')
        ->and($gone[0]['blocked'])->toBeTrue()->and($gone[0]['reason'])->toBe('copy_lost_or_retired')
        ->and($none[0]['blocked'])->toBeTrue()->and($none[0]['reason'])->toBe('title_has_no_copies');
});

it('a copyless title is still OFFERED, blocked, with its own true sentence — never filtered out', function () {
    // Settled decision 4, the search half. Two things are pinned and they
    // are different: the row is PRESENT (a missing row sends the volunteer
    // searching again — the reader search's rule, applied here), and its
    // reason is the copyless code, not the on-loan-or-held one. Flip the
    // query's branch back to copy_not_available and the second expectation
    // alone goes red; filter the row out and the first does.
    [$shelf] = lqFix(slug: 'dong-thap-lq-copyless');
    app(TenantContext::class)->actSystemWide();
    Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Chiếc Lược Ngà', 'slug' => 'clg-lq']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('role', 'manager')->firstOrFail());

    $rows = app(SearchBooksForLendingQuery::class)->run('chiec luoc nga');

    expect($rows)->toHaveCount(1)
        ->and($rows[0]['copiesTotal'])->toBe(0)
        ->and($rows[0]['copiesAvailable'])->toBe(0)
        ->and($rows[0]['blocked'])->toBeTrue()
        ->and($rows[0]['reason'])->toBe('title_has_no_copies')
        ->and(__('rules.title_has_no_copies'))->toBe('Cuốn này chưa có bản sách nào trong tủ.');
});

it('the reader search returns a blocked reader WITH the code LendCopy throws — never filters them out', function () {
    lqFix();
    $rows = app(SearchReadersForLendingQuery::class)->run('dang');

    // Both Đặng readers, folded match; suspended one flagged, not missing.
    expect($rows)->toHaveCount(2);
    $byName = collect($rows)->keyBy('fullName');
    expect($byName['Têrêsa Đặng Ngọc Ánh']['blocked'])->toBeFalse()
        ->and($byName['Têrêsa Đặng Ngọc Ánh']['activeLoans'])->toBe(1)
        ->and($byName['Anna Đặng Thu Hà']['blocked'])->toBeTrue()
        ->and($byName['Anna Đặng Thu Hà']['reason'])->toBe('membership_not_active');

    // Ordering, proven against creation order rather than with it: lqFix()
    // creates Têrêsa (reader1) BEFORE Anna (reader2), so UUID v7's
    // chronological monotonicity would return Têrêsa first on an
    // unordered scan. full_name_folded order puts Anna first ('anh...'
    // folds before 'terera...'), the opposite of creation order — a
    // sort seeded in creation order would never catch a dropped ORDER BY.
    expect($rows[0]['fullName'])->toBe('Anna Đặng Thu Hà')
        ->and($rows[1]['fullName'])->toBe('Têrêsa Đặng Ngọc Ánh');
});

it('the reader search row carries only what the picker renders — no extra fields leak', function () {
    // Phase 1b's boundary: a prop that reaches the client is disclosed
    // whether the page draws it or not. This is a real set-equality check
    // (toEqualCanonicalizing), not the inert `not->toHaveKeys([...])`
    // shape (which means "has ALL", not "has none but") — leaking one
    // extra key here (e.g. dateOfBirth, phone) must turn this test red on
    // its own, proven by mutation below rather than assumed.
    lqFix();
    $rows = app(SearchReadersForLendingQuery::class)->run('dang');

    expect($rows)->not->toBeEmpty()
        ->and(array_keys($rows[0]))->toEqualCanonicalizing([
            'membershipId', 'userId', 'fullName', 'saintName', 'parishLine', 'activeLoans', 'blocked', 'reason',
        ]);
});

it('a reader at the shelf\'s own limit reads loan_limit_reached', function () {
    [$shelf, $manager, $m1] = lqFix(slug: 'dong-thap-lq-limit');
    app(TenantContext::class)->actSystemWide();
    $book2 = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'drpn-lq']);
    foreach ([1, 2] as $i) { // reader1 already holds 1 → total 3 = default limit
        $c = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book2->id, 'code' => sprintf('DT-02%02d', $i), 'state' => 'on_loan']);
        Loan::query()->create([
            'bookshelf_id' => $shelf->id, 'copy_id' => $c->id, 'book_id' => $book2->id,
            'borrower_id' => $m1->user_id, 'lent_by' => $manager->id,
            'due_on' => '2026-09-04', 'status' => 'active',
        ]);
    }
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('role', 'manager')->firstOrFail());

    $rows = app(SearchReadersForLendingQuery::class)->run('ngoc anh');
    expect($rows)->toHaveCount(1)
        ->and($rows[0]['activeLoans'])->toBe(3)
        ->and($rows[0]['reason'])->toBe('loan_limit_reached');
});

it('a loan out is findable by title, by reader and by the code on the copy', function () {
    lqFix();
    $q = app(SearchLoansForReturnQuery::class);

    foreach (['de men', 'ngoc anh', 'dt-0102'] as $needle) {
        $rows = $q->run($needle);
        expect($rows)->toHaveCount(1, "needle: {$needle}")
            ->and($rows[0]['copyCode'])->toBe('DT-0102')
            ->and($rows[0]['borrowerName'])->toBe('Têrêsa Đặng Ngọc Ánh');
    }
});

it('loans come back soonest-due-first, not in the creation order UUID v7 would give an unordered scan', function () {
    [$shelf, $manager] = lqFix(slug: 'dong-thap-lq-loan-order');
    app(TenantContext::class)->actSystemWide();
    $book2 = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Order Loans Sách', 'slug' => 'order-loans-lq']);
    $reader3 = User::factory()->create(['full_name' => 'Phêrô Order Loans']);
    Membership::factory()->for($shelf)->create(['user_id' => $reader3->id, 'role' => 'reader', 'status' => 'active']);
    // Created in reverse of due-date order — see the books-order test's
    // comment for why creation-order fixtures prove nothing about a sort.
    $laterCopy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book2->id, 'code' => 'DT-0401', 'state' => 'on_loan']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $laterCopy->id, 'book_id' => $book2->id,
        'borrower_id' => $reader3->id, 'lent_by' => $manager->id, 'due_on' => '2026-09-20', 'status' => 'active',
    ]);
    $soonerCopy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book2->id, 'code' => 'DT-0402', 'state' => 'on_loan']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $soonerCopy->id, 'book_id' => $book2->id,
        'borrower_id' => $reader3->id, 'lent_by' => $manager->id, 'due_on' => '2026-09-10', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('role', 'manager')->firstOrFail());

    $rows = app(SearchLoansForReturnQuery::class)->run('order loans');

    expect($rows)->toHaveCount(2)
        ->and($rows[0]['copyCode'])->toBe('DT-0402')
        ->and($rows[1]['copyCode'])->toBe('DT-0401');
});

it('a loan already received back is not offered again', function () {
    [, , , , , $loan] = lqFix();
    Loan::query()->whereKey($loan->id)->update([
        'status' => 'returned', 'return_condition' => 'perfect', 'returned_at' => now(),
    ]);

    expect(app(SearchLoansForReturnQuery::class)->run('de men'))->toBe([]);
});

it('overdue is derived on read and moves with the clock, with no command in between', function () {
    lqFix();

    Carbon::setTestNow(Carbon::parse('2026-09-03 03:00:00', 'UTC'));
    $before = app(SearchLoansForReturnQuery::class)->run('de men');
    Carbon::setTestNow(Carbon::parse('2026-09-06 03:00:00', 'UTC'));
    $after = app(SearchLoansForReturnQuery::class)->run('de men');

    expect($before[0]['isOverdue'])->toBeFalse()
        ->and($before[0]['daysRemaining'])->toBe(1)
        ->and($after[0]['isOverdue'])->toBeTrue()
        ->and($after[0]['daysRemaining'])->toBe(-2);
});

it('M7: a garbage query returns nothing, not every row on the shelf', function () {
    lqFix();
    foreach (['', '   ', '%%%', '!!!'] as $garbage) {
        expect(app(SearchBooksForLendingQuery::class)->run($garbage))->toBe([], "books: '{$garbage}'")
            ->and(app(SearchReadersForLendingQuery::class)->run($garbage))->toBe([], "readers: '{$garbage}'")
            ->and(app(SearchLoansForReturnQuery::class)->run($garbage))->toBe([], "loans: '{$garbage}'");
    }
});

it('INV-10: a manager of one shelf finds none of another shelf\'s loans', function () {
    lqFix();
    // Second shelf with colliding data, the actSystemWide template.
    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho-lq', 'settings' => []]);
    $otherUser = User::factory()->create(['full_name' => 'Têrêsa Đặng Ngọc Ánh']); // colliding name
    $otherBook = Book::query()->create(['bookshelf_id' => $other->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men-plk']);
    $otherCopy = BookCopy::query()->create(['bookshelf_id' => $other->id, 'book_id' => $otherBook->id, 'code' => 'DT-0102', 'state' => 'on_loan']);
    Loan::query()->create([
        'bookshelf_id' => $other->id, 'copy_id' => $otherCopy->id, 'book_id' => $otherBook->id,
        'borrower_id' => $otherUser->id, 'lent_by' => $otherUser->id,
        'due_on' => '2026-09-04', 'status' => 'active',
    ]);
    // Re-bind shelf A — the query must see exactly ONE loan, its own.
    $shelfA = Bookshelf::query()->where('slug', 'dong-thap-lq')->firstOrFail();
    app(TenantContext::class)->set($shelfA, Membership::query()->where('bookshelf_id', $shelfA->id)->where('role', 'manager')->firstOrFail());

    expect(app(SearchLoansForReturnQuery::class)->run('de men'))->toHaveCount(1);
});
