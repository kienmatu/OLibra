<?php

use App\Enums\BookshelfStatus;
use App\Enums\MembershipRole;
use App\Enums\MembershipStatus;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Queries\Admin\AdminOverviewQuery;
use App\Support\TenantContext;

/**
 * `managersMissing` — spec D6's whole defence, and this file is its only
 * coverage.
 *
 * Revoking a shelf's LAST manager is permitted: the reference counts
 * nothing and this port invented no refusal. What makes that defensible
 * rather than a hole is that `/admin/shelves` says so afterwards, and Task 3
 * built the flag but was forbidden from asserting its value, precisely so
 * that the assertion would land here — against the act that produces it
 * rather than against a fixture arranged to match the predicate.
 *
 * SIX CASES, MEASURED against six mutations of the predicate
 * (`AdminOverviewQuery`'s manager aggregate), one mutation at a time:
 *
 * | mutation | which cases go red |
 * |---|---|
 * | drop the role filter | revoked, readers-only |
 * | drop the status filter | suspended manager |
 * | drop the surviving-user constraint | soft-deleted user |
 * | admit `reader` in the role filter | revoked, readers-only |
 * | count only `manager`, never `admin` | active shelf admin |
 * | drop the active-shelf gate | archived shelf |
 *
 * So four of the six cases are the sole witness to their own clause, and
 * removing any clause of the predicate turns this file red.
 *
 * THE REVOKED AND READERS-ONLY ROWS SHARE THEIR MUTATIONS, and that is not
 * a gap to be closed by inventing a seventh: after a revoke the shelf IS a
 * readers-only shelf, so no predicate can tell the two end states apart.
 * What the revoked row adds is not a clause but a DIRECTION — it asserts
 * the flag reads false before the act and true after it, through the real
 * route, so the flag is pinned to the act that produces it rather than to a
 * fixture arranged to match the predicate. A fixture-only file could not
 * show that at all.
 *
 * The readers-only row is the proxy mistake worth pinning by itself: the
 * `readers` figure beside this one counts every active membership
 * INCLUDING managers, so a shelf with fifty readers and no manager reads
 * fifty there and is indistinguishable from a well-staffed one.
 *
 * Grep first: `grep -rn "^function managersMissingFor" tests/`.
 */
function managersMissingFor(string $slug): bool
{
    /** @var list<array{slug: string, managersMissing: bool}> $rows */
    $rows = app(AdminOverviewQuery::class)->run();

    /** @var array{managersMissing: bool} $row */
    $row = collect($rows)->firstWhere('slug', $slug);

    return $row['managersMissing'];
}

/** Grep first: `grep -rn "^function managersMissingShelf" tests/`. */
function managersMissingShelf(string $slug): Bookshelf
{
    app(TenantContext::class)->actSystemWide();

    return Bookshelf::factory()->create([
        'slug' => $slug,
        'name' => 'Tủ sách '.$slug,
        'settings' => [],
    ]);
}

it('flags a shelf whose only manager was revoked — through the revoke path, not a fixture', function () {
    $shelf = managersMissingShelf('bi-thu-hoi');
    app(TenantContext::class)->actSystemWide();
    $admin = User::factory()->create(['is_super_admin' => true]);
    $person = User::factory()->create(['full_name' => 'Mai Văn Quản']);
    $membership = Membership::factory()->create([
        'bookshelf_id' => $shelf->id,
        'user_id' => $person->id,
        'role' => MembershipRole::Manager,
        'status' => MembershipStatus::Active,
    ]);

    // Manned before the act.
    expect(managersMissingFor('bi-thu-hoi'))->toBeFalse();

    $this->actingAs($admin)
        ->post("/admin/managers/{$shelf->slug}/{$membership->id}/revoke")
        ->assertRedirect('/admin/managers');

    // Unmanned after it — and the row survived as a reader, so the shelf is
    // not short of MEMBERS, only of somebody who can act.
    app(TenantContext::class)->actSystemWide();

    expect(managersMissingFor('bi-thu-hoi'))->toBeTrue()
        ->and($shelf->memberships()->sole()->role)->toBe(MembershipRole::Reader);
});

