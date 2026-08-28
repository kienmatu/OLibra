<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Inertia\Testing\AssertableInertia;

/**
 * @return array{Bookshelf, User, Membership, Book, BookCopy}
 */
function qlFix(string $slug = 'dong-thap-ql'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Ba Chạm Là Xong']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Cầm Sách Chờ']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'author' => 'Tô Hoài', 'slug' => 'de-men-ql',
    ]);
    $copy = BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0501', 'state' => 'available',
    ]);
    app(TenantContext::class)->clear();

    return [$shelf, $manager, $membership, $book, $copy];
}

it('step 1 searches and annotates each row with its block state', function () {
    [$shelf, $manager] = qlFix();

    $this->actingAs($manager)
        ->get(route('shelves.manage.lend', ['shelf' => $shelf->slug, 'q' => 'de men']))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/lend/index')
            ->where('filters.q', 'de men')
            ->count('results', 1)
            ->where('results.0.title', 'Dế Mèn Phiêu Lưu Ký')
            ->where('results.0.blocked', false));
});

it('step 2 carries the chosen book and searches readers with their block reasons', function () {
    [$shelf, $manager] = qlFix(slug: 'dong-thap-ql-s2');

    $this->actingAs($manager)
        ->get(route('shelves.manage.lend.reader', ['shelf' => $shelf->slug, 'book' => 'de-men-ql', 'q' => 'cam sach']))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/lend/reader')
            ->where('book.title', 'Dế Mèn Phiêu Lưu Ký')
            ->count('results', 1)
            ->where('results.0.fullName', 'Têrêsa Cầm Sách Chờ')
            ->where('results.0.blocked', false));
});

it('step 3 previews the pair, the chosen copy and the calculated due date', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 03:00:00', 'UTC'));
    [$shelf, $manager, $membership] = qlFix(slug: 'dong-thap-ql-s3');

    $this->actingAs($manager)
        ->get(route('shelves.manage.lend.confirm', [
            'shelf' => $shelf->slug, 'book' => 'de-men-ql', 'reader' => $membership->id,
        ]))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/lend/confirm')
            ->where('book.title', 'Dế Mèn Phiêu Lưu Ký')
            ->where('chosen.copyCode', 'DT-0501')
            ->where('reader.fullName', 'Têrêsa Cầm Sách Chờ')
            ->where('dueOn', '2026-09-11')
            ->where('blocking', null));
    Carbon::setTestNow();
});

it('a non-UUID-shaped ?reader= never reaches the membership bind (PR #62 review, finding 2)', function () {
    // memberships.id is ascii_bin — SafeId::isUuid() is the only thing
    // standing between this ?reader= value and Membership::find()'s bind.
    // Before this fix a hand-rolled `[0-9a-f-]{36}` regex played that
    // role: removing it left the full suite green (nothing pinned it) and
    // the live route 500'd on both invalid bytes and on ordinary
    // 36-character Vietnamese text. Both shapes below are exactly the
    // ones that reproduced the 500 live.
    [$shelf, $manager] = qlFix(slug: 'dong-thap-ql-safeid');

    $this->actingAs($manager)
        ->get(route('shelves.manage.lend.confirm', [
            'shelf' => $shelf->slug, 'book' => 'de-men-ql', 'reader' => 'Giáo họ Đức Mẹ Hằng Cứu Giúp X',
        ]))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->where('reader', null));

    $this->actingAs($manager)
        ->get(route('shelves.manage.lend.confirm', [
            'shelf' => $shelf->slug, 'book' => 'de-men-ql', 'reader' => '📚',
        ]))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->where('reader', null));
});

