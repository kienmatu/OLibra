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

    $this->post('/register', pubregBody(['full_name' => 'Người Số 31', 'phone' => '0999999999']))
        ->assertStatus(429);
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

    // Not just "the same status code" — literally the same bytes back,
    // whichever status the caller happened to hit.
    expect($responses['pending']->getContent())->toBe($responses['active']->getContent())
        ->and($responses['active']->getContent())->toBe($responses['suspended']->getContent());
});

// A signed-in visitor may still open the form (no guest middleware — a
// parent signed in at one shelf registers a child at another). Own it()
// block: the ONLY actingAs in this file, nothing after it.
it('a signed-in visitor may still open the registration form', function () {
    pubregShelf();
    $user = User::factory()->withCredentials('phu-huynh')->create();

    $this->actingAs($user)->get('/register?shelf=dong-thap')->assertOk();
});
