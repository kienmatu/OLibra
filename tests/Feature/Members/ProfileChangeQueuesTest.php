<?php

use App\Enums\ProfileChangeStatus;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\ParishUnit;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia as Assert;

/**
 * Phase 3c-i Task 5 — the two decision queues, their predicates, and their
 * badges (spec D9, D10).
 *
 * THE PROPERTY UNDER TEST IS A PARTITION, not two list contents. BR:580
 * gives the shelf-level queue "one card per proposed change whose subject
 * is a READER of this shelf"; BR:602 gives the cross-shelf one "every
 * pending profile-change proposal whose subject is a MANAGER OR SHELF ADMIN
 * anywhere". Between them every pending request must have exactly one home:
 * a request in BOTH could be decided twice over, and a request in NEITHER
 * is one nobody could ever rule on — which is the failure §9's routing rule
 * exists to prevent, since a manager may not decide a peer manager's own
 * change. So the queues are asserted from both sides, over one fixture
 * holding all four combinations.
 *
 * THE BADGES ARE ASSERTED ON A NON-EMPTY FIXTURE FOR BOTH QUEUES. "Each
 * badge equals its own queue's length" is a tautology at zero — 0 == 0
 * passes with the predicates deleted, with the queries swapped, and with
 * the badge hard-coded — so every badge assertion below runs against a
 * fixture where the two queues hold DIFFERENT non-zero numbers (1 and 2),
 * which is also what makes swapping the two counts visible.
 */

/** A shelf with nobody on it. Unbound while building: BelongsToBookshelf refuses a foreign create. */
function pcqShelf(string $slug): Bookshelf
{
    app(TenantContext::class)->clear();

    return Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
}

/** @return array{User, Membership} A person on that shelf, at that role. */
function pcqPerson(Bookshelf $shelf, string $role, string $fullName): array
{
    app(TenantContext::class)->clear();

    $user = User::factory()->create([
        'saint_name' => 'Maria', 'full_name' => $fullName,
        'father_name' => 'Nguyễn Văn Hoà', 'mother_name' => 'Trần Thị Mai',
        'phone' => '0911111111', 'phone_missing_reason' => null, 'email' => null,
    ]);

    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => $role, 'status' => 'active',
    ]);

    return [$user, $membership];
}

/** A pending row written straight to the table — no proposal path is under test here. */
function pcqPending(Bookshelf $shelf, User $person, array $proposed, array $previous = []): ProfileChangeRequest
{
    app(TenantContext::class)->clear();

    return ProfileChangeRequest::query()->create([
        'bookshelf_id' => $shelf->id,
        'user_id' => $person->id,
        'proposed_values' => $proposed,
        'previous_values' => $previous,
        'status' => 'pending',
    ]);
}

/**
 * The whole fixture, in one place, holding all four combinations of
 * (subject role) × (shelf): a reader and a manager with pending changes at
 * shelf A, and a reader and a shelf admin with pending changes at shelf B.
 * Plus the manager who does the deciding at A, and a super administrator.
 *
 * The two queues therefore hold DIFFERENT non-zero numbers for A's manager
 * — one card at the shelf, two in the cross-shelf queue — which is what
 * stops the badge assertions passing on an empty set.
 *
 * @return array{shelfA: Bookshelf, shelfB: Bookshelf, manager: User, superAdmin: User, readerA: User, managerA: User, readerB: User, adminB: User, readerARequest: ProfileChangeRequest, managerARequest: ProfileChangeRequest, readerBRequest: ProfileChangeRequest, adminBRequest: ProfileChangeRequest}
 */
