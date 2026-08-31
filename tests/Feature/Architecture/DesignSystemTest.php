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

/**
 * The reference's base layer carries two documented bug fixes that no
 * screenshot would catch: the h1-h4 leading that keeps stacked Vietnamese tone
 * marks from clipping, and the cursor rule that Tailwind 4's preflight stopped
 * supplying, without which every button reads as dead text. A presence check is
 * cheap, but the alternative is shipping both with no guard at all.
 */
it('ports the reference base layer', function () {
    $css = File::get(resource_path('css/app.css'));

    // iOS inflates text in landscape without this.
    expect($css)->toContain('-webkit-text-size-adjust: 100%');

    // The reference's typographic colour: looser leading and a hair of
    // tracking, which Vietnamese diacritics need room for.
    expect($css)->toContain('letter-spacing: 0.01em');
    expect($css)->toContain('line-height: 1.6');

    // Bug fix, not styling: tone marks stacked on capitals overflow tighter
    // leading. The comment travels with the rule for that reason.
    expect($css)->toMatch('/h1,\s*\n\s*h2,\s*\n\s*h3,\s*\n\s*h4\s*\{[^}]*line-height: 1\.3;[^}]*text-wrap: balance;/');
    expect($css)->toContain('Vietnamese diacritics must never clip.');

    // Bug fix, not styling: without it a <button> shows an arrow.
    expect($css)->toContain('button:not(:disabled)')
        ->toContain('cursor: pointer;');

    expect($css)->toContain('::selection');

    // Reaches non-shadcn focusables only -- the 19 focus-visible:outline-hidden
    // sites keep their own ring, which --ring has already made terracotta.
    expect($css)->toMatch('/:focus-visible\s*\{\s*\n\s*outline: 2px solid var\(--color-terracotta\);/');
});

/**
 * Every `--name: #rrggbb` declaration in one block, as name => [r, g, b].
 *
 * Only the block's own body is scanned, never the whole file: the eleven
 * reference tokens live in `@theme`, which is also a `:root` rule, so a
 * whole-file match would fold light-mode values into the dark map and quietly
 * measure light mode against itself.
 */
function designSystemColours(string $css, string $selector): array
{
    preg_match_all(
        '/^\s*--([a-z0-9-]+):\s*#([0-9a-fA-F]{6})\s*;/m',
        designSystemBlock($css, $selector),
        $matches,
        PREG_SET_ORDER
    );

    $colours = [];

    foreach ($matches as [, $name, $hex]) {
        $colours[$name] = [
            hexdec(substr($hex, 0, 2)),
            hexdec(substr($hex, 2, 2)),
            hexdec(substr($hex, 4, 2)),
        ];
    }

    return $colours;
}

/** WCAG 2.1 relative luminance of an sRGB triple. */
function designSystemLuminance(array $rgb): float
{
    $channels = array_map(function (int $value): float {
        $srgb = $value / 255;

        return $srgb <= 0.04045 ? $srgb / 12.92 : (($srgb + 0.055) / 1.055) ** 2.4;
    }, $rgb);

    return 0.2126 * $channels[0] + 0.7152 * $channels[1] + 0.0722 * $channels[2];
}

/** WCAG contrast ratio, (L1 + 0.05) / (L2 + 0.05) with L1 the lighter. */
function designSystemContrast(array $a, array $b): float
{
    $first = designSystemLuminance($a);
    $second = designSystemLuminance($b);

    return (max($first, $second) + 0.05) / (min($first, $second) + 0.05);
}

/**
 * The guard whose absence produced the worst defect in this spec's own
 * drafting: every ink had been measured against `page`, none against `paper` --
 * the ground `--muted`, `--accent` and `--secondary` all map onto -- and five of
 * six dark inks were below AA on it. Pairing every ink with every ground, rather
 * than only foreground with background, is what makes that class of mistake
 * impossible to repeat.
 *
 * The measured worst case is 4.504 light / 4.510 dark, both `destructive` on
 * `secondary`. There is very little headroom above 4.5 by design, so a colour
 * nudged "just a shade" will fail here.
 */
