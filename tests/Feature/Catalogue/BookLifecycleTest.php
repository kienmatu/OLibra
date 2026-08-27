<?php

use App\Actions\Catalogue\CreateBook;
use App\Actions\Catalogue\DeleteBook;
use App\Actions\Catalogue\UpdateBook;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Category;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

afterEach(fn () => Carbon::setTestNow());

function lifecycleFixture(string $role = 'manager'): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $user = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => $role, 'status' => 'active',
    ]);
    Category::factory()->create(['name' => 'Truyện thiếu nhi', 'slug' => 'truyen-thieu-nhi']);
    Category::factory()->create(['name' => 'Giáo lý', 'slug' => 'giao-ly']);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($user);

    $book = app(CreateBook::class)->execute($user, [
        'title' => 'Dế Mèn Phiêu Lưu Ký', 'author' => 'Tô Hoài',
        'category_slug' => 'truyen-thieu-nhi', 'copy_count' => 2,
        'publisher' => 'NXB Kim Đồng', 'isbn' => '9786041000001',
    ]);

    return [$shelf, $user, $book];
}

it('writes only the fields it was given, and audits before and after', function () {
    [, $user, $book] = lifecycleFixture();

    app(UpdateBook::class)->execute($user, $book, ['title' => 'Dế Mèn Phiêu Lưu Ký (tái bản)', 'is_published' => false]);

    $fresh = $book->fresh();
    expect($fresh->title)->toBe('Dế Mèn Phiêu Lưu Ký (tái bản)')
        ->and($fresh->is_published)->toBeFalse()
        ->and($fresh->publisher)->toBe('NXB Kim Đồng')   // untouched
        ->and($fresh->author)->toBe('Tô Hoài');

    $entry = AuditLog::query()->where('action', 'book.updated')->firstOrFail();
    expect($entry->before['title'])->toBe('Dế Mèn Phiêu Lưu Ký')
        ->and($entry->after['title'])->toBe('Dế Mèn Phiêu Lưu Ký (tái bản)')
        ->and($entry->before['isPublished'])->toBeTrue()
        ->and($entry->after['isPublished'])->toBeFalse();
});

it('an explicit null clears a nullable field; an omitted field never does', function () {
    [, $user, $book] = lifecycleFixture();

    app(UpdateBook::class)->execute($user, $book, ['publisher' => null]);
    expect($book->fresh()->publisher)->toBeNull();

    app(UpdateBook::class)->execute($user, $book, ['title' => 'Dế Mèn']);
    expect($book->fresh()->publisher)->toBeNull()
        ->and($book->fresh()->isbn)->toBe('9786041000001');
});

it('writes published_year, page_count, description and language exactly where each was named', function () {
    // Closes the exact hole known-gaps flags from Task 6: FIELDS maps each
    // key straight through by name, and nothing here would catch a swapped
    // mapping (e.g. published_year landing in page_count's column) unless
    // every field is independently asserted against its own value.
    [, $user, $book] = lifecycleFixture();

    app(UpdateBook::class)->execute($user, $book, [
        'published_year' => 1941,
        'page_count' => 232,
        'description' => 'Chuyện phiêu lưu của chú dế mèn.',
        'language' => 'en',
    ]);

    $fresh = $book->fresh();
    expect($fresh->published_year)->toBe(1941)
        ->and($fresh->page_count)->toBe(232)
        ->and($fresh->description)->toBe('Chuyện phiêu lưu của chú dế mèn.')
        ->and($fresh->language)->toBe('en');

    app(UpdateBook::class)->execute($user, $book, [
        'published_year' => null,
        'page_count' => null,
        'description' => null,
    ]);

    $cleared = $book->fresh();
    expect($cleared->published_year)->toBeNull()
        ->and($cleared->page_count)->toBeNull()
        ->and($cleared->description)->toBeNull()
        ->and($cleared->language)->toBe('en'); // omitted — untouched
});

it('an explicitly blank title or author is refused, never written', function () {
    [, $user, $book] = lifecycleFixture();

    expect(fn () => app(UpdateBook::class)->execute($user, $book, ['title' => '  ']))
        ->toThrow(ValidationException::class);

    expect($book->fresh()->title)->toBe('Dế Mèn Phiêu Lưu Ký');
});

it('re-categorises by slug', function () {
    [, $user, $book] = lifecycleFixture();

    app(UpdateBook::class)->execute($user, $book, ['category_slug' => 'giao-ly']);

    expect($book->fresh()->category->slug)->toBe('giao-ly');
});