it('the confirm POST lends and redirects to step 1 with the success flash', function () {
    [$shelf, $manager, $membership, $book, $copy] = qlFix(slug: 'dong-thap-ql-post');

    $response = $this->actingAs($manager)->post(
        route('shelves.manage.lend.store', ['shelf' => $shelf->slug]),
        ['copy_id' => $copy->id, 'membership_id' => $membership->id],
    );

    $response->assertRedirect(route('shelves.manage.lend', ['shelf' => $shelf->slug]))
        ->assertSessionHas('success');
    expect(Loan::query()->where('copy_id', $copy->id)->where('status', 'active')->exists())->toBeTrue();

    // Carry-over fix, Task 10 review Important #1: assertSessionHas only
    // proves the value landed in the session — not that
    // HandleInertiaRequests::share() actually puts it on the `flash` prop
    // every page reads. lend/index.tsx:50 does an unguarded
    // `flash.success` with no optional chaining; deleting the three-line
    // `'flash' => [...]` block in share() left all 789 tests green before
    // this assertion existed, which would have white-screened this exact
    // redirect target in production instead of failing a test. The
    // flashed value survives into the NEXT request (Laravel's normal
    // flash-data lifecycle), so following the redirect with a fresh GET
    // in the same test — same session — is what actually proves the wire.
    $loan = Loan::query()->where('copy_id', $copy->id)->firstOrFail();
    $this->actingAs($manager)
        ->get(route('shelves.manage.lend', ['shelf' => $shelf->slug]))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/lend/index')
            ->where('flash.success', __('rules.lend_success_flash', [
                'title' => 'Dế Mèn Phiêu Lưu Ký',
                'name' => 'Têrêsa Cầm Sách Chờ',
                'due' => Illuminate\Support\Carbon::parse($loan->due_on)->format('d/m/Y'),
            ])));
});

it('a refusal comes back as errors.rule, in Vietnamese, with nothing written', function () {
    [$shelf, $manager, $membership, , $copy] = qlFix(slug: 'dong-thap-ql-refuse');
    // Deviation from the brief: no HTTP call has run yet at this point, so
    // no request has passed through ResolveTenant and TenantContext is
    // unbound (qlFix() itself ends with ->clear()). BookCopy carries
    // BookshelfScope, so an unscoped write here throws the same
    // "shelf-scoped but no tenant is bound" RuntimeException the
    // LendCopyTest.php fixture avoids by never clearing the context after
    // setup. actSystemWide()/clear() around the single write matches the
    // pattern already used in this file's own "foreign copy id" test below.
    app(TenantContext::class)->actSystemWide();
    BookCopy::query()->whereKey($copy->id)->update(['state' => 'on_loan']);
    app(TenantContext::class)->clear();

    $this->actingAs($manager)
        ->from(route('shelves.manage.lend.confirm', ['shelf' => $shelf->slug, 'book' => 'de-men-ql', 'reader' => $membership->id]))
        ->post(route('shelves.manage.lend.store', ['shelf' => $shelf->slug]),
            ['copy_id' => $copy->id, 'membership_id' => $membership->id])
        ->assertRedirect()
        ->assertSessionHasErrors(['rule' => 'Bản sách này đang được mượn hoặc đang giữ chỗ.']);
    expect(Loan::query()->count())->toBe(0);
});

it('a foreign copy id 404s out of the scoped resolution, never lends', function () {
    [$shelf, $manager, $membership] = qlFix(slug: 'dong-thap-ql-foreign');
    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho-ql', 'settings' => []]);
    $otherBook = Book::query()->create(['bookshelf_id' => $other->id, 'title' => 'Sách Tủ Khác', 'slug' => 'sach-khac-ql']);
    $foreign = BookCopy::query()->create(['bookshelf_id' => $other->id, 'book_id' => $otherBook->id, 'code' => 'CT-0501', 'state' => 'available']);
    app(TenantContext::class)->clear();

    $this->actingAs($manager)
        ->post(route('shelves.manage.lend.store', ['shelf' => $shelf->slug]),
            ['copy_id' => $foreign->id, 'membership_id' => $membership->id])
        ->assertNotFound();
    expect(Loan::query()->count())->toBe(0);
});

it('a guest is redirected to login', function () {
    [$shelf] = qlFix(slug: 'dong-thap-ql-guest');
    $this->get(route('shelves.manage.lend', ['shelf' => $shelf->slug]))
        ->assertRedirect(route('login'));
});

