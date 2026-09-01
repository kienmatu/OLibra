<?php

use App\Actions\Admin\ChangeOwnPassword;
use App\Actions\Members\SetReaderCredentials;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\Audit\AuditSentences;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * Phase 3c-i Task 7 — ChangeOwnPassword (spec D12).
 *
 * THE SESSION ASSERTIONS ARE WRITTEN AGAINST ROWS, not against the
 * authenticated state, and that is not a stylistic choice. `phpunit.xml:72`
 * forces `SESSION_DRIVER=array` with `force="true"`, so no test in this
 * suite ever writes a `sessions` row of its own and every `assertGuest()`
 * -shaped assertion about a revocation passes whether or not the delete
 * exists. The table is real (0001_01_01_000000_create_users_table.php,
 * indexed on user_id), so the rows are seeded here and counted afterwards —
 * the shape SetReaderCredentialsTest already uses for its own revocation.
 *
 * @return array{Bookshelf, User, Membership} shelf, the person, their membership
 */
function cowFixture(string $password = 'mat-khau-cu-1'): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $person = User::factory()->withCredentials('lan.nguyen', $password)->create([
        'full_name' => 'Nguyễn Thị Lan',
    ]);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $person->id, 'role' => 'reader', 'status' => 'active',
    ]);

    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($person);

    return [$shelf, $person, $membership];
}

it('changes the password when the current one is right', function () {
    [, $person, $membership] = cowFixture();

    app(ChangeOwnPassword::class)->execute($person, $membership, 'mat-khau-cu-1', 'mat-khau-moi-2');

    expect(Hash::check('mat-khau-moi-2', $person->fresh()->password_hash))->toBeTrue();
});

it('refuses a wrong current password, and the stored hash does not move', function () {
    [, $person, $membership] = cowFixture();
    $before = $person->password_hash;

    expect(fn () => app(ChangeOwnPassword::class)
        ->execute($person, $membership, 'khong-phai-mat-khau', 'mat-khau-moi-2'))
        ->toThrow(RuleViolated::class, 'current_password_incorrect');

    expect($person->fresh()->password_hash)->toBe($before)
        ->and(Hash::check('mat-khau-moi-2', $person->fresh()->password_hash))->toBeFalse();
});

it('an account with no password at all fails identically — never "you have no password"', function () {
    [, $person, $membership] = cowFixture();
    $person->username = null;
    $person->password_hash = null;
    $person->save();

    // INV-14 makes credential-less a valid state, and telling a caller
    // apart from a wrong password would say which accounts have never been
    // given credentials. Same reasoning LoginRequest's single Hash::check
    // carries.
    expect(fn () => app(ChangeOwnPassword::class)
        ->execute($person, $membership, 'bat-ky', 'mat-khau-moi-2'))
        ->toThrow(RuleViolated::class, 'current_password_incorrect');
});

it('refuses a short new password with its OWN code, not SetReaderCredentials\'', function () {
    [, $person, $membership] = cowFixture();

    expect(fn () => app(ChangeOwnPassword::class)
        ->execute($person, $membership, 'mat-khau-cu-1', 'ngan'))
        ->toThrow(RuleViolated::class, 'new_password_too_short');

    // Both codes have a Vietnamese sentence, and they are DIFFERENT
    // sentences — the form carries two password boxes and has to say which.
    expect(__('rules.new_password_too_short'))->not->toBe('rules.new_password_too_short')
        ->and(__('rules.current_password_incorrect'))->not->toBe('rules.current_password_incorrect')
        ->and(__('rules.new_password_too_short'))->not->toBe(__('rules.password_too_short'));
});

it('ends every session that person had, and nobody else\'s', function () {
    [, $person, $membership] = cowFixture();
    $bystander = User::factory()->create();
    DB::table('sessions')->insert([
        ['id' => 'own-session-1', 'user_id' => $person->id, 'payload' => '', 'last_activity' => 1],
        ['id' => 'own-session-2', 'user_id' => $person->id, 'payload' => '', 'last_activity' => 1],
        ['id' => 'bystander-session', 'user_id' => $bystander->id, 'payload' => '', 'last_activity' => 1],
    ]);

    app(ChangeOwnPassword::class)->execute($person, $membership, 'mat-khau-cu-1', 'mat-khau-moi-2');

    expect(DB::table('sessions')->where('user_id', $person->id)->count())->toBe(0)
        ->and(DB::table('sessions')->where('user_id', $bystander->id)->count())->toBe(1);
});

