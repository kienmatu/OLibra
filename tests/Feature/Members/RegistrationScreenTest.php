<?php

use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\ParishUnit;
use App\Models\Scopes\BookshelfScope;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Inertia\Testing\AssertableInertia as Assert;

// The named rate limiter counts EVERY attempt against this suite's one IP,
// and the array cache store survives across tests in one process — without
// this reset, earlier tests' posts would bleed into the throttle test (or
// worse, trip 429s in unrelated tests that run after it).
beforeEach(fn () => Cache::flush());

/** @return Bookshelf a registrable shelf with one live and one deleted unit */
function pubregShelf(): Bookshelf
{
    $shelf = Bookshelf::factory()->create([
        'slug' => 'dong-thap', 'name' => 'Tủ sách Đồng Tháp',
        'settings' => ['parish_taxonomy' => ['levels' => 1, 'nested' => false, 'level1_label' => 'Giáo họ', 'level2_label' => 'Tổ']],
    ]);
    ParishUnit::factory()->for($shelf)->create(['level' => 1, 'name' => 'Giáo họ Thánh Tâm']);
    ParishUnit::factory()->for($shelf)->create(['level' => 1, 'name' => 'Giáo họ Cũ'])->delete();

    return $shelf;
}

/** @return array<string, string> a complete valid POST body */
function pubregBody(array $over = []): array
{
    return array_merge([
        'shelf' => 'dong-thap',
        'saint_name' => 'Maria', 'full_name' => 'Nguyễn Thị Lan',
        'date_of_birth' => '2015-04-02', 'father_name' => 'Nguyễn Văn Hoà',
        'mother_name' => 'Trần Thị Mai', 'phone' => '0912345678',
    ], $over);
}

it('with no shelf named, renders the chooser rather than a form that cannot submit', function () {
    $this->get('/register')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('register')
            ->where('shelf', null));
});

it('with a shelf named, renders the form with that shelf\'s own labels and only its live units', function () {
    pubregShelf();

    $this->get('/register?shelf=dong-thap')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('register')
            ->where('shelf.name', 'Tủ sách Đồng Tháp')
            ->where('taxonomy.level1Label', 'Giáo họ')
            ->has('units', 1)
            ->where('units.0.name', 'Giáo họ Thánh Tâm'));
});

it('an unknown or archived slug gets the chooser, not an existence oracle', function () {
    $archived = Bookshelf::factory()->create(['slug' => 'da-luu-tru', 'status' => 'archived', 'settings' => []]);

    $this->get('/register?shelf=khong-ton-tai')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('shelf', null));

    $this->get('/register?shelf=da-luu-tru')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('shelf', null));
});

it('a guest submits and lands on the sent acknowledgement, with a pending membership behind it', function () {
    $shelf = pubregShelf();

    $this->post('/register', pubregBody())
        ->assertRedirect('/register?shelf=dong-thap&sent=1');

    $membership = Membership::query()->withoutGlobalScope(BookshelfScope::class)
        ->where('bookshelf_id', $shelf->id)->firstOrFail();
    expect($membership->status->value)->toBe('pending')
        ->and($this->app['auth']->guard()->check())->toBeFalse();
});

it('a refusal comes back as the rule sentence, and nothing typed enters the URL', function () {
    pubregShelf();

    $response = $this->from('/register?shelf=dong-thap')
        ->post('/register', pubregBody(['phone' => '']));

    $response->assertRedirect('/register?shelf=dong-thap')
        ->assertSessionHasErrors(['rule' => __('rules.thieu-so-dien-thoai')]);
    expect($response->headers->get('Location'))->not->toContain('Lan');
});

// Fix round, Task 13, Minor #1: a birth date must be a real day AND a
// plausible one — before this, only checkdate()'s calendar-validity ran,
// so 9999-12-31 sailed through and created a pending membership for a
// reader "born" in the year 9999.
it('a birth date in the future or implausibly ancient is a field error', function () {
    pubregShelf();

    $this->post('/register', pubregBody(['date_of_birth' => '9999-12-31']))
        ->assertSessionHasErrors('date_of_birth');

    $this->post('/register', pubregBody(['date_of_birth' => '1899-12-31']))
        ->assertSessionHasErrors('date_of_birth');

    $this->post('/register', pubregBody(['date_of_birth' => now()->addDay()->toDateString()]))
        ->assertSessionHasErrors('date_of_birth');
});

it('a mistyped password confirmation is a field error in Vietnamese', function () {
    pubregShelf();

    $this->post('/register', pubregBody([
        'username' => 'lan', 'password' => 'mat-khau-123', 'password_confirmation' => 'khac-di',
    ]))->assertSessionHasErrors('password');
});

it('an unknown shelf slug on POST is a named refusal', function () {
    $this->post('/register', pubregBody(['shelf' => 'khong-ton-tai']))
        ->assertSessionHasErrors(['rule' => __('rules.shelf_not_found')]);
});

