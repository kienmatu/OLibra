# Implementation plan: porting OLibra's design system

Spec: `docs/superpowers/specs/2026-08-31-design-system-port-design.md`
Branch: `feat/design-system-port`, cut from `main` at `7704d10`
Plan applies from HEAD `3a4b733` — the font files are **already vendored**, see Task 1.

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
- **No formatter or linter covers `resources/css/app.css`.** `.prettierignore:12`
  ignores `resources` wholesale, and `biome.json:4` scopes Biome to
  `resources/js/**`. Match the file's existing 4-space indentation by hand —
  nothing will check it for you, and `npx prettier --check` on it reports a
  false pass.
- **The frontend build is `npm run laravel:build`.** Plain `npm run build` at the
  repo root maps to `cd old_next && next build` — it builds the read-only Next.js
  reference, not this app. Do not run it.
- **Put the new tests in `tests/Feature/Architecture/DesignSystemTest.php`**, next
  to the repo's other file-scanning guards (`StyleGuideTest.php`,
  `TenancyArchitectureTest.php`, …). Note `tests/Pest.php:8-10` applies
  `RefreshDatabase` to everything `->in('Feature')`, so these text-parsing tests
  will migrate the schema on each run; that matches the existing guards and is
  expected.

### House rule on tests: mandatory falsification

Every test in this plan must be **watched failing before it is accepted**. Write
it, mutate the value it protects, run it, see red, restore the value, run it, see
green, then confirm `git status --porcelain` is clean. A test never seen failing
is not evidence. This project has shipped vacuous guards before — one architecture
pin compared a bare path against a `"(line N)"`-suffixed string and passed
unconditionally for a whole phase.

---

## Task 1 — Declare the fonts and wire them into `@theme`

**The files are already downloaded and committed.** `resources/fonts/web/` holds
all 12 WOFF2 faces at HEAD `3a4b733`. Do not re-download them; do not put
anything in `resources/fonts/` itself, which holds the full-range TTFs and
generated definitions TCPDF uses for QR labels (`app/Support/Qr/LabelSheet.php:439`).

1. Write `@font-face` blocks in `resources/css/app.css` for all 12 faces.
   **Take every `unicode-range` from `resources/fonts/web/SOURCE-unicode-ranges.css`**,
   a captured copy of what fonts.bunny.net serves — you do **not** need network
   access. Two cautions: that file contains 17 `@font-face` blocks because
   Literata is served in eight subsets, so use **only** the `latin`, `latin-ext`
   and `vietnamese` blocks; and it carries no `font-display`, so add
   `font-display: swap` yourself (the reference's setting). Vite rewrites relative
   `url()` from `app.css`, so `src` paths are relative to that file and no
   `vite.config.ts` change is needed.
2. In `@theme`, replace `'Instrument Sans'` in `--font-sans` with `'Lexend'`,
   keeping the existing emoji fallback tail, and **add**
   `--font-serif: 'Literata', ui-serif, Georgia, serif`. Without the serif entry
   Literata is downloaded and never used — `font-serif` has 15 call sites across
   11 screens.
3. Delete the `fonts.bunny.net` `<link>` and `<preconnect>` from
   `resources/views/app.blade.php:9-10`.

**Test — `it self-hosts both families across all three subsets`:** assert
`app.css` declares `@font-face` for `Lexend` and `Literata`, that a
`vietnamese`-range face exists for each (match on `U+1EA0-1EF9`), that every
`@font-face` carries `font-display: swap`, and that `app.blade.php` contains no
`fonts.bunny.net`.

The repo-wide no-CDN test belongs to **Task 5**, not here: the two error Blades
still carry the link at this point, so a repo-wide assertion would be red at this
task boundary and stay red for three tasks.

**Falsify it:** drop the `font-display: swap` from one block and watch it fail;
restore.

---

## Task 2 — Re-point the 33 semantic variables

The heart of the change. Work from the spec's section 6 table; every value there
has been measured, so do not re-derive colours.

1. In `:root`, replace all **33** values with the light column.
2. In `.dark`, replace all **32** with the dark column. The count differs on
   purpose: `--radius` is `:root`-only (`app.css:104`) and does not change between
   modes. Do not add it to `.dark`.
3. **Preserve the two-layer indirection.** `@theme` declares
   `--color-background: var(--background)`; `:root`/`.dark` set `--background`.
   Change only the values in `:root`/`.dark`. Do not move colours into `@theme` —
   it emits at `:root`, so `.dark` could not override them.
4. Also expose the reference's own eleven tokens as `@theme` entries
   (`--color-page`, `--color-terracotta`, `--color-hairline`, …) so later work can
   name them directly. These are mode-invariant.
5. **Fix the cold-grey remnant at `app.css:69-77`.** A Tailwind-v3 compat block
   sets `border-color: var(--color-gray-200, currentColor)` on `*`, `::after`,
   `::before`, `::backdrop`, `::file-selector-button`, and the later
   `* { @apply border-border }` (`:151-153`) reclaims only the element selector —
   so a cold grey survives on every pseudo-element border.
   **Change the declaration to `border-color: var(--border)`.** Do *not* try to
   "repoint the fallback": `--color-gray-200` is defined by Tailwind's own theme
   (`node_modules/tailwindcss/theme.css:228`) and `app.css`'s `@theme` extends
   rather than resets it, so the `currentColor` fallback never fires and editing
   it changes nothing.
6. Retarget `--radius-md` to `calc(var(--radius) - 4px)` = 4px, joining
   `--radius-sm` which already carries that value (`app.css:15`). That gives the
   reference's two-radius system across 107 control sites (99 `rounded-md` + 8
   `rounded-sm`) without editing a component. The single `rounded-xl` site keeps
   Tailwind's 0.75rem.

