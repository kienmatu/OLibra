<?php

use App\Actions\Members\SetReaderCredentials;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/** @return array{Bookshelf, User, Membership, User} shelf, manager, reader membership, reader person */
function credFixture(string $actorRole = 'manager'): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $actor = User::factory()->create();
    $actorMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $actor->id, 'role' => $actorRole, 'status' => 'active',
    ]);
    $person = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create(['user_id' => $person->id, 'status' => 'active']);
    app(TenantContext::class)->set($shelf, $actorMembership);
    test()->actingAs($actor);

    return [$shelf, $actor, $membership, $person];
}

it('gives an account the ability to sign in for the first time', function () {
    [, $actor, $membership, $person] = credFixture();

    app(SetReaderCredentials::class)->execute($actor, $membership, 'lan.nguyen', 'mat-khau-123');

    $fresh = $person->fresh();
    expect($fresh->username)->toBe('lan.nguyen')
        ->and(Hash::check('mat-khau-123', $fresh->password_hash))->toBeTrue();
});

it('and gives it back to someone who forgot', function () {
    [, $actor, $membership, $person] = credFixture();
    $person->username = 'lan.nguyen';
    $person->password_hash = Hash::make('mat-khau-cu-1');
    $person->save();

    app(SetReaderCredentials::class)->execute($actor, $membership, 'lan.nguyen', 'mat-khau-moi-2');

    expect(Hash::check('mat-khau-moi-2', $person->fresh()->password_hash))->toBeTrue();
});

it('the audit entry names the manager, the reader and the time — with no before, no after, and no secret anywhere in the row', function () {
    [, $actor, $membership, $person] = credFixture();

    app(SetReaderCredentials::class)->execute($actor, $membership, 'lan.nguyen', 'mat-khau-123');

    $entry = AuditLog::query()->where('action', 'credentials.set')->firstOrFail();
    $row = json_encode($entry->getAttributes());

    expect($entry->actor_id)->toBe($actor->id)
        ->and($entry->entity_type)->toBe('user')
        ->and($entry->entity_id)->toBe($person->id)
        ->and($entry->before)->toBeNull()
        ->and($entry->after)->toBeNull()
        ->and($row)->not->toContain('mat-khau-123')
        ->and($row)->not->toContain($person->fresh()->password_hash);
});

it('setting credentials ends every session that reader already had, and nobody else\'s', function () {
    [, $actor, $membership, $person] = credFixture();
    $bystander = User::factory()->create();
    DB::table('sessions')->insert([
        ['id' => 'reader-session-1', 'user_id' => $person->id, 'payload' => '', 'last_activity' => 1],
        ['id' => 'reader-session-2', 'user_id' => $person->id, 'payload' => '', 'last_activity' => 1],
        ['id' => 'bystander-session', 'user_id' => $bystander->id, 'payload' => '', 'last_activity' => 1],
    ]);

    app(SetReaderCredentials::class)->execute($actor, $membership, 'lan.nguyen', 'mat-khau-123');

    expect(DB::table('sessions')->where('user_id', $person->id)->count())->toBe(0)
        ->and(DB::table('sessions')->where('user_id', $bystander->id)->count())->toBe(1);
});

it('a taken username is refused, case-insensitively, in the manager\'s words', function () {
    [, $actor, $membership] = credFixture();
    User::factory()->withCredentials('Lan.Nguyen')->create();

    expect(fn () => app(SetReaderCredentials::class)->execute($actor, $membership, 'lan.nguyen', 'mat-khau-123'))
        ->toThrow(RuleViolated::class, 'username_in_use');
});

it('keeping the same username while changing the password is not a collision', function () {
    [, $actor, $membership, $person] = credFixture();
    app(SetReaderCredentials::class)->execute($actor, $membership, 'lan.nguyen', 'mat-khau-123');

    app(SetReaderCredentials::class)->execute($actor, $membership, 'lan.nguyen', 'mat-khau-456');

    expect(Hash::check('mat-khau-456', $person->fresh()->password_hash))->toBeTrue();
});

it('a short password, and a blank username, are refused before any write', function () {
    [, $actor, $membership, $person] = credFixture();

    expect(fn () => app(SetReaderCredentials::class)->execute($actor, $membership, 'lan.nguyen', 'ngắn123'))
        ->toThrow(RuleViolated::class, 'password_too_short')
        ->and(fn () => app(SetReaderCredentials::class)->execute($actor, $membership, '   ', 'mat-khau-123'))
        ->toThrow(RuleViolated::class, 'required_fields_missing')
        ->and($person->fresh()->username)->toBeNull();
});

it('INV-10: a manager of one shelf cannot set credentials on another shelf\'s reader', function () {
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $foreign = Membership::factory()->for($other)->create(['status' => 'active']);
    [, $actor] = credFixture();

    expect(fn () => app(SetReaderCredentials::class)->execute($actor, $foreign, 'ai-do', 'mat-khau-123'))
        ->toThrow(ModelNotFoundException::class);
});

it('IMPORTANT 4: a soft-deleted identity cannot receive new credentials', function () {
    [, $actor, $membership, $person] = credFixture();
    $person->delete();

    expect(fn () => app(SetReaderCredentials::class)->execute($actor, $membership, 'lan.nguyen', 'mat-khau-123'))
        ->toThrow(RuleViolated::class, 'membership_not_found');
});

it('a reader cannot set anyone\'s credentials, including their own', function () {
    [, $actor, $membership] = credFixture('reader');

    expect(fn () => app(SetReaderCredentials::class)->execute($actor, $membership, 'lan.nguyen', 'mat-khau-123'))
        ->toThrow(AuthorizationException::class);
});

it('takes the locking re-read of the membership as the first statement of its transaction', function () {
    [, $actor, $membership] = credFixture();

    DB::enableQueryLog();
    app(SetReaderCredentials::class)->execute($actor, $membership, 'lan.nguyen', 'mat-khau-123');
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect($log)->not->toBe([])
        ->and(str_contains($log[0]['query'], 'memberships'))->toBeTrue('first query is not on memberships: '.$log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue('first query is not FOR UPDATE: '.$log[0]['query']);
});