it('a family registering three children in a row is never throttled', function () {
    // The test the per-IP-only design would have failed. Same connection,
    // same phone number, three children, seconds apart — BR §16.1's actual
    // scenario, and it must simply work.
    pubregShelf();

    foreach (['Nguyễn Thị Lan', 'Nguyễn Văn Bình', 'Nguyễn Ngọc Ánh'] as $i => $child) {
        $this->post('/register', pubregBody([
            'full_name' => $child, 'date_of_birth' => '201'.(4 + $i).'-04-02',
        ]))->assertRedirect('/register?shelf=dong-thap&sent=1');
    }

    expect(Membership::query()->withoutGlobalScope(BookshelfScope::class)->count())->toBe(3);
});

// Fix round, Task 13, CRITICAL: the register limiter used to read
// $request->string('phone') on the raw merged input bag, BEFORE
// RegisterMembershipRequest's own validation ever runs (throttle:register
// is route middleware; middleware always runs ahead of a controller
// method's Form Request resolution). Casting an array with Stringable
// throws `ErrorException: Array to string conversion`, promoted to a
// guest 500 by Laravel's own error handler — on the application's only
// unauthenticated write route. Reproduced over real HTTP first (see the
// fix report), then pinned here through the test client for all three
// array shapes the report named. A regression back to
// `$request->string('phone')` makes every one of these throw instead of
// redirecting.
it('an array-shaped phone (repeated key) never 500s the limiter', function () {
    pubregShelf();

    $this->post('/register', array_merge(pubregBody(), ['phone' => ['0912345678']]))
        ->assertStatus(302);
});

it('a nested-array-shaped phone never 500s the limiter', function () {
    pubregShelf();

    $this->post('/register', array_merge(pubregBody(), ['phone' => ['a' => ['b' => '09']]]))
        ->assertStatus(302);
});

it('an empty-array-shaped phone never 500s the limiter', function () {
    pubregShelf();

    $this->post('/register', array_merge(pubregBody(), ['phone' => []]))
        ->assertStatus(302);
});

// Fix round, Task 13: the day budget used to hash the RAW trimmed phone,
// so every spelling of one real phone number got its own 20/day bucket —
// six spellings, six buckets, a 120/day budget wearing a 20/day label.
// Phone::normalise() is what gets hashed now. Discriminates the day key
// specifically: all six posts share ONE phone's six spellings, well under
// the 30/minute IP budget, so only the day key can be what throttles the
// sixth attempt.
it('every spelling of one phone shares the same daily bucket', function () {
    pubregShelf();

    $spellings = ['0912345678', '0912 345 678', '0912.345.678', '0912-345-678', '+84912345678'];

    foreach ($spellings as $i => $phone) {
        $this->post('/register', pubregBody([
            'full_name' => 'Người Số '.$i, 'date_of_birth' => '201'.($i % 5).'-04-02',
            'phone' => $phone,
        ]))->assertStatus(302);
    }

    // A sixth spelling — genuinely distinct text, same underlying number —
    // is refused the identical way an exact repeat would be, once 20/day
    // is reached for real by padding out the same bucket first.
    foreach (range(1, 15) as $i) {
        $this->post('/register', pubregBody([
            'full_name' => 'Người Số Đệm '.$i, 'date_of_birth' => '2012-04-02',
            'phone' => '0912345678',
        ]));
    }

    $this->post('/register', pubregBody([
        'full_name' => 'Người Số Cuối', 'date_of_birth' => '2011-04-02',
        'phone' => '+84 912.345-678',
    ]))->assertStatus(429);
});

// Fix round, Task 13, Important #3: neither half of the two-key throttle
// had a permanent, DISCRIMINATING test — deleting Limit::perDay(20)
// outright left the full suite green, and so did replacing the IP
// fallback with an unbounded key. This test isolates the day key: 21
// posts sharing ONE phone, all well under the 30/minute IP budget (so the
// minute key cannot be what fires), the 21st expects 429. Mutation-proved
// in the fix report: deleting Limit::perDay(...) turns this red without
// touching Limit::perMinute(...) at all.
it('the day budget alone throttles 21 low-and-slow posts sharing one phone', function () {
    pubregShelf();

    foreach (range(1, 20) as $i) {
        $this->post('/register', pubregBody([
            'full_name' => 'Người Ngày '.$i, 'date_of_birth' => '2010-04-02',
        ]));
    }

    $this->post('/register', pubregBody([
        'full_name' => 'Người Ngày 21', 'date_of_birth' => '2010-04-02',
    ]))->assertStatus(429);
});

