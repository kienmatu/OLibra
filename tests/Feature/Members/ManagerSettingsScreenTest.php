<?php

use App\Models\Bookshelf;
use App\Models\BookshelfContact;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Route;
use Inertia\Testing\AssertableInertia;

/**
 * Phase 3b-ii Task 6: `shelves/{shelf}/manage/settings` — OPS §3.4's
 * `GetShelfSettings`, read-only, for the shelf's own manager.
 *
 * **THIS FILE'S SUBJECT IS AN ABSENCE, WHICH IS THE HARDEST THING TO TEST
 * HONESTLY.** "The screen renders no control" has two vacuous spellings and
 * one that works, and the task named all three in advance:
 *
 * 1. A raw grep of the `.tsx` for `<form` is **defeated by a comment**. That
 *    is not hypothetical: `AdminScreensRenderFeedbackTest` exists because a
 *    raw grep passed on prose after the block itself had been deleted, and
 *    `resources/js/pages/manage/settings.tsx` deliberately writes the word
 *    in its header so that a stripping test and a naive one disagree. Every
 *    source read below goes through `tests/Pest.php`'s `screenSource`.
 * 2. A route-absence assertion **alone** is green against an empty
 *    implementation, because no write verb existed under this path before
 *    this task either. So it never stands alone here.
 * 3. And a source assertion can be worthless even when it looks right:
 *    Task 5 shipped one whose needle also occurred three hundred lines away
 *    in an unrelated loop, so the mutation it was written for left it green.
 *    The needles below are the ones a form would introduce and nothing else
 *    on a read-only page has any use for — `useForm`, `<form`, `router.post`
 *    — checked as absences, plus a positive read of the values so that an
 *    empty file cannot satisfy them.
 *
 * **THE MUTATION IS ADDITIVE**, and it has to be: there is no existing code
 * whose removal would make a control appear. Watched failing — a
 * `useForm`/`<form>` block added to the screen and a `POST
 * manage/settings/policy` route added to `routes/web.php` turn BOTH halves
 * red; both removed by targeted edit, green, and `git status --porcelain`
 * clean.
 *
 * **WHY THERE IS NO CONTROL AT ALL** (spec D4): `UpdateBookshelfPolicy`
 * authorizes internally as a super administrator and denies as a 404, so a
 * manager pressing a save would get neither the change nor an explanation;
 * the reference's own row component renders plain text and says so in its
 * docstring; and BR §16.3's fourteen manager screens do not include
 * Settings.
 *
 * Grep first: `grep -rn "^function settingsFix" tests/`.
 *
 * @return array{Bookshelf, User} shelf, its manager
 */
function settingsFix(string $slug = 'dong-thap-settings', array $settings = []): array
{
    app(TenantContext::class)->actSystemWide();

    $shelf = Bookshelf::factory()->create([
        'slug' => $slug,
        'name' => 'Tủ sách Giáo xứ Đồng Tháp',
        'location' => 'Nhà xứ Thánh Tâm',
        'address' => '12 Nguyễn Huệ, Cao Lãnh',
        'settings' => $settings,
    ]);

    $manager = User::factory()->create(['full_name' => 'Maria Nguyễn Quản Lý']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);

    return [$shelf, $manager];
}

