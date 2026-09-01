<?php

use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\ParishUnit;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Gate;
use Inertia\Testing\AssertableInertia as Assert;

/**
 * Phase 3c-i Task 1 — BR §16.2's "Hồ sơ của bạn", the reader's own record.
 *
 * The shelf's taxonomy labels are DELIBERATELY NOT "Tổ" or "Giáo họ": D11
 * makes rendering a unit through the shelf's own label a requirement
 * (BR:247, BR:578), and a fixture that used the default words would pass
 * against a page that hard-coded them.
 *
 * @return array{Bookshelf, User, Membership} shelf, the reader, their membership
 */
function myProfileFixture(): array
{
    $shelf = Bookshelf::factory()->create([
        'slug' => 'dong-thap',
        'settings' => ['parish_taxonomy' => [
            'levels' => 2, 'nested' => true,
            'level1_label' => 'Giáo khu', 'level2_label' => 'Liên gia',
        ]],
    ]);

    $l1 = ParishUnit::factory()->for($shelf)->create(['level' => 1, 'name' => 'Giáo khu Thánh Tâm']);
    $l2 = ParishUnit::factory()->for($shelf)->create([
        'level' => 2, 'parent_id' => $l1->id, 'name' => 'Liên gia 3',
    ]);

    $person = User::factory()->create([
        'saint_name' => 'Maria', 'full_name' => 'Nguyễn Thị Lan',
        'date_of_birth' => '2015-04-02', 'phone' => '0911111111',
        'phone_missing_reason' => null, 'email' => null,
    ]);

    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $person->id, 'status' => 'active',
        'parish_unit_l1_id' => $l1->id, 'parish_unit_l2_id' => $l2->id,
    ]);

    return [$shelf, $person, $membership];
}

it('renders the reader their own nine fields, keyed as the database spells them', function () {
    [$shelf, $person] = myProfileFixture();

    $this->actingAs($person)
        ->get("/shelves/{$shelf->slug}/profile")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('shelves/profile/index')
            ->where('isMember', true)
            ->where('profile.fields.full_name', 'Nguyễn Thị Lan')
            ->where('profile.fields.saint_name', 'Maria')
            // A Y-m-d, never an instant: the column is a date and the
            // screen's own control expects one back.
            ->where('profile.fields.date_of_birth', '2015-04-02')
            ->where('profile.fields.phone', '0911111111')
            ->where('profile.fields.email', null));
});

it('never sends a credential to the reader\'s own page', function () {
    [$shelf, $person] = myProfileFixture();
    $person->username = 'lan.nguyen';
    $person->password_hash = 'not-a-real-hash';
    $person->save();

    $props = $this->actingAs($person)
        ->get("/shelves/{$shelf->slug}/profile")
        ->viewData('page')['props'];

    // One key per assertion — ->not->toHaveKeys() negates "has ALL of
    // them" and would pass on one absent key, the trap ReaderQueriesTest
    // documents at length.
    foreach (['username', 'password_hash', 'passwordHash'] as $forbidden) {
        expect(array_key_exists($forbidden, $props['profile']['fields']))->toBeFalse($forbidden);
    }

    expect(json_encode($props))->not->toContain('not-a-real-hash');
});

it('a reader sees their own record and not another reader\'s', function () {
    [$shelf, $person, $membership] = myProfileFixture();

    $other = User::factory()->create(['full_name' => 'Trần Minh Khác']);
    $otherMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $other->id, 'status' => 'active',
    ]);

    $props = $this->actingAs($person)
        ->get("/shelves/{$shelf->slug}/profile")
        ->viewData('page')['props'];

    expect($props['profile']['membershipId'])->toBe($membership->id)
        ->and(json_encode($props))->not->toContain('Trần Minh Khác');

    // The route names no membership, so the ONLY way to ask for someone
    // else's row is a future caller handing one to the ability. That is
    // what viewSelf refuses, and it is the whole reason the page was not
    // wired to MembershipPolicy::view — which grants a reader nothing and
    // would have 403ed this reader off their OWN page.
    app(TenantContext::class)->set($shelf, $membership);

    expect(Gate::forUser($person)->allows('viewSelf', $membership))->toBeTrue()
        ->and(Gate::forUser($person)->allows('viewSelf', $otherMembership))->toBeFalse()
        ->and(Gate::forUser($person)->allows('view', $membership))->toBeFalse();
});

