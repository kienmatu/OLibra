<?php

use App\Actions\Catalogue\CreateBook;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Category;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

afterEach(fn () => Carbon::setTestNow());

function catCreateFixture(string $role = 'manager'): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $user = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => $role, 'status' => 'active',
    ]);
    Category::factory()->create(['name' => 'Truyện thiếu nhi', 'slug' => 'truyen-thieu-nhi']);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($user);

    return [$shelf, $user];
}

function catCreateInput(array $over = []): array
{
    return array_merge([
        'title' => 'Dế Mèn Phiêu Lưu Ký',
        'author' => 'Tô Hoài',
        'category_slug' => 'truyen-thieu-nhi',
        'copy_count' => 3,
    ], $over);
}

it('creates the book and its first copies in one transaction, with sequential codes', function () {
    [, $user] = catCreateFixture();

    $book = app(CreateBook::class)->execute($user, catCreateInput());

    expect($book->slug)->toBe('de-men-phieu-luu-ky')
        ->and($book->copies)->toHaveCount(3)
        ->and($book->copies->pluck('code')->all())->toBe(['DT-0001', 'DT-0002', 'DT-0003']);
});

it('every generated copy starts available and perfect', function () {
    [, $user] = catCreateFixture();

    $book = app(CreateBook::class)->execute($user, catCreateInput());

    foreach ($book->copies as $copy) {
        expect($copy->state->value)->toBe('available')
            ->and($copy->condition->value)->toBe('perfect');
    }
});

it('defaults acquired_on to today in Asia/Ho_Chi_Minh', function () {
    // 18:30 UTC on the 27th is the 28th in Hồ Chí Minh — the off-by-one
    // Clock::today() exists for.
    Carbon::setTestNow(Carbon::parse('2026-08-27 18:30:00', 'UTC'));
    [, $user] = catCreateFixture();

    $book = app(CreateBook::class)->execute($user, catCreateInput());

    expect($book->copies->first()->acquired_on->toDateString())->toBe('2026-08-28');
});

it('the free-text donor lands on every copy the call creates', function () {
    [, $user] = catCreateFixture();

    $book = app(CreateBook::class)->execute($user, catCreateInput([
        'donor_name' => 'bác Hoà', 'acquired_on' => '2026-07-01',
    ]));

    foreach ($book->copies as $copy) {
        expect($copy->acquired_from)->toBe('bác Hoà')
            ->and($copy->acquired_from_membership_id)->toBeNull()
            ->and($copy->acquired_on->toDateString())->toBe('2026-07-01');
    }
});

it('the member donor lands on every copy the call creates', function () {
    [$shelf, $user] = catCreateFixture();
    $donorUser = User::factory()->create();
    $donor = Membership::factory()->for($shelf)->create([
        'user_id' => $donorUser->id, 'role' => 'reader', 'status' => 'active',
    ]);

    $book = app(CreateBook::class)->execute($user, catCreateInput([
        'donor_membership_id' => $donor->id,
    ]));

    foreach ($book->copies as $copy) {
        expect($copy->acquired_from_membership_id)->toBe($donor->id)
            ->and($copy->acquired_from)->toBeNull();
    }
});

it('filling both donor controls is refused', function () {
    [, $user] = catCreateFixture();

    expect(fn () => app(CreateBook::class)->execute($user, catCreateInput([
        'donor_membership_id' => 'm0000000-0000-7000-8000-000000000001',
        'donor_name' => 'bác Hoà',
    ])))->toThrow(RuleViolated::class, 'donor_ambiguous');

    expect(Book::query()->count())->toBe(0);
});

it('one audit entry per cataloguing event, naming the codes it produced', function () {
    [, $user] = catCreateFixture();

    $book = app(CreateBook::class)->execute($user, catCreateInput());

    $entries = AuditLog::query()->where('action', 'book.created')->get();
    expect($entries)->toHaveCount(1)
        ->and($entries->first()->entity_id)->toBe($book->id)
        ->and($entries->first()->actor_id)->toBe($user->id)
        ->and($entries->first()->after['copyCodes'])->toBe(['DT-0001', 'DT-0002', 'DT-0003'])
        ->and(AuditLog::query()->where('action', 'copy.added')->count())->toBe(0);
});

it('a category slug naming nothing live is a field error, not a driver error', function () {
    [, $user] = catCreateFixture();
    Category::query()->where('slug', 'truyen-thieu-nhi')->get()->each->delete();

    expect(fn () => app(CreateBook::class)->execute($user, catCreateInput()))
        ->toThrow(ValidationException::class);
});

