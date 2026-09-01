<?php

use App\Actions\Admin\ProposeProfileChange;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Support\Audit\AuditSentences;
use App\Support\Members\ProfileProposals;
use App\Support\TenantContext;
use Illuminate\Auth\Access\AuthorizationException;

/**
 * Phase 3c-i Task 2 — BR:83's "changing your own details is a request, not
 * an edit".
 *
 * The three constraints this file exists to hold, all of which read the
 * opposite way at first glance (spec D1):
 *
 *  - a second proposal MERGES into the pending row, same id, field-wise;
 *  - `previous_values` is written at PROPOSAL time, and is not re-snapshotted
 *    for a field that was already pending;
 *  - the generated column's unique index is NOT the second-proposal guard —
 *    it catches the person with memberships at two parishes, whose blocking
 *    row the tenant-scoped SELECT cannot see.
 *
 * @return array{Bookshelf, User, Membership}
 */
function propFixture(string $slug = 'dong-thap', string $role = 'reader'): array
{
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);

    $person = User::factory()->create([
        'saint_name' => 'Maria', 'full_name' => 'Nguyễn Thị Lan',
        'father_name' => 'Nguyễn Văn Hoà', 'mother_name' => 'Trần Thị Mai',
        'date_of_birth' => '2015-04-02', 'phone' => '0911111111',
        'phone_missing_reason' => null, 'email' => null,
    ]);

    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $person->id, 'role' => $role, 'status' => 'active',
    ]);

    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($person);

    return [$shelf, $person, $membership];
}

function propose(User $actor, Membership $membership, array $fields): string
{
    return app(ProposeProfileChange::class)->execute($actor, $membership, $fields);
}

it('a reader proposes a new phone, and NOTHING on the person moves', function () {
    [$shelf, $person, $membership] = propFixture();

    $id = propose($person, $membership, ['phone' => '0922222222']);

    // The whole point of the command: the existing values stay in force,
    // the phone number included, so a manager never loses the means of
    // contacting a family mid-change.
    expect($person->fresh()->phone)->toBe('0911111111');

    $request = ProfileChangeRequest::query()->withoutGlobalScopes()->findOrFail($id);

    expect($request->status->value)->toBe('pending')
        ->and($request->user_id)->toBe($person->id)
        ->and($request->bookshelf_id)->toBe($shelf->id)
        ->and($request->proposed_values)->toBe(['phone' => '0922222222'])
        // Written at PROPOSAL time (spec D3) — the column is NOT NULL with
        // no default, so a row cannot even be inserted without it.
        ->and($request->previous_values)->toBe(['phone' => '0911111111']);
});

it('a SECOND proposal merges into the pending row — same id, both fields', function () {
    [, $person, $membership] = propFixture();

    $first = propose($person, $membership, ['phone' => '0922222222']);
    $second = propose($person, $membership, ['email' => 'lan@example.com']);

    // The identity assertion is the one that falsifies an INSERT: a second
    // row would come back with a different id (and, on this schema, would
    // not come back at all — the unique index refuses it).
    expect($second)->toBe($first);

    $rows = ProfileChangeRequest::query()->withoutGlobalScopes()
        ->where('user_id', $person->id)->get();

    expect($rows)->toHaveCount(1)
        ->and($rows->first()->proposed_values)->toBe([
            'phone' => '0922222222', 'email' => 'lan@example.com',
        ]);
});

it('the merge does NOT re-snapshot a field that was already pending', function () {
    [, $person, $membership] = propFixture();

    $id = propose($person, $membership, ['phone' => '0922222222']);

    // A manager corrects the phone directly while the proposal waits. The
    // snapshot taken when the phone was first proposed describes THAT
    // moment, and a second proposal about an unrelated field must not
    // quietly rewrite it.
    $person->phone = '0933333333';
    $person->save();

    propose($person, $membership, ['email' => 'lan@example.com']);

    $request = ProfileChangeRequest::query()->withoutGlobalScopes()->findOrFail($id);

    expect($request->previous_values)->toBe([
        'phone' => '0911111111', 'email' => null,
    ]);
});

