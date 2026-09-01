<?php

use App\Enums\BookshelfStatus;
use App\Models\Bookshelf;
use App\Models\SystemSetting;
use App\Models\User;
use Illuminate\Support\Facades\Route;
use Inertia\Testing\AssertableInertia;

/**
 * Phase 3b-ii Task 2: the public `/contact` (spec D2).
 *
 * **THE FIRST BLOCK IS THE ONE THAT MATTERS, AND ITS FIXTURE IS THE POINT.**
 * It creates nothing, signs nobody in and — deliberately — never calls
 * `TenantContext::actSystemWide()`. Every other feature file in this
 * repository widens before touching a model, and doing that here would
 * destroy the only assertion this file makes that no other file could:
 * that the page works with NO tenant bound in any form. `BookshelfScope`
 * fails closed, so a shelf-scoped read in the controller throws
 * `RuntimeException` — but only for a request where nothing has widened.
 * Under a widened fixture the same defect is invisible.
 *
 * WATCHED FAILING BEFORE IT WAS ACCEPTED. `Book::query()->count()` added to
 * `ContactController::show()` turns the guest block below red with
 * `App\Models\Book is shelf-scoped but no tenant is bound`, a 500 rather
 * than an assertion failure — which is precisely the shape a stranger with
 * no bookshelf would meet in production. Removed by targeted edit, green.
 *
 * **THE END-TO-END BLOCK GOES THROUGH TASK 1'S REAL SAVE PATH**, a POST to
 * `/admin/settings/contact`, never `SystemSetting::update()`. A direct
 * database write would pass while the two halves disagreed about which
 * columns hold the contact — the whole claim being made is that what an
 * administrator types on one screen is what a stranger reads on the other.
 *
 * **THE SOURCE READ IS NOT DECORATION.** This repo has no frontend
 * rendering tests, so a server assertion that the props are all null cannot
 * distinguish "the page says what to do" from "the page renders nothing at
 * all". `AdminScreensRenderFeedbackTest` is the precedent, comment
 * stripping included: its docblock records that a raw grep stayed green
 * with the block deleted and only its explanatory comment left.
 *
 * Grep first: `grep -rn "^function contactPageSource" tests/`.
 */
function contactPageSource(): string
{
    $path = __DIR__.'/../../../resources/js/pages/contact.tsx';

    expect(file_exists($path))->toBeTrue('missing screen: pages/contact.tsx');

    $source = (string) file_get_contents($path);

    // Block comments (JSX's `{/* … */}` included), then line comments —
    // AdminScreensRenderFeedbackTest's helper, and crude for the same
    // reason: everything looked for below is code.
    $stripped = preg_replace('#/\*.*?\*/#s', '', $source);

    return (string) preg_replace('#//[^\n]*#', '', (string) $stripped);
}

/** A super administrator, created without widening — `User` is not shelf-scoped. */
function contactPageAdmin(): User
{
    return User::factory()->create(['is_super_admin' => true]);
}

it('serves the contact page to a caller with no membership, no shelf and no tenant', function () {
    // NOTHING is created and NOTHING is widened — see the docblock. This is
    // the visitor the page exists for: a parish with no bookshelf at all.
    $this->get('/contact')
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->component('contact'));

    // And the same for somebody signed in who belongs to no shelf either —
    // registering does not, by itself, make anyone a member of anything.
    $this->actingAs(User::factory()->create())
        ->get('/contact')
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->component('contact'));
});

it('tells an unconfigured installation to approach the parish directly', function () {
    // The seeded row: nobody has ever saved. All three props are null, which
    // is the state the page's sentence exists for.
    $this->get('/contact')
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('contact.name', null)
            ->where('contact.phone', null)
            ->where('contact.hours', null)
        );

    // The half no server assertion can reach: that the screen actually says
    // something in that state, rather than rendering an empty page. Read
    // with comments stripped, because this file's own docblock two screens
    // up names the sentence and would satisfy a bare grep on its own.
    expect(contactPageSource())->toContain('copy.contact.noContact');
});

it('renders no placeholder for a blank detail — the line is omitted', function () {
    $admin = contactPageAdmin();

    // Saved through Task 1's real form: a name and a number, no hours.
    $this->actingAs($admin)->post('/admin/settings/contact', [
        'contact_name' => 'Thầy Phêrô Nam',
        'contact_phone' => '0912345678',
        'contact_hours' => '',
    ])->assertSessionHasNoErrors();

    $this->get('/contact')
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('contact.name', 'Thầy Phêrô Nam')
            ->where('contact.phone', '0912345678')
            // NULL, not '' and not a dash. The screen's three lines are
            // plain null checks, so anything else here renders an empty
            // paragraph where the reference used to print an invented value.
            ->where('contact.hours', null)
        );

    // Whitespace is the same absence as empty, decided once in the
    // controller so the screen has one emptiness rather than three.
    SystemSetting::query()->sole()->update(['contact_hours' => '   ']);

    $this->get('/contact')
        ->assertInertia(fn (AssertableInertia $page) => $page->where('contact.hours', null));

    // Each of the three lines is guarded independently — a card that
    // rendered `name` unconditionally would print an empty heading for an
    // installation carrying only a phone number.
    $source = contactPageSource();

    expect($source)->toContain('contact.name ?')
        ->and($source)->toContain('contact.phone ?')
        ->and($source)->toContain('contact.hours ?');
});

