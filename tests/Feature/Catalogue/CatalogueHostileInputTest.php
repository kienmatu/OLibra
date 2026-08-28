<?php

use App\Actions\Catalogue\CreateBook;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Category;
use App\Models\Membership;
use App\Models\Scopes\BookshelfScope;
use App\Models\User;
use App\Support\TenantContext;

/**
 * Task 12 carry-over: Task 11's reviewer proved by execution that
 * `CopyNoteRequest::rules()`'s `note` — `['nullable', 'string', 'max:1000']`,
 * no `encoding:UTF-8` — lets invalid UTF-8 reach `report-lost`'s
 * `ReportCopyLost::execute()`, which writes the note straight onto the
 * `book_copies` row. MariaDB errno 1366 (invalid string for the utf8mb4
 * column) is unmapped, so it surfaces as a raw `QueryException` and 500s a
 * legitimate manager workflow. Fixed by adding `bail` + `encoding:UTF-8`,
 * the identical shape `ReceiveReturnRequest` already carries (Task 11) and
 * `VoidLoanRequest` now carries (Task 12) — this closes the fourth
 * confirmed instance of the same class of bug (registration, void/
 * suspension reasons, the return note, and now this one).
 */
function chiFix(string $slug = 'dong-thap-chi'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $user = User::factory()->create();
    Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => 'manager', 'status' => 'active',
    ]);
    Category::query()->firstOrCreate(['slug' => 'truyen-thieu-nhi'], ['name' => 'Truyện thiếu nhi']);
    app(TenantContext::class)->clear();

    $membership = Membership::query()->withoutGlobalScope(BookshelfScope::class)
        ->where('bookshelf_id', $shelf->id)->where('user_id', $user->id)->firstOrFail();
    app(TenantContext::class)->set($shelf, $membership);
    $book = app(CreateBook::class)->execute($user, [
        'title' => 'Sách Thử Độc Hại', 'author' => 'Tô Hoài',
        'category_slug' => 'truyen-thieu-nhi', 'copy_count' => 1,
    ]);
    $copy = $book->copies()->firstOrFail();
    $copy->update(['state' => 'on_loan']);
    app(TenantContext::class)->clear();

    return [$shelf, $user, $copy];
}

function chiSetState(BookCopy $copy, string $state): void
{
    app(TenantContext::class)->actSystemWide();
    $copy->update(['state' => $state]);
    app(TenantContext::class)->clear();
}

it('invalid UTF-8 in report-lost\'s note is refused as validation, never 500s (the carry-over fix)', function () {
    [$shelf, $manager, $copy] = chiFix();

    $response = $this->actingAs($manager)
        ->post(route('shelves.manage.copies.report-lost', ['shelf' => $shelf->slug, 'bookCopy' => $copy->id]),
            ['note' => "th\xC3\x28t l\xE1\xBA\xA1c"]);

    expect($response->status())->not->toBe(500);
    $response->assertSessionHasErrors('note');
    expect($copy->fresh()->state->value)->toBe('on_loan');
});

it('invalid UTF-8 in mark-found\'s note is refused as validation, never 500s', function () {
    [$shelf, $manager, $copy] = chiFix(slug: 'dong-thap-chi-found');
    chiSetState($copy, 'lost');

    $response = $this->actingAs($manager)
        ->post(route('shelves.manage.copies.mark-found', ['shelf' => $shelf->slug, 'bookCopy' => $copy->id]),
            ['note' => "t\xC3\x28m th\xE1\xBA\xA5y"]);

    expect($response->status())->not->toBe(500);
    $response->assertSessionHasErrors('note');
    expect($copy->fresh()->state->value)->toBe('lost');
});