// Fix round, Task 13, Important #3: proves the IP fallback (used when
// phone is blank, so the phone-missing-reason path is not an open
// bypass) is load-bearing rather than decorative. Mutation-proved in the
// fix report: replacing the fallback expression with a per-request-unique
// value (so every blank-phone request gets its own bucket) turns this
// red — the 21st succeeds instead of 429ing.
it('the IP fallback throttles 21 blank-phone posts from one host', function () {
    pubregShelf();

    foreach (range(1, 20) as $i) {
        $this->post('/register', pubregBody([
            'full_name' => 'Người Ẩn Số '.$i, 'date_of_birth' => '2009-04-02',
            'phone' => '', 'phone_missing_reason' => 'chua co dien thoai',
        ]));
    }

    $this->post('/register', pubregBody([
        'full_name' => 'Người Ẩn Số 21', 'date_of_birth' => '2009-04-02',
        'phone' => '', 'phone_missing_reason' => 'chua co dien thoai',
    ]))->assertStatus(429);
});

it('the register limiter throttles a burst from one host', function () {
    pubregShelf();

    // 30 per minute per IP (open question 3): the 31st is 429. Distinct
    // phones per attempt so the DAY limit (20 per hashed phone) is not what
    // fires — this test is about the burst key, and the assertion would be
    // a lie about which limit caught it.
    foreach (range(1, 30) as $i) {
        $this->post('/register', pubregBody([
            'full_name' => 'Người Số '.$i,
            'phone' => '09'.str_pad((string) $i, 8, '0', STR_PAD_LEFT),
        ]));
    }

    // Fix round, Task 13, Important #4: pins that the 429 is the
    // Vietnamese view (resources/views/errors/429.blade.php), not
    // Laravel's stock English "Too Many Requests" page — the throttle
    // refusal a guest was previously most likely to ever meet.
    $this->post('/register', pubregBody(['full_name' => 'Người Số 31', 'phone' => '0999999999']))
        ->assertStatus(429)
        ->assertSee('Bạn gửi hơi nhanh');
});

// PO ruling 2026-08-28: the existence oracle itself is accepted (a guest
// resubmitting an already-registered identity learns "already registered"),
// but pending/active/suspended must stay INDISTINGUISHABLE from each other.
// upsertMembership() only ever throws already_registered_here for any of
// the three (MembershipTransitions::check's own return value is discarded,
// not surfaced) — this pins that at the HTTP layer: identical status code,
// identical redirect target, identical session error sentence, for all
// three starting statuses.
it('resubmitting an existing identity refuses identically whether pending, active or suspended', function () {
    $shelf = pubregShelf();

    // A DISTINCT identity triple per status, not one shared triple: the
    // no-username match is the exact full_name+date_of_birth+phone triple
    // (Registration::findExistingPerson), and three users sharing one
    // triple would all satisfy the same ->first() lookup — the match
    // would silently resolve to whichever row that query happens to
    // return first, not necessarily the membership under test for that
    // iteration, and the test would pass without ever exercising two of
    // the three statuses. Caught live: the FIRST version of this test
    // (one shared identity) stayed green through a mutation that made
    // "suspended" leak its own refusal code, because every iteration's
    // lookup kept resolving to the pending user created first.
    $identities = [
        'pending' => ['full_name' => 'Nguyễn Thị Lan', 'date_of_birth' => '2015-04-02', 'phone' => '0912345671'],
        'active' => ['full_name' => 'Nguyễn Văn Bình', 'date_of_birth' => '2014-04-02', 'phone' => '0912345672'],
        'suspended' => ['full_name' => 'Nguyễn Ngọc Ánh', 'date_of_birth' => '2013-04-02', 'phone' => '0912345673'],
    ];

    $responses = [];
    foreach ($identities as $status => $identity) {
        $person = User::factory()->create($identity);
        Membership::factory()->for($shelf)->create(['user_id' => $person->id, 'status' => $status]);

        $responses[$status] = $this->from('/register?shelf=dong-thap')
            ->post('/register', pubregBody($identity));
    }

    foreach ($responses as $status => $response) {
        $response->assertStatus(302)
            ->assertRedirect('/register?shelf=dong-thap')
            ->assertSessionHasErrors(['rule' => __('rules.already_registered_here')]);
    }

    // Fix round, Task 13, Minor #4: a redirect response's BODY is only
    // ever the framework's generic "Redirecting to ..." meta-refresh
    // boilerplate — the session error lives in the flashed session data,
    // never in the response body Laravel sends for a 302. Since the
    // redirect target is already pinned identical for all three statuses
    // (assertRedirect() above), comparing getContent() byte-for-byte adds
    // no coverage beyond that: it would stay green even if the session
    // error text silently diverged between statuses, because that text
    // never reaches the body being compared. The real pin is
    // assertSessionHasErrors() above, which reads the actual flashed
    // value. Dropped rather than kept as decoration.
});

// A signed-in visitor may still open the form (no guest middleware — a
// parent signed in at one shelf registers a child at another). Own it()
// block: the ONLY actingAs in this file, nothing after it.
it('a signed-in visitor may still open the registration form', function () {
    pubregShelf();
    $user = User::factory()->withCredentials('phu-huynh')->create();

    $this->actingAs($user)->get('/register?shelf=dong-thap')->assertOk();
});