it('flags a shelf whose only manager is suspended', function () {
    // Spec D6 raises this case by name. A suspended manager cannot act —
    // the act-as gates read status, not role alone — so the shelf is as
    // unmanned as one with nobody at all.
    $shelf = managersMissingShelf('quan-ly-bi-khoa');
    app(TenantContext::class)->actSystemWide();
    Membership::factory()->create([
        'bookshelf_id' => $shelf->id,
        'user_id' => User::factory()->create()->id,
        'role' => MembershipRole::Manager,
        'status' => MembershipStatus::Suspended,
    ]);

    expect(managersMissingFor('quan-ly-bi-khoa'))->toBeTrue();
});

it('flags a shelf whose only manager has had their user row soft-deleted', function () {
    $shelf = managersMissingShelf('quan-ly-da-xoa');
    app(TenantContext::class)->actSystemWide();
    $person = User::factory()->create();
    Membership::factory()->create([
        'bookshelf_id' => $shelf->id,
        'user_id' => $person->id,
        'role' => MembershipRole::Manager,
        'status' => MembershipStatus::Active,
    ]);

    expect(managersMissingFor('quan-ly-da-xoa'))->toBeFalse();

    // The membership survives its person, and a grant nobody holds is no
    // grant. `readers` carries the same constraint, for the same reason.
    $person->delete();

    expect(managersMissingFor('quan-ly-da-xoa'))->toBeTrue();
});

it('does not flag a shelf held by an active shelf admin', function () {
    // Rank 3 is a real grant (spec D7), so a predicate that counted only
    // `manager` would report a well-run shelf as unmanned.
    $shelf = managersMissingShelf('co-quan-tri');
    app(TenantContext::class)->actSystemWide();
    Membership::factory()->create([
        'bookshelf_id' => $shelf->id,
        'user_id' => User::factory()->create()->id,
        'role' => MembershipRole::Admin,
        'status' => MembershipStatus::Active,
    ]);

    expect(managersMissingFor('co-quan-tri'))->toBeFalse();
});

it('does NOT flag an archived shelf, however unmanned it is', function () {
    // The fix wave's finding 6. The flag is an alarm, and this one could
    // not be cleared: BookshelfPolicy::assignManager() 404s an archived
    // shelf and ManagerCandidatesQuery does not offer one, so there is no
    // control anywhere in the application that answers it. What D6 defends
    // is a shelf that is OPEN and that nobody can run; a shelf deliberately
    // taken out of service is not that, and flagging it is noise beside the
    // rows a volunteer can actually act on.
    //
    // Through the archive ROUTE, not a fixture status: the point is that
    // the act of archiving clears the alarm, which is what a volunteer
    // pressing the button on the row expects to happen.
    $shelf = managersMissingShelf('da-ngung-hoat-dong');
    app(TenantContext::class)->actSystemWide();
    $admin = User::factory()->create(['is_super_admin' => true]);

    // Unmanned and active — the alarm is on.
    expect(managersMissingFor('da-ngung-hoat-dong'))->toBeTrue();

    $this->actingAs($admin)
        ->post("/admin/shelves/{$shelf->slug}/archive")
        ->assertRedirect('/admin/shelves');

    app(TenantContext::class)->actSystemWide();

    // Still unmanned — nothing was appointed — but no longer an alarm.
    expect($shelf->fresh()->status)->toBe(BookshelfStatus::Archived)
        ->and(managersMissingFor('da-ngung-hoat-dong'))->toBeFalse();
});

it('flags a shelf that has readers only, however many of them', function () {
    // The proxy mistake, pinned: `readers` counts active memberships
    // INCLUDING managers, so three readers and no manager reads three
    // there — a number a well-staffed shelf could equally produce.
    $shelf = managersMissingShelf('chi-co-doc-gia');
    app(TenantContext::class)->actSystemWide();

    foreach (range(1, 3) as $ignored) {
        Membership::factory()->create([
            'bookshelf_id' => $shelf->id,
            'user_id' => User::factory()->create()->id,
            'role' => MembershipRole::Reader,
            'status' => MembershipStatus::Active,
        ]);
    }

    /** @var list<array{slug: string, readers: int, managersMissing: bool}> $rows */
    $rows = app(AdminOverviewQuery::class)->run();
    /** @var array{readers: int, managersMissing: bool} $row */
    $row = collect($rows)->firstWhere('slug', 'chi-co-doc-gia');

    expect($row['managersMissing'])->toBeTrue()
        ->and($row['readers'])->toBe(3);
});