it('meets AA across the full ink and ground matrix', function () {
    $css = File::get(resource_path('css/app.css'));

    // Text colours, and the grounds they can land on. `secondary`, `muted` and
    // `accent` are all `paper`, the darkest of the light grounds; measuring
    // against `background` alone is exactly the mistake this test exists for.
    $inks = ['foreground', 'muted-foreground', 'primary', 'destructive'];
    $grounds = ['background', 'card', 'popover', 'secondary', 'muted', 'accent'];

    // The two variables that are also used as fills, each under its own label.
    $fills = ['primary' => 'primary-foreground', 'destructive' => 'destructive-foreground'];

    foreach ([':root', '.dark'] as $selector) {
        $colours = designSystemColours($css, $selector);

        // Pairs are built only from variables actually parsed, so a parse that
        // finds nothing yields nothing to iterate. The count assertion below is
        // what turns that silence into a failure -- assert it BEFORE any ratio,
        // or an empty matrix passes green.
        $pairs = [];

        foreach ($inks as $ink) {
            foreach ($grounds as $ground) {
                if (isset($colours[$ink], $colours[$ground])) {
                    $pairs[] = ["{$ink} on {$ground}", $colours[$ink], $colours[$ground]];
                }
            }
        }

        foreach ($fills as $fill => $label) {
            if (isset($colours[$fill], $colours[$label])) {
                $pairs[] = ["{$label} on {$fill}", $colours[$label], $colours[$fill]];
            }
        }

        // 24 ink x ground + 2 fills.
        expect($pairs)->toHaveCount(26, "wrong number of contrast pairs parsed from `{$selector}`");

        foreach ($pairs as [$description, $ink, $ground]) {
            $ratio = designSystemContrast($ink, $ground);

            expect($ratio)->toBeGreaterThanOrEqual(
                4.5,
                sprintf('%s in `%s` is %.3f, below AA 4.5', $description, $selector, $ratio)
            );
        }
    }
});

/**
 * Borders are not text, so they sit outside the AA matrix above -- but in a
 * shadowless design the hairline *is* the structure, and the reference's own
 * history records an earlier value being lost at 1.05. Measured against `card`,
 * the ground dividers actually sit on: light 1.604, dark 1.603.
 */
it('keeps borders visible', function () {
    $css = File::get(resource_path('css/app.css'));

    foreach ([':root', '.dark'] as $selector) {
        $colours = designSystemColours($css, $selector);

        $pairs = [];

        foreach (['border', 'input'] as $line) {
            if (isset($colours[$line], $colours['card'])) {
                $pairs[] = ["{$line} on card", $colours[$line], $colours['card']];
            }
        }

        // Same guard as above: an empty matrix must fail, not pass silently.
        expect($pairs)->toHaveCount(2, "wrong number of border pairs parsed from `{$selector}`");

        foreach ($pairs as [$description, $line, $ground]) {
            $ratio = designSystemContrast($line, $ground);

            expect($ratio)->toBeGreaterThanOrEqual(
                1.5,
                sprintf('%s in `%s` is %.3f, too faint to read as structure', $description, $selector, $ratio)
            );
        }
    }
});

/**
 * Scoped to every Blade under `resources/views`, not to `app.blade.php` alone.
 * The two error views are exactly the kind of file a font migration forgets:
 * neither loads `app.css`, so nothing about the self-hosting work touches them
 * and nothing about the built CSS would reveal a CDN link left behind. A
 * directory-wide scan is what forces them into the port and keeps them in it.
 *
 * The file count is asserted first on purpose. A scan that silently matches
 * zero files would pass this test green forever, which is a failure mode this
 * project has shipped before.
 */
it('references no font CDN from any blade', function () {
    $blades = collect(File::allFiles(resource_path('views')))
        ->filter(fn ($file): bool => str_ends_with($file->getFilename(), '.blade.php'))
        ->values();

    // app.blade.php plus errors/419 and errors/429. Raise this deliberately
    // when a Blade is added, rather than letting the scan quietly shrink.
    expect($blades)->toHaveCount(3);

    foreach ($blades as $blade) {
        $source = File::get($blade->getPathname());
        $name = $blade->getRelativePathname();

        // A file that read as empty would satisfy every assertion below.
        expect($source)->not->toBeEmpty("{$name} read as empty");

        foreach (['fonts.bunny.net', 'fonts.googleapis.com', 'fonts.gstatic.com'] as $host) {
            // str_contains, not `not->toContain($host, $message)`: toContain is
            // variadic, so a message passed as a second argument is read as a
            // second needle and the negation becomes "does not contain BOTH" --
            // which the message itself always satisfies, passing green over a
            // live CDN link. Watched happening.
            expect(str_contains($source, $host))
                ->toBeFalse("{$name} still loads fonts from {$host}");
        }
    }
});

/**
 * Both error views must actually compile and render. This looks redundant next
 * to a text scan until you hit the trap it was written for: Blade compiles its
 * directives from inside CSS comments too, so merely *naming* an
 * argument-less asset directive in a comment throws a 500 out of the page whose
 * whole job is to render when everything else is broken. The 429 has render
 * coverage through the throttle tests; the 419 had none at all, which is how
 * that would have shipped unnoticed.
 */
it('renders both error views without a compiled-asset dependency', function (string $view, string $heading) {
    expect(view($view)->render())->toContain($heading);
})->with([
    ['errors.419', 'Trang đã hết hạn'],
    ['errors.429', 'Bạn gửi hơi nhanh'],
]);
