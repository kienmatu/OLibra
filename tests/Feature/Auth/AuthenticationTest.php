<?php

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
