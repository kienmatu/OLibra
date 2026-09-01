<?php

/**
 * THE ADMIN AREA'S SERVER FEEDBACK ACTUALLY RENDERS.
 *
 * Every route under `/admin` that mutates something answers with one of two
 * things: a `RuleViolated` that `bootstrap/app.php` turns into
 * `back()->withErrors(['rule' => …])`, or a redirect carrying
 * `->with('success', …)` that `HandleInertiaRequests` shares as
 * `flash.success`. Both are pinned server-side, by session assertions, in
 * the feature files beside this one.
 *
 * NONE OF THOSE ASSERTIONS SAY THE VOLUNTEER SEES ANYTHING. A whole-branch
 * review found the gap: eight tasks each added server-side feedback and no
 * task owned rendering it, so `/admin/managers` swallowed five refusals in
 * silence and nine flash sentences across the area rendered nowhere at all.
 * Saving the shelf profile left the page pixel-identical — `useForm.patch()`
 * preserves state — so a save and a press that did nothing looked the same.
 *
 * SO THIS FILE READS THE COMPONENT SOURCE, which is the only layer that can
 * see the defect: no server test can, because every one of them was green
 * while the screens were mute. `AuditSentencesTest`'s "the condition words
 * match copy.ts character for character" is the precedent — FoldParityTest's
 * cross-language pattern, a PHP test reading TypeScript so the two sides
 * cannot drift silently.
 *
 * IT ASSERTS THE PROP IS REFERENCED, NOT HOW IT IS STYLED. A page is free to
 * move its banner, change its wording or wrap it in a component; what it may
 * not do is stop reading the prop. That is the line between a guard and a
 * snapshot.
 *
 * **THE COMMENTS ARE STRIPPED FIRST, AND THAT IS NOT A DETAIL.** Every one
 * of these pages explains its feedback block in a comment that names the
 * prop, so a grep over the raw file is satisfied by the prose alone: with
 * the block itself deleted and only its comment left, the first version of
 * this file stayed green — measured, it did. That is the same blindness
 * `TenancyArchitectureTest` documents from the other side, where a
 * where-shaped call inside a comment makes a file its own offender. A guard
 * that a comment can satisfy is not a guard.
 *
 * Grep first: `grep -rn "^function adminScreenSource" tests/`.
 */
function adminScreenSource(string $page): string
{
    $path = __DIR__.'/../../../resources/js/pages/admin/'.$page;

    expect(file_exists($path))->toBeTrue("missing admin screen: {$page}");

    $source = (string) file_get_contents($path);

    // Block comments (JSX's `{/* … */}` included) and line comments. Crude
    // by design: it over-strips a `//` inside a string literal, which costs
    // nothing here because every prop this file looks for is code.
    $stripped = preg_replace('#/\*.*?\*/#s', '', $source);
    $stripped = preg_replace('#//[^\n]*#', '', (string) $stripped);

    return (string) $stripped;
}

it('renders every refusal the /admin/managers controls can produce', function () {
    // Five land here: already_super_admin (PromoteSuperAdmin), not_a_manager
    // and membership_not_found (RevokeManager), and AssignManagerRequest's
    // two field rules. Before this, the page held zero references to either
    // bag — a press that did nothing and said nothing.
    $source = adminScreenSource('managers/index.tsx');

    expect($source)->toContain('errors.rule')
        // The appoint form's own two fields, which are scoped to its bag
        // rather than to the page's.
        ->and($source)->toContain('form.errors.user_id')
        ->and($source)->toContain('form.errors.role');
});

