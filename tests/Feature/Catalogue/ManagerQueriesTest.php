<?php

use App\Actions\Catalogue\AssessCondition;
use App\Actions\Catalogue\CreateBook;
use App\Enums\CopyCondition;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\Category;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\BookForEditQuery;
use App\Queries\BooksListQuery;
use App\Queries\ManagerBookDetailQuery;
use App\Support\TenantContext;
use Carbon\Carbon;

afterEach(fn () => Carbon::setTestNow());

function mgrFixture(): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $user = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => 'manager', 'status' => 'active',
    ]);
    Category::factory()->create(['name' => 'Truyện thiếu nhi', 'slug' => 'truyen-thieu-nhi']);
    Category::factory()->create(['name' => 'Giáo lý', 'slug' => 'giao-ly']);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($user);

    return [$shelf, $user];
}

function mgrBook(User $user, string $title, array $over = []): Book
{
    return app(CreateBook::class)->execute($user, array_merge([
        'title' => $title, 'author' => 'Tô Hoài',
        'category_slug' => 'truyen-thieu-nhi', 'copy_count' => 1,
    ], $over));
}

it('sorts by title alphabetically in Vietnamese, not in byte order', function () {
    [, $user] = mgrFixture();
    mgrBook($user, 'Tuổi Thơ Dữ Dội');
    mgrBook($user, 'Đất Rừng Phương Nam');   // Đ begins 0xC4 — byte order puts it last
    mgrBook($user, 'Anh Em Nhà Bồ Câu');

    $rows = app(BooksListQuery::class)->run(['sort' => 'title'])['rows'];

    expect(array_column($rows, 'title'))
        ->toBe(['Anh Em Nhà Bồ Câu', 'Đất Rừng Phương Nam', 'Tuổi Thơ Dữ Dội']);
});

it('shows a draft the reader catalogue hides, flagged as such', function () {
    [, $user] = mgrFixture();
    mgrBook($user, 'Bản Nháp', ['is_published' => false]);

    $rows = app(BooksListQuery::class)->run([])['rows'];

    expect($rows)->toHaveCount(1)
        ->and($rows[0]['isPublished'])->toBeFalse();
});

it('filters by folded query and by category slug', function () {
    [, $user] = mgrFixture();
    mgrBook($user, 'Dế Mèn Phiêu Lưu Ký');
    mgrBook($user, 'Hoàng Tử Bé', ['category_slug' => 'giao-ly']);

    expect(array_column(app(BooksListQuery::class)->run(['q' => 'de men'])['rows'], 'title'))
        ->toBe(['Dế Mèn Phiêu Lưu Ký'])
        ->and(array_column(app(BooksListQuery::class)->run(['category' => 'giao-ly'])['rows'], 'title'))
        ->toBe(['Hoàng Tử Bé']);
});

it('M7: a garbage query returns nothing, not the whole shelf', function () {
    [, $user] = mgrFixture();
    mgrBook($user, 'Dế Mèn Phiêu Lưu Ký');

    $page = app(BooksListQuery::class)->run(['q' => '%%%']);

    expect($page['rows'])->toBe([])
        ->and($page['total'])->toBe(0);
});

it('M8: reports none, not retired, for a title with zero live copies', function () {
    [, $user] = mgrFixture();
    $book = mgrBook($user, 'Sách Không Bản');
    $book->copies->first()->delete();   // soft-delete the only copy

    $rows = app(BooksListQuery::class)->run([])['rows'];

    expect($rows[0]['availability'])->toBe('none');
});

it('shows the code range under the title', function () {
    [, $user] = mgrFixture();
    mgrBook($user, 'Dế Mèn Phiêu Lưu Ký', ['copy_count' => 3]);

    $rows = app(BooksListQuery::class)->run([])['rows'];

    expect($rows[0]['codes'])->toBe('DT-0001 – DT-0003');
});

it('copiesTotal excludes lost and retired, list and detail agreeing', function () {
    [, $user] = mgrFixture();
    $book = mgrBook($user, 'Dế Mèn Phiêu Lưu Ký', ['copy_count' => 3]);
    $copies = $book->copies;
    $copies[0]->update(['state' => 'lost']);
    $copies[1]->update(['state' => 'retired', 'retired_reason' => 'hỏng']);

    $listRow = app(BooksListQuery::class)->run([])['rows'][0];
    $detail = app(ManagerBookDetailQuery::class)->run($book);

    expect($listRow['copiesTotal'])->toBe(1)
        ->and($detail['book']['copiesTotal'])->toBe(1)
        // …but the copies table still lists every one, retired included,
        // with its reason — a manager's page, unlike a reader's.
        ->and($detail['copies'])->toHaveCount(3)
        ->and(collect($detail['copies'])->firstWhere('state', 'retired')['retiredReason'])->toBe('hỏng');
});

it('manager detail carries per-copy holder and computed overdue', function () {
    [, $user] = mgrFixture();
    $borrower = User::factory()->create(['full_name' => 'Nguyễn Văn Bình']);
    $book = mgrBook($user, 'Dế Mèn Phiêu Lưu Ký');
    $copy = $book->copies->first();
    $copy->update(['state' => 'on_loan']);
    Loan::query()->create([
        'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $borrower->id, 'lent_by' => $user->id,
        'due_on' => '2026-08-20', 'status' => 'active',
    ]);
    Carbon::setTestNow(Carbon::parse('2026-08-27 03:00:00', 'UTC'));   // past due — computed, never stored

    $detail = app(ManagerBookDetailQuery::class)->run($book);

    expect($detail['copies'][0]['holderName'])->toBe('Nguyễn Văn Bình')
        ->and($detail['copies'][0]['dueOn'])->toBe('2026-08-20')
        ->and($detail['copies'][0]['isOverdue'])->toBeTrue()
        ->and($detail['onLoan'])->toBe(1);
});

