<?php

use Illuminate\Support\Facades\File;

/**
 * Guards on the ported design system.
 *
 * The font block below exists because the failure it protects against is
 * silent: a missing `vietnamese` face does not break the build, it just makes
 * every tone-marked vowel in the app render from a fallback typeface, and a
 * missing `font-display: swap` does not break anything at all until a
 * volunteer on a slow parish connection stares at invisible text.
 */
it('self-hosts both families across all three subsets', function () {
    $css = File::get(resource_path('css/app.css'));

    // Every @font-face block declared in app.css, as (family, body) pairs.
    preg_match_all('/@font-face\s*\{(.*?)\}/s', $css, $matches);
    $blocks = $matches[1];

    // 9 Lexend (3 weights x 3 subsets) + 3 Literata 600 (3 subsets).
    expect($blocks)->toHaveCount(12);

    $families = [];

    foreach ($blocks as $block) {
        preg_match("/font-family:\s*'([^']+)'/", $block, $family);
        expect($family)->not->toBeEmpty();
        $families[] = $family[1];

        // swap, not the browser default of `auto` (block): the reference sets
        // swap so Vietnamese copy is readable while the face is in flight.
        expect($block)->toContain('font-display: swap');
    }

    expect($families)->toContain('Lexend')->toContain('Literata');

    // U+1EA0-1EF9 is the precomposed tone-marked vowel range. latin-ext does
    // not carry it, so a face covering it must exist for BOTH families or
    // Vietnamese text falls back mid-word.
    foreach (['Lexend', 'Literata'] as $family) {
        $vietnamese = array_filter($blocks, fn (string $block): bool => str_contains($block, "font-family: '{$family}'")
            && str_contains($block, 'U+1EA0-1EF9'));

        expect($vietnamese)->not->toBeEmpty("no vietnamese-subset face declared for {$family}");
    }

    // Both families must actually be reachable from a utility class, or they
    // are downloaded and never used: font-serif has 15 call sites.
    expect($css)->toContain("--font-serif: 'Literata'");
    expect($css)->toMatch("/--font-sans:\s*\n?\s*'Lexend',/");

    // And the CDN the self-hosting replaces is gone from the app shell.
    expect(File::get(resource_path('views/app.blade.php')))
        ->not->toContain('fonts.bunny.net');
});
