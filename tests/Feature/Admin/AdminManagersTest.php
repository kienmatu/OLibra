<?php

use App\Enums\BookshelfStatus;
use App\Enums\MembershipRole;
use App\Enums\MembershipStatus;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Queries\Admin\AdminOverviewQuery;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * Task 7 — `/admin/managers`, the last placeholder in the admin area, and
 * the three grants of OPS §4.5 (spec D5, D7).
 *
 * `managersMissing` is covered in its own file
 * (`AdminManagersMissingTest`), because it is a property of a QUERY the
 * revoke path happens to move rather than a property of these routes, and
 * its five cases each want their own fixture.
 *
 * Grep first: `grep -rn "^function adminManagersFix" tests/`.
 *
 * @return array{User, Bookshelf}
 */
function adminManagersFix(string $slug = 'quan-ly-vien', BookshelfStatus $status = BookshelfStatus::Active): array
{
    // The /admin group binds no tenant, and a factory runs outside a
    // request — the same reason every other admin fixture widens first.
    app(TenantContext::class)->actSystemWide();

    $shelf = Bookshelf::factory()->create([
        'slug' => $slug,
        'name' => 'Tủ sách '.$slug,
        'settings' => [],
        'status' => $status,
    ]);

    return [User::factory()->create(['is_super_admin' => true]), $shelf];
}

/** A membership on $shelf at $role, with a real person behind it. */
function adminManagersMember(Bookshelf $shelf, MembershipRole $role, string $name, MembershipStatus $status = MembershipStatus::Active): Membership
{
    app(TenantContext::class)->actSystemWide();

    $person = User::factory()->create(['full_name' => $name]);

    return Membership::factory()->create([
        'bookshelf_id' => $shelf->id,
        'user_id' => $person->id,
        'role' => $role,
        'status' => $status,
    ]);
}

it('renders the real managers list, not the placeholder', function () {
    [$admin, $shelf] = adminManagersFix();
    adminManagersMember($shelf, MembershipRole::Manager, 'Nguyễn Văn Quản');
    // A reader is not a manager and must not be listed — the near miss the
    // whole screen turns on.
    adminManagersMember($shelf, MembershipRole::Reader, 'Trần Thị Đọc');

    $this->actingAs($admin)
        ->get('/admin/managers')
        ->assertInertia(function (AssertableInertia $page) use ($admin, $shelf) {
            $page->component('admin/managers/index');

            /** @var list<array<string, mixed>> $rows */
            $rows = $page->toArray()['props']['managers'];
            $names = array_column($rows, 'fullName');

            // The super administrator is in the list, holding no shelf.
            expect($names)->toContain($admin->full_name)
                ->and($names)->toContain('Nguyễn Văn Quản')
                ->and($names)->not->toContain('Trần Thị Đọc');

            $manager = collect($rows)->firstWhere('fullName', 'Nguyễn Văn Quản');
            $global = collect($rows)->firstWhere('fullName', $admin->full_name);

            expect($manager['role'])->toBe('manager')
                ->and($manager['shelfId'])->toBe($shelf->id)
                ->and($manager['membershipId'])->not->toBeNull()
                // No demotion command exists, so the global row carries no
                // membership to revoke and no confirmation to show.
                ->and($global['role'])->toBe('super_admin')
                ->and($global['membershipId'])->toBeNull()
                ->and($global['shelfId'])->toBeNull()
                ->and($global['revokeConfirmation'])->toBeNull();
        });
});

it('sends the shelf ROUTE KEY down with both the list and the appoint form', function () {
    // Bookshelf::getRouteKeyName is 'slug', so every admin URL naming a
    // shelf is built from the slug. A prop carrying only the id would let
    // both controls build a path that binds nothing — a 404 on every
    // appointment and every revocation, with every server-side test still
    // green, because those post their URLs directly.
    [$admin, $shelf] = adminManagersFix('duong-dan-tu-sach');
    adminManagersMember($shelf, MembershipRole::Manager, 'Vương Văn Quản');
    adminManagersMember($shelf, MembershipRole::Reader, 'Tạ Thị Đọc');

    $this->actingAs($admin)
        ->get('/admin/managers')
        ->assertInertia(function (AssertableInertia $page) use ($shelf) {
            $props = $page->toArray()['props'];

            /** @var list<array<string, mixed>> $managers */
            $managers = $props['managers'];
            /** @var list<array<string, mixed>> $appointable */
            $appointable = $props['appointable'];

            $manager = collect($managers)->firstWhere('fullName', 'Vương Văn Quản');
            $offered = collect($appointable)->firstWhere('shelfId', $shelf->id);

            expect($manager['shelfSlug'])->toBe($shelf->slug)
                ->and($offered['slug'])->toBe($shelf->slug)
                // And the form's second select is fed from the same entry.
                ->and(array_column($offered['candidates'], 'fullName'))->toBe(['Tạ Thị Đọc']);
        });
});