it('a person with memberships at TWO shelves is refused change_already_pending', function () {
    [, $person] = propFixture('dong-thap');

    // The blocking row belongs to the OTHER parish. Written before the
    // second shelf is bound, because BelongsToBookshelf refuses a create
    // naming a foreign shelf while one is bound.
    app(TenantContext::class)->clear();
    $first = Bookshelf::query()->where('slug', 'dong-thap')->firstOrFail();
    ProfileChangeRequest::query()->create([
        'bookshelf_id' => $first->id, 'user_id' => $person->id,
        'proposed_values' => ['phone' => '0922222222'],
        'previous_values' => ['phone' => '0911111111'],
        'status' => 'pending',
    ]);

    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $atOther = Membership::factory()->for($other)->create([
        'user_id' => $person->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($other, $atOther);

    // The scoped SELECT cannot see the blocking row, so this reaches the
    // INSERT and the GLOBAL generated-column index refuses it. Without the
    // catch it would be a raw driver error, which OPS §2 forbids.
    expect(fn () => propose($person, $atOther, ['email' => 'lan@example.com']))
        ->toThrow(RuleViolated::class, 'change_already_pending');
});

it('a blank saint name is refused — a parish register with none is not a parish register', function () {
    [, $person, $membership] = propFixture();

    expect(fn () => propose($person, $membership, ['saint_name' => '  ']))
        ->toThrow(RuleViolated::class, 'required_fields_missing')
        ->and(ProfileChangeRequest::query()->withoutGlobalScopes()->count())->toBe(0);
});

it('clearing the phone with no reason on file is thieu-so-dien-thoai, judged on the RESULTING record', function () {
    [, $person, $membership] = propFixture();

    expect(fn () => propose($person, $membership, ['phone' => '']))
        ->toThrow(RuleViolated::class, 'thieu-so-dien-thoai');

    // The same clear, with a reason, is allowed — and so is a clear whose
    // reason was already pending from an earlier proposal, which is what
    // "the resulting record" means rather than "this patch".
    $id = propose($person, $membership, ['phone_missing_reason' => 'Gia đình chưa có điện thoại']);
    expect(propose($person, $membership, ['phone' => '']))->toBe($id);
});

it('a proposal that changes nothing is empty_proposal, not a request for a manager to decide', function () {
    [, $person, $membership] = propFixture();

    expect(fn () => propose($person, $membership, ['phone' => '0911111111']))
        ->toThrow(RuleViolated::class, 'empty_proposal')
        ->and(ProfileChangeRequest::query()->withoutGlobalScopes()->count())->toBe(0);
});

it('a manager may propose on another person\'s behalf — proposing is not reader-only', function () {
    [$shelf, $person, $membership] = propFixture();

    $manager = User::factory()->create();
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    $id = propose($manager, $membership, ['phone' => '0922222222']);

    $request = ProfileChangeRequest::query()->withoutGlobalScopes()->findOrFail($id);
    expect($request->user_id)->toBe($person->id);

    // A reader may not propose about SOMEBODY ELSE: requireSelfOrManager's
    // self half compares membership ids, so another reader's row refuses.
    $stranger = User::factory()->create();
    $strangerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $stranger->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $strangerMembership);
    test()->actingAs($stranger);

    expect(fn () => propose($stranger, $membership, ['phone' => '0955555555']))
        ->toThrow(AuthorizationException::class);
});

it('avatar_object is dropped before validation, so a caller can never name a storage key', function () {
    [, $person, $membership] = propFixture();

    $id = propose($person, $membership, [
        'phone' => '0922222222',
        'avatar_object' => 'avatars/somebody-elses-child.webp',
    ]);

    $request = ProfileChangeRequest::query()->withoutGlobalScopes()->findOrFail($id);

    expect(array_key_exists('avatar_object', $request->proposed_values))->toBeFalse()
        // The list is DERIVED from ProfileFields::FIELDS rather than
        // hand-copied, so a tenth verified field becomes proposable on the
        // day it lands — and the photograph stays the one exclusion.
        ->and(ProfileProposals::proposableFields())->not->toContain('avatar_object')
        ->and(ProfileProposals::proposableFields())->toHaveCount(8);
});

it('the audit row names the REQUEST, carries both bags, and reads as a sentence', function () {
    [$shelf, $person, $membership] = propFixture();

    $id = propose($person, $membership, ['phone' => '0922222222']);

    $entry = AuditLog::query()->where('action', 'profile_change.proposed')->firstOrFail();

    expect($entry->actor_id)->toBe($person->id)
        // The request, not the person: nothing about the person changed.
        ->and($entry->entity_type)->toBe('profile_change_request')
        ->and($entry->entity_id)->toBe($id)
        ->and($entry->bookshelf_id)->toBe($shelf->id)
        ->and($entry->before)->toBe(['phone' => '0911111111'])
        ->and($entry->after)->toBe(['phone' => '0922222222']);

    // phrase() is private, so the arm is asserted through the public
    // sentence() — a missing arm would render the undescribed-action
    // fallback here instead.
    expect(AuditSentences::sentence('profile_change.proposed', [
        'actor' => 'Maria Nguyễn Thị Lan', 'subject' => null,
        'before' => $entry->before, 'after' => $entry->after,
    ]))->toBe('Maria Nguyễn Thị Lan đã gửi yêu cầu đổi thông tin')
        ->and(AuditSentences::groupOf('profile_change.proposed'))->toBe('readers');
});

it('the reader posts the form and gets their proposal back on the same page', function () {
    [$shelf, $person] = propFixture();

    $this->actingAs($person)
        ->post("/shelves/{$shelf->slug}/profile/change-request", [
            'saint_name' => 'Maria',
            'full_name' => 'Nguyễn Thị Lan',
            'date_of_birth' => '2015-04-02',
            'father_name' => 'Nguyễn Văn Hoà',
            'mother_name' => 'Trần Thị Mai',
            'phone' => '0922222222',
            'email' => '',
            // The pin: the form does not carry this field and the request
            // class holds no rule for it, so validated() drops it and a
            // reader can never point their avatar at an arbitrary object.
            'avatar_object' => 'avatars/somebody-elses-child.webp',
        ])
        ->assertRedirect()
        ->assertSessionHas('success');

    $request = ProfileChangeRequest::query()->withoutGlobalScopes()->firstOrFail();

    expect($request->proposed_values)->toBe(['phone' => '0922222222'])
        ->and($person->fresh()->phone)->toBe('0911111111');
});