it('shows the shelf\'s own eight policy values, not the defaults', function () {
    // THE FAILURE MODE OF A SETTINGS SCREEN IS THAT IT IS BELIEVED. The
    // reference printed six literals that happened to equal the defaults, so
    // a shelf lending for twenty-one days read "14 ngày" here and nothing
    // disagreed out loud. Every value below is overridden AWAY from its
    // default, and both booleans are flipped false, so a screen wired to the
    // fallbacks rather than to the row fails on all eight.
    [$shelf, $manager] = settingsFix('dong-thap-settings-policy', [
        'loan_days' => 21,
        'max_concurrent_loans' => 5,
        'max_renewals' => 0,
        'renewal_days' => 10,
        'hold_days' => 2,
        'due_soon_days' => 0,
        'comments_enabled' => false,
        'comments_require_approval' => false,
    ]);

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/settings")
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/settings')
            ->where('profile.name', 'Tủ sách Giáo xứ Đồng Tháp')
            ->where('profile.location', 'Nhà xứ Thánh Tâm')
            ->where('profile.address', '12 Nguyễn Huệ, Cao Lãnh')
            ->where('policy.loanDays', 21)
            ->where('policy.maxConcurrentLoans', 5)
            // The two real zeroes: "no renewals allowed" and "remind on the
            // due date itself" are policies, not unset fields, and a screen
            // that read them off a `?:` would print 1 and 3 here.
            ->where('policy.maxRenewals', 0)
            ->where('policy.renewalDays', 10)
            ->where('policy.holdDays', 2)
            ->where('policy.dueSoonDays', 0)
            ->where('policy.commentsEnabled', false)
            ->where('policy.commentsRequireApproval', false));
});

it('falls back to the shipped defaults for a shelf that has never been configured', function () {
    // The other direction, and it is not symmetry for its own sake: an empty
    // `settings` bag is what every new shelf has, and 14/3/1/7/3/3 with both
    // comment settings true is what such a shelf ACTUALLY does. Reading the
    // bag directly here would be an undefined-key crash rather than a
    // statement about behaviour, which is why the controller reads through
    // LendingSettings and CommentSettings.
    [$shelf, $manager] = settingsFix('dong-thap-settings-defaults');

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/settings")
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('policy.loanDays', 14)
            ->where('policy.maxConcurrentLoans', 3)
            ->where('policy.maxRenewals', 1)
            ->where('policy.renewalDays', 7)
            ->where('policy.holdDays', 3)
            ->where('policy.dueSoonDays', 3)
            ->where('policy.commentsEnabled', true)
            ->where('policy.commentsRequireApproval', true)
            // The taxonomy's own per-field fallback, through ParishTaxonomy:
            // one level, "Tổ", not nested.
            ->where('taxonomy.levels', 1)
            ->where('taxonomy.nested', false)
            ->where('taxonomy.level1Label', 'Tổ')
            ->where('taxonomy.level2Label', 'Tổ'));
});

it('lists the shelf\'s contacts in position order and skips the empty slot', function () {
    [$shelf, $manager] = settingsFix('dong-thap-settings-contacts', [
        'parish_taxonomy' => [
            'levels' => 2, 'nested' => true, 'level1_label' => 'Giáo họ', 'level2_label' => 'Tổ',
        ],
    ]);

    // Positions 3 and 1, written out of order and with 2 left empty: a
    // retired volunteer frees a position without shifting the others, and
    // this screen is a DENSE list rather than the admin editor's three fixed
    // blocks, so the gap is simply not a line.
    BookshelfContact::query()->create([
        'bookshelf_id' => $shelf->id, 'position' => 3,
        'name' => 'Anh Trần Văn Ba', 'phone' => '0912345678', 'role_label' => null,
    ]);
    BookshelfContact::query()->create([
        'bookshelf_id' => $shelf->id, 'position' => 1,
        'name' => 'Sơ Maria Nguyễn', 'phone' => '0987654321', 'role_label' => 'Người giữ chìa khoá',
    ]);

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/settings")
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->has('contacts', 2)
            ->where('contacts.0.position', 1)
            ->where('contacts.0.name', 'Sơ Maria Nguyễn')
            ->where('contacts.0.phone', '0987654321')
            ->where('contacts.0.roleLabel', 'Người giữ chìa khoá')
            ->where('contacts.1.position', 3)
            // Blank vai trò travels as null; the screen supplies the generic
            // heading rather than the server inventing one.
            ->where('contacts.1.roleLabel', null)
            ->where('taxonomy.levels', 2)
            ->where('taxonomy.nested', true)
            ->where('taxonomy.level1Label', 'Giáo họ'));
});

