<?php

use App\Actions\Admin\ApproveProfileChange;
use App\Actions\Admin\RejectProfileChange;
use App\Enums\ProfileChangeStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\ParishUnit;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * Phase 3c-i Task 3 — the correctness core of the phase (spec D2, D3).
 *
 * The decision rule has three parts and three independent ways to be
 * subtly wrong, and each has its own test below:
 *
 *  1. the subject's role is read at DECISION time, not proposal time;
 *  2. self-decision is refused at EVERY rank, super administrator
 *     included;
 *  3. the comparison is on `user_id`, NOT membership id — which is what
 *     the "other shelf" case exists to hold, and the one part that is
 *     genuinely new to the port.
 */

/** @return array{Bookshelf, User, Membership} A shelf, a person, and their membership on it. */
function decShelfWith(string $slug, string $role = 'reader', array $person = []): array
{
    // Unbound while the fixture is built: BelongsToBookshelf refuses a
    // create naming a foreign shelf while another one is bound, and the
    // self-decision case below builds three shelves in a row.
    app(TenantContext::class)->clear();

    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);

    $user = User::factory()->create(array_merge([
        'saint_name' => 'Maria', 'full_name' => 'Nguyễn Thị Lan',
        'father_name' => 'Nguyễn Văn Hoà', 'mother_name' => 'Trần Thị Mai',
        'date_of_birth' => '2015-04-02', 'phone' => '0911111111',
        'phone_missing_reason' => null, 'email' => null,
    ], $person));

    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => $role, 'status' => 'active',
    ]);

    return [$shelf, $user, $membership];
}

/** A pending request, written straight to the table so no proposal path is under test here. */
function decPending(Bookshelf $shelf, User $person, array $proposed, array $previous = []): ProfileChangeRequest
{
    $tenant = app(TenantContext::class);
    $bookshelf = $tenant->bookshelf();
    $membership = $tenant->membership();
    $tenant->clear();

    $request = ProfileChangeRequest::query()->create([
        'bookshelf_id' => $shelf->id,
        'user_id' => $person->id,
        'proposed_values' => $proposed,
        'previous_values' => $previous,
        'status' => 'pending',
    ]);

    if ($bookshelf !== null) {
        $tenant->set($bookshelf, $membership);
    }

    return $request;
}

/** The row as a decider's controller would hand it over — resolved, then re-read under the command's own lock. */
function decRow(string $id): ProfileChangeRequest
{
    return ProfileChangeRequest::query()->withoutGlobalScopes()->findOrFail($id);
}

function decApprove(User $actor, ProfileChangeRequest $request, array $units = []): void
{
    app(ApproveProfileChange::class)->execute($actor, $request, $units);
}

function decReject(User $actor, ProfileChangeRequest $request, string $reason): void
{
    app(RejectProfileChange::class)->execute($actor, $request, $reason);
}

/** Bind the tenant and the session the way a manager's request would arrive. */
function decActAs(Bookshelf $shelf, User $actor, ?Membership $membership = null): void
{
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($actor);
}

/** The unbound `/admin` caller: no tenant at all, a super administrator in the session. */
function decActAsSuperAdmin(): User
{
    $admin = User::factory()->create(['is_super_admin' => true]);

    app(TenantContext::class)->clear();
    test()->actingAs($admin);

    return $admin;
}

it('a manager decides a reader subject\'s proposal, and the values MOVE onto the person', function () {
    [$shelf, $person] = decShelfWith('dong-thap');
    [$manager, $managerMembership] = decShelfManager($shelf);

    decActAs($shelf, $manager, $managerMembership);
    $request = decPending($shelf, $person, ['phone' => '0922222222'], ['phone' => '0911111111']);

    decApprove($manager, decRow($request->id));

    expect($person->fresh()->phone)->toBe('0922222222');

    $decided = decRow($request->id);
    expect($decided->status)->toBe(ProfileChangeStatus::Approved)
        ->and($decided->decided_by)->toBe($manager->id)
        ->and($decided->decided_at)->not->toBeNull();

    // Spec D3's entity-type rule: approve files against the USER, because
    // approve is the moment the details actually move.
    $row = AuditLog::query()->where('action', 'profile_change.approved')->sole();
    expect($row->entity_type)->toBe('user')
        ->and($row->entity_id)->toBe($person->id)
        ->and($row->before)->toBe(['phone' => '0911111111'])
        ->and($row->after)->toBe(['phone' => '0922222222']);
});