it('shows a REJECTED request and the manager\'s reason — the page is where a reader learns it', function () {
    [$shelf, $person] = myProfileFixture();

    ProfileChangeRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $person->id,
        'proposed_values' => ['phone' => '0922222222'],
        'previous_values' => ['phone' => '0911111111'],
        'status' => 'rejected',
        'rejection_reason' => 'Số này là của nhà hàng xóm, con hỏi lại giúp cô nhé.',
        'decided_at' => now(),
    ]);

    $this->actingAs($person)
        ->get("/shelves/{$shelf->slug}/profile")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('profile.pendingChange.status', 'rejected')
            ->where(
                'profile.pendingChange.rejectionReason',
                'Số này là của nhà hàng xóm, con hỏi lại giúp cô nhé.',
            )
            ->where('profile.pendingChange.proposedValues.phone', '0922222222'));
});

it('reads the MOST RECENT request whatever its status, not the pending one underneath it', function () {
    [$shelf, $person] = myProfileFixture();

    // A cancelled row from last week and a rejected one from today. A
    // pending-only filter would answer with NEITHER; an unordered read
    // could answer with either.
    ProfileChangeRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $person->id,
        'proposed_values' => ['email' => 'cu@example.test'],
        'previous_values' => ['email' => null],
        'status' => 'cancelled',
        'requested_at' => now()->subWeek(),
    ]);
    ProfileChangeRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $person->id,
        'proposed_values' => ['email' => 'moi@example.test'],
        'previous_values' => ['email' => null],
        'status' => 'rejected', 'rejection_reason' => 'Chưa đúng.',
        'requested_at' => now(),
    ]);

    $this->actingAs($person)
        ->get("/shelves/{$shelf->slug}/profile")
        ->assertInertia(fn (Assert $page) => $page
            ->where('profile.pendingChange.status', 'rejected')
            ->where('profile.pendingChange.proposedValues.email', 'moi@example.test'));
});

it('BR:544 — a pending request travels with the CURRENT value beside the proposed one', function () {
    [$shelf, $person] = myProfileFixture();

    ProfileChangeRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $person->id,
        'proposed_values' => ['phone' => '0922222222'],
        'previous_values' => ['phone' => '0911111111'],
        'status' => 'pending',
    ]);

    $this->actingAs($person)
        ->get("/shelves/{$shelf->slug}/profile")
        ->assertInertia(fn (Assert $page) => $page
            ->where('profile.pendingChange.status', 'pending')
            ->where('profile.pendingChange.proposedValues.phone', '0922222222')
            // The other half of the contract. A page given only the
            // proposed value satisfies the query and fails BR:544.
            ->where('profile.pendingChange.previousValues.phone', '0911111111')
            // And the value still in force is on the page independently,
            // because the current record is what a proposal has NOT
            // changed yet.
            ->where('profile.fields.phone', '0911111111'));
});

it('BR:544 — the page RENDERS both halves and says plainly that it is waiting', function () {
    // The props being right is not the requirement; the rendering is. Read
    // off the component with its comments stripped, so the prose above each
    // block cannot satisfy the grep on its own.
    $source = screenSource('shelves/profile/index.tsx');

    expect($source)->toContain('proposedValues[f]')
        ->and($source)->toContain('previousValues[f]')
        ->and($source)->toContain('c.currentIs')
        ->and($source)->toContain('c.stillInForce')
        ->and($source)->toContain('c.rejectionReasonLine');
});

