<?php

use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use Illuminate\Cookie\CookieValuePrefix;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Session;
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

it('a session revoked by setCredentials is DEAD ON ITS NEXT REQUEST, not merely absent from the row', function () {
    // The test above only proves the row is gone — it would pass even if a
    // bug deleted some OTHER row for the same user while the live session
    // kept working. Task 15's reviewer built the real proof and this ports
    // it: a genuine /login, the actual encrypted Set-Cookie, a forced
    // cookie -> id -> database read on the NEXT request (not an in-process
    // continuation of this one), then the same cookie re-presented after
    // the credential change.
    //
    // THREE separate things a naive two-request test gets for free and
    // must not, each confirmed live by breaking it and watching this exact
    // test fail before the fix (kept here because the next person tempted
    // to simplify this away will hit the same three in order):
    //
    //  1. Laravel's test client does not transport cookies between calls
    //     on its own — passing the decrypted id to $this->call(...,
    //     cookies:) and re-encrypting it by hand is what makes each
    //     request carry it, matching EncryptCookies' own shape.
    //
    //  2. `withCookie()` would have been the obvious way to attach it, but
    //     it writes into $this->defaultCookies, which is STICKY — it
    //     rides along on every later call in the test, including the
    //     unrelated manager POST below. Confirmed live: with withCookie(),
    //     the manager's credentials POST carried the reader's
    //     still-valid cookie as a passenger, so StartSession loaded the
    //     reader's OLD attributes (the auth-persisted `login_web_*` key)
    //     into memory before SetReaderCredentials deleted the row
    //     mid-transaction, and the middleware's end-of-request save()
    //     wrote those very attributes BACK under the same id —
    //     resurrecting the "revoked" session on a cookie the manager's own
    //     browser would never send. Passing cookies only to $this->call()
    //     keeps the manager POST cookie-free, matching a real browser.
    //
    //  3. Even cookie-isolated, the SAME session id can still look "alive"
    //     after being deleted, for a reason specific to this app's own
    //     boot: `Illuminate\Session\SessionServiceProvider` binds
    //     `StartSession::class` itself as a SINGLETON that captures ONE
    //     SessionManager (via `$app->make(SessionManager::class)`,
    //     independent of the 'session'/'session.store' container keys) at
    //     its first construction — normally invisible, but forgetInstance
    //     on 'session'/'auth' (needed for reason 2's own class of problem
    //     — the actingAs() guard-cache entry in known-gaps.md is the same
    //     mechanism from the other direction) does NOT rebuild this
    //     already-cached StartSession object, so it keeps re-using the
    //     SAME Store instance across every request in this test method.
    //     That would still be harmless IF the Store's own load merged
    //     cleanly — it does not: Store::loadSession() does
    //     `array_merge($this->attributes, $this->readFromHandler())`,
    //     which KEEPS a key already in memory (`login_web_*`) when the
    //     fresh read comes back empty. Confirmed live with an
    //     instrumented run: after the credentials POST genuinely emptied
    //     `sessions`, the next request's OWN read returned `[]`, yet
    //     `Auth::guard('web')->id()` still resolved to the reader — merged
    //     stale state, not a real read. Forgetting the `StartSession`
    //     singleton itself (in addition to 'session'/'session.store'/
    //     'auth') is what forces a truly fresh SessionManager and Store
    //     each time, closing the merge.
    //
    // Plain 'database', not the app's real 'hashed-database' default:
    // forgetInstance('session') discards the SessionManager entirely, and
    // its custom 'hashed-database' creator was registered once, at boot,
    // in AppServiceProvider — a freshly built SessionManager has never
    // seen that Session::extend() call and throws "Driver
    // [hashed-database] not supported." The hashing of the stored id is
    // AuthenticationTest's guarantee (`stores only the sha256 of the
    // session id`); this test's guarantee is orthogonal — that a session
    // is dead on its next request — and holds identically under either
    // driver, since both key the `sessions` row on the same `user_id`
    // column SetReaderCredentials deletes by.
    config()->set('session.driver', 'database');

    [$shelf, $manager, $membership, $person] = rdFixture();
    $person->username = 'lan.nguyen';
    $person->password_hash = Hash::make('mat-khau-cu');
    $person->save();

    $login = $this->post('/login', ['username' => 'lan.nguyen', 'password' => 'mat-khau-cu']);
    $login->assertRedirect('/');

    $cookieName = config('session.cookie');
    $rawSessionId = $login->getCookie($cookieName)->getValue();  // decrypted by TestResponse::getCookie()
    expect($rawSessionId)->not->toBeEmpty();

    // Re-encrypted by hand (the same shape
    // MakesHttpRequests::prepareCookiesForRequest() applies to
    // withCookie()) and handed straight to the low-level call() per
    // request — never via withCookie(), see reason 2 above.
    $readerCookie = fn () => [$cookieName => encrypt(
        CookieValuePrefix::create($cookieName, app('encrypter')->getKey()).$rawSessionId,
        false,
    )];

    $freshRequest = function () {
        // See reasons 2 and 3 above: both the container's cached
        // SessionManager/AuthManager AND the singleton StartSession
        // middleware object (which holds its own, separate SessionManager
        // reference) have to go, or the next request rides on in-memory
        // state instead of a real read.
        $this->app->forgetInstance('session');
        $this->app->forgetInstance('session.store');
        $this->app->forgetInstance('auth');
        $this->app->forgetInstance(StartSession::class);
        Auth::clearResolvedInstance('auth');
        Session::clearResolvedInstance('session');
    };

    // The positive half first — worthless as a proof without it: confirm
    // the captured cookie genuinely authenticates BEFORE the change.
    $freshRequest();
    $this->call('GET', "/shelves/{$shelf->slug}", cookies: $readerCookie())
        ->assertOk();

    $freshRequest();
    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/readers/{$membership->id}/credentials", [
            'username' => 'lan.nguyen', 'password' => 'mat-khau-moi',
        ])->assertRedirect();

    // The negative half: the SAME cookie, re-presented, on a genuinely
    // fresh request that never carried the manager's own state.
    $freshRequest();
    $this->call('GET', "/shelves/{$shelf->slug}", cookies: $readerCookie())
        ->assertRedirect('/login');
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
