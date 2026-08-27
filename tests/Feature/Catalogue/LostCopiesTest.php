<?php

use App\Actions\Catalogue\CreateBook;
use App\Actions\Catalogue\MarkCopyFound;
use App\Actions\Catalogue\ReportCopyLost;
use App\Actions\Catalogue\RetireCopy;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\Category;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\LostCopiesQuery;
use App\Support\TenantContext;
use Carbon\Carbon;

afterEach(fn () => Carbon::setTestNow());

function lostFixture(): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $user = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => 'manager', 'status' => 'active',
    ]);
    Category::factory()->create(['name' => 'Truyện thiếu nhi', 'slug' => 'truyen-thieu-nhi']);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($user);

    return [$shelf, $user];
}

function lostBook(User $user, string $title, int $copies = 1): Book
{
    return app(CreateBook::class)->execute($user, [
        'title' => $title, 'author' => 'Tô Hoài',
        'category_slug' => 'truyen-thieu-nhi', 'copy_count' => $copies,
    ]);
}

it('a copy reported lost appears with its book and the holder the command closed out', function () {
    [, $user] = lostFixture();
    $borrower = User::factory()->create(['full_name' => 'Nguyễn Văn Bình']);
    $book = lostBook($user, 'Dế Mèn Phiêu Lưu Ký');
    $copy = $book->copies->first();
    $copy->update(['state' => 'on_loan']);
    Loan::query()->create([
        'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $borrower->id, 'lent_by' => $user->id,
        'due_on' => '2026-09-10', 'status' => 'active',
    ]);

    app(ReportCopyLost::class)->execute($user, $copy);

    $rows = app(LostCopiesQuery::class)->rows();
    expect($rows)->toHaveCount(1)
        ->and($rows[0]['code'])->toBe('DT-0001')
        ->and($rows[0]['title'])->toBe('Dế Mèn Phiêu Lưu Ký')
        ->and($rows[0]['bookSlug'])->toBe('de-men-phieu-luu-ky')
        ->and($rows[0]['lastBorrowerName'])->toBe('Nguyễn Văn Bình')
        ->and(array_key_exists('phone', $rows[0]))->toBeFalse();   // name, no phone — BR:574
});

it('a copy lost with no loan behind it is listed with no name, not dropped', function () {
    [, $user] = lostFixture();
    $book = lostBook($user, 'Hoàng Tử Bé');
    $book->copies->first()->update(['state' => 'lost']);   // import shape: no loan, no report time

    $rows = app(LostCopiesQuery::class)->rows();
    expect($rows)->toHaveCount(1)
        ->and($rows[0]['lastBorrowerName'])->toBeNull()
        ->and($rows[0]['reportedAt'])->toBeNull();
});

it('only lost copies — never available, on loan or retired ones', function () {
    [, $user] = lostFixture();
    $book = lostBook($user, 'Dế Mèn Phiêu Lưu Ký', 4);
    [$available, $out, $retired, $lost] = $book->copies->all();
    $out->update(['state' => 'on_loan']);
    $retired->update(['state' => 'retired', 'retired_reason' => 'x']);
    $lost->update(['state' => 'lost']);

    $rows = app(LostCopiesQuery::class)->rows();
    expect(array_column($rows, 'copyId'))->toBe([$lost->id]);
});

it('the two exits BR §7.1 draws out of lost both empty this screen', function () {
    [, $user] = lostFixture();
    $book = lostBook($user, 'Dế Mèn Phiêu Lưu Ký', 2);
    [$first, $second] = $book->copies->all();
    $first->update(['state' => 'lost']);
    $second->update(['state' => 'lost']);

    app(MarkCopyFound::class)->execute($user, $first);
    app(RetireCopy::class)->execute($user, $second, 'không tìm lại được');

    expect(app(LostCopiesQuery::class)->rows())->toBe([])
        ->and(app(LostCopiesQuery::class)->count())->toBe(0);
});

it('the newest report is first, order total, missing report time last', function () {
    [, $user] = lostFixture();
    $book = lostBook($user, 'Dế Mèn Phiêu Lưu Ký', 3);
    [$a, $b, $c] = $book->copies->all();   // DT-0001..3
    $a->update(['state' => 'lost', 'lost_reported_at' => '2026-08-01 00:00:00']);
    $b->update(['state' => 'lost', 'lost_reported_at' => '2026-08-20 00:00:00']);
    $c->update(['state' => 'lost', 'lost_reported_at' => null]);

    $codes = array_column(app(LostCopiesQuery::class)->rows(), 'code');

    expect($codes)->toBe(['DT-0002', 'DT-0001', 'DT-0003']);
});

it('the count is the number of rows the list it labels shows', function () {
    [, $user] = lostFixture();
    $book = lostBook($user, 'Dế Mèn Phiêu Lưu Ký', 3);
    $book->copies[0]->update(['state' => 'lost']);
    $book->copies[1]->update(['state' => 'lost']);

    $query = app(LostCopiesQuery::class);
    expect($query->count())->toBe(count($query->rows()))->toBe(2);
});

it('a soft-deleted copy, and a soft-deleted book, leave both the count and the list', function () {
    [, $user] = lostFixture();
    $first = lostBook($user, 'Dế Mèn Phiêu Lưu Ký');
    $second = lostBook($user, 'Hoàng Tử Bé');
    $first->copies->first()->update(['state' => 'lost']);
    $second->copies->first()->update(['state' => 'lost']);

    $first->copies->first()->delete();
    $second->delete();

    expect(app(LostCopiesQuery::class)->rows())->toBe([])
        ->and(app(LostCopiesQuery::class)->count())->toBe(0);
});

it('the scoping is the global scope, not a where clause', function () {
    [$shelf, $user] = lostFixture();
    $book = lostBook($user, 'Dế Mèn Phiêu Lưu Ký');
    $book->copies->first()->update(['state' => 'lost']);

    app(TenantContext::class)->clear();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $otherUser = User::factory()->create();
    $otherMembership = Membership::factory()->for($other)->create([
        'user_id' => $otherUser->id, 'role' => 'manager', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($other, $otherMembership);

    expect(app(LostCopiesQuery::class)->rows())->toBe([]);
});