it('invalid UTF-8 in assess-condition\'s note is refused as validation, never 500s', function () {
    [$shelf, $manager, $copy] = chiFix(slug: 'dong-thap-chi-assess');

    $response = $this->actingAs($manager)
        ->post(route('shelves.manage.copies.assess', ['shelf' => $shelf->slug, 'bookCopy' => $copy->id]),
            ['condition' => 'worn', 'note' => "r\xC3\x28ch"]);

    expect($response->status())->not->toBe(500);
    $response->assertSessionHasErrors('note');
});

it('invalid UTF-8 in retire\'s reason is refused as validation, never 500s', function () {
    [$shelf, $manager, $copy] = chiFix(slug: 'dong-thap-chi-retire');
    chiSetState($copy, 'available');

    $response = $this->actingAs($manager)
        ->post(route('shelves.manage.copies.retire', ['shelf' => $shelf->slug, 'bookCopy' => $copy->id]),
            ['reason' => "h\xE1\xBB\x8Fng \xC3\x28"]);

    expect($response->status())->not->toBe(500);
    $response->assertSessionHasErrors('reason');
    expect($copy->fresh()->state->value)->toBe('available');
});

it('invalid UTF-8 in a new book\'s free-text fields is refused as validation, never 500s', function () {
    [$shelf, $manager] = chiFix(slug: 'dong-thap-chi-book');

    $response = $this->actingAs($manager)
        ->post(route('shelves.manage.books.store', ['shelf' => $shelf->slug]), [
            'title' => "T\xC3\x28i s\xC3\xA1ch",
            'author' => 'Tô Hoài',
            'category_slug' => 'truyen-thieu-nhi',
            'copy_count' => 1,
        ]);

    expect($response->status())->not->toBe(500);
    $response->assertSessionHasErrors('title');
});

/**
 * Fix round (Task 12): `donor_membership_id`'s ruleset was
 * `['nullable', 'uuid', 'prohibits:donor_name', $existsClosure]` with no
 * `bail`. `uuid` is a value guard, not an ordering guard — Laravel runs
 * every rule for an attribute unless told to stop, so a value that fails
 * `uuid` still reaches the closure, which binds those same bytes into
 * `Membership::query()->whereKey($value)`. `memberships.id` is
 * `ascii_bin` (see the migration); invalid-UTF-8 bytes arrive at that
 * bind as `utf8mb4_unicode_ci`, and MariaDB refuses the mix with errno
 * 1267 ("Illegal mix of collations"), unmapped, a raw 500. Fixed by
 * adding `bail` so a failed `uuid` check stops the ruleset before the
 * closure runs — the same shape `LendCopyRequest` already carries on its
 * own uuid fields.
 */
it('invalid UTF-8 in a new book\'s donor_membership_id is refused as validation, never 500s', function () {
    [$shelf, $manager] = chiFix(slug: 'dong-thap-chi-donor-book');

    $response = $this->actingAs($manager)
        ->post(route('shelves.manage.books.store', ['shelf' => $shelf->slug]), [
            'title' => 'Sách hợp lệ',
            'author' => 'Tô Hoài',
            'category_slug' => 'truyen-thieu-nhi',
            'copy_count' => 1,
            'donor_membership_id' => "not-\xC3\x28-a-uuid",
        ]);

    expect($response->status())->not->toBe(500);
    $response->assertSessionHasErrors('donor_membership_id');
});

it('invalid UTF-8 in add-copies\' donor_membership_id is refused as validation, never 500s', function () {
    [$shelf, $manager] = chiFix(slug: 'dong-thap-chi-donor-copies');

    app(TenantContext::class)->actSystemWide();
    $book = Book::query()->where('bookshelf_id', $shelf->id)->firstOrFail();
    app(TenantContext::class)->clear();

    $response = $this->actingAs($manager)
        ->post(route('shelves.manage.books.copies.store', ['shelf' => $shelf->slug, 'book' => $book->slug]), [
            'count' => 1,
            'donor_membership_id' => "not-\xC3\x28-a-uuid",
        ]);

    expect($response->status())->not->toBe(500);
    $response->assertSessionHasErrors('donor_membership_id');
});
