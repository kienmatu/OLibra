<?php

use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Inertia\Testing\AssertableInertia as Assert;

/** @return array{Bookshelf, User, Membership, User} shelf, manager, reader membership, reader person */
function rdFixture(string $status = 'active'): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $manager = User::factory()->create();
    Membership::factory()->for($shelf)->manager()->create(['user_id' => $manager->id, 'status' => 'active']);
    $person = User::factory()->create([
        'full_name' => 'Nguyễn Thị Lan', 'date_of_birth' => '2015-04-02',
        'phone' => '0911111111', 'phone_missing_reason' => null,
    ]);
    $membership = Membership::factory()->for($shelf)->create(['user_id' => $person->id, 'status' => $status]);

    return [$shelf, $manager, $membership, $person];
}

it('renders the full profile with manager-only fields and no hash', function () {
    [$shelf, $manager, $membership, $person] = rdFixture();
    $person->username = 'lan.nguyen';
    $person->password_hash = Hash::make('mat-khau-123');
    $person->save();

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/readers/{$membership->id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/readers/show')
            ->where('reader.fullName', 'Nguyễn Thị Lan')
            ->where('reader.dateOfBirth', '2015-04-02')
            ->where('reader.phone', '0911111111')
            ->where('reader.hasCredentials', true)
            ->where('reader.username', 'lan.nguyen')
            ->missing('reader.passwordHash'));
});

it('sets credentials from the detail page', function () {
    [$shelf, $manager, $membership, $person] = rdFixture();

    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/readers/{$membership->id}/credentials", [
            'username' => 'lan.nguyen', 'password' => 'mat-khau-123',
        ])->assertRedirect("/shelves/{$shelf->slug}/manage/readers/{$membership->id}");

    expect($person->fresh()->username)->toBe('lan.nguyen');
});

it('setCredentials over HTTP revokes the reader\'s existing sessions', function () {
    [$shelf, $manager, $membership, $person] = rdFixture();

    DB::table('sessions')->insert([
        'id' => 'reader-detail-session-under-test',
        'user_id' => $person->id,
        'ip_address' => '127.0.0.1',
        'user_agent' => 'pest',
        'payload' => base64_encode('irrelevant'),
        'last_activity' => time(),
    ]);

    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/readers/{$membership->id}/credentials", [
            'username' => 'lan.nguyen', 'password' => 'mat-khau-123',
        ])->assertRedirect();

    expect(DB::table('sessions')->where('user_id', $person->id)->exists())->toBeFalse();
});

it('suspend REQUIRES a reason at the screen even though the command\'s is optional', function () {
    [$shelf, $manager, $membership] = rdFixture();

    // The reference's NO_SUSPENSION_REASON: a suspension with no
    // explanation is a decision nobody at the shelf next month can act on
    // — the screen asks before the command ever sees the request, in its
    // own sentence, distinct from reject's.
    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/readers/{$membership->id}/suspend", ['reason' => ''])
        ->assertSessionHasErrors(['reason' => __('rules.suspension_reason_required')]);

    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/readers/{$membership->id}/suspend", ['reason' => 'Mượn quá lâu'])
        ->assertRedirect();

    expect($membership->fresh()->status->value)->toBe('suspended');
});

it('reactivate and mark-left round-trip from the detail page', function () {
    [$shelf, $manager, $membership] = rdFixture('suspended');

    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/readers/{$membership->id}/reactivate")
        ->assertRedirect();
    expect($membership->fresh()->status->value)->toBe('active');

    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/readers/{$membership->id}/mark-left")
        ->assertRedirect();
    expect($membership->fresh()->status->value)->toBe('left');
});

it('corrects the profile with a PATCH, and a stale-state refusal reads as the rule sentence', function () {
    [$shelf, $manager, $membership, $person] = rdFixture();

    $this->actingAs($manager)
        ->patch("/shelves/{$shelf->slug}/manage/readers/{$membership->id}/profile", [
            'saint_name' => 'Maria', 'full_name' => 'Nguyễn Thị Lan',
            'father_name' => $person->father_name, 'mother_name' => $person->mother_name,
            'phone' => '0922222222', 'phone_missing_reason' => '', 'email' => '', 'date_of_birth' => '2015-04-02',
        ])->assertRedirect();
    expect($person->fresh()->phone)->toBe('0922222222');

    // The unchanged resubmission: empty_proposal, as the rule error.
    $this->actingAs($manager)
        ->patch("/shelves/{$shelf->slug}/manage/readers/{$membership->id}/profile", [
            'saint_name' => 'Maria', 'full_name' => 'Nguyễn Thị Lan',
            'father_name' => $person->father_name, 'mother_name' => $person->mother_name,
            'phone' => '0922222222', 'phone_missing_reason' => '', 'email' => '', 'date_of_birth' => '2015-04-02',
        ])->assertSessionHasErrors(['rule' => __('rules.empty_proposal')]);
});

it('a key omitted from the PATCH body leaves that field untouched — presence, not blankness, is "leave alone"', function () {
    [$shelf, $manager, $membership, $person] = rdFixture();
    $person->email = 'lan.family@example.com';
    $person->save();
    $originalEmail = $person->email;

    // `email` is never mentioned at all here — key-presence semantics
    // (UpdateReaderProfileRequest's docblock, ProfileFields::normalisePatch)
    // say an absent key means "leave alone", distinct from a present empty
    // string (folded to null, meaning "clear"). Only phone actually changes.
    $this->actingAs($manager)
        ->patch("/shelves/{$shelf->slug}/manage/readers/{$membership->id}/profile", [
            'saint_name' => $person->saint_name, 'full_name' => $person->full_name,
            'father_name' => $person->father_name, 'mother_name' => $person->mother_name,
            'phone' => '0933333333', 'date_of_birth' => '2015-04-02',
        ])->assertRedirect();

    expect($person->fresh()->phone)->toBe('0933333333')
        ->and($person->fresh()->email)->toBe($originalEmail);
});

it('a foreign shelf\'s reader detail 404s', function () {
    [, $manager] = rdFixture();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $foreign = Membership::factory()->for($other)->create(['status' => 'active']);

    $this->actingAs($manager)
        ->get('/shelves/dong-thap/manage/readers/'.$foreign->id)
        ->assertNotFound();
});

it('a guest is redirected to login on the detail and every action', function () {
    [$shelf, , $membership] = rdFixture();

    $this->get("/shelves/{$shelf->slug}/manage/readers/{$membership->id}")->assertRedirect('/login');
    $this->post("/shelves/{$shelf->slug}/manage/readers/{$membership->id}/suspend", ['reason' => 'x'])->assertRedirect('/login');
});
