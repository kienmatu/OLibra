<?php

use App\Actions\Catalogue\CreateBook;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Category;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\BookDetailQuery;
use App\Queries\CatalogueQuery;
use App\Queries\SearchQuery;
use App\Support\TenantContext;
use Carbon\Carbon;

afterEach(fn () => Carbon::setTestNow());

function rdrFixture(array $settings = []): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => $settings]);
    $manager = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    Category::factory()->create(['name' => 'Truyện thiếu nhi', 'slug' => 'truyen-thieu-nhi']);
    Category::factory()->create(['name' => 'Giáo lý', 'slug' => 'giao-ly']);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($manager);

    return [$shelf, $manager];
}

function rdrBook(User $user, string $title, array $over = []): Book
{
    return app(CreateBook::class)->execute($user, array_merge([
        'title' => $title, 'author' => 'Tô Hoài',
        'category_slug' => 'truyen-thieu-nhi', 'copy_count' => 1,
    ], $over));
}

function rdrHold(Book $book, string $copyId, string $expiresAt): BorrowRequest
{
    $requester = User::factory()->create();

    return BorrowRequest::query()->create([
        'book_id' => $book->id, 'copy_id' => $copyId, 'member_id' => $requester->id,
        'status' => 'approved', 'hold_expires_at' => $expiresAt,
    ]);
}

it('availability is derived from borrowability, never a stored count', function () {
    [, $user] = rdrFixture();
    $book = rdrBook($user, 'Dế Mèn Phiêu Lưu Ký');
    $book->copies->first()->update(['state' => 'on_loan']);

    $rows = app(CatalogueQuery::class)->run(['scope' => 'all'])['rows'];

    expect($rows[0]['availability'])->toBe('on_loan')
        ->and($rows[0]['copiesAvailable'])->toBe(0);
});

it('an unexpired hold makes a copy unavailable without changing its state', function () {
    // Two copies, as the reference's own fixture: the badge ladder counts
    // copies by STATE, and a held-by-request copy is still state
    // 'available' — so for a one-copy title under a hold the ladder lands
    // on 'none', faithfully to the reference's deriveAvailability. What
    // this pins is the count: the held copy leaves copiesAvailable with
    // its state untouched.
    Carbon::setTestNow(Carbon::parse('2026-08-27 03:00:00', 'UTC'));
    [, $user] = rdrFixture();
    $book = rdrBook($user, 'Dế Mèn Phiêu Lưu Ký', ['copy_count' => 2]);
    $copy = $book->copies->first();
    rdrHold($book, $copy->id, '2026-08-28 03:00:00');

    $rows = app(CatalogueQuery::class)->run(['scope' => 'all'])['rows'];

    expect($copy->fresh()->state->value)->toBe('available')   // the state did not move
        ->and($rows[0]['copiesTotal'])->toBe(2)
        ->and($rows[0]['copiesAvailable'])->toBe(1);
});

it('a lapsed hold frees the copy on read, no job having run — BR §8', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-27 03:00:00', 'UTC'));
    [, $user] = rdrFixture();
    $book = rdrBook($user, 'Dế Mèn Phiêu Lưu Ký');
    rdrHold($book, $book->copies->first()->id, '2026-08-26 03:00:00');   // already lapsed

    $rows = app(CatalogueQuery::class)->run(['scope' => 'all'])['rows'];

    expect($rows[0]['copiesAvailable'])->toBe(1)
        ->and($rows[0]['availability'])->toBe('available');
});

it('scope=available hides a title with nothing on the shelf; scope=all does not', function () {
    [, $user] = rdrFixture();
    rdrBook($user, 'Dế Mèn Phiêu Lưu Ký');
    $allOut = rdrBook($user, 'Hoàng Tử Bé');
    $allOut->copies->first()->update(['state' => 'on_loan']);

    expect(array_column(app(CatalogueQuery::class)->run(['scope' => 'available'])['rows'], 'title'))
        ->toBe(['Dế Mèn Phiêu Lưu Ký'])
        ->and(app(CatalogueQuery::class)->run(['scope' => 'all'])['total'])->toBe(2);
});

it('an unpublished draft is hidden from members, on both scopes', function () {
    [, $user] = rdrFixture();
    rdrBook($user, 'Bản Nháp', ['is_published' => false]);

    expect(app(CatalogueQuery::class)->run(['scope' => 'all'])['total'])->toBe(0)
        ->and(app(CatalogueQuery::class)->run(['scope' => 'available'])['total'])->toBe(0);
});

it('the catalogue is paginated and reports its own total', function () {
    [, $user] = rdrFixture();
    foreach (range(1, 5) as $i) {
        rdrBook($user, "Sách Số {$i}");
    }

    $page = app(CatalogueQuery::class)->run(['scope' => 'all', 'page' => 2, 'per_page' => 2]);

    expect($page['rows'])->toHaveCount(2)
        ->and($page['page'])->toBe(2)
        ->and($page['pageCount'])->toBe(3)
        ->and($page['total'])->toBe(5);
});

