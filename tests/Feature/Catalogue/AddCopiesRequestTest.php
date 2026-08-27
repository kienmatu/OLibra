<?php

use App\Http\Requests\Catalogue\AddCopiesRequest;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

/**
 * Exercises AddCopiesRequest::rules() directly against Laravel's validator,
 * without a route — no controller wires this Request yet, and the Action
 * (AddCopiesTest) is the one caller today. Same shape and reason as
 * StoreBookRequestTest: pins `prohibits:` against a silent rename back to
 * the nonexistent `prohibited_with` (BadMethodCallException the moment the
 * validator runs), and pins the scoped donor_membership_id existence check
 * against a bare `exists:memberships,id` that would let a foreign-shelf
 * membership through to the composite FK as a raw errno 1452.
 */
function addCopiesRequestValidate(array $input): Illuminate\Validation\Validator
{
    $request = new AddCopiesRequest;
    $rules = app()->call([$request, 'rules']);

    return Validator::make($input, $rules);
}

it('refuses both a member donor and a free-text donor name', function () {
    [$shelf] = addCopiesFixture();
    $donorUser = User::factory()->create();
    $donor = Membership::factory()->for($shelf)->create([
        'user_id' => $donorUser->id, 'role' => 'reader', 'status' => 'active',
    ]);

    $validator = addCopiesRequestValidate([
        'count' => 1,
        'donor_membership_id' => $donor->id,
        'donor_name' => 'bác Hoà',
    ]);

    expect($validator->fails())->toBeTrue()
        ->and($validator->errors()->has('donor_membership_id'))->toBeTrue();
});

it('accepts a member-only donor that exists on the bound shelf', function () {
    [$shelf] = addCopiesFixture();
    $donorUser = User::factory()->create();
    $donor = Membership::factory()->for($shelf)->create([
        'user_id' => $donorUser->id, 'role' => 'reader', 'status' => 'active',
    ]);

    $validator = addCopiesRequestValidate(['count' => 1, 'donor_membership_id' => $donor->id]);

    expect($validator->fails())->toBeFalse();
});

it('accepts a name-only donor', function () {
    addCopiesFixture();

    $validator = addCopiesRequestValidate(['count' => 1, 'donor_name' => 'bác Hoà']);

    expect($validator->fails())->toBeFalse();
});

it('refuses a donor_membership_id naming nothing live on the bound shelf', function () {
    // Covers both the plain-nonexistent case and — because the exists
    // rule is scoped to bookshelf_id — a real membership on ANOTHER
    // shelf, which is exactly the composite-FK hazard this rule exists
    // to keep out of AddCopies's transaction.
    addCopiesFixture();

    $validator = addCopiesRequestValidate([
        'count' => 1,
        'donor_membership_id' => (string) Str::uuid(),
    ]);

    expect($validator->fails())->toBeTrue()
        ->and($validator->errors()->has('donor_membership_id'))->toBeTrue();
});

it('refuses a donor_membership_id belonging to another shelf', function () {
    [$shelf, $user] = addCopiesFixture();
    $membership = app(TenantContext::class)->membership();

    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho-add-copies-req', 'settings' => []]);
    $otherUser = User::factory()->create();
    $foreignDonor = Membership::factory()->create([
        'bookshelf_id' => $other->id, 'user_id' => $otherUser->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($user);

    $validator = addCopiesRequestValidate([
        'count' => 1,
        'donor_membership_id' => $foreignDonor->id,
    ]);

    expect($validator->fails())->toBeTrue()
        ->and($validator->errors()->has('donor_membership_id'))->toBeTrue();
});

it('bounds count to 1..200', function () {
    addCopiesFixture();

    expect(addCopiesRequestValidate(['count' => 0])->fails())->toBeTrue()
        ->and(addCopiesRequestValidate(['count' => 201])->fails())->toBeTrue()
        ->and(addCopiesRequestValidate(['count' => 1])->fails())->toBeFalse()
        ->and(addCopiesRequestValidate(['count' => 200])->fails())->toBeFalse();
});