**Tests:**

- `it defines every semantic variable in both modes` — 33 in `:root`, 32 in
  `.dark`. **Scope the match to the literal `:root { … }` and `.dark { … }` blocks
  in the source file, by brace-matching rather than regex** — a lazy
  `/:root\s*\{(.*?)\}/s` stops at the first nested `}`. Step 4 adds eleven `--color-*` entries to `@theme`, which
  Tailwind also emits at `:root`; a semantic or built-CSS count would see 44.
- `it retains no stock starter colours` — assert **no `hsl(`** remains in either
  block. Do not assert only the three obvious starter values; a leftover
  `--muted-foreground: hsl(0, 0%, 45.1%)` would sail past that.
- `it leaves no cold grey on pseudo-element borders` — assert `app.css` contains
  no `var(--color-gray-200`. **Do not quote the old declaration verbatim in a
  comment explaining the fix** — the test scans the whole file, so the
  documentation would fail a correct implementation. Describe the old value in
  prose.

**Falsify each:** delete one variable from `.dark`; restore one `hsl()` value;
restore the `--color-gray-200` reference. Watch each go red, then restore.

---

## Task 3 — Port the reference's base layer

From spec section 5. All sources are `old_next/src/app/globals.css`.

- `html { -webkit-text-size-adjust: 100% }` (56-58)
- `body { font-size: 16px; line-height: 1.6; letter-spacing: 0.01em }` (60-67)
- `h1–h4 { line-height: 1.3; text-wrap: balance }` (69-76). **Carry the comment
  across verbatim** — *"Vietnamese diacritics must never clip."* Stacked tone
  marks on capitals overflow tighter leading; a real bug fix, not styling.
- The `cursor: pointer` base-layer block (78-107) **with its thirty lines of
  comment**. Tailwind 4 dropped the preflight rule giving `<button>` a pointer
  cursor, leaving buttons indistinguishable from dead text for hesitant
  volunteers. Two rounds of bug reports are recorded there.
- `::selection` (109-111) and the `:focus-visible` terracotta outline (113-116).

**On the focus outline — do not go looking for a "stock ring" to remove.** The 4
`focus-visible:outline-hidden` sites in `resources/js` (e.g.
`components/ui/button.tsx:8`, which pairs it with `focus-visible:ring-2
focus-visible:ring-ring`) mean shadcn controls suppress this base outline and keep
their ring — which is already terracotta once Task 2 sets `--ring`. The new
outline reaches non-shadcn focusables only. That is the intended outcome; **do not
edit `button.tsx` or any other component.**

Do **not** port `@utility hairline` (119-122) — zero call sites, and this plan
forbids adding any, so it would ship dead.

**Test — `it ports the reference base layer`:** assert `app.css` contains the
`-webkit-text-size-adjust`, the `body` letter-spacing, the `h1,h2,h3,h4`
line-height with its diacritics comment, the `cursor: pointer` rule, `::selection`
and `:focus-visible`. This is a cheap presence check, but Task 3 otherwise ships
two documented bug fixes with no guard at all, and neither is visible in a
screenshot.

