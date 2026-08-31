<?php

use Illuminate\Support\Facades\File;

/**
 * AGENTS.md is the house style guide, and until Phase 3a it named fourteen
 * components this repository has never had — plus a `field.tsx` its table
 * routed through twice. It misdirected three tasks in Phase 2b and cost a
 * warning paragraph in every screen dispatch in 2c.
 *
 * This block is what stops it drifting back. It is deliberately narrow: it
 * proves every component the guide NAMES exists, not that every component
 * that exists is named. A guide may be incomplete; it may not be wrong.
 *
 * **The PATH arm is the one that matters, and it exists because the original
 * PascalCase-only arm was near-vacuous by the time it shipped.** Task 1's own
 * rewrite of AGENTS.md replaced almost every component reference with a
 * backticked lowercase PATH (`ui/badge.tsx`, `components/input-error.tsx`);
 * exactly one backticked PascalCase word survives in the whole guide, so the
 * PascalCase arm checked 1 reference out of 23. Measured: appending a row
 * citing `ui/nonexistent-widget.tsx` left the old test green.
 */
it('every component path AGENTS.md names exists under resources/js', function () {
    // Backticked `*.tsx` paths — the form the guide actually uses. TWO roots,
    // because the guide itself uses two: `components/input-error.tsx` is
    // written from resources/js, while `ui/badge.tsx` is written from
    // resources/js/components (its import is `@/components/ui/badge`). Both
    // are accepted rather than one being declared wrong; a path that resolves
    // under neither is a component the guide names and the repo lacks, which
    // is the only thing this block is for. No escape list: a path either
    // resolves or the guide is wrong about it.
    preg_match_all('/`([A-Za-z0-9._\/-]+\.tsx)`/', File::get(base_path('AGENTS.md')), $matches);
    $named = array_values(array_unique($matches[1]));

    expect($named)->not->toBeEmpty();   // a guide that names nothing pins nothing

    $missing = collect($named)
        ->reject(fn (string $path) => File::exists(resource_path('js/'.$path))
            || File::exists(resource_path('js/components/'.$path)))
        ->values()
        ->all();

    expect($missing)->toBe([]);
});

it('every PascalCase component AGENTS.md names exists in resources/js/components', function () {
    $guide = File::get(base_path('AGENTS.md'));

    // Backticked PascalCase identifiers are the guide's older naming form.
    // Kept because the guide still uses it once, but see the docblock: the
    // path arm above is where the coverage is.
    preg_match_all('/`([A-Z][A-Za-z]+)`/', $guide, $matches);
    $named = array_values(array_unique($matches[1]));

    // Words the guide backticks that are NOT components. Keep this list
    // short and justified — every entry is a hole in the pin. Trimmed in the
    // whole-branch fix wave to the entries the current guide actually
    // produces; the other eleven matched nothing and were pure hole.
    $notComponents = [];

    $components = collect(File::allFiles(resource_path('js/components')))
        ->map(fn ($f) => $f->getFilenameWithoutExtension())
        // book-card.tsx exports BookCard; the guide names components in
        // PascalCase and the files are kebab-case.
        ->map(fn (string $n) => str_replace(' ', '', ucwords(str_replace('-', ' ', $n))))
        ->all();

    $missing = collect($named)
        ->reject(fn (string $n) => in_array($n, $notComponents, true))
        ->reject(fn (string $n) => in_array($n, $components, true))
        ->values()
        ->all();

    expect($missing)->toBe([]);
});