it('gives a super admin who also manages a shelf both rows, and marks both unpromotable', function () {
    // The fix wave's finding 2. This query emits a global row for every
    // super administrator AND a row for every manager/admin membership,
    // with no exclusion between them — which is correct: the shelf grant is
    // real and genuinely revocable, so dropping either row would either
    // hide a grant or remove the only control that takes it back.
    //
    // What was wrong was the SCREEN's promote gate, which read `role`. On
    // the membership row the role is `manager`, so the control rendered,
    // and pressing it threw `already_super_admin` — a live button whose
    // only outcome was a refusal. The gate now reads `isSuperAdmin`, a fact
    // about the person that only the server can state, and this asserts the
    // prop that makes it possible. The refusal behind it is pinned by
    // 'refuses to promote somebody who is already a super admin'.
    [$admin, $shelf] = adminManagersFix('vua-quan-tri-vua-quan-ly');
    app(TenantContext::class)->actSystemWide();
    Membership::factory()->create([
        'bookshelf_id' => $shelf->id,
        'user_id' => $admin->id,
        'role' => MembershipRole::Manager,
        'status' => MembershipStatus::Active,
    ]);

    $this->actingAs($admin)
        ->get('/admin/managers')
        ->assertInertia(function (AssertableInertia $page) use ($admin, $shelf) {
            /** @var list<array<string, mixed>> $rows */
            $rows = $page->toArray()['props']['managers'];
            $mine = array_values(array_filter($rows, fn (array $row): bool => $row['userId'] === $admin->id));

            expect($mine)->toHaveCount(2);

            $global = collect($mine)->firstWhere('membershipId', null);
            $onShelf = collect($mine)->first(fn (array $row): bool => $row['membershipId'] !== null);

            // The shelf row still reads `manager` — the role is a fact
            // about the membership and did not change — so a gate on the
            // role alone would still render the button here.
            expect($onShelf['role'])->toBe('manager')
                ->and($onShelf['shelfId'])->toBe($shelf->id)
                // Revocable, and that is why the row must survive.
                ->and($onShelf['revokeConfirmation'])->not->toBeNull()
                // Both rows say the person already holds the global grant.
                ->and($onShelf['isSuperAdmin'])->toBeTrue()
                ->and($global['isSuperAdmin'])->toBeTrue();
        });
});

it('agrees with /admin/shelves about a suspended manager rather than contradicting it', function () {
    // The fix wave's finding 5. AdminOverviewQuery counts ACTIVE
    // memberships, so a shelf whose only manager is suspended is flagged
    // `managersMissing` — spec D6 names that case by name, and
    // known-gaps.md rests D6's whole defensibility on the flag. This query
    // filters by role alone, so the same person was listed here with a live
    // Revoke button: two admin screens telling a volunteer opposite things
    // about the same shelf.
    //
    // THE ROW STAYS, and the status is what reconciles them. A suspended
    // grant is still a grant somebody holds; hiding the row would make it
    // invisible AND unrevocable, since the revoke control lives on it. So
    // the list keeps the person, states the status, and the screen prints
    // the sentence explaining why the other screen is raising the alarm.
    [$admin, $shelf] = adminManagersFix('quan-ly-tam-khoa');
    adminManagersMember($shelf, MembershipRole::Manager, 'Hồ Thị Tạm Khoá', MembershipStatus::Suspended);

    /** @var list<array{slug: string, managersMissing: bool}> $overview */
    $overview = app(AdminOverviewQuery::class)->run();
    /** @var array{managersMissing: bool} $row */
    $row = collect($overview)->firstWhere('slug', 'quan-ly-tam-khoa');

    // /admin/shelves says the shelf has nobody who can act.
    expect($row['managersMissing'])->toBeTrue();

    $this->actingAs($admin)
        ->get('/admin/managers')
        ->assertInertia(function (AssertableInertia $page) {
            /** @var list<array<string, mixed>> $rows */
            $rows = $page->toArray()['props']['managers'];
            $suspended = collect($rows)->firstWhere('fullName', 'Hồ Thị Tạm Khoá');

            // /admin/managers still lists them — and says why.
            expect($suspended)->not->toBeNull()
                ->and($suspended['status'])->toBe('suspended')
                // Still revocable: an unusable grant is exactly the one
                // worth taking back.
                ->and($suspended['revokeConfirmation'])->not->toBeNull();
        });
});

