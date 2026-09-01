<?php

use App\Actions\Admin\ApproveProfileChange;
use App\Actions\Admin\RejectProfileChange;
use App\Enums\ProfileChangeStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\Notification;
use App\Models\ParishUnit;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Support\Notifications\NotificationSentences;
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

it('approve locks memberships, THEN users, THEN the request — and each on the SUBJECT\'s own id', function () {
    // Spec D3's ordering rule, stated as the whole sequence rather than as
    // one statement, because this command's hazard was never its first
    // lock. It USED to read the membership unlocked and lock `users` first,
    // on a docblock arguing that not locking the membership avoided
    // inverting against UpdateReaderProfile. It did not: applyPlacement's
    // `$membership->save()` takes the exclusive row lock anyway, so the
    // measured order was users-then-memberships against
    // UpdateReaderProfile.php:61,69's and ChangeOwnPassword.php:91,93's
    // memberships-then-users — an AB–BA cycle over that exact pair, and
    // those two use a bare DB::transaction() with no retry at all, so the
    // loser ships a driver error as a 500.
    //
    // A test reading only $log[0] and only the TABLE could not have caught
    // it, which is why this one reads the whole locking sequence and the
    // bindings under it.
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $unit = ParishUnit::factory()->for($shelf)->create(['level' => 1, 'name' => 'Giáo họ Mân Côi']);

    $person = User::factory()->create([
        'saint_name' => 'Maria', 'full_name' => 'Nguyễn Thị Lan',
        'phone' => '0911111111', 'phone_missing_reason' => null,
    ]);
    $subjectMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $person->id, 'role' => 'reader', 'status' => 'active',
    ]);
    [$manager, $managerMembership] = decShelfManager($shelf);

    decActAs($shelf, $manager, $managerMembership);
    // WITH a placement, so applyPlacement actually writes the membership —
    // an approve that names no unit never reaches the UPDATE and so cannot
    // demonstrate the edge this test pins.
    $approving = decRow(decPending($shelf, $person, ['phone' => '0922222222'])->id);

    DB::flushQueryLog();
    DB::enableQueryLog();
    decApprove($manager, $approving, ['parish_unit_l1_id' => $unit->id]);
    $locking = lockingReads(DB::getQueryLog());
    DB::disableQueryLog();

    expect(array_map(fn (array $e) => preg_replace('/^select \* from (`\w+`).*$/s', '$1', $e['query']), $locking))
        ->toBe(['`memberships`', '`users`', '`profile_change_requests`']);

    // Each one on the SUBJECT's row, named by binding. The manager is an
    // active member of this same shelf with a `users` row of their own, so
    // "some users row was locked" is not the statement worth making.
    expect($locking[0]['bindings'])->toContain($person->id)
        ->and($locking[0]['bindings'])->toContain($shelf->id)
        ->and($locking[0]['bindings'])->not->toContain($manager->id)
        ->and($locking[1]['bindings'])->toBe([$person->id])
        ->and($locking[2]['bindings'])->toBe([$approving->id]);

    // And the write this ordering exists for did happen — a fixture where
    // applyPlacement silently no-opped would make the sequence above true
    // for the wrong reason.
    expect($subjectMembership->fresh()->parish_unit_l1_id)->toBe($unit->id);
});

