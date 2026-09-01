<?php

use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Gate;

/** @return array{Bookshelf, User, Membership} shelf, actor, a reader's membership */
function polFixture(string $role): array
{
    $shelf = Bookshelf::factory()->create(['settings' => []]);
    $actor = User::factory()->create();
    $actorMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $actor->id, 'role' => $role, 'status' => 'active',
    ]);
    $reader = Membership::factory()->for($shelf)->create(['status' => 'pending']);
    app(TenantContext::class)->set($shelf, $actorMembership);

    return [$shelf, $actor, $reader];
}

const MEMPOL_CLASS_ABILITIES = ['viewAny', 'create'];
const MEMPOL_ROW_ABILITIES = ['view', 'approve', 'reject', 'suspend', 'reactivate', 'markLeft', 'setCredentials', 'correct'];

it('a manager holds the whole members permission set', function () {
    [, $actor, $reader] = polFixture('manager');

    foreach (MEMPOL_CLASS_ABILITIES as $ability) {
        expect(Gate::forUser($actor)->allows($ability, Membership::class))->toBeTrue($ability);
    }
    foreach (MEMPOL_ROW_ABILITIES as $ability) {
        expect(Gate::forUser($actor)->allows($ability, $reader))->toBeTrue($ability);
    }
});

it('a reader holds none of it, their own membership included', function () {
    [, $actor, $reader] = polFixture('reader');

    foreach (MEMPOL_CLASS_ABILITIES as $ability) {
        expect(Gate::forUser($actor)->allows($ability, Membership::class))->toBeFalse($ability);
    }
    foreach (MEMPOL_ROW_ABILITIES as $ability) {
        expect(Gate::forUser($actor)->allows($ability, $reader))->toBeFalse($ability);
    }
});

it('a memberless super admin passes through Gate::before', function () {
    $shelf = Bookshelf::factory()->create(['settings' => []]);
    $admin = User::factory()->superAdmin()->create();
    $reader = Membership::factory()->for($shelf)->create();
    app(TenantContext::class)->set($shelf, null);

    expect(Gate::forUser($admin)->allows('approve', $reader))->toBeTrue()
        ->and(Gate::forUser($admin)->allows('viewAny', Membership::class))->toBeTrue();
});

it('a suspended manager is nobody', function () {
    $shelf = Bookshelf::factory()->create(['settings' => []]);
    $actor = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->manager()->create([
        'user_id' => $actor->id, 'status' => 'suspended',
    ]);
    app(TenantContext::class)->set($shelf, $membership);

    expect(Gate::forUser($actor)->allows('viewAny', Membership::class))->toBeFalse();
});

