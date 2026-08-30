<?php

use App\Enums\RequestStatus;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;

/**
 * Shelf + one reader + one book. @return array{Bookshelf, User, Book}
 */
function lrkFix(string $slug = 'dong-thap-lrk'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men']);
    app(TenantContext::class)->set($shelf, $membership);

    return [$shelf, $reader, $book];
}

/** @param array<string, mixed> $extra */
function lrkRow(Bookshelf $shelf, Book $book, User $reader, string $status, array $extra = []): BorrowRequest
{
    return BorrowRequest::query()->create(array_merge([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $reader->id,
        'status' => $status, 'requested_at' => now(),
    ], $extra));
}

it('a second live request for the same title by the same reader is refused by the database', function () {
    [$shelf, $reader, $book] = lrkFix();
    lrkRow($shelf, $book, $reader, 'pending');

    expect(fn () => lrkRow($shelf, $book, $reader, 'pending'))
        ->toThrow(QueryException::class, 'borrow_requests_one_live_per_title_member');
});

it('approved holds the slot exactly as pending does', function () {
    [$shelf, $reader, $book] = lrkFix('dong-thap-lrk-approved');
    lrkRow($shelf, $book, $reader, 'approved', ['hold_expires_at' => now()->addDays(3)]);

    expect(fn () => lrkRow($shelf, $book, $reader, 'pending'))
        ->toThrow(QueryException::class, 'borrow_requests_one_live_per_title_member');
});

it('every terminal status frees the slot, and so does a soft delete', function () {
    // Five separate rows would collide with each other, so each ending is
    // taken in turn on ONE row: end it, queue again, end that, and so on.
    [$shelf, $reader, $book] = lrkFix('dong-thap-lrk-free');
    foreach (['fulfilled', 'rejected', 'cancelled', 'expired'] as $ending) {
        $row = lrkRow($shelf, $book, $reader, 'pending');
        BorrowRequest::query()->whereKey($row->id)->update(['status' => $ending]);
    }
    $live = lrkRow($shelf, $book, $reader, 'pending');
    $live->delete();                                  // SoftDeletes

    // The slot is free after all five endings: this insert is the proof.
    expect(lrkRow($shelf, $book, $reader, 'pending')->status)->toBe(RequestStatus::Pending);
});

it('a different reader, and a different title, never collide', function () {
    [$shelf, $reader, $book] = lrkFix('dong-thap-lrk-distinct');
    lrkRow($shelf, $book, $reader, 'pending');

    app(TenantContext::class)->actSystemWide();
    $other = User::factory()->create(['full_name' => 'Anna Người Khác']);
    Membership::factory()->for($shelf)->create(['user_id' => $other->id, 'role' => 'reader', 'status' => 'active']);
    $otherBook = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $reader->id)->firstOrFail());

    lrkRow($shelf, $book, $other, 'pending');         // same title, other reader
    lrkRow($shelf, $otherBook, $reader, 'pending');   // other title, same reader

    expect(BorrowRequest::query()->count())->toBe(3);
});