it('appoints a reader as a manager and writes membership.role_assigned', function () {
    [$admin, $shelf] = adminManagersFix('giao-quyen');
    $reader = adminManagersMember($shelf, MembershipRole::Reader, 'Lê Thị Bạn Đọc');

    $this->actingAs($admin)
        ->post("/admin/managers/{$shelf->slug}", [
            'user_id' => $reader->user_id,
            'role' => 'manager',
        ])
        ->assertRedirect('/admin/managers');

    app(TenantContext::class)->actSystemWide();

    // The SAME row, promoted — never a second membership. A person holds at
    // most one role per shelf (§4 assumption 8).
    expect($shelf->memberships()->count())->toBe(1)
        ->and($shelf->memberships()->sole()->id)->toBe($reader->id)
        ->and($shelf->memberships()->sole()->role)->toBe(MembershipRole::Manager);

    $row = AuditLog::query()->where('action', 'membership.role_assigned')->sole();

    expect($row->bookshelf_id)->toBe($shelf->id)
        ->and($row->entity_type)->toBe('membership')
        ->and($row->entity_id)->toBe($reader->id)
        ->and($row->before['role'])->toBe('reader')
        ->and($row->after['role'])->toBe('manager')
        ->and($row->after['subject'])->toBe('Lê Thị Bạn Đọc');
});

it('appoints at the admin role too, and makes a pending applicant active', function () {
    // Spec D7: the form offers a choice of two roles, and rank 3 is a real
    // grant rather than a synonym for manager.
    [$admin, $shelf] = adminManagersFix('quan-tri-tu-sach');
    $pending = adminManagersMember(
        $shelf, MembershipRole::Reader, 'Phạm Văn Chờ', MembershipStatus::Pending,
    );

    $this->actingAs($admin)
        ->post("/admin/managers/{$shelf->slug}", [
            'user_id' => $pending->user_id,
            'role' => 'admin',
        ])
        ->assertRedirect('/admin/managers');

    app(TenantContext::class)->actSystemWide();
    $after = $shelf->memberships()->sole();

    // Active, not pending: somebody handed the keys must not be left in the
    // approval queue they are now meant to be working.
    expect($after->role)->toBe(MembershipRole::Admin)
        ->and($after->status)->toBe(MembershipStatus::Active);
});

it('creates a membership when the person has none at that shelf, stamped with the shelf', function () {
    [$admin, $shelf] = adminManagersFix('nguoi-moi');
    app(TenantContext::class)->actSystemWide();
    $stranger = User::factory()->create(['full_name' => 'Vũ Thị Mới']);

    $this->actingAs($admin)
        ->post("/admin/managers/{$shelf->slug}", [
            'user_id' => $stranger->id,
            'role' => 'manager',
        ])
        ->assertRedirect('/admin/managers');

    app(TenantContext::class)->actSystemWide();
    $created = $shelf->memberships()->sole();

    // The shelf column is stamped from the RELATION, not from the creating
    // hook — under a widening that hook returns without stamping anything,
    // so a create spelled any other way would write a row belonging to no
    // parish at all.
    expect($created->bookshelf_id)->toBe($shelf->id)
        ->and($created->user_id)->toBe($stranger->id)
        ->and($created->role)->toBe(MembershipRole::Manager);
});

it('refuses an appointment on an archived shelf as a 404 and writes nothing', function () {
    [$admin, $shelf] = adminManagersFix('da-luu-tru', BookshelfStatus::Archived);
    $reader = adminManagersMember($shelf, MembershipRole::Reader, 'Đỗ Văn Kho');

    $this->actingAs($admin)
        ->post("/admin/managers/{$shelf->slug}", [
            'user_id' => $reader->user_id,
            'role' => 'manager',
        ])
        ->assertNotFound();

    app(TenantContext::class)->actSystemWide();

    // A grant on an archived shelf is void on arrival: nobody can ever
    // exercise it, and the redirect would look like every other success.
    expect($shelf->memberships()->sole()->role)->toBe(MembershipRole::Reader)
        ->and(AuditLog::query()->where('action', 'membership.role_assigned')->count())->toBe(0);
});

