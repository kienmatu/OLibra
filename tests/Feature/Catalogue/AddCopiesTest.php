<?php

use App\Actions\Catalogue\AddCopies;
use App\Actions\Catalogue\CreateBook;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Category;
use App\Models\Membership;
use App\Models\User;
use App\Support\Clock;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

afterEach(fn () => Carbon::setTestNow());

function addCopiesFixture(string $role = 'manager'): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $user = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => $role, 'status' => 'active',
    ]);
    Category::factory()->create(['name' => 'Truyện thiếu nhi', 'slug' => 'truyen-thieu-nhi']);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($user);

    $book = app(CreateBook::class)->execute($user, [
        'title' => 'Dế Mèn Phiêu Lưu Ký', 'author' => 'Tô Hoài',
        'category_slug' => 'truyen-thieu-nhi', 'copy_count' => 2,
    ]);

    return [$shelf, $user, $book];
}

it('continues the same sequence and writes one audit row per copy', function () {
    [, $user, $book] = addCopiesFixture();

    $copies = app(AddCopies::class)->execute($user, $book, ['count' => 2, 'donor_name' => 'bác Hoà']);

    expect($copies->pluck('code')->all())->toBe(['DT-0003', 'DT-0004']);
    foreach ($copies as $copy) {
        expect($copy->state->value)->toBe('available')
            ->and($copy->condition->value)->toBe('perfect')
            ->and($copy->acquired_from)->toBe('bác Hoà');
    }

    $entries = AuditLog::query()->where('action', 'copy.added')->get();
    expect($entries)->toHaveCount(2)
        ->and($entries->pluck('entity_id')->sort()->values()->all())
        ->toBe($copies->pluck('id')->sort()->values()->all())
        ->and($entries->first()->after['bookId'])->toBe($book->id);
});

it('its donor fields are its own, not the title\'s', function () {
    // The second copy's giver is frequently not the first copy's — the
    // command's whole reason to exist separately from CreateBook.
    [, $user, $book] = addCopiesFixture();

    $copies = app(AddCopies::class)->execute($user, $book, ['count' => 1]);

    expect($copies->first()->acquired_from)->toBeNull()
        ->and($copies->first()->acquired_from_membership_id)->toBeNull();
});

it('refuses both donor controls at once, writing nothing', function () {
    [, $user, $book] = addCopiesFixture();

    expect(fn () => app(AddCopies::class)->execute($user, $book, [
        'count' => 1,
        'donor_membership_id' => 'm0000000-0000-7000-8000-000000000001',
        'donor_name' => 'bác Hoà',
    ]))->toThrow(RuleViolated::class, 'donor_ambiguous');

    expect($book->copies()->count())->toBe(2);
});

it('a count below one is refused in the domain, and nothing is written', function () {
    [, $user, $book] = addCopiesFixture();

    expect(fn () => app(AddCopies::class)->execute($user, $book, ['count' => 0]))
        ->toThrow(RuleViolated::class, 'copy_count_invalid');

    expect($book->copies()->count())->toBe(2);
});

it('a reader may not add copies', function () {
    [$shelf, $manager, $book] = addCopiesFixture();
    app(TenantContext::class)->clear();
    $reader = User::factory()->create();
    $readerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $readerMembership);
    test()->actingAs($reader);

    expect(fn () => app(AddCopies::class)->execute($reader, $book, ['count' => 1]))
        ->toThrow(AuthorizationException::class);
});

it('an unknown donor membership is refused in the domain, writing nothing', function () {
    [, $user, $book] = addCopiesFixture();

    expect(fn () => app(AddCopies::class)->execute($user, $book, [
        'count' => 1,
        'donor_membership_id' => 'm0000000-0000-7000-8000-000000000099',
    ]))->toThrow(RuleViolated::class, 'donor_membership_invalid');

    expect($book->copies()->count())->toBe(2);
});

it('a donor membership on another shelf is refused, not a raw FK error', function () {
    // memberships.id is globally unique, so a naive exists() would accept
    // this; the composite FK (bookshelf_id, acquired_from_membership_id)
    // would then surface it as raw errno 1452 (BR §2 forbids). The scoped
    // Membership::query() check must catch it first, exactly as
    // CreateBook's own equivalent test does.
    [$shelf, $user, $book] = addCopiesFixture();
    $membership = app(TenantContext::class)->membership();

    // Built system-wide so the foreign-shelf create hook
    // (BelongsToBookshelf) does not object to a membership named for a
    // different shelf than the one currently bound.
    app(TenantContext::class)->actSystemWide();
    $otherShelf = Bookshelf::factory()->create(['slug' => 'khac', 'settings' => []]);
    $otherUser = User::factory()->create();
    $foreignMembership = Membership::factory()->create([
        'bookshelf_id' => $otherShelf->id, 'user_id' => $otherUser->id, 'role' => 'manager', 'status' => 'active',
    ]);

    // Rebind shelf A, the fixture's own tenant, before exercising the guard.
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($user);

    expect(fn () => app(AddCopies::class)->execute($user, $book, [
        'count' => 1,
        'donor_membership_id' => $foreignMembership->id,
    ]))->toThrow(RuleViolated::class, 'donor_membership_invalid');

    expect($book->copies()->count())->toBe(2);
});

it('records the donor membership id and a supplied acquired_on when given', function () {
    [$shelf, $user, $book] = addCopiesFixture();
    $donorMembership = Membership::factory()->for($shelf)->create([
        'user_id' => User::factory()->create()->id, 'role' => 'reader', 'status' => 'active',
    ]);

    $copies = app(AddCopies::class)->execute($user, $book, [
        'count' => 1,
        'donor_membership_id' => $donorMembership->id,
        'acquired_on' => '2026-01-15',
    ]);

    $copy = $copies->first()->fresh();
    expect($copy->acquired_from_membership_id)->toBe($donorMembership->id)
        ->and($copy->acquired_from)->toBeNull()
        ->and($copy->acquired_on->toDateString())->toBe('2026-01-15');
});

it('defaults acquired_on to today in the parish timezone when omitted', function () {
    Carbon::setTestNow(Carbon::parse('2026-03-10 12:00:00', 'UTC'));
    [, $user, $book] = addCopiesFixture();

    $copies = app(AddCopies::class)->execute($user, $book, ['count' => 1]);

    expect($copies->first()->acquired_on->toDateString())->toBe(app(Clock::class)->today());
});

it('takes the shelf-row lock BEFORE any read — the first query of the transaction', function () {
    // Same load-bearing ordering as CreateBook's identically named test:
    // under REPEATABLE READ the transaction's read view is fixed at its
    // first consistent read, so any read (including the donor-membership
    // lookup) ahead of the allocator's FOR UPDATE would pin a stale
    // snapshot. No single-connection test can show the corruption itself
    // — this pins the mechanism that prevents it.
    [, $user, $book] = addCopiesFixture();
    DB::enableQueryLog();

    app(AddCopies::class)->execute($user, $book, ['count' => 1, 'donor_name' => 'bác Hoà']);

    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect($log)->not->toBe([])
        ->and(str_contains($log[0]['query'], 'bookshelves'))->toBeTrue('first query is not on bookshelves: '.$log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue('first query is not FOR UPDATE: '.$log[0]['query']);
});