it('sort=title is alphabetical in Vietnamese, not in byte order', function () {
    [, $user] = rdrFixture();
    rdrBook($user, 'Tuổi Thơ Dữ Dội');
    rdrBook($user, 'Đất Rừng Phương Nam');
    rdrBook($user, 'Anh Em Nhà Bồ Câu');

    $rows = app(CatalogueQuery::class)->run(['scope' => 'all', 'sort' => 'title'])['rows'];

    expect(array_column($rows, 'title'))
        ->toBe(['Anh Em Nhà Bồ Câu', 'Đất Rừng Phương Nam', 'Tuổi Thơ Dữ Dội']);
});

it('a category filter narrows by slug, not by name', function () {
    [, $user] = rdrFixture();
    rdrBook($user, 'Dế Mèn Phiêu Lưu Ký');
    rdrBook($user, 'Sách Giáo Lý', ['category_slug' => 'giao-ly']);

    $rows = app(CatalogueQuery::class)->run(['scope' => 'all', 'category' => 'giao-ly'])['rows'];

    expect(array_column($rows, 'title'))->toBe(['Sách Giáo Lý']);
});

it('one shelf\'s catalogue never contains another\'s', function () {
    [$shelf, $user] = rdrFixture();
    rdrBook($user, 'Dế Mèn Phiêu Lưu Ký');

    app(TenantContext::class)->clear();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $otherUser = User::factory()->create();
    $otherMembership = Membership::factory()->for($other)->create([
        'user_id' => $otherUser->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($other, $otherMembership);

    expect(app(CatalogueQuery::class)->run(['scope' => 'all'])['total'])->toBe(0);
});

it('search finds titles typed without diacritics, over title and author', function () {
    [, $user] = rdrFixture();
    rdrBook($user, 'Tìm Kiếm Kho Báu');
    rdrBook($user, 'Đất Rừng Phương Nam', ['author' => 'Đoàn Giỏi']);

    expect(array_column(app(SearchQuery::class)->run('tim kiem kho bau'), 'title'))
        ->toBe(['Tìm Kiếm Kho Báu'])
        ->and(array_column(app(SearchQuery::class)->run('doan gioi'), 'title'))
        ->toBe(['Đất Rừng Phương Nam']);
});

it('search results carry availability and stay alphabetical in Vietnamese', function () {
    [, $user] = rdrFixture();
    $out = rdrBook($user, 'Đất Rừng Phương Nam');
    $out->copies->first()->update(['state' => 'on_loan']);
    rdrBook($user, 'Anh Em Nhà Bồ Câu');

    // Both books share rdrBook's default author, so this one term returns
    // both — the reference's own device for its ordering assertion.
    $rows = app(SearchQuery::class)->run('to hoai');

    expect(array_column($rows, 'title'))->toBe(['Anh Em Nhà Bồ Câu', 'Đất Rừng Phương Nam'])
        ->and(collect($rows)->firstWhere('title', 'Đất Rừng Phương Nam')['availability'])->toBe('on_loan');
});

it('titles that fold alike take the slug tiebreak, concretely — not incidentally', function () {
    // A two-row version of this test is NOT falsifiable: ids are UUID v7
    // (time-ordered), so an unordered scan already returns rows in
    // creation order, and Slugs::nextAvailable also assigns de-men,
    // de-men-2, ... in strict creation order — so for two or a few rows,
    // "creation order" and "slug order" are the same sequence, and the
    // test would pass with orderBy('slug') deleted (confirmed live below).
    //
    // Eleven collisions break that coincidence: creation order gives
    // slugs de-men, de-men-2, ..., de-men-11, but sorting THOSE STRINGS
    // lexicographically — what orderBy('slug') actually does — puts
    // de-men-10 and de-men-11 before de-men-2 ('1' < '2' as a byte), which
    // is a different sequence from creation order. Asserting this exact,
    // non-incidental order is what a deleted tiebreak cannot survive.
    [, $user] = rdrFixture();
    foreach ([
        'De Men', 'DE MEN', 'de men', 'De  Men', 'De-Men', 'De_Men',
        'De.Men', 'De,Men', 'De!Men', 'De?Men', 'Dế Mèn',
    ] as $title) {
        rdrBook($user, $title);   // every one of these folds to 'de men'
    }

    expect(array_column(app(SearchQuery::class)->run('de men'), 'slug'))->toBe([
        'de-men', 'de-men-10', 'de-men-11', 'de-men-2', 'de-men-3',
        'de-men-4', 'de-men-5', 'de-men-6', 'de-men-7', 'de-men-8', 'de-men-9',
    ]);
});

it('an empty search term, and one that folds to nothing, return nothing', function () {
    [, $user] = rdrFixture();
    rdrBook($user, 'Dế Mèn Phiêu Lưu Ký');

    expect(app(SearchQuery::class)->run(''))->toBe([])
        ->and(app(SearchQuery::class)->run('   '))->toBe([])
        ->and(app(SearchQuery::class)->run('%%%'))->toBe([]);   // M7 — never the whole shelf
});

it('search does not surface drafts', function () {
    [, $user] = rdrFixture();
    rdrBook($user, 'Bản Nháp Bí Mật', ['is_published' => false]);

    expect(app(SearchQuery::class)->run('ban nhap'))->toBe([]);
});

it('book detail reports the queue and the earliest-due holder', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-27 03:00:00', 'UTC'));
    [, $user] = rdrFixture();
    $holder = User::factory()->create(['full_name' => 'Nguyễn Văn Bình']);
    $book = rdrBook($user, 'Dế Mèn Phiêu Lưu Ký', ['copy_count' => 2]);
    $copy = $book->copies->first();
    $copy->update(['state' => 'on_loan']);
    Loan::query()->create([
        'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $holder->id, 'lent_by' => $user->id,
        'due_on' => '2026-08-30', 'status' => 'active',
    ]);
    // Two pending requests — BR §7.2: the queue IS the pending set.
    foreach (range(1, 2) as $i) {
        BorrowRequest::query()->create([
            'book_id' => $book->id, 'member_id' => User::factory()->create()->id, 'status' => 'pending',
        ]);
    }

    $detail = app(BookDetailQuery::class)->run($book);

    expect($detail['queueLength'])->toBe(2)
        ->and($detail['onLoan'])->toBe(1)
        ->and($detail['copiesAvailable'])->toBe(1)
        ->and($detail['currentLoan']['holderName'])->toBe('Nguyễn Văn Bình')
        ->and($detail['currentLoan']['dueOn'])->toBe('2026-08-30')
        ->and($detail['currentLoan']['daysRemaining'])->toBe(3);
});

it('public_show_current_borrower off withholds the holder, keeps the availability', function () {
    [, $user] = rdrFixture(['public_show_current_borrower' => false]);
    $holder = User::factory()->create();
    $book = rdrBook($user, 'Dế Mèn Phiêu Lưu Ký');
    $copy = $book->copies->first();
    $copy->update(['state' => 'on_loan']);
    Loan::query()->create([
        'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $holder->id, 'lent_by' => $user->id,
        'due_on' => '2026-08-30', 'status' => 'active',
    ]);

    $detail = app(BookDetailQuery::class)->run($book);

    expect($detail['currentLoan'])->toBeNull()
        ->and($detail['availability'])->toBe('on_loan');
});

it('public_name_display governs the holder\'s name — display_name, and hidden', function () {
    [, $user] = rdrFixture(['public_name_display' => 'display_name']);
    $holder = User::factory()->create(['full_name' => 'Nguyễn Văn Bình', 'display_name' => 'Bình']);
    $book = rdrBook($user, 'Dế Mèn Phiêu Lưu Ký');
    $copy = $book->copies->first();
    $copy->update(['state' => 'on_loan']);
    $loan = Loan::query()->create([
        'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $holder->id, 'lent_by' => $user->id,
        'due_on' => '2026-08-30', 'status' => 'active',
    ]);

    expect(app(BookDetailQuery::class)->run($book)['currentLoan']['holderName'])->toBe('Bình');

    // hidden: the loan facts stay, the name goes.
    $shelf = app(TenantContext::class)->bookshelf();
    $shelf->update(['settings' => ['public_name_display' => 'hidden']]);
    app(TenantContext::class)->set($shelf->fresh(), app(TenantContext::class)->membership());

    $detail = app(BookDetailQuery::class)->run($book);
    expect($detail['currentLoan'])->not->toBeNull()
        ->and($detail['currentLoan']['holderName'])->toBeNull()
        ->and($detail['currentLoan']['dueOn'])->toBe('2026-08-30');
});

it('copiesTotal excludes a lost copy, the same way it excludes a retired one', function () {
    [, $user] = rdrFixture();
    $book = rdrBook($user, 'Dế Mèn Phiêu Lưu Ký', ['copy_count' => 3]);
    $book->copies[0]->update(['state' => 'lost']);
    $book->copies[1]->update(['state' => 'retired', 'retired_reason' => 'x']);

    expect(app(BookDetailQuery::class)->run($book)['copiesTotal'])->toBe(1);
});

it('paging the catalogue loses no book and repeats none, at both sorts and odd page sizes', function () {
    // The reference's parameterised paging property: every book of a bulk
    // load shares one created_at, so only a total order pages correctly.
    Carbon::setTestNow(Carbon::parse('2026-08-27 03:00:00', 'UTC'));
    [, $user] = rdrFixture();
    foreach (range(1, 11) as $i) {
        rdrBook($user, "Sách Số {$i}");
    }

    foreach (['recent', 'title'] as $sort) {
        foreach ([3, 4, 7] as $size) {
            $seen = [];
            for ($page = 1; $page <= (int) ceil(11 / $size); $page++) {
                $result = app(CatalogueQuery::class)->run([
                    'scope' => 'all', 'sort' => $sort, 'page' => $page, 'per_page' => $size,
                ]);
                foreach ($result['rows'] as $row) {
                    $seen[] = $row['slug'];
                }
            }
            expect(count($seen))->toBe(11, "sort {$sort} size {$size}: lost or repeated")
                ->and(count(array_unique($seen)))->toBe(11, "sort {$sort} size {$size}: repeated");
        }
    }
});