it('leaves the sessions alone when the change is refused — one transaction, not two', function () {
    [, $person, $membership] = cowFixture();
    DB::table('sessions')->insert([
        ['id' => 'own-session-1', 'user_id' => $person->id, 'payload' => '', 'last_activity' => 1],
    ]);

    expect(fn () => app(ChangeOwnPassword::class)
        ->execute($person, $membership, 'khong-phai-mat-khau', 'mat-khau-moi-2'))
        ->toThrow(RuleViolated::class);

    expect(DB::table('sessions')->where('user_id', $person->id)->count())->toBe(1);
});

it('audits user.password_changed against the USER, with no before, no after and no secret in the row', function () {
    [, $person, $membership] = cowFixture();

    app(ChangeOwnPassword::class)->execute($person, $membership, 'mat-khau-cu-1', 'mat-khau-moi-2');

    $entry = AuditLog::query()->where('action', 'user.password_changed')->firstOrFail();
    $row = json_encode($entry->getAttributes());

    expect($entry->actor_id)->toBe($person->id)
        ->and($entry->entity_type)->toBe('user')
        ->and($entry->entity_id)->toBe($person->id)
        ->and($entry->before)->toBeNull()
        ->and($entry->after)->toBeNull()
        ->and($row)->not->toContain('mat-khau-moi-2')
        ->and($row)->not->toContain('mat-khau-cu-1')
        ->and($row)->not->toContain((string) $person->fresh()->password_hash);
});

it('reads as a Vietnamese sentence naming the person, and not as the volunteer\'s sentence', function () {
    // The whole reason spec D12 keeps two actions rather than merging them:
    // an oversight screen must be able to tell "they changed their own"
    // from "somebody set it for them".
    //
    // phrase() is private, so the arm is asserted through the public
    // sentence() — a missing arm renders the undescribed-action fallback
    // here instead.
    $facts = [
        'actor' => 'Maria Nguyễn Thị Lan', 'subject' => 'Maria Nguyễn Thị Lan',
        'before' => null, 'after' => null,
    ];
    $mine = AuditSentences::sentence('user.password_changed', $facts);
    $theirs = AuditSentences::sentence('credentials.set', $facts);

    expect($mine)->toContain('Maria Nguyễn Thị Lan')
        ->and($mine)->not->toBe($theirs)
        ->and(AuditSentences::groupOf('user.password_changed'))->toBe('readers');
});

it('the volunteer path is untouched and still audits credentials.set', function () {
    // BR:79: a volunteer setting a password stays possible and stays
    // VISIBLE. Task 7 added a second path; it did not narrow this one.
    [$shelf, $person, $membership] = cowFixture();

    $manager = User::factory()->create();
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    app(SetReaderCredentials::class)->execute($manager, $membership, 'lan.nguyen', 'mat-khau-moi-3');

    expect(AuditLog::query()->where('action', 'credentials.set')->count())->toBe(1)
        ->and(AuditLog::query()->where('action', 'user.password_changed')->count())->toBe(0)
        ->and(Hash::check('mat-khau-moi-3', $person->fresh()->password_hash))->toBeTrue();
});

it('a reader changes their own password over HTTP, from their own page', function () {
    [$shelf, $person] = cowFixture();
    DB::table('sessions')->insert([
        ['id' => 'own-session-1', 'user_id' => $person->id, 'payload' => '', 'last_activity' => 1],
    ]);

    $this->actingAs($person)
        ->from("/shelves/{$shelf->slug}/profile")
        ->post("/shelves/{$shelf->slug}/profile/password", [
            'current_password' => 'mat-khau-cu-1',
            'new_password' => 'mat-khau-moi-2',
        ])
        ->assertRedirect("/shelves/{$shelf->slug}/profile")
        ->assertSessionHasNoErrors();

    expect(Hash::check('mat-khau-moi-2', $person->fresh()->password_hash))->toBeTrue()
        ->and(DB::table('sessions')->where('user_id', $person->id)->count())->toBe(0);
});

it('a wrong current password over HTTP comes back as the Vietnamese sentence, not a 500', function () {
    [$shelf, $person] = cowFixture();

    $response = $this->actingAs($person)
        ->from("/shelves/{$shelf->slug}/profile")
        ->post("/shelves/{$shelf->slug}/profile/password", [
            'current_password' => 'khong-phai-mat-khau',
            'new_password' => 'mat-khau-moi-2',
        ]);

    $response->assertRedirect("/shelves/{$shelf->slug}/profile")
        ->assertSessionHasErrors(['rule' => __('rules.current_password_incorrect')]);

    expect(Hash::check('mat-khau-moi-2', $person->fresh()->password_hash))->toBeFalse();
});