it('revokes by DEMOTING: the membership row survives, id unchanged, and its history still resolves', function () {
    [$admin, $shelf] = adminManagersFix('thu-hoi');
    $manager = adminManagersMember($shelf, MembershipRole::Manager, 'Hoàng Văn Quản');
    $membershipId = $manager->id;

    // A row that names this membership from before the revoke. If revoke
    // deleted instead of demoting, this is the history BR §16.4's
    // confirmation promises is retained — and the promise would be false.
    app(TenantContext::class)->actSystemWide();
    AuditLog::query()->create([
        'bookshelf_id' => $shelf->id,
        'actor_id' => $admin->id,
        'action' => 'membership.approved',
        'entity_type' => 'membership',
        'entity_id' => $membershipId,
        'before' => null,
        'after' => ['status' => 'active'],
        'context' => [],
        'occurred_at' => now(),
    ]);

    $this->actingAs($admin)
        ->post("/admin/managers/{$shelf->slug}/{$membershipId}/revoke")
        ->assertRedirect('/admin/managers');

    app(TenantContext::class)->actSystemWide();
    $after = $shelf->memberships()->find($membershipId);

    expect($after)->not->toBeNull()
        ->and($after->id)->toBe($membershipId)
        ->and($after->role)->toBe(MembershipRole::Reader)
        // Still a member in good standing — only the grant went.
        ->and($after->status)->toBe(MembershipStatus::Active)
        ->and($after->deleted_at)->toBeNull();

    // The earlier row still resolves to a membership that exists.
    $earlier = AuditLog::query()->where('action', 'membership.approved')->sole();
    expect($shelf->memberships()->find($earlier->entity_id))->not->toBeNull();

    $row = AuditLog::query()->where('action', 'membership.role_revoked')->sole();

    expect($row->bookshelf_id)->toBe($shelf->id)
        ->and($row->entity_id)->toBe($membershipId)
        ->and($row->before['role'])->toBe('manager')
        ->and($row->after['role'])->toBe('reader')
        ->and($row->after['subject'])->toBe('Hoàng Văn Quản');
});

it('refuses to revoke somebody who is already a reader', function () {
    [$admin, $shelf] = adminManagersFix('da-la-doc-gia');
    $reader = adminManagersMember($shelf, MembershipRole::Reader, 'Bùi Thị Đọc');

    $this->actingAs($admin)
        ->from('/admin/managers')
        ->post("/admin/managers/{$shelf->slug}/{$reader->id}/revoke")
        ->assertRedirect('/admin/managers')
        ->assertSessionHasErrors(['rule' => __('rules.not_a_manager')]);

    // No audit row: the whole objection to permitting this is that it would
    // record a revocation that took nothing.
    expect(AuditLog::query()->where('action', 'membership.role_revoked')->count())->toBe(0);
});

it('refuses to revoke a membership belonging to another shelf', function () {
    [$admin, $mine] = adminManagersFix('tu-sach-cua-toi');
    [, $theirs] = adminManagersFix('tu-sach-cua-ho');
    $theirManager = adminManagersMember($theirs, MembershipRole::Manager, 'Ngô Văn Xa');

    // The membership id is real; the shelf in the URL is not its shelf.
    // Under a widening nothing narrows a bare find(), so this is what the
    // shelf's own relation is for.
    $this->actingAs($admin)
        ->from('/admin/managers')
        ->post("/admin/managers/{$mine->slug}/{$theirManager->id}/revoke")
        ->assertSessionHasErrors(['rule' => __('rules.membership_not_found')]);

    app(TenantContext::class)->actSystemWide();
    expect($theirs->memberships()->sole()->role)->toBe(MembershipRole::Manager);
});