function pcqFixture(): array
{
    $shelfA = pcqShelf('dong-thap');
    $shelfB = pcqShelf('an-giang');

    [$manager] = pcqPerson($shelfA, 'manager', 'Quản Lý Đông Tháp');
    [$readerA] = pcqPerson($shelfA, 'reader', 'Trần Thị Bạn Đọc');
    [$managerA] = pcqPerson($shelfA, 'manager', 'Lê Văn Đồng Nghiệp');
    [$readerB] = pcqPerson($shelfB, 'reader', 'Phạm Thị An Giang');
    [$adminB] = pcqPerson($shelfB, 'admin', 'Đỗ Văn Quản Trị');

    app(TenantContext::class)->clear();
    $superAdmin = User::factory()->create(['is_super_admin' => true]);

    return [
        'shelfA' => $shelfA,
        'shelfB' => $shelfB,
        'manager' => $manager,
        'superAdmin' => $superAdmin,
        'readerA' => $readerA,
        'managerA' => $managerA,
        'readerB' => $readerB,
        'adminB' => $adminB,
        'readerARequest' => pcqPending($shelfA, $readerA, ['phone' => '0922222222'], ['phone' => '0911111111']),
        'managerARequest' => pcqPending($shelfA, $managerA, ['email' => 'dong@nghiep.vn']),
        'readerBRequest' => pcqPending($shelfB, $readerB, ['phone' => '0933333333']),
        'adminBRequest' => pcqPending($shelfB, $adminB, ['full_name' => 'Đỗ Văn Quản Trị Mới']),
    ];
}

it('the shelf queue holds READER subjects of this shelf, and nothing else', function () {
    $f = pcqFixture();

    $this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelfA']->slug}/manage/profile-changes")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/profile-changes')
            ->has('queue', 1)
            // The reader's, and BR:580's side-by-side pair on it.
            ->where('queue.0.requestId', $f['readerARequest']->id)
            ->where('queue.0.subjectName', 'Trần Thị Bạn Đọc')
            ->where('queue.0.fields.0.field', 'phone')
            ->where('queue.0.fields.0.current', '0911111111')
            ->where('queue.0.fields.0.proposed', '0922222222'));
});

it('a MANAGER subject\'s own change is absent from their shelf\'s queue — nobody present may decide it', function () {
    // The other side of the same predicate, asserted by identity rather
    // than by count: the count above would also pass if the queue held the
    // manager's request and dropped the reader's.
    $f = pcqFixture();

    $ids = collect($this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelfA']->slug}/manage/profile-changes")
        ->viewData('page')['props']['queue'])->pluck('requestId')->all();

    expect($ids)->toContain($f['readerARequest']->id)
        ->and($ids)->not->toContain($f['managerARequest']->id);
});

it('the cross-shelf queue holds MANAGER and ADMIN subjects anywhere, with the shelf on each card', function () {
    $f = pcqFixture();

    $this->actingAs($f['superAdmin'])
        ->get('/admin/profile-changes')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('admin/profile-changes')
            ->has('queue', 2)
            ->where('queue.0.requestId', $f['managerARequest']->id)
            ->where('queue.0.shelfName', $f['shelfA']->name)
            ->where('queue.0.subjectRole', 'manager')
            ->where('queue.1.requestId', $f['adminBRequest']->id)
            ->where('queue.1.shelfName', $f['shelfB']->name)
            ->where('queue.1.subjectRole', 'admin'));
});

it('the two queues PARTITION the pending set — every request in exactly one', function () {
    $f = pcqFixture();

    // Shelf A's queue, shelf B's queue, and the cross-shelf one. Together
    // they must name each of the four pending requests exactly once.
    $shelfAIds = collect($this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelfA']->slug}/manage/profile-changes")
        ->viewData('page')['props']['queue'])->pluck('requestId')->all();

    // A super administrator is admitted to any shelf's manage area
    // (Gate::before), which is what lets one test walk both shelves.
    $shelfBIds = collect($this->actingAs($f['superAdmin'])
        ->get("/shelves/{$f['shelfB']->slug}/manage/profile-changes")
        ->viewData('page')['props']['queue'])->pluck('requestId')->all();

    $adminIds = collect($this->actingAs($f['superAdmin'])
        ->get('/admin/profile-changes')
        ->viewData('page')['props']['queue'])->pluck('requestId')->all();

    $seen = [...$shelfAIds, ...$shelfBIds, ...$adminIds];

    $all = [
        $f['readerARequest']->id, $f['managerARequest']->id,
        $f['readerBRequest']->id, $f['adminBRequest']->id,
    ];

    // Exactly once each: set-equality with no duplicates is both halves of
    // the partition in one assertion — a request in both queues appears
    // twice, and a request in neither is missing.
    expect($seen)->toEqualCanonicalizing($all);
});

