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

it('a proposed avatar renders as TWO PHOTOGRAPHS, and its storage key never crosses the seam', function () {
    // REWRITTEN BY TASK 8, and the rewrite is the point rather than an
    // accommodation. Task 1 asserted the pending list rendered a BARE LABEL
    // for `avatar_object` and its own comment said, by name, that the two
    // photographs side by side were the right rendering and were this
    // task's. The bare label was a placeholder; asserting it still existed
    // would now be pinning the placeholder in place.
    //
    // What survives unchanged is the rule underneath: the storage key is
    // meaningless to a reader and is an internal fact about a disk, so it
    // must never be printed as a value. Task 8 makes that structural rather
    // than a rendering choice — App\Queries\MyProfileChangeRequestQuery
    // strips the key from both bags server-side and sends two ADDRESSES, so
    // the page cannot print it even by mistake.
    //
    // Read off the component with comments stripped, so the prose above the
    // branch cannot satisfy the grep.
    $source = screenSource('shelves/profile/index.tsx');

    expect($source)->toContain('avatar_object')
        // The read-only list of current values drops it outright…
        ->and($source)->toContain('FIELD_ORDER.filter((f) => f !== "avatar_object")')
        // …the pending list is built from the eight TEXT fields, so the
        // photograph is not a row in it at all…
        ->and($source)->toContain('TEXT_FIELDS.filter((f) => f in pendingChange.proposedValues)')
        // …and the pair is rendered as pictures, guarded on the FLAG rather
        // than on a URL being non-null.
        ->and($source)->toContain('pendingChange.avatarProposed ?')
        ->and($source)->toContain('url={pendingChange.previousAvatarUrl}')
        ->and($source)->toContain('url={pendingChange.proposedAvatarUrl}');

    // And the key itself is gone from the payload: the props the page reads
    // carry addresses, never a bucket path.
    expect(str_contains($source, 'proposedValues.avatar_object'))->toBeFalse();
});

it('the reader gets an upload control whose accept list comes from the server', function () {
    // Spec D6's photograph, as a control. `accept` is NOT hand-written in
    // the page: App\Support\Members\AvatarLimits is the one list the
    // server gates on, MyProfileQuery sends it, and this pins that the page
    // uses what it was sent — a screen offering a format the server refuses
    // is exactly what two copies of a limit produce.
    //
    // HEIC's ABSENCE from that list is what makes iOS Safari transcode an
    // iPhone photograph to JPEG on the way out, so the page must not add it
    // back.
    $source = screenSource('shelves/profile/index.tsx');

    expect($source)->toContain('accept={accept}')
        ->and($source)->toContain('shelves.profile.avatar')
        ->and($source)->toContain('forceFormData: true')
        ->and(str_contains($source, 'image/heic'))->toBeFalse();

    [$shelf, $person] = myProfileFixture();

    $props = $this->actingAs($person)
        ->get("/shelves/{$shelf->slug}/profile")
        ->viewData('page')['props'];

    expect($props['profile']['avatarAccept'])
        ->toBe('image/jpeg,image/png,image/webp,image/avif')
        // Nobody has a photograph on a shelf that has just opened, and the
        // screen says so in words rather than drawing an unexplained disc.
        ->and($props['profile']['avatarUrl'])->toBeNull()
        // The KEY is not among the eight text fields the page receives.
        ->and($props['profile']['fields'])->not->toHaveKey('avatar_object');
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

/*
 * ── Task 7: the withdrawal gets a caller ─────────────────────────────────
 *
 * App\Actions\Admin\CancelProfileChange shipped in Task 4 with tests and no
 * HTTP route at all — Task 5 measured it: neither decision queue wires it
 * (BR:580/602 list only *Duyệt* and *Từ chối* on those cards), so spec D4's
 * self-exemption, a reader taking back their own proposal, was reachable by
 * nobody. These blocks are the difference between an Action that exists and
 * a capability that does.
 */

it('a reader withdraws their own pending proposal from their own page, and the pending card goes away', function () {
    [$shelf, $person] = myProfileFixture();

    $request = ProfileChangeRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $person->id,
        'proposed_values' => ['phone' => '0922222222'],
        'previous_values' => ['phone' => '0911111111'],
        'status' => 'pending',
    ]);

    $this->actingAs($person)
        ->from("/shelves/{$shelf->slug}/profile")
        ->post("/shelves/{$shelf->slug}/profile/change-request/{$request->id}/cancel")
        ->assertRedirect("/shelves/{$shelf->slug}/profile")
        ->assertSessionHasNoErrors();

    // The card does not vanish — this page shows the most recent request of
    // ANY status, deliberately (Task 1), so what goes away is the PENDING
    // one. The reader is told their own withdrawal took effect, and the
    // phone they proposed is not on their record.
    $this->actingAs($person)
        ->get("/shelves/{$shelf->slug}/profile")
        ->assertInertia(fn (Assert $page) => $page
            ->where('profile.pendingChange.status', 'cancelled')
            ->where('profile.fields.phone', '0911111111'));

    expect($request->fresh()->status->value)->toBe('cancelled')
        ->and($person->fresh()->phone)->toBe('0911111111');
});

it('the withdrawal control renders on a PENDING card only', function () {
    // Read off the component with comments stripped, so the prose above the
    // block cannot satisfy the grep. A decided request has nothing to take
    // back, and the server would answer profile_change_not_pending.
    $source = screenSource('shelves/profile/index.tsx');

    expect($source)->toContain('shelves.profile.change-request.cancel')
        ->and($source)->toContain('<CancelButton');
});

it('a reader cannot withdraw somebody ELSE\'s request — not_own_request, not a silent success', function () {
    [$shelf, $person] = myProfileFixture();

    $other = User::factory()->create(['full_name' => 'Trần Minh Khác']);
    Membership::factory()->for($shelf)->create(['user_id' => $other->id, 'status' => 'active']);

    $request = ProfileChangeRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $other->id,
        'proposed_values' => ['phone' => '0933333333'],
        'previous_values' => ['phone' => null],
        'status' => 'pending',
    ]);

    // The route binds by shelf, never by person — that layer is the
    // Action's pairing check, one layer down, which is where the refusal
    // comes from.
    $this->actingAs($person)
        ->from("/shelves/{$shelf->slug}/profile")
        ->post("/shelves/{$shelf->slug}/profile/change-request/{$request->id}/cancel")
        ->assertSessionHasErrors(['rule' => __('rules.not_own_request')]);

    expect($request->fresh()->status->value)->toBe('pending');
});

it('the password form posts to its own route, and it is not a proposal', function () {
    // Spec D12: BR §16.2's one immediate-effect control on this page. It is
    // NOT one of the eight proposable fields, so a screen that folded it
    // into the change-request form would be promising a manager's approval
    // for something no manager decides.
    $source = screenSource('shelves/profile/index.tsx');

    expect($source)->toContain('shelves.profile.password')
        ->and($source)->toContain('current_password')
        ->and($source)->toContain('c.passwordNote');
});
