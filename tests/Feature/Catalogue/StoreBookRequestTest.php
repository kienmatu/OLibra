<?php

use App\Http\Requests\Catalogue\StoreBookRequest;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

/**
 * Exercises StoreBookRequest::rules() directly against Laravel's validator,
 * without a route — Task 12's controller does not exist yet, and the Action
 * (CreateBookTest) is the one caller today. This is the only thing pinning
 * `prohibits:` against a silent rename back to the nonexistent
 * `prohibited_with`: that misnamed rule raises BadMethodCallException the
 * moment the validator runs, so a rename during Task 12's work would fail
 * THIS test loudly rather than landing as a live 500 behind a green suite.
 */
function catStoreBookValidate(array $input): Illuminate\Validation\Validator
{
    $request = new StoreBookRequest;
    $rules = app()->call([$request, 'rules']);

    return Validator::make($input, $rules);
}

it('refuses both a member donor and a free-text donor name', function () {
    [$shelf] = catCreateFixture();
    $donorUser = User::factory()->create();
    $donor = Membership::factory()->for($shelf)->create([
        'user_id' => $donorUser->id, 'role' => 'reader', 'status' => 'active',
    ]);

    $validator = catStoreBookValidate(catCreateInput([
        'donor_membership_id' => $donor->id,
        'donor_name' => 'bác Hoà',
    ]));

    expect($validator->fails())->toBeTrue()
        ->and($validator->errors()->has('donor_membership_id'))->toBeTrue();
});

it('accepts a member-only donor that exists on the bound shelf', function () {
    [$shelf] = catCreateFixture();
    $donorUser = User::factory()->create();
    $donor = Membership::factory()->for($shelf)->create([
        'user_id' => $donorUser->id, 'role' => 'reader', 'status' => 'active',
    ]);

    $validator = catStoreBookValidate(catCreateInput(['donor_membership_id' => $donor->id]));

    expect($validator->fails())->toBeFalse();
});

it('accepts a name-only donor', function () {
    catCreateFixture();

    $validator = catStoreBookValidate(catCreateInput(['donor_name' => 'bác Hoà']));

    expect($validator->fails())->toBeFalse();
});

it('refuses a donor_membership_id naming nothing live on the bound shelf', function () {
    // Covers both the plain-nonexistent case and — because the exists
    // rule is scoped to bookshelf_id — a real membership on ANOTHER
    // shelf, which is exactly the composite-FK hazard this rule exists
    // to keep out of CreateBook's transaction.
    catCreateFixture();

    $validator = catStoreBookValidate(catCreateInput([
        'donor_membership_id' => (string) Str::uuid(),
    ]));

    expect($validator->fails())->toBeTrue()
        ->and($validator->errors()->has('donor_membership_id'))->toBeTrue();
});

it('refuses a donor_membership_id belonging to another shelf', function () {
    [$shelf, $user] = catCreateFixture();
    $membership = app(TenantContext::class)->membership();

    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho-req', 'settings' => []]);
    $otherUser = User::factory()->create();
    $foreignDonor = Membership::factory()->create([
        'bookshelf_id' => $other->id, 'user_id' => $otherUser->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($user);

    $validator = catStoreBookValidate(catCreateInput([
        'donor_membership_id' => $foreignDonor->id,
    ]));

    expect($validator->fails())->toBeTrue()
        ->and($validator->errors()->has('donor_membership_id'))->toBeTrue();
});

it('bounds copy_count to 1..200', function () {
    catCreateFixture();

    expect(catStoreBookValidate(catCreateInput(['copy_count' => 0]))->fails())->toBeTrue()
        ->and(catStoreBookValidate(catCreateInput(['copy_count' => 201]))->fails())->toBeTrue()
        ->and(catStoreBookValidate(catCreateInput(['copy_count' => 1]))->fails())->toBeFalse()
        ->and(catStoreBookValidate(catCreateInput(['copy_count' => 200]))->fails())->toBeFalse();
});