it('a manager may NOT decide a MANAGER subject\'s proposal — a super administrator may', function () {
    [$shelf, $subject] = decShelfWith('dong-thap', 'manager');
    [$peer, $peerMembership] = decShelfManager($shelf);

    decActAs($shelf, $peer, $peerMembership);
    $request = decPending($shelf, $subject, ['phone' => '0922222222']);

    expect(fn () => decApprove($peer, decRow($request->id)))
        ->toThrow(RuleViolated::class, 'not_permitted');

    // The cross-shelf queue's caller: no tenant bound at all, which is the
    // path spec D10's directory choice exists for.
    $admin = decActAsSuperAdmin();
    decApprove($admin, decRow($request->id));

    expect($subject->fresh()->phone)->toBe('0922222222')
        ->and(decRow($request->id)->status)->toBe(ProfileChangeStatus::Approved);
});

it('nobody decides their OWN proposal — reader, manager and super administrator alike', function () {
    // A reader is stopped by the ability itself: `decide` is act-as-manager
    // and grants a reader nothing, so the refusal is the gate's 403 rather
    // than the rule's code. The rule still has to be there for the two
    // ranks below, and for the other-shelf case in the next test.
    [$shelfA, $reader, $readerMembership] = decShelfWith('dong-thap');
    decActAs($shelfA, $reader, $readerMembership);
    $ownAsReader = decPending($shelfA, $reader, ['phone' => '0922222222']);

    expect(fn () => decApprove($reader, decRow($ownAsReader->id)))
        ->toThrow(AuthorizationException::class);

    // A manager's own record fails the subject-role half too, since their
    // own role IS manager — but the self check is what makes the refusal
    // independent of rank, which the super administrator below proves.
    [$shelfB, $manager, $managerMembership] = decShelfWith('can-tho', 'manager');
    decActAs($shelfB, $manager, $managerMembership);
    $ownAsManager = decPending($shelfB, $manager, ['phone' => '0933333333']);

    expect(fn () => decApprove($manager, decRow($ownAsManager->id)))
        ->toThrow(RuleViolated::class, 'not_permitted');

    // "Rank is not the question; being both parties to the decision is."
    // A super administrator passes the subject-role half by construction,
    // so this case is the self check and nothing else.
    [$shelfC, $admin, $adminMembership] = decShelfWith('vinh-long', 'manager');
    $admin->is_super_admin = true;
    $admin->save();
    decActAs($shelfC, $admin, $adminMembership);
    $ownAsAdmin = decPending($shelfC, $admin, ['phone' => '0944444444']);

    expect(fn () => decApprove($admin, decRow($ownAsAdmin->id)))
        ->toThrow(RuleViolated::class, 'not_permitted');

    // And rejecting is the same rule, not a second one.
    expect(fn () => decReject($admin, decRow($ownAsAdmin->id), 'Không hợp lệ'))
        ->toThrow(RuleViolated::class, 'not_permitted');
});

it('nor from their OTHER shelf — the comparison is on user_id, not membership id', function () {
    // ONE PERSON, TWO MEMBERSHIPS. A reader at Đồng Tháp, where the
    // proposal sits, and a manager at Cần Thơ, where they are standing. A
    // membership-id comparison says "different rows, go ahead"; a user-id
    // comparison says "same human being on both halves of the decision".
    [$shelfA, $person] = decShelfWith('dong-thap');

    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $atOther = Membership::factory()->for($other)->create([
        'user_id' => $person->id, 'role' => 'manager', 'status' => 'active',
    ]);

    $request = decPending($shelfA, $person, ['phone' => '0922222222']);

    decActAs($other, $person, $atOther);

    expect(fn () => decApprove($person, decRow($request->id)))
        ->toThrow(RuleViolated::class, 'not_permitted');

    // Nothing moved, and the request is still there to be decided by
    // somebody who is not its subject.
    expect($person->fresh()->phone)->toBe('0911111111')
        ->and(decRow($request->id)->status)->toBe(ProfileChangeStatus::Pending);
});

it('the subject\'s role is read at DECISION time — a reader promoted mid-flight', function () {
    [$shelf, $subject, $subjectMembership] = decShelfWith('dong-thap');
    [$manager, $managerMembership] = decShelfManager($shelf);

    decActAs($shelf, $manager, $managerMembership);
    $request = decPending($shelf, $subject, ['phone' => '0922222222']);

    // Promoted while the proposal waits. Nothing on the request row
    // changes; the routing does, because the rule reads the role now.
    $subjectMembership->role = 'manager';
    $subjectMembership->save();

    expect(fn () => decApprove($manager, decRow($request->id)))
        ->toThrow(RuleViolated::class, 'not_permitted');

    $admin = decActAsSuperAdmin();
    decApprove($admin, decRow($request->id));

    expect($subject->fresh()->phone)->toBe('0922222222');
});