it('does not move the slug out from under an existing link', function () {
    [, $user, $book] = lifecycleFixture();

    app(UpdateBook::class)->execute($user, $book, ['title' => 'Một Tựa Hoàn Toàn Khác']);

    expect($book->fresh()->slug)->toBe('de-men-phieu-luu-ky');
});

it('refuses an ISBN already used on this shelf, ignoring soft-deleted holders', function () {
    [, $user, $book] = lifecycleFixture();
    $other = app(CreateBook::class)->execute($user, [
        'title' => 'Hoàng Tử Bé', 'author' => 'Antoine de Saint-Exupéry',
        'category_slug' => 'truyen-thieu-nhi', 'copy_count' => 1, 'isbn' => '9786041000002',
    ]);

    expect(fn () => app(UpdateBook::class)->execute($user, $book, ['isbn' => '9786041000002']))
        ->toThrow(RuleViolated::class, 'duplicate_isbn');

    $other->delete();
    app(UpdateBook::class)->execute($user, $book, ['isbn' => '9786041000002']);
    expect($book->fresh()->isbn)->toBe('9786041000002');
});

it('keeping the same isbn on the same book is not a clash with itself', function () {
    [, $user, $book] = lifecycleFixture();

    app(UpdateBook::class)->execute($user, $book, ['isbn' => '9786041000001', 'title' => 'Dế Mèn']);

    expect($book->fresh()->title)->toBe('Dế Mèn');
});

it('Q7: DeleteBook soft-deletes the book and the copies that have no history', function () {
    [, $user, $book] = lifecycleFixture();

    $result = app(DeleteBook::class)->execute($user, $book);

    expect($result)->toBe(['copiesDeleted' => 2, 'copiesRetained' => 0])
        ->and(Book::query()->count())->toBe(0)
        ->and(Book::withTrashed()->count())->toBe(1)
        ->and(BookCopy::query()->count())->toBe(0)
        ->and(BookCopy::withTrashed()->count())->toBe(2);
});

it('a copy with loan history is retained, not deleted, and the count says so', function () {
    [$shelf, $user, $book] = lifecycleFixture();
    $withHistory = $book->copies->first();
    Loan::query()->create([
        'copy_id' => $withHistory->id, 'book_id' => $book->id,
        'borrower_id' => $user->id, 'lent_by' => $user->id,
        'due_on' => '2026-08-01', 'status' => 'returned',
        'return_condition' => 'perfect', 'returned_at' => now(),
    ]);

    $result = app(DeleteBook::class)->execute($user, $book);

    expect($result)->toBe(['copiesDeleted' => 1, 'copiesRetained' => 1])
        ->and(BookCopy::query()->whereKey($withHistory->id)->exists())->toBeTrue();

    $entry = AuditLog::query()->where('action', 'book.deleted')->firstOrFail();
    expect($entry->after['copiesDeleted'])->toBe(1)
        ->and($entry->after['copiesRetained'])->toBe(1);
});

it('refuses while a copy is out or held', function () {
    [, $user, $book] = lifecycleFixture();
    $book->copies->first()->update(['state' => 'on_loan']);

    expect(fn () => app(DeleteBook::class)->execute($user, $book))
        ->toThrow(RuleViolated::class, 'has_active_loans');

    expect(Book::query()->whereKey($book->id)->exists())->toBeTrue();
});

it('M6: deleted_at comes from the injected clock, one instant for book and copies', function () {
    [, $user, $book] = lifecycleFixture();
    Carbon::setTestNow(Carbon::parse('2026-08-27 05:00:00', 'UTC'));

    app(DeleteBook::class)->execute($user, $book);

    $deletedBook = Book::withTrashed()->findOrFail($book->id);
    expect($deletedBook->deleted_at->toDateTimeString())->toBe('2026-08-27 05:00:00');
    foreach (BookCopy::withTrashed()->get() as $copy) {
        expect($copy->deleted_at->toDateTimeString())->toBe('2026-08-27 05:00:00');
    }
});

it('a reader can neither edit nor delete', function () {
    [$shelf, $manager, $book] = lifecycleFixture();
    app(TenantContext::class)->clear();
    $reader = User::factory()->create();
    $readerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $readerMembership);
    test()->actingAs($reader);

    expect(fn () => app(UpdateBook::class)->execute($reader, $book, ['title' => 'X']))
        ->toThrow(AuthorizationException::class);
    expect(fn () => app(DeleteBook::class)->execute($reader, $book))
        ->toThrow(AuthorizationException::class);
});