it('a reader 404s on every lend screen — 404, never 403 (BR §5.4)', function () {
    // Review fix: the draft asserted ONE of the four routes while its title
    // said "every lend screen". All four, including the POST.
    //
    // Carry-over fix, Task 10 review Minor #2: an earlier version of this
    // comment claimed the POST's 404 "comes from LendCopyRequest::
    // authorize's abort_unless(..., 404) rather than from the role
    // middleware" — false. Every route below sits inside
    // ['auth', 'role:manager'] (routes/web.php), and EnsureShelfRole
    // already 404s a non-manager before any controller or Form Request
    // runs; deleting the abort_unless from BOTH LendCopyRequest and
    // QuickLendRegisterReaderRequest leaves this whole suite green
    // (verified). The guards are harmless defence in depth for a future
    // middleware-ordering change (PR #61 Task 4's shape) — they are not
    // load-bearing for what THIS test checks, and this test does not pin
    // them. tests/Feature/Circulation/FormRequestAuthorize404Test.php pins
    // the guards themselves, directly, the way
    // tests/Feature/Members/FormRequestAuthorize404Test.php already does
    // for the five Members requests.
    [$shelf, , $membership, , $copy] = qlFix(slug: 'dong-thap-ql-reader404');
    $reader = User::query()->findOrFail($membership->user_id);

    $this->actingAs($reader)
        ->get(route('shelves.manage.lend', ['shelf' => $shelf->slug]))
        ->assertNotFound();
    $this->actingAs($reader)
        ->get(route('shelves.manage.lend.reader', ['shelf' => $shelf->slug, 'book' => 'de-men-ql']))
        ->assertNotFound();
    $this->actingAs($reader)
        ->get(route('shelves.manage.lend.confirm', ['shelf' => $shelf->slug, 'book' => 'de-men-ql', 'reader' => $membership->id]))
        ->assertNotFound();
    $this->actingAs($reader)
        ->get(route('shelves.manage.lend.reader.create', ['shelf' => $shelf->slug, 'book' => 'de-men-ql']))
        ->assertNotFound();
    $this->actingAs($reader)
        ->post(route('shelves.manage.lend.reader.store', ['shelf' => $shelf->slug]), qlNewReaderInput())
        ->assertNotFound();
    $this->actingAs($reader)
        ->post(route('shelves.manage.lend.store', ['shelf' => $shelf->slug]),
            ['copy_id' => $copy->id, 'membership_id' => $membership->id])
        ->assertNotFound();
    expect(Loan::query()->count())->toBe(0);
    // The POST that 404'd must also have written nothing.
    expect(Membership::query()->where('role', 'reader')->count())->toBe(1);
});

// ── The escape hatch (settled decision 3) ─────────────────────────────────

/**
 * BR §16.3's walk-up child. Names chosen outside UserFactory's five-name
 * pool and outside DemoShelfSeeder's, per the Global Constraints.
 *
 * @param  array<string, string>  $overrides
 * @return array<string, string>
 */
function qlNewReaderInput(array $overrides = []): array
{
    return [
        'saint_name' => 'Gioan',
        'full_name' => 'Lã Quốc Vinh',
        'date_of_birth' => '2015-04-02',
        'father_name' => 'Lã Quốc Bảo',
        'mother_name' => 'Vũ Thị Hạnh',
        'phone' => '',
        'phone_missing_reason' => 'Gia đình chưa có số điện thoại.',
        'email' => '',
        'parish_unit_l1_id' => '',
        'parish_unit_l2_id' => '',
        ...$overrides,
    ];
}

it('the escape hatch renders its own form and carries the chosen book through', function () {
    [$shelf, $manager] = qlFix(slug: 'dong-thap-ql-hatch-get');

    $this->actingAs($manager)
        ->get(route('shelves.manage.lend.reader.create', ['shelf' => $shelf->slug, 'book' => 'de-men-ql']))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/lend/new-reader')
            // The book slug is what makes this the LEND flow's form and not
            // the readers list's: without it the POST has nowhere to return
            // to and the three-tap flow is broken in the middle.
            ->where('book.slug', 'de-men-ql')
            ->where('book.title', 'Dế Mèn Phiêu Lưu Ký')
            ->has('taxonomy')
            ->has('units'));
});

it('the escape hatch registers an ACTIVE reader and lands on the confirm step', function () {
    // 1b's open question 1 chose `active` precisely so this works. If
    // anyone ever flips ManagerRegisterReader to pending, THIS test says
    // what breaks: the redirect lands on confirm, and confirm blocks.
    [$shelf, $manager] = qlFix(slug: 'dong-thap-ql-hatch-post');

    $response = $this->actingAs($manager)->post(
        route('shelves.manage.lend.reader.store', ['shelf' => $shelf->slug]),
        qlNewReaderInput(['book' => 'de-men-ql']),
    );

    $created = Membership::query()
        ->whereHas('user', fn ($u) => $u->where('full_name', 'Lã Quốc Vinh'))
        ->firstOrFail();

    expect($created->status->value)->toBe('active')
        ->and($created->role->value)->toBe('reader');
    $response->assertRedirect(route('shelves.manage.lend.confirm', [
        'shelf' => $shelf->slug, 'book' => 'de-men-ql', 'reader' => $created->id,
    ]));
});