**Falsify it:** delete the `h1–h4` rule, watch it fail, restore.

---

## Task 4 — The contrast guards

These matter more than they look. The spec's own drafting shipped a palette where
**five of six** dark inks failed AA, because every ink had been measured against
`page` and none against `paper` — the ground `--muted`, `--accent` and
`--secondary` all map onto.

**Parsing.** Extract hex values by **splitting on the literal `:root { … }` and
`.dark { … }` blocks first**, then matching within each. A pattern run over the
whole file will match the `@theme` entries too and silently test light mode
against itself.

1. `it meets AA across the full ink and ground matrix` — compute WCAG ratios
   (relative luminance; `(L1+0.05)/(L2+0.05)`) and assert **every** ink
   (`foreground`, `muted-foreground`, `primary`, `destructive`) against **every**
   ground (`background`, `card`, `popover`, `secondary`, `muted`, `accent`), plus
   each fill under its own `-foreground`, is ≥ 4.5 in both modes. Expected worst
   case 4.504 light / 4.510 dark (both are `destructive` on `secondary`).
   **Assert the pair count is 26 before asserting any ratio** (24 ink×ground + 2
   fills, per mode). Without that, a regex that matches nothing iterates an empty
   array and passes green — precisely the vacuous guard this project has shipped
   before.
2. `it keeps borders visible` — `--border` and `--input` ≥ 1.5 against `card` in
   both modes (expected 1.604 / 1.603). Borders are not text so they sit outside
   test 1, but in a shadowless design they *are* the structure; the reference
   records an earlier value being lost at 1.05.

**Falsify both:** set dark `--muted-foreground` to `#938b83` (its page-derived
predecessor, 4.425 on paper) and watch test 1 go red; lighten `--border` toward
the card colour and watch test 2 go red. Restore both.

---

## Task 5 — The two error pages

`errors/419.blade.php` and `errors/429.blade.php` render Vietnamese copy, carry
the CDN link (`419:18-19`, `429:23-24`) and hardcode `#fafafa`, `#18181b`,
`#52525b`. **Neither loads `app.css`** — there is no `@vite` in either.

Keep them self-contained: an error page must render when things are already going
wrong, so do not make it depend on a built asset manifest. Replace the greys in
their inline `<style>` with the reference's `page` / `ink` / `meta` values and use
a **system font stack**, not a webfont. Diacritics render correctly from system
fonts on every target platform.

**Test — `no blade references a font CDN`:** scan **every** Blade under
`resources/views` for `fonts.bunny.net`, `fonts.googleapis.com`,
`fonts.gstatic.com`. Scoping to the whole directory rather than `app.blade.php` is
what keeps these two pages from being forgotten.

**Falsify it:** re-add the link to one error Blade, watch it fail, remove it.

---

## Task 6 — Record the deferred status colours

The spec (D4) defers the six status inks. `AGENTS.md:57` requires that every state
carry **an icon, a Vietnamese word and a colour together** — so this deferral
leaves two of those three unmet, not one.

Add an entry to `docs/known-gaps.md` under a new `## Phase 3b — the design system
port` heading at the end of the file, following the convention of the existing
phase sections (the file is 4,338 lines; `## Phase 3a — the network foundation` at
:4150 is the model to copy for tone, citation style and depth). Name the four call
sites that render the six copy-item states: `components/book-card.tsx:48`,
`pages/shelves/book.tsx:157`, `pages/manage/books/show.tsx:319`,
`pages/manage/books/index.tsx:132`.

Also record there that **`--primary` is pinned to the reference's *hover* colour**:
`docs/DESIGN.md:205` specifies the primary button as `bg-terracotta` with
`hover:bg-terracotta-ink`, and the mapping pins `--primary` to `#965c33`
(terracotta-ink) on AA grounds, so primary buttons render permanently in what the
reference treats as the pressed state. The D5 follow-up should look at this.

---

## Definition of done

- Full suite green inside `laravel-app-1`; `vendor/bin/pint` clean (run in the
  container).
- Every test above watched failing and restored, with `git status --porcelain`
  clean afterwards.
- Screenshots of at least one reader screen and one manage screen, in **both**
  modes, showing the warm palette and both typefaces.
- No file under `resources/js/pages` or `resources/js/components` modified.
- Every task ends with the suite green — no test left red across a task boundary.