it('each badge equals its OWN queue\'s length, and the two are different numbers', function () {
    $f = pcqFixture();

    // Shelf A: one card, one badge. The manage badge and the admin badge
    // are both resolved on this render, and the admin one must NOT be the
    // shelf's number — a super administrator's own count belongs to a
    // different queue entirely.
    $this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelfA']->slug}/manage/profile-changes")
        ->assertInertia(fn (Assert $page) => $page
            ->has('queue', 1)
            ->where('pendingProfileChanges', 1)
            // Not a super administrator: no cross-shelf badge at all.
            ->where('pendingManagerProfileChanges', null));

    // The cross-shelf queue: TWO cards, two on the badge. Different from
    // the number above, so a badge wired to the wrong query is visible.
    $this->actingAs($f['superAdmin'])
        ->get('/admin/profile-changes')
        ->assertInertia(fn (Assert $page) => $page
            ->has('queue', 2)
            ->where('pendingManagerProfileChanges', 2));
});

it('the shelf badge counts THIS shelf only, not every shelf\'s readers', function () {
    // Shelf B holds one reader-subject request of its own. A badge counting
    // pending rows without the tenant would answer 2 on shelf A.
    $f = pcqFixture();

    $this->actingAs($f['superAdmin'])
        ->get("/shelves/{$f['shelfB']->slug}/manage/profile-changes")
        ->assertInertia(fn (Assert $page) => $page
            ->has('queue', 1)
            ->where('queue.0.requestId', $f['readerBRequest']->id)
            ->where('pendingProfileChanges', 1));
});

it('a manager approves from the queue, and may re-place the reader in the same act', function () {
    $f = pcqFixture();

    app(TenantContext::class)->clear();
    $unit = ParishUnit::factory()->for($f['shelfA'])->create(['level' => 1, 'parent_id' => null]);

    $this->actingAs($f['manager'])
        ->post("/shelves/{$f['shelfA']->slug}/manage/profile-changes/{$f['readerARequest']->id}/approve", [
            'parish_unit_l1_id' => $unit->id,
        ])
        ->assertRedirect("/shelves/{$f['shelfA']->slug}/manage/profile-changes");

    app(TenantContext::class)->clear();

    expect(ProfileChangeRequest::query()->withoutGlobalScopes()->find($f['readerARequest']->id)->status)
        ->toBe(ProfileChangeStatus::Approved)
        ->and(User::query()->find($f['readerA']->id)->phone)->toBe('0922222222')
        ->and(Membership::query()->withoutGlobalScopes()
            ->where('user_id', $f['readerA']->id)->first()->parish_unit_l1_id)
        ->toBe($unit->id);
});

it('approving with no unit keys leaves the placement alone', function () {
    // Absent and null are different answers to ApproveProfileChange, and a
    // page that always sent the pair would clear every reader's đơn vị on
    // approval. The bodiless POST is what pins that the queue can express
    // "leave it alone".
    $f = pcqFixture();

    app(TenantContext::class)->clear();
    $unit = ParishUnit::factory()->for($f['shelfA'])->create(['level' => 1, 'parent_id' => null]);
    Membership::query()->withoutGlobalScopes()
        ->where('user_id', $f['readerA']->id)
        ->update(['parish_unit_l1_id' => $unit->id]);

    $this->actingAs($f['manager'])
        ->post("/shelves/{$f['shelfA']->slug}/manage/profile-changes/{$f['readerARequest']->id}/approve")
        ->assertRedirect();

    expect(Membership::query()->withoutGlobalScopes()
        ->where('user_id', $f['readerA']->id)->first()->parish_unit_l1_id)
        ->toBe($unit->id);
});