it('the reader the escape hatch created can be lent to in the same visit — no approval step', function () {
    // The whole justification for the hatch, end to end (BR §1.3's walk-up
    // child). It is a SEPARATE assertion from the status check above: a
    // membership could read `active` and still be refused by LendCopy for
    // another reason, and that would be the bug this catches.
    [$shelf, $manager, , , $copy] = qlFix(slug: 'dong-thap-ql-hatch-lend');

    $this->actingAs($manager)->post(
        route('shelves.manage.lend.reader.store', ['shelf' => $shelf->slug]),
        qlNewReaderInput(['book' => 'de-men-ql']),
    );
    $created = Membership::query()
        ->whereHas('user', fn ($u) => $u->where('full_name', 'Lã Quốc Vinh'))
        ->firstOrFail();

    $this->actingAs($manager)
        ->post(route('shelves.manage.lend.store', ['shelf' => $shelf->slug]),
            ['copy_id' => $copy->id, 'membership_id' => $created->id])
        ->assertRedirect(route('shelves.manage.lend', ['shelf' => $shelf->slug]))
        ->assertSessionHasNoErrors();

    expect(Loan::query()->where('copy_id', $copy->id)->where('borrower_id', $created->user_id)
        ->where('status', 'active')->exists())->toBeTrue();
});

it('the escape hatch validates before it writes, and a refusal writes nothing', function () {
    [$shelf, $manager] = qlFix(slug: 'dong-thap-ql-hatch-invalid');
    // Deviation from the brief: same unbound-tenant issue as the refusal
    // test above — Membership carries BookshelfScope too, and no request
    // has run yet at this line. Wrapped in actSystemWide()/clear() so the
    // before/after count is comparable and reads across every shelf,
    // exactly the visibility qlFix()'s own setup relies on.
    app(TenantContext::class)->actSystemWide();
    $before = Membership::query()->count();
    app(TenantContext::class)->clear();

    $this->actingAs($manager)
        ->from(route('shelves.manage.lend.reader.create', ['shelf' => $shelf->slug, 'book' => 'de-men-ql']))
        ->post(route('shelves.manage.lend.reader.store', ['shelf' => $shelf->slug]),
            qlNewReaderInput(['full_name' => '', 'book' => 'de-men-ql']))
        ->assertRedirect()
        ->assertSessionHasErrors('full_name');

    app(TenantContext::class)->actSystemWide();
    expect(Membership::query()->count())->toBe($before);
    app(TenantContext::class)->clear();
});

it('the escape hatch does not create the on-behalf pending path — that form is untouched', function () {
    // Settled decision 3's boundary: two forms, two meanings. The readers
    // list's form still lands `pending` (BR §16.1's explicit sentence);
    // only the lend flow's form lands `active`.
    [$shelf, $manager] = qlFix(slug: 'dong-thap-ql-hatch-boundary');

    $this->actingAs($manager)->post(
        route('shelves.manage.readers.store', ['shelf' => $shelf->slug]),
        qlNewReaderInput(['full_name' => 'Lã Quốc Khánh']),
    );

    $onBehalf = Membership::query()
        ->whereHas('user', fn ($u) => $u->where('full_name', 'Lã Quốc Khánh'))
        ->firstOrFail();

    expect($onBehalf->status->value)->toBe('pending');
});

// ── The copyless title, step 1 and step 3 (settled decision 4) ────────────

it('a copyless title says the same true sentence on the list and on the confirm step', function () {
    // Settled decision 4's agreement clause, pinned across BOTH surfaces in
    // one test so a fix to one and not the other cannot pass. Revert either
    // branch to copy_not_available and this goes red.
    [$shelf, $manager] = qlFix(slug: 'dong-thap-ql-copyless');
    app(TenantContext::class)->actSystemWide();
    Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Chiếc Lược Ngà', 'slug' => 'clg-ql',
    ]);
    app(TenantContext::class)->clear();

    $this->actingAs($manager)
        ->get(route('shelves.manage.lend', ['shelf' => $shelf->slug, 'q' => 'chiec luoc nga']))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->count('results', 1)
            ->where('results.0.blocked', true)
            ->where('results.0.reason', 'title_has_no_copies'));

    $this->actingAs($manager)
        ->get(route('shelves.manage.lend.confirm', ['shelf' => $shelf->slug, 'book' => 'clg-ql']))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('chosen', null)
            ->where('blocking', 'title_has_no_copies'));
});