it('approve validates the RESULTING unit pair, not the supplied half', function () {
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => [
        'parish_taxonomy' => ['levels' => 2, 'nested' => true, 'level1_label' => 'Giáo họ', 'level2_label' => 'Tổ'],
    ]]);

    $left = ParishUnit::factory()->for($shelf)->create(['level' => 1, 'name' => 'Giáo họ Thánh Tâm']);
    $leftChild = ParishUnit::factory()->for($shelf)->create(['level' => 2, 'parent_id' => $left->id, 'name' => 'Tổ 1']);
    $right = ParishUnit::factory()->for($shelf)->create(['level' => 1, 'name' => 'Giáo họ Mân Côi']);
    $rightChild = ParishUnit::factory()->for($shelf)->create(['level' => 2, 'parent_id' => $right->id, 'name' => 'Tổ 9']);

    $person = User::factory()->create([
        'saint_name' => 'Maria', 'full_name' => 'Nguyễn Thị Lan',
        'phone' => '0911111111', 'phone_missing_reason' => null,
    ]);
    $subjectMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $person->id, 'role' => 'reader', 'status' => 'active',
        'parish_unit_l1_id' => $left->id, 'parish_unit_l2_id' => $leftChild->id,
    ]);
    [$manager, $managerMembership] = decShelfManager($shelf);

    decActAs($shelf, $manager, $managerMembership);
    $request = decPending($shelf, $person, ['phone' => '0922222222']);

    // ONLY the level-2 id is supplied, and on its own it is a perfectly
    // real level-2 unit. It is the RESULTING pair that is wrong: the
    // level 1 already on file is the other parent. A command that checked
    // the supplied half would let this through and leave the membership
    // pointing at a child of a unit it does not belong to.
    expect(fn () => decApprove($manager, decRow($request->id), ['parish_unit_l2_id' => $rightChild->id]))
        ->toThrow(RuleViolated::class, 'parish_unit_l2_not_in_l1');

    // Nothing was decided and nothing moved — the refusal rolled the
    // transaction back, profile columns included.
    expect($person->fresh()->phone)->toBe('0911111111')
        ->and(decRow($request->id)->status)->toBe(ProfileChangeStatus::Pending);

    // Moving BOTH halves together is the same pair, and it is fine.
    decApprove($manager, decRow($request->id), [
        'parish_unit_l1_id' => $right->id, 'parish_unit_l2_id' => $rightChild->id,
    ]);

    $subjectMembership->refresh();
    expect($subjectMembership->parish_unit_l1_id)->toBe($right->id)
        ->and($subjectMembership->parish_unit_l2_id)->toBe($rightChild->id)
        ->and($person->fresh()->phone)->toBe('0922222222');
});

it('approving with NEITHER unit id leaves the placement untouched', function () {
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $unit = ParishUnit::factory()->for($shelf)->create(['level' => 1, 'name' => 'Tổ 3']);

    $person = User::factory()->create([
        'saint_name' => 'Maria', 'full_name' => 'Nguyễn Thị Lan',
        'phone' => '0911111111', 'phone_missing_reason' => null,
    ]);
    $subjectMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $person->id, 'role' => 'reader', 'status' => 'active',
        'parish_unit_l1_id' => $unit->id,
    ]);
    [$manager, $managerMembership] = decShelfManager($shelf);

    decActAs($shelf, $manager, $managerMembership);
    $request = decPending($shelf, $person, ['phone' => '0922222222']);

    decApprove($manager, decRow($request->id));

    expect($subjectMembership->fresh()->parish_unit_l1_id)->toBe($unit->id);
});

it('the stored JSON is re-validated AT APPROVAL — a legacy row fails required_fields_missing', function () {
    // proposed_values is a json column with no check constraint behind it,
    // so a row written by an older schema or by hand can hold a blanked
    // saint name. It has to fail on the manager's screen, not in a NOT NULL
    // driver error underneath it.
    [$shelf, $person] = decShelfWith('dong-thap');
    [$manager, $managerMembership] = decShelfManager($shelf);

    decActAs($shelf, $manager, $managerMembership);
    $request = decPending($shelf, $person, ['saint_name' => '', 'phone' => '0922222222']);

    expect(fn () => decApprove($manager, decRow($request->id)))
        ->toThrow(RuleViolated::class, 'required_fields_missing');

    expect(decRow($request->id)->status)->toBe(ProfileChangeStatus::Pending)
        ->and($person->fresh()->phone)->toBe('0911111111');
});

