<?php

use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

/** @return array{Bookshelf, User, Membership} shelf, manager, pending application */
function rqFixture(): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    // DEVIATION FROM BRIEF (tests/Feature/Members/RegistrationQueueScreenTest.php,
    // this fixture): the brief's own version left the manager's full_name
    // to UserFactory's default, which draws from a five-name fixed pool
    // (database/factories/UserFactory.php:16-20) — and one of those five is
    // literally 'Trần Minh'. PendingRegistrationsQuery's similar-name
    // lookup scores every ACTIVE membership on the shelf, managers
    // included, exactly as the reference does (old_next/src/domain/
    // members/queries/get-pending-registrations.ts's own `dup` subquery has
    // no role filter either — verified, not assumed). With the applicant
    // named 'Trần Minh Đức', an unlucky factory draw silently made the
    // MANAGER the "similar" match instead of the $existing fixture the
    // second test below deliberately sets up, an intermittent failure
    // reproduced directly (assertion saw 'Trần Minh', not 'Tran Minh').
    // Pinning the manager's own name here, distinct from every name in
    // that pool and from every name this file writes explicitly, removes
    // that collision instead of leaving the suite to fail one run in five.
    $manager = User::factory()->create(['full_name' => 'Quản Lý Đông Tháp']);
    Membership::factory()->for($shelf)->manager()->create(['user_id' => $manager->id, 'status' => 'active']);
    $applicant = User::factory()->create([
        'full_name' => 'Trần Minh Đức', 'date_of_birth' => '2014-09-01',
        'father_name' => 'Trần Văn Ba', 'mother_name' => 'Lê Thị Tư',
        'phone' => '0987654321', 'phone_missing_reason' => null,
    ]);
    $pending = Membership::factory()->for($shelf)->create(['user_id' => $applicant->id, 'status' => 'pending']);

    return [$shelf, $manager, $pending];
}

it('renders one review card per pending application, with the fields the manager verifies in person', function () {
    [$shelf, $manager] = rqFixture();

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/registrations")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/registrations/index')
            ->has('applications', 1)
            ->where('applications.0.fullName', 'Trần Minh Đức')
            ->where('applications.0.fatherName', 'Trần Văn Ba')
            ->where('applications.0.phone', '0987654321'));
});

it('the similar-name warning rides the card when an active member is close', function () {
    [$shelf, $manager] = rqFixture();
    $existing = User::factory()->create(['full_name' => 'Tran Minh']);
    Membership::factory()->for($shelf)->create(['user_id' => $existing->id, 'status' => 'active']);

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/registrations")
        ->assertInertia(fn (Assert $page) => $page
            ->where('applications.0.similarTo.fullName', 'Tran Minh'));
});

it('approve moves the application to active and returns to the queue', function () {
    [$shelf, $manager, $pending] = rqFixture();

    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/registrations/{$pending->id}/approve")
        ->assertRedirect();

    expect($pending->fresh()->status->value)->toBe('active')
        ->and($pending->fresh()->approved_by)->toBe($manager->id);
});

it('reject requires a reason, in OPS\'s own sentence, and stores it', function () {
    [$shelf, $manager, $pending] = rqFixture();

    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/registrations/{$pending->id}/reject", ['reason' => ''])
        ->assertSessionHasErrors(['reason' => __('rules.reject_reason_required')]);

    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/registrations/{$pending->id}/reject", ['reason' => 'Chưa gặp được gia đình'])
        ->assertRedirect();

    expect($pending->fresh()->status->value)->toBe('rejected')
        ->and($pending->fresh()->rejection_reason)->toBe('Chưa gặp được gia đình');
});

it('a decided application posted again gets the already-processed sentence', function () {
    [$shelf, $manager, $pending] = rqFixture();
    $pending->update(['status' => 'active']);

    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/registrations/{$pending->id}/approve")
        ->assertSessionHasErrors(['rule' => __('rules.registration_not_pending')]);
});

it('a foreign shelf\'s application 404s by binding, not 403', function () {
    [, $manager] = rqFixture();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $foreign = Membership::factory()->for($other)->create(['status' => 'pending']);
    $shelfSlug = 'dong-thap';

    $this->actingAs($manager)
        ->post("/shelves/{$shelfSlug}/manage/registrations/{$foreign->id}/approve")
        ->assertNotFound();
});

it('a guest is redirected to login', function () {
    [$shelf] = rqFixture();

    $this->get("/shelves/{$shelf->slug}/manage/registrations")->assertRedirect('/login');
});
