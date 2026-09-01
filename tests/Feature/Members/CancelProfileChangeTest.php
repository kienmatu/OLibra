<?php

use App\Actions\Admin\CancelProfileChange;
use App\Enums\ProfileChangeStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Phase 3c-i Task 4 — cancelling (spec D4).
 *
 * THE OBVIOUS READING IS THE WRONG ONE, and these tests exist to hold the
 * reversed one:
 *
 *  - cancelling IS governed by the subject-role rule, so a manager may not
 *    cancel a peer manager's own pending change — only a super
 *    administrator may;
 *  - the ONE exemption is the self case, at every rank, because withdrawing
 *    your own request has no second party to it;
 *  - and that self-check compares MEMBERSHIP ids, where the decision pair
 *    compares user ids. The asymmetry is deliberate.
 */

/** @return array{Bookshelf, User, Membership} A shelf, a person, and their membership on it. */
function canShelfWith(string $slug, string $role = 'reader'): array
{
    // Unbound while the fixture is built, for the same reason
    // DecideProfileChangeTest clears it: BelongsToBookshelf refuses a create
    // naming a foreign shelf while another one is bound.
    app(TenantContext::class)->clear();

    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);

    $user = User::factory()->create([
        'saint_name' => 'Maria', 'full_name' => 'Nguyễn Thị Lan',
        'phone' => '0911111111', 'phone_missing_reason' => null,
    ]);

    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => $role, 'status' => 'active',
    ]);

    return [$shelf, $user, $membership];
}

/** A pending request written straight to the table — no proposal path is under test here. */
function canPending(Bookshelf $shelf, User $person, array $proposed = ['phone' => '0922222222']): ProfileChangeRequest
{
    $tenant = app(TenantContext::class);
    $bookshelf = $tenant->bookshelf();
    $membership = $tenant->membership();
    $tenant->clear();

    $request = ProfileChangeRequest::query()->create([
        'bookshelf_id' => $shelf->id,
        'user_id' => $person->id,
        'proposed_values' => $proposed,
        'previous_values' => ['phone' => '0911111111'],
        'status' => 'pending',
    ]);

    if ($bookshelf !== null) {
        $tenant->set($bookshelf, $membership);
    }

    return $request;
}

/** The row as a caller's controller would hand it over. */
function canRow(string $id): ProfileChangeRequest
{
    return ProfileChangeRequest::query()->withoutGlobalScopes()->findOrFail($id);
}

function canCancel(User $actor, Membership $membership, ProfileChangeRequest $request): void
{
    app(CancelProfileChange::class)->execute($actor, $membership, $request);
}

function canActAs(Bookshelf $shelf, User $actor, ?Membership $membership = null): void
{
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($actor);
}

/**
 * A manager of $shelf, created fresh.
 *
 * @return array{User, Membership}
 */
function canShelfManager(Bookshelf $shelf): array
{
    $manager = User::factory()->create(['saint_name' => 'Giuse', 'full_name' => 'Trần Minh']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);

    return [$manager, $membership];
}

it('a manager cancels a READER subject\'s request, and nothing on the person moves', function () {
    [$shelf, $person, $subjectMembership] = canShelfWith('dong-thap');
    [$manager, $managerMembership] = canShelfManager($shelf);

    canActAs($shelf, $manager, $managerMembership);
    $request = canPending($shelf, $person);

    canCancel($manager, $subjectMembership, canRow($request->id));

    $cancelled = canRow($request->id);
    expect($cancelled->status)->toBe(ProfileChangeStatus::Cancelled)
        ->and($cancelled->decided_at)->not->toBeNull()
        // `decided_by` is the manager who RULED on a request. A withdrawal
        // has none, and naming the canceller there would make "who decided
        // this" answer with the person who asked.
        ->and($cancelled->decided_by)->toBeNull()
        ->and($person->fresh()->phone)->toBe('0911111111');

    // Spec D3's entity-type rule: the REQUEST, not the user. Approve's
    // `user` is the exception, being the only moment anything moved.
    $row = AuditLog::query()->where('action', 'profile_change.cancelled')->sole();
    expect($row->entity_type)->toBe('profile_change_request')
        ->and($row->entity_id)->toBe($request->id)
        ->and($row->before)->toBe(['status' => 'pending'])
        ->and($row->after)->toBe(['status' => 'cancelled']);
});