it('a proposal to CLEAR a field survives as a named field, not as an absent one', function () {
    [$shelf, $person] = myProfileFixture();

    ProfileChangeRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $person->id,
        // Present and null: "clear my email". Distinct from a key the
        // proposal never mentioned, which is the difference ProfileFields
        // ::pick preserves on the way out.
        'proposed_values' => ['email' => null],
        'previous_values' => ['email' => 'cu@example.test'],
        'status' => 'pending',
    ]);

    $props = $this->actingAs($person)
        ->get("/shelves/{$shelf->slug}/profile")
        ->viewData('page')['props'];

    $proposed = $props['profile']['pendingChange']['proposedValues'];

    expect(array_key_exists('email', $proposed))->toBeTrue()
        ->and($proposed['email'])->toBeNull()
        ->and(array_key_exists('phone', $proposed))->toBeFalse();
});

it('a stored bag holding something that is not a profile field never reaches the screen', function () {
    [$shelf, $person] = myProfileFixture();

    ProfileChangeRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $person->id,
        // The column is JSON with no check constraint behind it. The
        // allowlist is applied on the way OUT as well as in.
        'proposed_values' => ['phone' => '0922222222', 'is_super_admin' => true],
        'previous_values' => [],
        'status' => 'pending',
    ]);

    $props = $this->actingAs($person)
        ->get("/shelves/{$shelf->slug}/profile")
        ->viewData('page')['props'];

    expect(array_key_exists('is_super_admin', $props['profile']['pendingChange']['proposedValues']))
        ->toBeFalse();
});

it('D11 — the units render through THIS shelf\'s labels, never the words Tổ or Giáo họ', function () {
    [$shelf, $person] = myProfileFixture();

    $this->actingAs($person)
        ->get("/shelves/{$shelf->slug}/profile")
        ->assertInertia(fn (Assert $page) => $page
            ->where('profile.taxonomy.level1Label', 'Giáo khu')
            ->where('profile.taxonomy.level2Label', 'Liên gia')
            ->where('profile.parishUnitL1Name', 'Giáo khu Thánh Tâm')
            ->where('profile.parishUnitL2Name', 'Liên gia 3')
            ->where('profile.showLevel1', true)
            ->where('profile.showLevel2', true));

    // And the screen itself spells neither default word, so a shelf that
    // kept the defaults cannot make a hard-coded label look correct.
    $source = screenSource('shelves/profile/index.tsx');

    expect($source)->toContain('taxonomy.level1Label')
        ->and(str_contains($source, 'Giáo họ'))->toBeFalse('the page hard-codes Giáo họ')
        ->and(str_contains($source, 'Tổ '))->toBeFalse('the page hard-codes Tổ');
});

it('a shelf whose units are all retired renders no unit row, and still names the reader\'s own', function () {
    [$shelf, $person] = myProfileFixture();

    // Soft-deleted rather than removed, because that is the state a shelf
    // actually reaches: a manager retires a unit and every membership
    // pointing at it keeps pointing at it (the composite FK would refuse
    // otherwise, measured — errno 1451). "No field, or a usable one":
    // ParishUnits::options excludes a retired unit, so neither level
    // renders a row, while describeSelection still names the unit the
    // reader is actually in.
    app(TenantContext::class)->set($shelf, null);
    ParishUnit::query()->get()->each(fn (ParishUnit $u) => $u->delete());

    $this->actingAs($person)
        ->get("/shelves/{$shelf->slug}/profile")
        ->assertInertia(fn (Assert $page) => $page
            ->where('profile.showLevel1', false)
            ->where('profile.showLevel2', false)
            ->where('profile.parishLine', 'Liên gia 3 · Giáo khu Thánh Tâm'));
});

it('a reader with no proposal at all gets null, not a failure', function () {
    [$shelf, $person] = myProfileFixture();

    $this->actingAs($person)
        ->get("/shelves/{$shelf->slug}/profile")
        ->assertInertia(fn (Assert $page) => $page->where('profile.pendingChange', null));
});

it('a memberless super admin gets the not-a-member page rather than a 500', function () {
    [$shelf] = myProfileFixture();
    $admin = User::factory()->superAdmin()->create();

    $this->actingAs($admin)
        ->get("/shelves/{$shelf->slug}/profile")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('shelves/profile/index')
            ->where('isMember', false)
            ->where('profile', null));
});