it('rejecting from the queue requires a reason, and stores the one given', function () {
    $f = pcqFixture();

    $this->actingAs($f['manager'])
        ->post("/shelves/{$f['shelfA']->slug}/manage/profile-changes/{$f['readerARequest']->id}/reject", ['reason' => ''])
        ->assertSessionHasErrors('reason');

    app(TenantContext::class)->clear();
    expect(ProfileChangeRequest::query()->withoutGlobalScopes()->find($f['readerARequest']->id)->status)
        ->toBe(ProfileChangeStatus::Pending);

    $this->actingAs($f['manager'])
        ->post("/shelves/{$f['shelfA']->slug}/manage/profile-changes/{$f['readerARequest']->id}/reject", [
            'reason' => 'Số điện thoại chưa khớp với sổ giáo xứ.',
        ])
        ->assertRedirect();

    app(TenantContext::class)->clear();
    $row = ProfileChangeRequest::query()->withoutGlobalScopes()->find($f['readerARequest']->id);

    expect($row->status)->toBe(ProfileChangeStatus::Rejected)
        ->and($row->rejection_reason)->toBe('Số điện thoại chưa khớp với sổ giáo xứ.');
});

it('a request id from another parish 404s on the shelf route — the binding, not the command', function () {
    $f = pcqFixture();

    $this->actingAs($f['manager'])
        ->post("/shelves/{$f['shelfA']->slug}/manage/profile-changes/{$f['readerBRequest']->id}/reject", [
            'reason' => 'không thuộc tủ sách này',
        ])
        ->assertNotFound();
});

it('a manager cannot decide a peer manager\'s change even by posting its id', function () {
    // The queue hides the card; §9's routing rule is what actually refuses
    // it, and the refusal is a Vietnamese sentence over a redirect, never a
    // 403 (spec §5.4).
    $f = pcqFixture();

    $this->actingAs($f['manager'])
        ->post("/shelves/{$f['shelfA']->slug}/manage/profile-changes/{$f['managerARequest']->id}/approve")
        ->assertSessionHasErrors('rule');

    app(TenantContext::class)->clear();
    expect(ProfileChangeRequest::query()->withoutGlobalScopes()->find($f['managerARequest']->id)->status)
        ->toBe(ProfileChangeStatus::Pending);
});

it('a super administrator decides a manager-subject change from the cross-shelf queue', function () {
    $f = pcqFixture();

    $this->actingAs($f['superAdmin'])
        ->post("/admin/profile-changes/{$f['managerARequest']->id}/approve")
        ->assertRedirect('/admin/profile-changes');

    app(TenantContext::class)->clear();

    expect(ProfileChangeRequest::query()->withoutGlobalScopes()->find($f['managerARequest']->id)->status)
        ->toBe(ProfileChangeStatus::Approved)
        ->and(User::query()->find($f['managerA']->id)->email)->toBe('dong@nghiep.vn');
});

it('the cross-shelf reject carries its reason, and a blank one is refused', function () {
    $f = pcqFixture();

    $this->actingAs($f['superAdmin'])
        ->post("/admin/profile-changes/{$f['adminBRequest']->id}/reject", ['reason' => ''])
        ->assertSessionHasErrors('reason');

    $this->actingAs($f['superAdmin'])
        ->post("/admin/profile-changes/{$f['adminBRequest']->id}/reject", ['reason' => 'Xin gặp trực tiếp.'])
        ->assertRedirect('/admin/profile-changes');

    app(TenantContext::class)->clear();
    $row = ProfileChangeRequest::query()->withoutGlobalScopes()->find($f['adminBRequest']->id);

    expect($row->status)->toBe(ProfileChangeStatus::Rejected)
        ->and($row->rejection_reason)->toBe('Xin gặp trực tiếp.');
});

it('an unknown id on the cross-shelf route is a 404, not a 500', function () {
    $f = pcqFixture();

    $this->actingAs($f['superAdmin'])
        ->post('/admin/profile-changes/'.fake()->uuid().'/approve')
        ->assertNotFound();
});

it('a decided request leaves both queues and both badges', function () {
    // The predicates are `pending` AND a role; this is the half a role-only
    // predicate would get wrong.
    $f = pcqFixture();

    $this->actingAs($f['manager'])
        ->post("/shelves/{$f['shelfA']->slug}/manage/profile-changes/{$f['readerARequest']->id}/approve")
        ->assertRedirect();

    $this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelfA']->slug}/manage/profile-changes")
        ->assertInertia(fn (Assert $page) => $page
            ->has('queue', 0)
            ->where('pendingProfileChanges', 0));
});
