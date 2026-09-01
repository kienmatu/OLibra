<?php

use App\Actions\Community\SubmitFeedback;
use App\Enums\BookshelfStatus;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Feedback;
use App\Models\SystemSetting;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Route;
use Inertia\Testing\AssertableInertia;

/**
 * Phase 3b-ii Task 2: the public `/contact` (spec D2). Phase 3c-ii Task 3
 * added its form, and RETRACTED this file's own anti-pin to do it — see the
 * "has exactly one write route" block, which carries what it used to say and
 * why the retraction rather than a deletion.
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
 * WATCHED FAILING AGAIN FOR THE WRITE HALF (3c-ii Task 3), because the POST
 * is the path where it matters most: `Book::query()->count()` at the top of
 * `ContactController::store()` reddens "takes a message from a stranger"
 * with the same `RuntimeException` from `BookshelfScope:42` — an
 * unauthenticated 500 on the application's most exposed write. Two more
 * mutations were measured on this file's newer blocks: negating the screen's
 * gate to `{!hasContact ? (` reddens "shows the card OR the form" (and did
 * NOT, before that block's needle was written with its opening brace — the
 * three positional checks all survive a negation, because negating a
 * condition moves nothing); and letting the body decide the shelf, with
 * `siteWide: $request->input('bookshelf_id') === null`, reddens "cannot be
 * talked into filing a stranger's message against a parish". All restored by
 * targeted edit.
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

it('offers an unconfigured installation the form, and says the message is read', function () {
    // RETRACTED TITLE, phase 3c-ii Task 3. This block was
    // "tells an unconfigured installation to approach the parish directly",
    // and that is no longer what the branch does or should do: the sentence
    // it asserted sent the visitor away from the one channel that now
    // reaches the administrator, and the visitor is a parish being told to
    // ask their parish. `copy.contact.noContact` survives as the key —
    // and is still asserted below — but its Vietnamese is now the lead
    // sentence ABOVE the form rather than a substitute for it. copy.ts
    // carries the retracted string verbatim.
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

    // The limit the form promises is the command's own constant, never a 3
    // typed into a Vietnamese sentence — the reference hard-codes it and
    // this port does not. Asserted on the prop rather than on the markup,
    // because a screen reading the prop is only worth anything if the
    // controller sends it.
    $this->get('/contact')
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('dailyLimit', SubmitFeedback::DAILY_LIMIT)
        );
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

it('has exactly one write route, and the screen it belongs to holds the form', function () {
    // ═══ A RETRACTION, phase 3c-ii Task 3, and the reason is the phase ═══
    //
    // Until this commit this block read "has no write route at all — the
    // feedback form is 3c's, with its inbox", and asserted the opposite of
    // everything below:
    //
    //   > BR §16.1 lists a form on this page and D2 defers it deliberately,
    //   > so "there is no form" is a decision to pin rather than an absence
    //   > to leave unstated. Two halves, because either alone is vacuous: a
    //   > route assertion is green against a page that was never built, and
    //   > a source read alone would not catch a POST wired to some other
    //   > component.
    //   >
    //   > CatalogueArchitectureTest's "there is deliberately no delete-book
    //   > route" is the precedent for the first half.
    //   >
    //   >   expect($writes)->toBe([]);
    //   >   expect($source)->not->toContain('useForm')
    //   >       ->and($source)->not->toContain('<form');
    //
    // It was 3b-ii pinning its own deferral — an anti-pin whose whole
    // purpose was to go red in the phase that built the thing — and this is
    // that phase. It is REWRITTEN RATHER THAN DELETED, and its two halves
    // are kept as two halves, because the reasoning for the pair survives
    // the inversion word for word: a route assertion alone is green against
    // a page that renders nothing, and a source read alone would be green
    // against a form posting to some other component.
    //
    // The retraction is recorded here rather than only in the commit
    // message because the next person to widen this route will read this
    // file, not `git log`. What the deleted version was protecting against
    // — a POST landing before there was an inbox to read it — is now
    // `/admin/feedback`'s to keep true.
    $writes = collect(Route::getRoutes()->getRoutes())
        ->filter(fn ($route) => $route->uri() === 'contact' || str_starts_with($route->uri(), 'contact/'))
        ->reject(fn ($route) => $route->methods() === ['GET', 'HEAD'])
        ->map(fn ($route) => implode('|', $route->methods()).' '.$route->uri())
        ->values()
        ->all();

    // EXACTLY ONE, and it is the census that matters rather than the
    // presence: this is the application's most exposed address, and a
    // second write appearing under `contact/` — an edit, a delete, an
    // administrative anything — is a thing to notice deliberately.
    expect($writes)->toBe(['POST contact']);

    // And the screen holds the form bag. Comments stripped, because this
    // file talks about the form at length and a bare grep would be
    // satisfied by the prose above.
    $source = contactPageSource();

    expect($source)->toContain('useForm')
        ->and($source)->toContain('<form')
        ->and($source)->toContain('route("contact.feedback")');
});

it('shows the card OR the form, never both — the form is the empty state', function () {
    // The reference's own shape (old_next/src/app/lien-he/page.tsx:83 is a
    // ternary on `hasContact`), and the half of the retracted entry in
    // docs/known-gaps.md that still governs. An installation that has
    // published a name or a number is offering a stranger a human to ring,
    // which beats a message they must wait for.
    //
    // A SOURCE READ, because this repo has no frontend rendering tests and
    // the two branches arrive in one Inertia response either way — there is
    // no prop whose value could distinguish them, which is the point: the
    // page decides. Positional, on whitespace-normalised source, the
    // portal-link block at the foot of this file's technique: Biome reflows
    // JSX freely, so a needle written with spaces breaks on the next format
    // run.
    $source = (string) preg_replace('/\s+/', '', contactPageSource());

    // THE GATE ITSELF, needle written with its opening brace so that a
    // NEGATED gate — `{!hasContact ? (`, which swaps the two branches and
    // shows the form to precisely the installations that need it least —
    // does not satisfy it. Measured: without the brace, `!hasContact` is a
    // substring match and the three positional expectations below all still
    // hold, because negating the condition moves nothing.
    expect($source)->toContain('{hasContact?(');

    $ternary = strpos($source, '{hasContact?(');
    $else = strpos($source, '):(');
    $card = strpos($source, 'tel:${contact.phone}');
    $form = strpos($source, '<form');

    expect($else)->not->toBeFalse('the ternary lost its else branch — re-read this block');
    expect($card)->not->toBeFalse('the card no longer renders the number as a tel: link');

    // The card in the FIRST branch, the form in the SECOND — which, with
    // the un-negated gate above, is the whole claim.
    expect($card)->toBeGreaterThan($ternary)->toBeLessThan($else);
    expect($form)->toBeGreaterThan(
        $else,
        'the form is no longer inside the empty-state branch: an installation with a published '
        .'telephone number now shows a message box beside the number, which is not the reference’s shape',
    );
});

it('takes a message from a stranger with no membership, no shelf and no tenant', function () {
    // THE BLOCK THIS TASK EXISTS FOR, and its fixture is the point in
    // exactly the way the docblock at the top of this file describes:
    // nothing is created, nobody is signed in, and TenantContext is never
    // widened. A shelf-scoped model touched anywhere on this path — the
    // controller, the Form Request, the command — throws RuntimeException
    // here and nowhere else in the suite, because every other feature file
    // widens before it writes.
    $this->from('/contact')->post('/contact', [
        'guest_name' => 'Ông Sáu',
        'guest_contact' => '0912 345 678',
        'subject' => 'Mở tủ sách mới',
        'body' => 'Giáo xứ chúng tôi muốn lập một tủ sách.',
    ])->assertRedirect('/contact')->assertSessionHasNoErrors();

    // Feedback is deliberately NOT BelongsToBookshelf — its bookshelf_id is
    // the schema's one nullable tenant column — which is what lets this row
    // be read back here without widening either.
    $row = Feedback::query()->sole();

    expect($row->bookshelf_id)->toBeNull()
        ->and($row->member_id)->toBeNull()
        ->and($row->guest_name)->toBe('Ông Sáu')
        // Stored AS TYPED, spaces and all, because somebody has to ring it
        // back. Only the rate-limit key is normalised.
        ->and($row->guest_contact)->toBe('0912 345 678')
        ->and($row->guest_hash)->toBe(SubmitFeedback::phoneHash('0912 345 678'))
        ->and($row->subject)->toBe('Mở tủ sách mới');

    // The audit row is written against NO shelf, which the recorder permits
    // only because the command names its absent shelf explicitly — with no
    // tenant bound and no such naming it throws rather than writing a null.
    $audit = AuditLog::query()->where('action', 'feedback.submitted')->sole();

    expect($audit->bookshelf_id)->toBeNull()
        ->and($audit->entity_id)->toBe($row->id)
        ->and($audit->actor_id)->toBeNull()
        ->and($audit->after)->toBe(['site_wide' => true]);
});

it('refuses a number that is not one, in Vietnamese, without a shelf to refuse it against', function () {
    // The reference's own QA round found `khong-phai-so` accepted and
    // stored by this exact command, on the one form a parish with no shelf
    // has. The refusal reaches the page as a rule banner rather than a 500
    // or a silent success — and getting THERE, through bootstrap/app.php's
    // render hook, is what this block adds over SubmitFeedbackTest's
    // direct-call coverage: the hook runs with no tenant bound.
    $this->from('/contact')->post('/contact', [
        'guest_name' => 'Ông Sáu',
        'guest_contact' => 'khong-phai-so',
        'subject' => '',
        'body' => 'Giáo xứ chúng tôi muốn lập một tủ sách.',
    ])->assertRedirect('/contact')->assertSessionHasErrors('rule');

    expect(Feedback::query()->count())->toBe(0);

    // And a body that says nothing is refused per-field by the Form
    // Request, which is a different mechanism from the banner above and
    // reaches the fields rather than the top of the page.
    $this->from('/contact')->post('/contact', ['guest_name' => '', 'guest_contact' => '', 'body' => ''])
        ->assertSessionHasErrors(['guest_name', 'guest_contact', 'body']);

    expect(Feedback::query()->count())->toBe(0);
});

it('cannot be talked into filing a stranger’s message against a parish', function () {
    // The whole guarantee of a site-wide form, from the other side: there
    // is no URI segment naming a shelf here and no key in
    // SubmitFeedbackRequest's ruleset that could name one, so a body that
    // tries lands site-wide anyway. Without this block the claim rests on
    // reading the ruleset and believing it.
    //
    // The shelf is created — and this is the ONE place in this file that
    // widens, deliberately and locally, because a fixture is needed to have
    // an id worth naming. The POST itself still runs as the stranger.
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['status' => BookshelfStatus::Active]);
    app(TenantContext::class)->clear();

    $this->from('/contact')->post('/contact', [
        'guest_name' => 'Ông Sáu',
        'guest_contact' => '0912345678',
        'body' => 'Giáo xứ chúng tôi muốn lập một tủ sách.',
        'bookshelf_id' => $shelf->id,
        'shelf' => $shelf->slug,
    ])->assertSessionHasNoErrors();

    expect(Feedback::query()->sole()->bookshelf_id)->toBeNull();
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