it('renders the two refusals and both field bags /admin/settings can produce', function () {
    // Phase 3b-ii Task 1. THE LIST IN THIS FILE IS HAND-WRITTEN and does not
    // grow on its own — a new admin page rendering neither its refusals nor
    // its flashes ships silently, which is the exact defect this file's
    // docblock was written about. So the page is added here in the same task
    // that builds it.
    //
    // One RuleViolated reaches this screen: phone_invalid, from
    // UpdateSiteContact's Phone::assert() on the number /contact publishes.
    // It arrives under `rule` rather than as a field error, which is why the
    // page must read the shared bag as well as the two form bags.
    //
    // The shared bag is read under a local name here (`errors: pageErrors`,
    // the shelf editor's own shape) rather than as the literal `errors.rule`
    // /admin/managers uses, so BOTH halves are asserted: that the page takes
    // `errors` off the page props at all, and that it renders `.rule` from
    // it. Either alone passes on a page that destructures the prop and never
    // shows it, or that shows a `.rule` belonging to some other bag.
    $source = adminScreenSource('settings/index.tsx');

    expect($source)->toContain('errors: pageErrors')
        ->and($source)->toContain('pageErrors.rule')
        // The two forms' own bags, each scoped to its own form. A page that
        // read only the shared bag would swallow every bounds refusal on the
        // defaults form and every length refusal on the contact form.
        ->and($source)->toContain('contactForm.errors')
        ->and($source)->toContain('defaultsForm.errors');
});

it('renders the two refusals and both field bags /admin/categories can produce', function () {
    // Phase 3b-ii Task 3, added here in the same task that builds the page —
    // THE LIST IN THIS FILE IS HAND-WRITTEN and does not grow on its own, so
    // a screen rendering neither its refusals nor its flashes ships silently.
    //
    // Two RuleViolated reach this screen, both from app/Actions/Admin:
    // category_in_use (ArchiveCategory, while live books still carry the
    // genre) and duplicate_category (CreateCategory, when the derived slug is
    // already taken — including by an archived genre nobody can see). Both
    // arrive under `rule` rather than as field errors, so the page must read
    // the shared bag as well as the two form bags. The archive control hides
    // itself when the count says it would be refused, which is a courtesy —
    // a hand-posted request still lands on this banner.
    //
    // The shared bag is read under a local name (`errors: pageErrors`, the
    // shelf editor's and /admin/settings' shape), so BOTH halves are
    // asserted: that the page takes `errors` off the page props at all, and
    // that it renders `.rule` from it. Either alone passes on a page that
    // destructures the prop and never shows it.
    $source = adminScreenSource('categories/index.tsx');

    expect($source)->toContain('errors: pageErrors')
        ->and($source)->toContain('pageErrors.rule')
        // The two name fields, each scoped to its own form — the add form's
        // bag and the per-row rename form's. A page that read only the
        // shared bag would swallow every length and encoding refusal on
        // both, and one that named a single bag would prove nothing about
        // the other.
        ->and($source)->toContain('addForm.errors')
        ->and($source)->toContain('renameForm.errors');
});

it('renders the taxonomy section\'s own field bag on the shelf editor', function () {
    // Phase 3b-ii Task 4, added here in the same task that builds the
    // section — THE LIST IN THIS FILE IS HAND-WRITTEN and does not grow on
    // its own.
    //
    // The fourth form on this screen has its own bag, and that is the point
    // of asserting it separately: a page that read only the shared `errors`
    // prop would swallow every length and encoding refusal on the two label
    // fields, and the three bags already asserted elsewhere prove nothing
    // about a fourth that does not exist yet.
    $source = adminScreenSource('shelves/edit.tsx');

    expect($source)->toContain('errors: pageErrors')
        ->and($source)->toContain('pageErrors.rule')
        ->and($source)->toContain('taxonomyForm.errors');
});

it('renders the success flash on every admin screen a redirect carries one to', function () {
    // ManagerController flashes on all three grants and redirects to
    // /admin/managers. ShelfController flashes on all six of its writes:
    // archive and unarchive land on the list, create/profile/policy/contacts
    // land on the editor.
    expect(adminScreenSource('managers/index.tsx'))->toContain('flash.success')
        ->and(adminScreenSource('shelves/index.tsx'))->toContain('flash.success')
        ->and(adminScreenSource('shelves/edit.tsx'))->toContain('flash.success')
        // SettingsController flashes on both of its writes and redirects
        // back to /admin/settings, so the one screen carries both sentences.
        ->and(adminScreenSource('settings/index.tsx'))->toContain('flash.success')
        // CategoryController flashes on all three of its writes — create,
        // rename and archive — and all three redirect back to the list,
        // where each has changed a row a volunteer would otherwise have to
        // hunt for.
        ->and(adminScreenSource('categories/index.tsx'))->toContain('flash.success');
});