it('a manager may NOT cancel a MANAGER subject\'s request — a super administrator may', function () {
    // The defect the reference records fixing, in one test: "a manager could
    // cancel a peer manager's own pending change, cutting §9's routing rule
    // off at the knees" before a super administrator ever saw it.
    // `requireSelfOrManager` alone lets the peer through; the subject-role
    // rule is what stops them.
    [$shelf, $subject, $subjectMembership] = canShelfWith('dong-thap', 'manager');
    [$peer, $peerMembership] = canShelfManager($shelf);

    canActAs($shelf, $peer, $peerMembership);
    $request = canPending($shelf, $subject);

    expect(fn () => canCancel($peer, $subjectMembership, canRow($request->id)))
        ->toThrow(RuleViolated::class, 'not_permitted');

    expect(canRow($request->id)->status)->toBe(ProfileChangeStatus::Pending);

    // The unbound cross-shelf caller: no tenant at all, the global flag.
    $admin = User::factory()->create(['is_super_admin' => true]);
    app(TenantContext::class)->clear();
    test()->actingAs($admin);

    canCancel($admin, $subjectMembership, canRow($request->id));

    expect(canRow($request->id)->status)->toBe(ProfileChangeStatus::Cancelled);
});

it('anyone cancels their OWN request, at every rank — the one exemption', function () {
    // A reader withdrawing their own is the ordinary case this command
    // exists for, and `requireSelfOrManager`'s self half is the only reason
    // a reader passes the gate at all.
    [$shelfA, $reader, $readerMembership] = canShelfWith('dong-thap');
    canActAs($shelfA, $reader, $readerMembership);
    $own = canPending($shelfA, $reader);

    canCancel($reader, $readerMembership, canRow($own->id));

    expect(canRow($own->id)->status)->toBe(ProfileChangeStatus::Cancelled);

    // AND A MANAGER'S OWN, which is where cancel parts company with approve
    // and reject: they refuse self-decision at every rank, while a manager
    // who mistyped their own phone number must not be stranded waiting for a
    // super administrator to take it back for them. The subject-role check
    // would refuse this one outright — the self exemption is what does not
    // reach it.
    [$shelfB, $manager, $managerMembership] = canShelfWith('can-tho', 'manager');
    canActAs($shelfB, $manager, $managerMembership);
    $ownAsManager = canPending($shelfB, $manager);

    canCancel($manager, $managerMembership, canRow($ownAsManager->id));

    expect(canRow($ownAsManager->id)->status)->toBe(ProfileChangeStatus::Cancelled);
});

it('the self-check compares MEMBERSHIP ids, so the exemption is the caller\'s own session row', function () {
    // ONE PERSON, TWO MEMBERSHIPS — the fixture DecideProfileChangeTest uses
    // for the opposite rule, and the outcome here turns on which id is
    // compared. The person is a MANAGER subject at Đồng Tháp, where their
    // request sits, and stands as a manager at Cần Thơ.
    //
    //   - membership ids: a different row, so not the self exemption. The
    //     subject-role rule then applies to a manager subject, and only a
    //     super administrator may take it back.
    //   - user ids: the same human, so the exemption would fire and this
    //     would be permitted.
    //
    // The self exemption is about the session the caller is actually in —
    // `requireSelfOrManager`'s comparand, resolved by ResolveTenant and
    // never supplied by a caller — not about the human being behind it.
    // That is exactly inverted from the decision pair, on purpose.
    [$shelfA, $person, $atA] = canShelfWith('dong-thap', 'manager');

    app(TenantContext::class)->clear();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $atOther = Membership::factory()->for($other)->create([
        'user_id' => $person->id, 'role' => 'manager', 'status' => 'active',
    ]);

    $request = canPending($shelfA, $person);

    canActAs($other, $person, $atOther);

    expect(fn () => canCancel($person, $atA, canRow($request->id)))
        ->toThrow(RuleViolated::class, 'not_permitted');

    expect(canRow($request->id)->status)->toBe(ProfileChangeStatus::Pending);

    // Standing at Đồng Tháp — the session the request belongs to — the very
    // same person withdraws it, because now it IS their own session row.
    canActAs($shelfA, $person, $atA);

    canCancel($person, $atA, canRow($request->id));

    expect(canRow($request->id)->status)->toBe(ProfileChangeStatus::Cancelled);
});