it('changes the public page when an administrator changes the details', function () {
    $admin = contactPageAdmin();

    $this->get('/contact')
        ->assertInertia(fn (AssertableInertia $page) => $page->where('contact.phone', null));

    // THROUGH THE REAL SAVE PATH — Task 1's controller, Form Request,
    // Action and audit row — never a direct update. The two screens are
    // only proven to share a meaning if the write half is the real one.
    $this->actingAs($admin)->post('/admin/settings/contact', [
        'contact_name' => 'Thầy Phêrô Nam',
        'contact_phone' => '0912345678',
        'contact_hours' => 'Thứ hai đến thứ sáu, 8h–17h',
    ])->assertRedirect('/admin/settings');

    // READ BACK AS THE STRANGER, not as the administrator who just wrote.
    // `actingAs()` binds the user for the REST of the test's client, not
    // just the request it decorates (ShellTest carries the same note), so
    // without this the GET below would be an authenticated administrator
    // reading their own screen — which is not the claim being made.
    $this->app['auth']->forgetGuards();

    $this->get('/contact')
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('contact.name', 'Thầy Phêrô Nam')
            ->where('contact.phone', '0912345678')
            ->where('contact.hours', 'Thứ hai đến thứ sáu, 8h–17h')
        );
});

it('exposes only the three contact fields, never the row', function () {
    // The single row also carries the six lending defaults and the two
    // provenance columns. `changed_by` is a user id, and none of the eight
    // is any of the public's business — a controller that serialised the
    // model would publish whatever column the next migration adds, silently.
    $admin = contactPageAdmin();

    $this->actingAs($admin)->post('/admin/settings/defaults', [
        'loan_days' => 21,
        'max_concurrent_loans' => 5,
        'max_renewals' => 2,
        'renewal_days' => 10,
        'hold_days' => 4,
        'due_soon_days' => 2,
    ])->assertRedirect('/admin/settings');

    $this->app['auth']->forgetGuards();

    $props = $this->get('/contact')->viewData('page')['props'];

    // Scoped to THIS page's own prop, not to the whole payload: `auth.user`
    // is a shared prop every screen carries, so an assertion over the full
    // JSON would be about HandleInertiaRequests rather than about this
    // controller. What is asserted here is that the controller published
    // three keys and nothing else — measured on the keys themselves, so a
    // fourth column added to the row cannot arrive silently.
    expect(array_keys($props['contact']))->toBe(['name', 'phone', 'hours'])
        ->and(json_encode($props['contact']))->not->toContain('loan_days')
        ->and(json_encode($props['contact']))->not->toContain('changed_by');
});

it('has no write route at all — the feedback form is 3c\'s, with its inbox', function () {
    // BR §16.1 lists a form on this page and D2 defers it deliberately, so
    // "there is no form" is a decision to pin rather than an absence to
    // leave unstated. Two halves, because either alone is vacuous: a route
    // assertion is green against a page that was never built, and a source
    // read alone would not catch a POST wired to some other component.
    //
    // CatalogueArchitectureTest's "there is deliberately no delete-book
    // route" is the precedent for the first half.
    $writes = collect(Route::getRoutes()->getRoutes())
        ->filter(fn ($route) => $route->uri() === 'contact' || str_starts_with($route->uri(), 'contact/'))
        ->reject(fn ($route) => $route->methods() === ['GET', 'HEAD'])
        ->map(fn ($route) => implode('|', $route->methods()).' '.$route->uri())
        ->values()
        ->all();

    expect($writes)->toBe([]);

    // And the screen holds no form bag: no useForm, no submit handler, no
    // <form>. Comments stripped, because this file talks about the deferred
    // form at length and a bare grep would be satisfied by the prose.
    $source = contactPageSource();

    expect($source)->not->toContain('useForm')
        ->and($source)->not->toContain('<form');
});

/**
 * The reachability half, which nothing covered until the 3b-ii whole-branch
 * review pointed out that the page worked and could not be found.
 *
 * /contact exists for a parish with no bookshelf — BR:504 calls it their only
 * route to a human. An earlier link lived inside the portal's empty state,
 * which is a branch that visitor never sees: from the second shelf onward the
 * portal lists OTHER parishes' shelves, so it is not empty. The assertion
 * below is deliberately made against a NON-empty portal, because that is the
 * case the empty-state version failed.
 */
it('links to the contact page from the portal even when other parishes have shelves', function () {
    Bookshelf::factory()->count(2)->create(['status' => BookshelfStatus::Active]);

    $this->get(route('shelves.index'))->assertOk();

    // Whitespace-normalised: screenSource strips comments, not layout, and
    // Biome reflows JSX freely — so a needle written with spaces is a needle
    // that breaks on the next format run.
    $source = (string) preg_replace('/\s+/', '', screenSource('shelves/index.tsx'));

    expect(str_contains($source, 'route("contact")'))
        ->toBeTrue('the portal does not link to /contact at all');

    // The link must not be inside the empty-state branch. `shelves.length === 0`
    // opens that branch; the link has to appear after it closes.
    $emptyBranch = strpos($source, 'shelves.length===0');
    $link = strpos($source, 'route("contact")');

    expect($emptyBranch)->not->toBeFalse('the empty-state branch moved; re-read this test');
    expect($link)->toBeGreaterThan(
        strpos($source, '</ul>'),
        'the contact link sits inside the empty-state branch, where the parish it serves never sees it',
    );
});
