# Implementation plan: porting OLibra's design system

Spec: `docs/superpowers/specs/2026-08-31-design-system-port-design.md`
Branch: `feat/design-system-port`, cut from `main` at `7704d10`

## Context for whoever picks this up

OLibra is a Vietnamese parish lending-library system being ported from Next.js to
Laravel + Inertia + React. `old_next/` is a **read-only** behavioural reference —
never write to it. Phases 1–3a shipped 42 React screens under `resources/js`,
but they were built against the **stock Laravel starter theme**: a neutral
near-black-and-white shadcn palette with `Instrument Sans` pulled from a CDN. The
reference app is warm and papery — cream page, terracotta accents, Lexend for UI
and Literata for headings, hairline rules instead of shadows.

**The single most important thing to understand before you start:** the ported
screens contain **zero** uses of the reference's own utility names. Not one
`bg-page`, `text-ink` or `border-hairline`. Every screen was written against
shadcn's semantic vocabulary instead — `text-muted-foreground` appears 181 times,
`bg-accent` 22, `bg-background` 30. So adding the reference's colours to `@theme`
and stopping there changes **nothing on screen**.

The work is therefore re-pointing shadcn's 33 semantic variables onto the
reference palette, in both light and dark mode, so those 181 existing call sites
start rendering warm greys without a single component being edited. **No screen
component is edited in this plan.** If you find yourself editing a `.tsx` file
under `resources/js/pages` or `resources/js/components`, stop — you have
misread the task.

Section 6 of the spec is the mapping table. It is authoritative; every value in
it has been measured. Do not re-derive colours.

### Environment

- Containers `laravel-app-1` and `laravel-mariadb-1` are up. DB creds
  `-uroot -psecret`, database `olibra_testing`.
- **Do not run `vendor/bin/pint` on the host** — the host PHP is broken. Run it
  inside `laravel-app-1`.
- Run tests with `docker exec laravel-app-1 php artisan test`.

### House rule on tests: mandatory falsification

Every test in this plan must be **watched failing before it is accepted**. Write
it, mutate the value it protects, run it, see red, restore the value, run it, see
green, then confirm `git status --porcelain` is clean. A test never seen failing
is not evidence. This project has shipped vacuous guards before — one architecture
pin compared a bare path against a `"(line N)"`-suffixed string and passed
unconditionally for a whole phase.

---

## Task 1 — Self-host the fonts and wire them into `@theme`

**Why this is first:** nothing else is visible without it, and it is the only task
needing network access.

1. Create `resources/fonts/web/`. **Do not put files in `resources/fonts/`
   directly** — that directory is git-tracked and holds `Lexend-Regular.ttf`,
   `Lexend-SemiBold.ttf`, `OFL.txt` and `resources/fonts/tcpdf/`, which TCPDF
   consumes for QR labels via `app/Support/Qr/LabelSheet.php:439`. Mixing web
   assets in would be confusing at best.
2. Download 12 files (143 KB total) from `https://fonts.bunny.net/{family}/files/`:
   - `lexend-{latin,latin-ext,vietnamese}-{400,500,600}-normal.woff2`
   - `literata-{latin,latin-ext,vietnamese}-600-normal.woff2`
   The user has explicitly approved this download.
3. Fetch `https://fonts.bunny.net/css?family=lexend:400,500,600` and
   `...?family=literata:600` and **copy the `unicode-range` values verbatim** into
   your `@font-face` blocks. Do not retype them from memory — the vietnamese
   range is `U+1EA0-1EF9` plus Ăă Đđ Ĩĩ Ũũ Ơơ Ưư, the combining marks and U+20AB,
   and getting it wrong silently degrades Vietnamese text to a fallback face.
   Every block gets `font-display: swap`.
4. In `resources/css/app.css`, replace `--font-sans`'s `'Instrument Sans'` with
   `'Lexend'` (keep the existing emoji fallback tail) and **add**
   `--font-serif: 'Literata', ui-serif, Georgia, serif`. Without the serif entry,
   Literata downloads and is never used — `font-serif` has 15 call sites across
   11 screens.
5. Delete the `fonts.bunny.net` `<link>` and `<preconnect>` from
   `resources/views/app.blade.php:9-10`.

**Test (`tests/Feature/DesignSystemTest.php`), `no blade references a font CDN`:**
scan **every** Blade under `resources/views` for `fonts.bunny.net`,
`fonts.googleapis.com`, `fonts.gstatic.com`. Scope it to the whole directory, not
just `app.blade.php` — that is what forces the two error Blades into Task 5.

**Falsify it:** re-add the `<link>` to `app.blade.php`, watch it fail, remove it.

**Verify:** `resources/js` uses only `font-normal` (12), `font-medium` (47),
`font-semibold` (83) — zero `font-bold`, zero italics — so 400/500/600 covers
every weight in use.

---

## Task 2 — Re-point the 33 semantic variables

The heart of the change. Work from the spec's section 6 table.

1. In `:root`, replace all **33** variable values with the light column.
2. In `.dark`, replace all **32** with the dark column. The count differs on
   purpose: `--radius` is `:root`-only (`app.css:104`) and does not change
   between modes. Do not add it to `.dark`.
3. **Preserve the two-layer indirection.** `@theme` declares
   `--color-background: var(--background)` and `:root`/`.dark` set `--background`.
   Change only the values in `:root`/`.dark`. Do not move colours into `@theme` —
   `@theme` emits at `:root`, so a `.dark` block cannot override it.