it('a member donor resolves to their name; a free-text one renders as typed', function () {
    [$shelf, $user] = mgrFixture();
    $managerMembership = app(TenantContext::class)->membership();
    $donorUser = User::factory()->create(['full_name' => 'Phạm Thị Cúc']);
    app(TenantContext::class)->clear();
    $donor = Membership::factory()->for($shelf)->create([
        'user_id' => $donorUser->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $managerMembership);

    $memberDonated = mgrBook($user, 'Sách Được Tặng', ['donor_membership_id' => $donor->id]);
    $textDonated = mgrBook($user, 'Sách Tặng Tay', ['donor_name' => 'bác Hoà']);

    $first = app(ManagerBookDetailQuery::class)->run($memberDonated)['copies'][0];
    $second = app(ManagerBookDetailQuery::class)->run($textDonated)['copies'][0];

    expect($first['acquiredFromMembershipName'])->toBe('Phạm Thị Cúc')
        ->and($first['acquiredFrom'])->toBeNull()
        ->and($second['acquiredFrom'])->toBe('bác Hoà')
        ->and($second['acquiredFromMembershipName'])->toBeNull();
});

it('loan history survives the copy being retired', function () {
    [, $user] = mgrFixture();
    $borrower = User::factory()->create(['full_name' => 'Nguyễn Văn Bình']);
    $book = mgrBook($user, 'Dế Mèn Phiêu Lưu Ký');
    $copy = $book->copies->first();
    Loan::query()->create([
        'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $borrower->id, 'lent_by' => $user->id,
        'due_on' => '2026-08-01', 'status' => 'returned',
        'return_condition' => 'perfect', 'returned_at' => now(),
    ]);
    $copy->update(['state' => 'retired', 'retired_reason' => 'cũ nát']);

    $history = app(ManagerBookDetailQuery::class)->run($book)['loanHistory'];

    expect($history)->toHaveCount(1)
        ->and($history[0]['borrowerName'])->toBe('Nguyễn Văn Bình')
        ->and($history[0]['copyCode'])->toBe('DT-0001')
        ->and($history[0]['returnCondition'])->toBe('perfect');
});

it('condition history survives the copy being soft-deleted — BR §11, never deleted', function () {
    [, $user] = mgrFixture();
    $book = mgrBook($user, 'Dế Mèn Phiêu Lưu Ký');
    $copy = $book->copies->first();
    app(AssessCondition::class)->execute($user, $copy, CopyCondition::Worn, 'gáy sách hơi lỏng');
    $copy->delete();   // soft-deleted; the assessment is not

    $history = app(ManagerBookDetailQuery::class)->run($book)['conditionHistory'];

    expect($history)->toHaveCount(1)
        ->and($history[0]['copyCode'])->toBe('DT-0001')
        ->and($history[0]['condition'])->toBe('worn')
        ->and($history[0]['note'])->toBe('gáy sách hơi lỏng');
});

it('book-for-edit reaches a draft and round-trips the category slug', function () {
    [, $user] = mgrFixture();
    $draft = mgrBook($user, 'Bản Nháp', ['is_published' => false, 'publisher' => 'NXB Trẻ']);

    $form = app(BookForEditQuery::class)->run($draft);

    expect($form['categorySlug'])->toBe('truyen-thieu-nhi')
        ->and($form['isPublished'])->toBeFalse()
        ->and($form['publisher'])->toBe('NXB Trẻ')
        ->and(array_key_exists('copiesTotal', $form))->toBeFalse();
});

it('paging the manager list loses no book and repeats none', function () {
    // IMPORTANT 5: every book of a bulk load shares one created_at (a fixed
    // test clock reproduces the ordinary case), so the order must be total
    // or LIMIT/OFFSET pages drop and duplicate rows. 9 books, pageSize 4.
    Carbon::setTestNow(Carbon::parse('2026-08-27 03:00:00', 'UTC'));
    [, $user] = mgrFixture();
    foreach (range(1, 9) as $i) {
        mgrBook($user, "Sách Số {$i}");
    }

    foreach (['recent', 'title'] as $sort) {
        $seen = [];
        foreach ([1, 2, 3] as $page) {
            $result = app(BooksListQuery::class)->run(['sort' => $sort, 'page' => $page, 'per_page' => 4]);
            foreach ($result['rows'] as $row) {
                $seen[] = $row['slug'];
            }
        }
        expect(count($seen))->toBe(9, "sort {$sort}: lost or repeated a row across pages")
            ->and(count(array_unique($seen)))->toBe(9, "sort {$sort}: repeated a row");
    }
});

it('one shelf\'s list never contains another\'s', function () {
    [$shelf, $user] = mgrFixture();
    mgrBook($user, 'Dế Mèn Phiêu Lưu Ký');

    app(TenantContext::class)->clear();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $otherUser = User::factory()->create();
    $otherMembership = Membership::factory()->for($other)->create([
        'user_id' => $otherUser->id, 'role' => 'manager', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($other, $otherMembership);

    expect(app(BooksListQuery::class)->run([])['total'])->toBe(0);
});