it('a membership naming a different person than the request earns not_own_request', function () {
    // OPS §4.3: "should be structurally unreachable via UI, but the command
    // must still check". The pairing of the two inputs IS the check, and the
    // code is a reuse — CancelOwnRequest's sentence says exactly this.
    [$shelf, $person] = canShelfWith('dong-thap');
    [$manager, $managerMembership] = canShelfManager($shelf);
    [, $strangerMembership] = canShelfManager($shelf);

    canActAs($shelf, $manager, $managerMembership);
    $request = canPending($shelf, $person);

    expect(fn () => canCancel($manager, $strangerMembership, canRow($request->id)))
        ->toThrow(RuleViolated::class, 'not_own_request');

    expect(canRow($request->id)->status)->toBe(ProfileChangeStatus::Pending);
});

it('a request already decided since the card was opened yields profile_change_not_pending', function () {
    [$shelf, $person, $subjectMembership] = canShelfWith('dong-thap');
    [$manager, $managerMembership] = canShelfManager($shelf);

    canActAs($shelf, $manager, $managerMembership);
    $request = canPending($shelf, $person);

    // The model a controller resolved BEFORE the lock existed — still
    // pending as far as it knows.
    $stale = canRow($request->id);

    canCancel($manager, $subjectMembership, canRow($request->id));

    expect(fn () => canCancel($manager, $subjectMembership, $stale))
        ->toThrow(RuleViolated::class, 'profile_change_not_pending');
});

it('takes the SUBJECT\'s users row first, then the request, and locks NO membership', function () {
    // Spec D3's ordering rule, and cancel is the command that measured it:
    // reversed, a manager clicking *Duyệt* as the reader clicked *Huỷ*
    // deadlocked 3/3 in both directions and the loser shipped a 500.
    //
    // THE BINDINGS ARE ASSERTED, NOT ONLY THE TABLE. Both `users` rows in
    // scope — the subject's and the cancelling manager's — produce a
    // byte-identical `select * from `users` … limit 1 for update`, so a
    // regression locking the wrong one leaves the query text untouched.
    // Only the binding tells them apart. (Approve's own version of this
    // block, in DecideProfileChangeTest, carries the fuller note.)
    //
    // The membership half is the other statement worth making: cancel
    // writes no membership, so it takes no membership lock, and adding one
    // it does not need would only buy contention.
    [$shelf, $person, $subjectMembership] = canShelfWith('dong-thap');
    [$manager, $managerMembership] = canShelfManager($shelf);

    canActAs($shelf, $manager, $managerMembership);
    $cancelling = canRow(canPending($shelf, $person)->id);

    DB::flushQueryLog();
    DB::enableQueryLog();
    canCancel($manager, $subjectMembership, $cancelling);
    $locking = lockingReads(DB::getQueryLog());
    DB::disableQueryLog();

    expect(array_map(fn (array $e) => preg_replace('/^select \* from (`\w+`).*$/s', '$1', $e['query']), $locking))
        ->toBe(['`users`', '`profile_change_requests`']);

    expect($locking[0]['bindings'])->toBe([$person->id])
        ->and($locking[1]['bindings'])->toBe([$cancelling->id]);
});