4. Also expose the reference's own eleven tokens as `@theme` entries
   (`--color-page`, `--color-terracotta`, `--color-hairline`, …) so later work can
   name them directly. Note these are mode-invariant.
5. Fix the stock remnant at `app.css:69-77`: a Tailwind-v3 compat block sets
   `border-color: var(--color-gray-200, currentColor)` on `*`, `::after`,
   `::before`, `::backdrop`, `::file-selector-button`. The later
   `* { @apply border-border }` reclaims only the element selector, leaving a cold
   grey on every pseudo-element border. Repoint the fallback at the hairline.
6. Retarget `--radius-md` to `calc(var(--radius) - 4px)` = 4px, matching
   `--radius-sm` which already carries that value (`app.css:15`). This gives the
   reference's two-radius system (card 0.5rem, control 0.25rem) across 107
   control sites without editing a component.

**Tests, all in `DesignSystemTest`:**

- `it defines every semantic variable in both modes` — 33 in `:root`, 32 in `.dark`.
- `it retains no stock starter colours` — assert **no `hsl(`** survives in either
  block. Do not assert only the three obvious starter values; a leftover
  `--muted-foreground: hsl(0, 0%, 45.1%)` would pass that. The new palette is
  authored in hex, so `hsl(` is a clean "not yet ported" marker.

**Falsify each:** delete one variable from `.dark` (expect the count test red);
restore one `hsl()` value (expect the stock test red).

---

## Task 3 — Port the reference's base layer

From spec section 5. All sources are in `old_next/src/app/globals.css`.

- `html { -webkit-text-size-adjust: 100% }` (56-58)
- `body { font-size: 16px; line-height: 1.6; letter-spacing: 0.01em }` (60-67)
- `h1–h4 { line-height: 1.3; text-wrap: balance }` (69-76). **Carry the comment
  across verbatim** — *"Vietnamese diacritics must never clip."* Stacked tone
  marks on capitals overflow tighter leading; this is a real bug fix, not styling.
- The `cursor: pointer` base-layer block (78-107), **with its thirty lines of
  comment**. Tailwind 4 dropped the preflight rule giving `<button>` a pointer
  cursor, leaving buttons indistinguishable from dead text for hesitant
  volunteers. Two rounds of bug reports are recorded there.
- `::selection` (109-111) and the `:focus-visible` terracotta outline (113-116),
  replacing the stock ring.

Do **not** port `@utility hairline` (119-122) — it has zero call sites and this
plan forbids adding any, so it would ship dead.

No test of its own; covered by Task 4's visual verification.

---

## Task 4 — The contrast guards

Two tests, both in `DesignSystemTest`. These matter more than they look: the
spec's own drafting shipped a palette where five of six dark inks failed AA,
because every ink had been measured against `page` and none against `paper` —
the ground that `--muted`, `--accent` and `--secondary` all map onto.

1. `it meets AA across the full ink and ground matrix` — parse the hex values out
   of `app.css`, compute WCAG ratios (relative luminance, `(L1+0.05)/(L2+0.05)`),
   and assert **every** ink (`foreground`, `muted-foreground`, `primary`,
   `destructive`) against **every** ground (`background`, `card`, `popover`,
   `secondary`, `muted`, `accent`), plus each fill under its own `-foreground`,
   is ≥ 4.5 — in both modes. Expected worst case: 4.504 light, 4.510 dark.
   Assert the matrix, not a hand-picked list of pairs.
2. `it keeps borders visible` — `--border` and `--input` ≥ 1.5 against `card` in
   both modes (expected 1.604 / 1.603). Borders are not text so they are outside
   test 1, but in a shadowless design they *are* the structure; the reference
   records an earlier value being lost at 1.05.

**Falsify both:** set dark `--muted-foreground` back to `#968d85`'s
page-derived predecessor `#938b83` (4.425 on paper) and watch test 1 go red;
lighten `--border` toward the card colour and watch test 2 go red.

---

## Task 5 — The two error pages

`errors/419.blade.php` and `errors/429.blade.php` render Vietnamese copy, carry
the CDN link (`419:18-19`, `429:23-24`) and hardcode neutral greys `#fafafa`,
`#18181b`, `#52525b`. **Neither loads `app.css`** — there is no `@vite` in either.

Keep them self-contained: an error page must render when things are already going
wrong, so do not make it depend on a built asset manifest. Replace the greys in
their inline `<style>` with the reference's `page` / `ink` / `meta` values and use
a **system font stack**, not a webfont. Diacritics render correctly from system
fonts on every target platform.

Task 1's no-CDN test already covers these files; it should go green here.

---

## Task 6 — Record the deferred status colours

The spec (D4) defers the six status inks. `AGENTS.md` rule 2 asks that a status be
conveyed by word **and** colour, so this leaves that rule partly unmet. Add an
entry to `docs/known-gaps.md` naming the four call sites that render the six
copy-item states: `components/book-card.tsx:48`, `pages/shelves/book.tsx:157`,
`pages/manage/books/show.tsx:319`, `pages/manage/books/index.tsx:132`. The states
stay distinguishable by word, so nothing becomes ambiguous meanwhile.

---

## Definition of done

- Full suite green inside `laravel-app-1`; `vendor/bin/pint` clean (run in the
  container).
- Every test above watched failing and restored, with `git status --porcelain`
  clean afterwards.
- Screenshots of at least one reader screen and one manage screen, in **both**
  modes, showing the warm palette and both typefaces.
- No file under `resources/js/pages` or `resources/js/components` modified.
