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

/**
 * Extracts the body of a literal top-level block (`:root { ... }`) from CSS
 * source, matching braces so a nested block would not truncate it.
 *
 * Scoping to the source file's own blocks matters: the reference's eleven
 * tokens are declared in `@theme`, which Tailwind also emits at `:root`, so a
 * count taken from built CSS or from a whole-file regex would see 44 variables
 * where the mapping defines 33.
 */
function designSystemBlock(string $css, string $selector): string
{
    $start = strpos($css, "\n{$selector} {");

    expect($start)->not->toBeFalse("no literal `{$selector} {` block in app.css");

    $open = strpos($css, '{', $start);
    $depth = 0;

    for ($i = $open; $i < strlen($css); $i++) {
        $depth += match ($css[$i]) {
            '{' => 1,
            '}' => -1,
            default => 0,
        };

        if ($depth === 0) {
            return substr($css, $open + 1, $i - $open - 1);
        }
    }

    throw new RuntimeException("unbalanced braces in `{$selector}` block");
}

/**
 * The 42 ported screens use shadcn's semantic vocabulary exclusively, so these
 * 33 variables are the entire surface through which the reference palette
 * reaches the screen. One dropped variable falls back to nothing at all.
 */
it('defines every semantic variable in both modes', function () {
    $css = File::get(resource_path('css/app.css'));

    preg_match_all('/^\s*(--[a-z0-9-]+):/m', designSystemBlock($css, ':root'), $light);
    preg_match_all('/^\s*(--[a-z0-9-]+):/m', designSystemBlock($css, '.dark'), $dark);

    // 33 and 32, deliberately: --radius is :root-only and does not change
    // between modes, so asserting 33 in .dark would fail a correct port.
    expect($light[1])->toHaveCount(33);
    expect($dark[1])->toHaveCount(32);

    // ...and the one that is missing from .dark is exactly --radius.
    expect(array_values(array_diff($light[1], $dark[1])))->toBe(['--radius']);
    expect(array_values(array_diff($dark[1], $light[1])))->toBe([]);
});

/**
 * The stock starter palette is authored in hsl(), the ported one in hex, so
 * `hsl(` is a clean marker for "not yet ported". Naming only the three obvious
 * starter values would let a half-finished port through -- a leftover
 * `--muted-foreground: hsl(0, 0%, 45.1%)` would sail past that and leave 181
 * call sites cold grey.
 */
it('retains no stock starter colours', function () {
    $css = File::get(resource_path('css/app.css'));

    expect(designSystemBlock($css, ':root'))->not->toContain('hsl(');
    expect(designSystemBlock($css, '.dark'))->not->toContain('hsl(');
});

/**
 * The Tailwind-v3 compat block sets a border colour on `::after`, `::before`,
 * `::backdrop` and `::file-selector-button` as well as `*`, but the later
 * `* { @apply border-border }` reclaims only the element selector. A stock grey
 * left there survives on every pseudo-element border, and is invisible to the
 * hsl() marker above because it arrives through a var().
 */
it('leaves no cold grey on pseudo-element borders', function () {
    expect(File::get(resource_path('css/app.css')))
        ->not->toContain('var(--color-gray-200');
});
