<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Gate;
use Tests\Support\TenantHarness;

function bookPolicyActor(string $role): array
{
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();
    $user = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => $role, 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $membership);

    $book = Book::query()->firstOrFail();
    $copy = BookCopy::query()->firstOrFail();

    return [$user, $book, $copy];
}

it('lets a reader view and only view', function () {
    [$user, $book, $copy] = bookPolicyActor('reader');

    expect(Gate::forUser($user)->allows('viewAny', Book::class))->toBeTrue()
        ->and(Gate::forUser($user)->allows('view', $book))->toBeTrue()
        ->and(Gate::forUser($user)->allows('create', Book::class))->toBeFalse()
        ->and(Gate::forUser($user)->allows('update', $book))->toBeFalse()
        ->and(Gate::forUser($user)->allows('delete', $book))->toBeFalse()
        ->and(Gate::forUser($user)->allows('manage', $book))->toBeFalse()
        ->and(Gate::forUser($user)->allows('addCopies', [BookCopy::class, $book]))->toBeFalse()
        ->and(Gate::forUser($user)->allows('assessCondition', $copy))->toBeFalse()
        ->and(Gate::forUser($user)->allows('retire', $copy))->toBeFalse()
        ->and(Gate::forUser($user)->allows('reportLost', $copy))->toBeFalse()
        ->and(Gate::forUser($user)->allows('markFound', $copy))->toBeFalse();
});

it('lets a manager do all of it', function () {
    [$user, $book, $copy] = bookPolicyActor('manager');

    foreach (['create' => Book::class, 'update' => $book, 'delete' => $book, 'manage' => $book] as $ability => $target) {
        expect(Gate::forUser($user)->allows($ability, $target))->toBeTrue($ability);
    }
    expect(Gate::forUser($user)->allows('addCopies', [BookCopy::class, $book]))->toBeTrue()
        ->and(Gate::forUser($user)->allows('assessCondition', $copy))->toBeTrue()
        ->and(Gate::forUser($user)->allows('retire', $copy))->toBeTrue()
        ->and(Gate::forUser($user)->allows('reportLost', $copy))->toBeTrue()
        ->and(Gate::forUser($user)->allows('markFound', $copy))->toBeTrue();
});

it('a suspended manager is refused — the gate\'s status check flows through', function () {
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();
    $user = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => 'manager', 'status' => 'suspended',
    ]);
    app(TenantContext::class)->set($shelf, $membership);

    expect(Gate::forUser($user)->allows('create', Book::class))->toBeFalse();
});

it('a memberless super admin passes every manager ability', function () {
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();
    $admin = User::factory()->create(['is_super_admin' => true]);
    app(TenantContext::class)->set($shelf, null);

    $book = Book::query()->firstOrFail();

    expect(Gate::forUser($admin)->allows('update', $book))->toBeTrue()
        ->and(Gate::forUser($admin)->allows('view', $book))->toBeTrue();
});
