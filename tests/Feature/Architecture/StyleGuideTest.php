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
 */
it('every component AGENTS.md names exists in resources/js/components', function () {
    $guide = File::get(base_path('AGENTS.md'));

    // Backticked PascalCase identifiers are how the guide names a component.
    preg_match_all('/`([A-Z][A-Za-z]+)`/', $guide, $matches);
    $named = array_values(array_unique($matches[1]));

    // Words the guide backticks that are NOT components. Keep this list
    // short and justified — every entry is a hole in the pin.
    $notComponents = ['README', 'AGENTS', 'MariaDB', 'TypeScript', 'Vietnamese', 'Laravel', 'Inertia', 'Pest', 'Larastan', 'Pint', 'Biome'];

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
