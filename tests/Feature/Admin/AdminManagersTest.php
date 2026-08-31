<?php

use App\Enums\BookshelfStatus;
use App\Enums\MembershipRole;
use App\Enums\MembershipStatus;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
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