it('approving a phone clears the stale phone_missing_reason nobody withdrew', function () {
    [$shelf, $person] = decShelfWith('dong-thap', 'reader', [
        'phone' => null, 'phone_missing_reason' => 'Trẻ em chưa có điện thoại',
    ]);
    [$manager, $managerMembership] = decShelfManager($shelf);

    decActAs($shelf, $manager, $managerMembership);
    $request = decPending($shelf, $person, ['phone' => '0922222222']);

    decApprove($manager, decRow($request->id));

    expect($person->fresh()->phone)->toBe('0922222222')
        ->and($person->fresh()->phone_missing_reason)->toBeNull();
});

it('a request decided since the card was opened yields profile_change_not_pending', function () {
    [$shelf, $person] = decShelfWith('dong-thap');
    [$manager, $managerMembership] = decShelfManager($shelf);

    decActAs($shelf, $manager, $managerMembership);
    $request = decPending($shelf, $person, ['phone' => '0922222222']);

    // The model a controller resolved BEFORE the lock existed — still
    // pending as far as it knows.
    $stale = decRow($request->id);

    decApprove($manager, decRow($request->id));

    expect(fn () => decApprove($manager, $stale))
        ->toThrow(RuleViolated::class, 'profile_change_not_pending')
        ->and(fn () => decReject($manager, $stale, 'Muộn mất rồi'))
        ->toThrow(RuleViolated::class, 'profile_change_not_pending');
});

it('a blank reject reason is refused, and the reason reaches the audit row', function () {
    [$shelf, $person] = decShelfWith('dong-thap');
    [$manager, $managerMembership] = decShelfManager($shelf);

    decActAs($shelf, $manager, $managerMembership);
    $request = decPending($shelf, $person, ['phone' => '0922222222']);

    // Whitespace is blank: a space bar is not a reason a reader can act on.
    expect(fn () => decReject($manager, decRow($request->id), '   '))
        ->toThrow(RuleViolated::class, 'reject_reason_required');

    decReject($manager, decRow($request->id), '  Số này là của hàng xóm.  ');

    $decided = decRow($request->id);
    expect($decided->status)->toBe(ProfileChangeStatus::Rejected)
        ->and($decided->rejection_reason)->toBe('Số này là của hàng xóm.')
        ->and($decided->decided_by)->toBe($manager->id)
        // Nothing on the person moved — there was never anything to undo.
        ->and($person->fresh()->phone)->toBe('0911111111');

    // The column is overwritable; the audit row is not. BR §13.2's
    // question is what reason this manager gave AT THE TIME.
    $row = AuditLog::query()->where('action', 'profile_change.rejected')->sole();
    expect($row->entity_type)->toBe('profile_change_request')
        ->and($row->entity_id)->toBe($request->id)
        ->and($row->after['reason'])->toBe('Số này là của hàng xóm.');
});

it('takes the SUBJECT\'s users row as the first statement of every decide transaction', function () {
    // Spec D3's ordering rule, and it is not taste: reversed — the request
    // row first, the person second — approve racing cancel deadlocked 3/3
    // in BOTH directions and the loser's driver error shipped as a 500.
    // ProposeProfileChange reaches the same two rows in the same order from
    // the other end, which is what makes the pair safe.
    [$shelf, $person] = decShelfWith('dong-thap');
    [$manager, $managerMembership] = decShelfManager($shelf);

    decActAs($shelf, $manager, $managerMembership);
    // Resolved BEFORE the log is enabled — the controller's own read is
    // not part of the transaction whose first statement is under test.
    $approving = decRow(decPending($shelf, $person, ['phone' => '0922222222'])->id);

    DB::enableQueryLog();
    decApprove($manager, $approving);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect($log)->not->toBe([])
        ->and(str_contains($log[0]['query'], '`users`'))->toBeTrue('first query is not on users: '.$log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue('first query is not FOR UPDATE: '.$log[0]['query']);

    $rejecting = decRow(decPending($shelf, $person, ['phone' => '0933333333'])->id);

    DB::enableQueryLog();
    decReject($manager, $rejecting, 'Không đúng số.');
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect($log)->not->toBe([])
        ->and(str_contains($log[0]['query'], '`users`'))->toBeTrue('first query is not on users: '.$log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue('first query is not FOR UPDATE: '.$log[0]['query']);
});

/**
 * A manager of $shelf, created fresh.
 *
 * @return array{User, Membership}
 */
function decShelfManager(Bookshelf $shelf): array
{
    $manager = User::factory()->create(['saint_name' => 'Giuse', 'full_name' => 'Trần Minh']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);

    return [$manager, $membership];
}