it('reject takes the SUBJECT\'s users row first and locks NO membership at all', function () {
    // Reject writes no membership, so it takes none — and taking one it did
    // not need would be contention bought for nothing. Its own half of D3
    // is the pair the reference measured: reversed — the request row first,
    // the person second — approve racing cancel deadlocked 3/3 in BOTH
    // directions. ProposeProfileChange reaches those same two rows in the
    // same order from the other end.
    [$shelf, $person] = decShelfWith('dong-thap');
    [$manager, $managerMembership] = decShelfManager($shelf);

    decActAs($shelf, $manager, $managerMembership);
    // Resolved BEFORE the log is enabled — the controller's own read is
    // not part of the transaction whose first statement is under test.
    $rejecting = decRow(decPending($shelf, $person, ['phone' => '0933333333'])->id);

    DB::flushQueryLog();
    DB::enableQueryLog();
    decReject($manager, $rejecting, 'Không đúng số.');
    $locking = lockingReads(DB::getQueryLog());
    DB::disableQueryLog();

    expect(array_map(fn (array $e) => preg_replace('/^select \* from (`\w+`).*$/s', '$1', $e['query']), $locking))
        ->toBe(['`users`', '`profile_change_requests`']);

    expect($locking[0]['bindings'])->toBe([$person->id])
        ->and($locking[1]['bindings'])->toBe([$rejecting->id]);
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

/**
 * Task 6 — BR §15's profile-change pair (spec D8).
 *
 * BR:492 gives the reason these two exist at all: "without them a reader
 * would have to keep revisiting the page to find out whether their new
 * phone number took effect." So what is asserted below is that the reader
 * — never the deciding manager — ends up holding the sentence, and that
 * the rejection's sentence still carries the manager's reason once
 * NotificationSentences has rendered it. Asserting the stored payload
 * alone would pass on a reason that never reaches a sentence.
 */
it('approving tells the SUBJECT, and tells the deciding manager nothing', function () {
    [$shelf, $person] = decShelfWith('dong-thap');
    [$manager, $managerMembership] = decShelfManager($shelf);

    decActAs($shelf, $manager, $managerMembership);
    $request = decPending($shelf, $person, ['phone' => '0922222222'], ['phone' => '0911111111']);

    decApprove($manager, decRow($request->id));

    $note = Notification::query()->withoutGlobalScopes()->sole();

    expect($note->user_id)->toBe($person->id)
        ->and($note->kind)->toBe('profile_change_approved')
        // The shelf comes off the request row, on both paths.
        ->and($note->bookshelf_id)->toBe($shelf->id)
        // BR §15: managers get none, by design.
        ->and(Notification::query()->withoutGlobalScopes()->where('user_id', $manager->id)->count())->toBe(0)
        ->and(NotificationSentences::sentence($note->kind, $note->payload))
        ->toBe('Thông tin cá nhân của bạn đã được cập nhật.');
});

it('rejecting tells the subject, CARRYING the manager\'s reason into the sentence', function () {
    [$shelf, $person] = decShelfWith('dong-thap');
    [$manager, $managerMembership] = decShelfManager($shelf);

    decActAs($shelf, $manager, $managerMembership);
    $request = decPending($shelf, $person, ['phone' => '0922222222']);

    decReject($manager, decRow($request->id), '  Số này là của hàng xóm.  ');

    $note = Notification::query()->withoutGlobalScopes()->sole();

    expect($note->user_id)->toBe($person->id)
        ->and($note->kind)->toBe('profile_change_rejected')
        // THE SENTENCE FIRST, and the payload key read with ?? null — both
        // deliberate. A failed expect() aborts the whole method, so
        // whichever assertion comes first is the one a falsification run
        // gets to show; and a bare $note->payload['reason'] on a payload
        // that lost its reason raises ErrorException before any
        // expectation runs at all, which reddens on the wrong thing. What
        // BR:490 requires is that the reason reaches the READER, so that
        // is what fails first when it does not.
        ->and(NotificationSentences::sentence($note->kind, $note->payload))
        ->toBe('Yêu cầu cập nhật thông tin của bạn chưa được duyệt vì Số này là của hàng xóm..')
        // Trimmed, and the same string the column and the audit row hold.
        ->and($note->payload['reason'] ?? null)->toBe('Số này là của hàng xóm.');
});

it('writes the notification from the UNBOUND /admin path too, onto the request\'s own shelf', function () {
    // The half the manager's path cannot exercise: Notification carries
    // BelongsToBookshelf, and the cross-shelf queue binds no tenant, so
    // without the shelf being named the create-hook throws. A manager
    // SUBJECT is what routes the decision to a super administrator, which
    // is exactly the case that arrives unbound.
    [$shelf, $person] = decShelfWith('dong-thap', 'manager');

    $request = decPending($shelf, $person, ['phone' => '0922222222']);
    $admin = decActAsSuperAdmin();

    decReject($admin, decRow($request->id), 'Số này chưa đúng.');

    $note = Notification::query()->withoutGlobalScopes()->sole();

    expect($note->user_id)->toBe($person->id)
        ->and($note->kind)->toBe('profile_change_rejected')
        ->and($note->bookshelf_id)->toBe($shelf->id);
});

it('a notification cannot outlive a rolled-back decision', function () {
    // The phase's headline guarantee, from the behavioural side rather
    // than the token walk's. applyPlacement raises its refusal AFTER the
    // status write and BEFORE the notify, so a refused approval is the
    // shape that proves the whole closure rolls back together.
    [$shelf, $person] = decShelfWith('dong-thap');
    [$manager, $managerMembership] = decShelfManager($shelf);

    decActAs($shelf, $manager, $managerMembership);
    $request = decPending($shelf, $person, ['phone' => '0922222222']);

    expect(fn () => decApprove($manager, decRow($request->id), ['parish_unit_l1_id' => 'khong-co-that']))
        ->toThrow(RuleViolated::class);

    expect(Notification::query()->withoutGlobalScopes()->count())->toBe(0)
        ->and(decRow($request->id)->status)->toBe(ProfileChangeStatus::Pending);
});

/**
 * The COMMON path, which lost its sequence pin when the one above switched to
 * an approve WITH a placement. An approve that names no unit never reaches
 * `applyPlacement`, so a change making the membership lock conditional on
 * `$units !== []` would reintroduce the inversion for the majority of
 * approvals and leave every other test green.
 */
it('locks the same three rows in the same order approving WITHOUT a placement', function () {
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-no-units']);
    $person = User::factory()->create([
        'saint_name' => 'Maria', 'full_name' => 'Nguyễn Thị Lan',
        'phone' => '0911111111', 'phone_missing_reason' => null,
    ]);
    Membership::factory()->for($shelf)->create([
        'user_id' => $person->id, 'role' => 'reader', 'status' => 'active',
    ]);
    [$manager, $managerMembership] = decShelfManager($shelf);

    decActAs($shelf, $manager, $managerMembership);
    $approving = decRow(decPending($shelf, $person, ['phone' => '0922222222'])->id);

    DB::flushQueryLog();
    DB::enableQueryLog();
    decApprove($manager, $approving);
    $locking = lockingReads(DB::getQueryLog());
    DB::disableQueryLog();

    expect(array_map(
        fn (array $e) => preg_replace('/^select \* from (`\w+`).*$/s', '$1', $e['query']),
        $locking,
    ))->toBe(['`memberships`', '`users`', '`profile_change_requests`']);

    expect($locking[1]['bindings'])->toBe([$person->id]);
});