it('states, in Vietnamese, that history is retained — naming the person and the shelf', function () {
    // BR §16.4. The RENDERED prop, not the presence of a lang key: a key
    // the screen never substituted into would leave this requirement
    // unmet with the key still present and correct.
    [$admin, $shelf] = adminManagersFix('xac-nhan');
    adminManagersMember($shelf, MembershipRole::Manager, 'Trịnh Văn Quản');

    $this->actingAs($admin)
        ->get('/admin/managers')
        ->assertInertia(function (AssertableInertia $page) use ($shelf) {
            /** @var list<array<string, mixed>> $rows */
            $rows = $page->toArray()['props']['managers'];
            $manager = collect($rows)->firstWhere('fullName', 'Trịnh Văn Quản');

            /** @var string $sentence */
            $sentence = $manager['revokeConfirmation'];

            expect($sentence)->toContain('Trịnh Văn Quản')
                ->and($sentence)->toContain($shelf->name)
                // "Toàn bộ lịch sử ... đều được giữ lại" — the requirement
                // is that it says history is KEPT, so that is the phrase
                // asserted rather than the whole sentence.
                ->and($sentence)->toContain('được giữ lại')
                // No unsubstituted placeholder left behind.
                ->and($sentence)->not->toContain(':name')
                ->and($sentence)->not->toContain(':shelf');
        });
});

it('promotes a person to super admin: the FLAG is set, and the audit row belongs to no shelf', function () {
    [$admin, $shelf] = adminManagersFix('toan-quyen');
    $manager = adminManagersMember($shelf, MembershipRole::Manager, 'Đinh Văn Tân');

    $this->actingAs($admin)
        ->post("/admin/managers/{$manager->user_id}/promote")
        ->assertRedirect('/admin/managers');

    // THE FLAG, asserted first and on its own. is_super_admin is not
    // mass-assignable, so an update() spelling would silently do nothing
    // and return true — and every audit assertion below would still pass.
    expect(User::query()->findOrFail($manager->user_id)->is_super_admin)->toBeTrue();

    $row = AuditLog::query()->where('action', 'user.promoted_super_admin')->sole();

    // NULL, not the shelf: this is a fact about a person and about the
    // installation, and it is the reason the audit configurator exists.
    expect($row->bookshelf_id)->toBeNull()
        ->and($row->entity_type)->toBe('user')
        ->and($row->entity_id)->toBe($manager->user_id)
        ->and($row->before['is_super_admin'])->toBeFalse()
        ->and($row->after['is_super_admin'])->toBeTrue()
        ->and($row->after['subject'])->toBe('Đinh Văn Tân');
});

it('refuses to promote somebody who is already a super admin', function () {
    [$admin] = adminManagersFix('da-la-quan-tri');
    app(TenantContext::class)->actSystemWide();
    $other = User::factory()->create(['is_super_admin' => true, 'full_name' => 'Cao Thị Quản Trị']);

    $this->actingAs($admin)
        ->from('/admin/managers')
        ->post("/admin/managers/{$other->id}/promote")
        ->assertSessionHasErrors(['rule' => __('rules.already_super_admin')]);

    expect(AuditLog::query()->where('action', 'user.promoted_super_admin')->count())->toBe(0);
});

it('refuses every one of the three grants to somebody who is not a super admin', function () {
    [, $shelf] = adminManagersFix('nguoi-la');
    $manager = adminManagersMember($shelf, MembershipRole::Manager, 'Lý Văn Quản');
    app(TenantContext::class)->actSystemWide();
    $stranger = User::factory()->create();

    // 404 rather than 403 throughout — EnsureSuperAdmin's shape, so a
    // stranger cannot learn from a status code that any of these rows
    // exist.
    $this->actingAs($stranger)->get('/admin/managers')->assertNotFound();
    $this->actingAs($stranger)
        ->post("/admin/managers/{$shelf->slug}", ['user_id' => $manager->user_id, 'role' => 'manager'])
        ->assertNotFound();
    $this->actingAs($stranger)
        ->post("/admin/managers/{$shelf->slug}/{$manager->id}/revoke")
        ->assertNotFound();
    $this->actingAs($stranger)
        ->post("/admin/managers/{$manager->user_id}/promote")
        ->assertNotFound();

    app(TenantContext::class)->actSystemWide();
    expect($shelf->memberships()->sole()->role)->toBe(MembershipRole::Manager)
        ->and(User::query()->findOrFail($manager->user_id)->is_super_admin)->toBeFalse()
        ->and(AuditLog::query()->count())->toBe(0);
});
