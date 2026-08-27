<?php

use App\Http\Requests\Auth\LoginRequest;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

function authUser(string $username = 'lan', string $password = 'mat-khau-123'): User
{
    $user = new User([
        'saint_name' => 'Maria', 'full_name' => 'Nguyễn Thị Lan',
        'father_name' => 'Cha', 'mother_name' => 'Mẹ',
    ]);
    // Assigned directly, not via fillable — credentials never come from
    // request data (INV-14's pairing is the schema's to enforce).
    $user->username = $username;
    $user->password_hash = Hash::make($password);
    $user->save();

    return $user;
}

it('renders the login screen', function () {
    $this->get('/login')->assertOk();
});

it('signs in with username and password', function () {
    $user = authUser();

    $response = $this->post('/login', ['username' => 'lan', 'password' => 'mat-khau-123']);

    $response->assertRedirect('/');
    $this->assertAuthenticatedAs($user);
});

it('signs in case-insensitively on the username, never on the password', function () {
    $user = authUser();

    // The password half first, while still guest: a case-variant password
    // must be an ordinary failure, not a match.
    $this->from('/login')->post('/login', ['username' => 'lan', 'password' => 'MAT-KHAU-123'])
        ->assertSessionHasErrors('username');
    $this->assertGuest();

    $this->post('/login', ['username' => 'LAN', 'password' => 'mat-khau-123']);

    $this->assertAuthenticatedAs($user);
});

it('rejects a wrong password with one generic message', function () {
    authUser();

    $response = $this->from('/login')->post('/login', ['username' => 'lan', 'password' => 'sai']);

    // One code for wrong password, unknown username and a credential-less
    // account alike — distinguishing them would tell a caller which
    // accounts exist (src/auth/session.ts IMPORTANT 3, kept).
    $response->assertRedirect('/login')->assertSessionHasErrors('username');
    $this->assertGuest();
});

it('rejects an unknown username with the same message', function () {
    $this->from('/login')->post('/login', ['username' => 'nobody', 'password' => 'x'])
        ->assertSessionHasErrors('username');
    $this->assertGuest();
});

it('refuses an account with no credentials — most readers never sign in', function () {
    $user = new User([
        'saint_name' => 'Giuse', 'full_name' => 'Trần Minh',
        'father_name' => 'Cha', 'mother_name' => 'Mẹ',
    ]);
    $user->save();   // INV-14: username and password_hash both null

    $this->from('/login')->post('/login', ['username' => '', 'password' => 'x'])
        ->assertSessionHasErrors('username');
    $this->assertGuest();
});

it('stops resolving the session of a soft-deleted user on the next request', function () {
    $user = authUser();
    $this->post('/login', ['username' => 'lan', 'password' => 'mat-khau-123']);
    $this->assertAuthenticatedAs($user);

    $user->delete();   // safeguarding, a merged duplicate, a mistake undone

    $this->get('/')->assertStatus(200);   // the request completes…
    $this->assertGuest();                 // …signed out in substance, not just for new logins
});

it('hashes with argon2id', function () {
    expect(Hash::make('mat-khau-123'))->toStartWith('$argon2id$');
});

it('carries a well-formed, non-matching dummy hash for every hashing driver', function () {
    // LoginRequest::DUMMY_HASHES equalises timing between a wrong password
    // and an unknown username/credential-less account by checking the
    // submitted password against one of these instead of computing a fresh
    // hash per miss (found in review: a per-request Hash::make() pays a
    // full derivation on every unknown-username attempt, which is SLOWER
    // than a wrong password's single check — a 2.11x, trivially measurable
    // oracle in the wrong direction). Each literal must (a) be well-formed
    // for its own driver — BcryptHasher::check() throws outright on a
    // foreign hash format — and (b) never match anything a test or a real
    // user would type.
    $hashes = (new ReflectionClass(LoginRequest::class))
        ->getConstant('DUMMY_HASHES');

    expect($hashes)->toHaveKeys(['argon2id', 'argon', 'bcrypt']);

    foreach ($hashes as $driver => $hash) {
        config()->set('hashing.driver', $driver);

        expect(Hash::check('mat-khau-123', $hash))->toBeFalse()
            ->and(Hash::check('', $hash))->toBeFalse();
    }
});

it('signs out and invalidates the session', function () {
    authUser();
    $this->post('/login', ['username' => 'lan', 'password' => 'mat-khau-123']);

    $this->post('/logout')->assertRedirect('/');
    $this->assertGuest();
});

it('stores only the sha256 of the session id, never the raw id', function () {
    // phpunit.xml forces SESSION_DRIVER=array (so the suite at large never
    // touches the table); this test opts into the real driver explicitly —
    // without it the handler ships untested. The driver is resolved lazily
    // per name, so setting config before the first request is enough.
    config()->set('session.driver', 'hashed-database');

    authUser();
    $this->post('/login', ['username' => 'lan', 'password' => 'mat-khau-123']);

    $rawId = session()->getId();

    expect(DB::table('sessions')->count())->toBeGreaterThan(0)
        ->and(DB::table('sessions')->where('id', $rawId)->exists())->toBeFalse()
        ->and(DB::table('sessions')->where('id', hash('sha256', $rawId))->exists())->toBeTrue();
});

it('reads the session back on a second request under the hashed driver', function () {
    // Found in review: the test above proves write() hashes the id, but a
    // single POST-then-inspect-the-row never calls read() at all — if
    // read() were left un-overridden (looking the raw id up instead of its
    // hash), every session would silently fail to resolve on the very NEXT
    // request, and the test above would still pass. A second request is
    // what actually exercises read().
    config()->set('session.driver', 'hashed-database');

    $user = authUser();
    $this->post('/login', ['username' => 'lan', 'password' => 'mat-khau-123']);
    $this->assertAuthenticatedAs($user);

    $this->get('/')->assertOk();
    $this->assertAuthenticatedAs($user);
});