// ── Cross-shelf identity reuse (BR §5.3) ────────────────────────────────
// One User row, two memberships at two different shelves, different roles.
// The manager abilities earned at shelf B must not follow the same user
// over to shelf A, and vice versa — TenantContext (not the User row) is
// the only thing the act-as gates read, so switching the bound membership
// must switch the answer.
it('a reader at one shelf and a manager at another gets the right abilities at each, never both at once', function () {
    $shelfA = Bookshelf::factory()->create(['settings' => []]);
    $shelfB = Bookshelf::factory()->create(['settings' => []]);
    $user = User::factory()->create();
    $readerAtA = Membership::factory()->for($shelfA)->create([
        'user_id' => $user->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $managerAtB = Membership::factory()->for($shelfB)->manager()->create([
        'user_id' => $user->id, 'status' => 'active',
    ]);

    app(TenantContext::class)->set($shelfA, $readerAtA);
    expect(Gate::forUser($user)->allows('viewAny', Membership::class))->toBeFalse();

    app(TenantContext::class)->set($shelfB, $managerAtB);
    expect(Gate::forUser($user)->allows('viewAny', Membership::class))->toBeTrue();
});

// ── Cross-shelf 404 layer (BookshelfScope, not the policy) ──────────────
// The policy's row methods take no shelf re-check on purpose — under a
// bound tenant, BookshelfScope means a foreign shelf's membership cannot
// have been resolved into a $membership argument at all. Prove that here
// at the model layer, independent of the policy: a manager bound to shelf
// A cannot resolve shelf B's membership row by id, whether through a bare
// Membership::find() or through the {reader} route's own relation guess.
it('a manager at shelf A cannot resolve a membership that belongs to shelf B', function () {
    $shelfA = Bookshelf::factory()->create(['settings' => []]);
    $shelfB = Bookshelf::factory()->create(['settings' => []]);
    $actor = User::factory()->create();
    $managerAtA = Membership::factory()->for($shelfA)->manager()->create([
        'user_id' => $actor->id, 'status' => 'active',
    ]);
    $memberAtB = Membership::factory()->for($shelfB)->create();

    app(TenantContext::class)->set($shelfA, $managerAtA);

    // Both layers agree the row is unreachable: the bare lookup (guarded by
    // BookshelfScope alone) and the {reader} route's own relation guess
    // (guarded by the FK filter AND BookshelfScope). The policy is
    // deliberately not part of this: it is only ever handed a $membership
    // that one of these two already refused to resolve.
    expect(Membership::find($memberAtB->id))->toBeNull()
        ->and($shelfA->readers()->find($memberAtB->id))->toBeNull();
});

// ── viewSelf, Phase 3c-i Task 1 (spec D7/D11) ───────────────────────────
// The one ability in this policy a reader ever passes, and the one that
// reads TenantContext rather than only a gate. Deliberately NOT added to
// MEMPOL_ROW_ABILITIES above: those two blocks assert a reader holds none
// of the manager set, and this ability is precisely the exception.
it('viewSelf admits a reader to their OWN membership and refuses every other row', function () {
    [$shelf, $actor] = polFixture('reader');
    $own = app(TenantContext::class)->membership();
    $somebodyElse = Membership::factory()->for($shelf)->create(['status' => 'active']);

    expect($own)->not->toBeNull()
        ->and(Gate::forUser($actor)->allows('viewSelf', $own))->toBeTrue()
        ->and(Gate::forUser($actor)->allows('viewSelf', $somebodyElse))->toBeFalse()
        // The mistake MembershipPolicy's docblock has warned against since
        // Task 16: `view` is act-as-manager only, so wiring the reader's
        // own profile page to it hands every reader a permanent 403.
        ->and(Gate::forUser($actor)->allows('view', $own))->toBeFalse();
});

it('viewSelf admits a manager to a row that is not theirs — the "or manager" half', function () {
    [, $actor, $reader] = polFixture('manager');

    expect(Gate::forUser($actor)->allows('viewSelf', $reader))->toBeTrue();
});

it('viewSelf refuses a reader whose own membership is on a DIFFERENT shelf', function () {
    // The self check compares membership ids, not user ids, and this is
    // why: one person, two parishes, two rows with two roles and two
    // parish units. A user-id comparison would say yes to the wrong row.
    $shelfA = Bookshelf::factory()->create(['settings' => []]);
    $shelfB = Bookshelf::factory()->create(['settings' => []]);
    $user = User::factory()->create();
    $atA = Membership::factory()->for($shelfA)->create(['user_id' => $user->id, 'status' => 'active']);
    $atB = Membership::factory()->for($shelfB)->create(['user_id' => $user->id, 'status' => 'active']);

    app(TenantContext::class)->set($shelfA, $atA);

    expect(Gate::forUser($user)->allows('viewSelf', $atA))->toBeTrue()
        ->and(Gate::forUser($user)->allows('viewSelf', $atB))->toBeFalse();
});

it('viewSelf does not let a NULL own-membership match a row by accident', function () {
    // A memberless caller has TenantContext::membership() === null. The
    // null guard is what stops that comparing equal to anything; a
    // memberless SUPER ADMIN still passes, on the manager half.
    $shelf = Bookshelf::factory()->create(['settings' => []]);
    $stranger = User::factory()->create();
    $admin = User::factory()->superAdmin()->create();
    $someRow = Membership::factory()->for($shelf)->create(['status' => 'active']);
    app(TenantContext::class)->set($shelf, null);

    expect(Gate::forUser($stranger)->allows('viewSelf', $someRow))->toBeFalse()
        ->and(Gate::forUser($admin)->allows('viewSelf', $someRow))->toBeTrue();
});
