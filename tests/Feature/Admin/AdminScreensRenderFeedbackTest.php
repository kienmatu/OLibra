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

it('renders the success flash on every admin screen a redirect carries one to', function () {
    // ManagerController flashes on all three grants and redirects to
    // /admin/managers. ShelfController flashes on all six of its writes:
    // archive and unarchive land on the list, create/profile/policy/contacts
    // land on the editor.
    expect(adminScreenSource('managers/index.tsx'))->toContain('flash.success')
        ->and(adminScreenSource('shelves/index.tsx'))->toContain('flash.success')
        ->and(adminScreenSource('shelves/edit.tsx'))->toContain('flash.success');
});