it('a duplicate ISBN on the same shelf is refused; the same ISBN elsewhere is not', function () {
    [$shelf, $user] = catCreateFixture();
    app(CreateBook::class)->execute($user, catCreateInput(['isbn' => '9786041000001']));

    expect(fn () => app(CreateBook::class)->execute($user, catCreateInput([
        'title' => 'Dế Mèn, bản mới', 'isbn' => '9786041000001',
    ])))->toThrow(RuleViolated::class, 'duplicate_isbn');

    // The same ISBN on ANOTHER shelf is fine — the check is per shelf.
    // Unbind first: creating a membership for shelf B while shelf A is
    // bound trips BelongsToBookshelf's foreign-shelf refusal (known-gaps).
    app(TenantContext::class)->clear();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $otherUser = User::factory()->create();
    $otherMembership = Membership::factory()->for($other)->create([
        'user_id' => $otherUser->id, 'role' => 'manager', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($other, $otherMembership);
    test()->actingAs($otherUser);

    $book = app(CreateBook::class)->execute($otherUser, catCreateInput(['isbn' => '9786041000001']));
    expect($book->exists)->toBeTrue();
});

it('a soft-deleted book frees its ISBN', function () {
    [, $user] = catCreateFixture();
    $first = app(CreateBook::class)->execute($user, catCreateInput(['isbn' => '9786041000001']));
    $first->delete();

    $second = app(CreateBook::class)->execute($user, catCreateInput([
        'title' => 'Dế Mèn, bản mới', 'isbn' => '9786041000001',
    ]));

    expect($second->exists)->toBeTrue();
});

it('CRITICAL 1: a second edition of a held title gets a disambiguated slug, not errno 1062', function () {
    [, $user] = catCreateFixture();
    app(CreateBook::class)->execute($user, catCreateInput());

    $second = app(CreateBook::class)->execute($user, catCreateInput(['copy_count' => 1]));
    $third = app(CreateBook::class)->execute($user, catCreateInput(['copy_count' => 1]));

    expect($second->slug)->toBe('de-men-phieu-luu-ky-2')
        ->and($third->slug)->toBe('de-men-phieu-luu-ky-3');
});

it('a soft-deleted book frees its slug for exact reuse', function () {
    [, $user] = catCreateFixture();
    $first = app(CreateBook::class)->execute($user, catCreateInput());
    $first->delete();

    $second = app(CreateBook::class)->execute($user, catCreateInput(['copy_count' => 1]));

    expect($second->slug)->toBe('de-men-phieu-luu-ky');
});

it('takes the shelf-row lock BEFORE any read — the first query of the transaction', function () {
    // The load-bearing ordering, pinned by position: under REPEATABLE
    // READ the transaction's read view is fixed at its first consistent
    // read, so a category lookup ahead of the allocator's FOR UPDATE
    // reintroduces the silent-ISBN-duplicate window even though the lock
    // is still "in" the transaction (reproduced live on 10.11). No
    // single-connection test can show the corruption itself — this pins
    // the mechanism that prevents it.
    [, $user] = catCreateFixture();
    DB::enableQueryLog();

    app(CreateBook::class)->execute($user, catCreateInput());

    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect($log)->not->toBe([])
        ->and(str_contains($log[0]['query'], 'bookshelves'))->toBeTrue('first query is not on bookshelves: '.$log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue('first query is not FOR UPDATE: '.$log[0]['query']);
});

it('a copy count below one is refused in the domain, and nothing is written', function () {
    // range(1, 0) is [1, 0] in PHP — unguarded, a zero would allocate two
    // codes. The Form Request guards HTTP; this guards every caller.
    [, $user] = catCreateFixture();

    expect(fn () => app(CreateBook::class)->execute($user, catCreateInput(['copy_count' => 0])))
        ->toThrow(RuleViolated::class, 'copy_count_invalid');

    expect(Book::query()->count())->toBe(0)
        ->and(BookCopy::query()->count())->toBe(0);
});

it('a blank title or author is refused in the domain', function () {
    [, $user] = catCreateFixture();

    expect(fn () => app(CreateBook::class)->execute($user, catCreateInput(['title' => '   '])))
        ->toThrow(ValidationException::class);
    expect(fn () => app(CreateBook::class)->execute($user, catCreateInput(['author' => ''])))
        ->toThrow(ValidationException::class);

    expect(Book::query()->count())->toBe(0);
});

it('a reader cannot catalogue a book, and nothing is written', function () {
    [, $user] = catCreateFixture(role: 'reader');

    expect(fn () => app(CreateBook::class)->execute($user, catCreateInput()))
        ->toThrow(AuthorizationException::class);

    expect(Book::query()->count())->toBe(0)
        ->and(BookCopy::query()->count())->toBe(0)
        ->and(AuditLog::query()->count())->toBe(0);
});