it('another shelf\'s contacts never reach this page', function () {
    // The route group binds a tenant and BookshelfContact carries the shelf
    // scope, so this passes by construction — which is exactly why it is
    // asserted. The contacts are reached through the relation rather than a
    // hand-written predicate, and a later edit that widened the read would
    // return every parish's volunteers and their telephone numbers.
    [$shelf, $manager] = settingsFix('dong-thap-settings-scope');
    [$other] = settingsFix('other-parish-settings-scope');

    BookshelfContact::query()->create([
        'bookshelf_id' => $other->id, 'position' => 1,
        'name' => 'Người của giáo xứ khác', 'phone' => '0900000000', 'role_label' => null,
    ]);

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/settings")
        ->assertInertia(fn (AssertableInertia $page) => $page->has('contacts', 0));
});

it('there is deliberately no write route under manage/settings', function () {
    // HALF ONE of the absence, and the precedent is
    // CatalogueArchitectureTest's "there is deliberately no delete-book
    // route". If this test surprises you, read spec D4 before "fixing" it:
    // UpdateBookshelfPolicy answers a manager with a 404, so a route here
    // would not be a missing feature restored but a dead end shipped.
    //
    // Census over the whole route table rather than a named-route lookup: a
    // writer added under any name, on any verb, under this path is what this
    // is for.
    $writes = collect(Route::getRoutes())
        ->filter(fn ($route) => str_starts_with($route->uri(), 'shelves/{shelf}/manage/settings'))
        ->reject(fn ($route) => $route->methods() === ['GET', 'HEAD'])
        ->map(fn ($route) => implode('|', $route->methods()).' '.$route->uri())
        ->values()
        ->all();

    expect($writes)->toBe([]);

    // …and the GET itself exists, so this block cannot pass by the path
    // having been renamed out from under it.
    $read = collect(Route::getRoutes())
        ->first(fn ($route) => $route->uri() === 'shelves/{shelf}/manage/settings'
            && in_array('GET', $route->methods(), true));

    expect($read)->not->toBeNull();
});

it('the screen itself reaches for no form', function () {
    // HALF TWO, and the one a route census cannot see: a component may
    // perfectly well post to somebody else's route. COMMENT-STRIPPED, and
    // the screen's own header writes `<form` in prose precisely so that the
    // difference between this test and a naive grep is visible rather than
    // asserted.
    $source = screenSource('manage/settings.tsx');

    // The needles are the three things a control would introduce and that a
    // read-only page has no other use for. Chosen for that: Task 5's
    // measurement was that a needle occurring anywhere else in the file
    // stays green under the mutation it was written for.
    //
    // ONE NEEDLE PER CALL, AND NO FAILURE MESSAGE ARGUMENT. Pest's
    // `toContain` is VARIADIC over needles — it takes no message — so the
    // obvious `->not->toContain($needle, "…reaches for {$needle}")` passes
    // the message as a SECOND NEEDLE, and the negation is then satisfied by
    // that string being absent whatever the first needle does. Measured:
    // written that way, this block stayed green with a `useForm` and a
    // `<form>` block both present in the screen. `str_contains` states the
    // one thing meant, and carries the name of what failed.
    foreach (['useForm', '<form', 'router.post', 'method="post"'] as $needle) {
        expect(str_contains($source, $needle))
            ->toBeFalse("manage/settings.tsx reaches for {$needle}");
    }

    // NOT VACUOUS ON AN EMPTY FILE: the eight values, the contacts and the
    // taxonomy are read here, and the reference's sentence saying who may
    // change them is drawn under them.
    expect($source)
        ->toContain('policy.loanDays')
        ->toContain('policy.commentsRequireApproval')
        ->toContain('taxonomy.level1Label')
        ->toContain('contacts.map')
        ->toContain('superAdminOnly');
});
