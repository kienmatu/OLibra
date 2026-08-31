# Porting OLibra's design system to the Laravel app

Status: approved design, revised after review
Date: 2026-08-31
Branch: `feat/design-system-port`, cut from `main` at `7704d10`

## 1. Context

OLibra is a parish lending-library system being ported from Next.js to Laravel +
Inertia + React. The Next.js app lives in `old_next/` as a **read-only**
behavioural reference. Phases 1 through 3a have shipped the data model, the
reader-facing screens, the manager screens, statistics and QR labels — 42 React
screens in `resources/js`.

Those screens were built against the **stock Laravel starter theme**: a neutral
near-black-and-white shadcn palette with the `Instrument Sans` webfont pulled
from `fonts.bunny.net`. The reference app looks nothing like it. `old_next` is
warm and papery — a cream page, terracotta accents, `Lexend` for UI and
`Literata` for headings, visible hairline rules instead of shadows.

This is why the screenshots taken from Phase 3a look like a generic admin panel
rather than OLibra: **the design system was never ported.** Only the screens were.

## 2. Problem statement

Two problems, and the second is the one that makes this spec non-trivial.

**Problem 1 — the tokens do not exist.** `resources/css/app.css` has no
`--color-page`, no `--color-terracotta`, no serif family. The warm palette and
the two typefaces simply are not in the Laravel app.

**Problem 2 — nothing would consume them if they did.** This is the finding that
reshaped this spec. Searching the 42 ported screens for the reference's own
utility class names:

```
$ grep -rnoE '\b(bg|text|border)-(page|surface|paper|hairline|ink|meta|leather|terracotta|sage|brick)\b' resources/js | wc -l
0
```

**Zero.** Every ported screen was written against shadcn's *semantic* vocabulary
instead — `text-muted-foreground` appears 181 times, `bg-accent` 22, `bg-background`
30, `bg-primary` 14. So adding the reference's tokens to `@theme` and stopping
there would change **nothing on screen**. It would be a no-op that looks like a
delivered feature.

The port is therefore not "add ten colour variables." It is: **re-point shadcn's
33 semantic variables, in both modes, onto the reference's palette** — so that
the 181 existing `text-muted-foreground` call sites start rendering the
reference's `meta` grey without any screen being edited.

That mapping table is the central artefact of this work, and it is section 6.

## 3. Scope

In scope: `resources/css/app.css`, `resources/views/app.blade.php`, the two error
Blades (`errors/419.blade.php`, `errors/429.blade.php`), font assets, and a
regression test. **No screen component is edited.** Per-screen visual refinement
is explicitly out of scope (D5).

## 4. Decisions

### D1 — Self-host all three subsets, bundled by Vite

The app currently pulls `Instrument Sans` from `fonts.bunny.net` at runtime. The
reference self-hosts, and `old_next/src/app/layout.tsx:5` says why:

> Self-hosted at build time by `next/font` — never fetched from a third-party CDN.
> The vietnamese subset is required: diacritics are not optional here.

That second sentence is a correctness constraint. Google's `vietnamese` subset
spans **U+1EA0–U+1EF9** plus Ăă Đđ Ĩĩ Ũũ Ơơ Ưư, the combining tone marks, and
U+20AB (₫). The `latin-ext` subset covers U+0100–02BA, U+1E00–1E9F and
U+1EF2–1EFF — so it supplies the *base* letters Ăă Đđ Ơơ Ưư and **overlaps**
vietnamese at U+1EF2–1EF9, but it does not carry the bulk of the precomposed
tone-marked vowels (ậ ộ ữ ọ …) in U+1EA0–1EF1. A build shipping only
`latin`+`latin-ext` renders much of Vietnamese body text from a fallback face,
producing visibly mismatched glyphs mid-word.

The reference loads **three** subsets — `["latin", "latin-ext", "vietnamese"]`
(`layout.tsx:8,15`) — and we match that exactly. Vietnamese-only is not an
option; it would break Latin text.

**Files.** Nothing is vendored today: every `.woff2` in the repo belongs to
KaTeX, and `old_next` has no `@next/font` directory, because `next/font` fetched
these at build time. So the implementation must **acquire 12 files**:

- `lexend-{latin,latin-ext,vietnamese}-{400,500,600}-normal.woff2` (9)
- `literata-{latin,latin-ext,vietnamese}-600-normal.woff2` (3)

from `https://fonts.bunny.net/{family}/files/`, into `resources/fonts/`. Both
families are SIL Open Font License 1.1; the licence text ships alongside them.
Each `@font-face` carries the `unicode-range` bunny serves for that subset, so
the browser fetches only the subsets a page actually needs — copy the ranges from
`https://fonts.bunny.net/css?family=lexend:400,500,600` rather than retyping them.

**One narrowing to note:** the reference passes no weight array, so `next/font`
ships Lexend as a *variable* font. Pinning 400/500/600 is a deliberate decision
to keep the static-file count down, not a faithful port. Those are the three
weights the screens use.

### D2 — Port the reference's light palette verbatim

The eleven ground/ink tokens from `old_next/src/app/globals.css` are copied
unchanged. They are a designed set, not a starting point, and one of them
carries a comment recording a fix we would otherwise re-break:

| token | value | role |
|---|---|---|
| `page` | `#fdfbf8` | app ground |
| `surface` | `#ffffff` | cards, raised panels |
| `paper` | `#f2ebe1` | inset/secondary fills |
| `hairline` | `#d3cbc2` | all dividers and borders |
| `ink` | `#3a352f` | body text |
| `meta` | `#716962` | secondary text |
| `leather` | `#776857` | tertiary/labels |
| `terracotta` | `#a4673b` | primary accent (fill) |
| `terracotta-ink` | `#965c33` | primary accent (text) |
| `sage` | `#477369` | positive accent |
| `brick` | `#af4c44` | negative accent |

On `hairline` the reference notes that an earlier `#ede5da` sat at 1.05:1 on warm
paper, leaving row dividers effectively invisible, and that in a design with no
shadows the borders *are* the structure. We keep `#d3cbc2`.

Note the reference distinguishes `terracotta` (a **fill**) from `terracotta-ink`
(**text**). Section 6 shows why that distinction forces a decision when mapping
onto shadcn, which has only one variable for both.

### D3 — Derive a dark palette, then hand-tune it

`old_next` has **no dark mode** — zero matches for `.dark`, `dark:`, or
`prefers-color-scheme`. But the Laravel app already ships a working dark mode
(appearance toggle, `.dark` class, persisted preference), and 42 screens already
carry `dark:` variants. Removing it would be a visible regression; leaving it on
the stock neutral palette would mean the app is warm in light mode and cold in
dark. So the dark values must be **invented**, and this is the only part of the
port with no reference to copy.

**Method, stated honestly.** The heuristic is: hold each ink's hue and saturation,
and move its lightness until it sits at *the same contrast ratio against the dark
ground that it has against the light ground in the reference*. This is a
**starting heuristic followed by a hand-tuning pass**, not a derivation that
removes judgement:

- WCAG relative luminance is not perceptually uniform, so equal ratios do not
  guarantee equal perceived emphasis.
- HSL saturation is not chroma; holding it does not hold colourfulness. OKLCH
  would model this correctly. We use HSL because the reference is authored in hex
  and the arithmetic stays inspectable in review.
- The constraint suits **inks** and actively misfits **fills** (see below).

Treat the numbers as a defensible starting point that a human should look at, not
as a proof of visual equivalence.

**Why ~5.2 is the reference's constant.** Measured against `page`, **ten** of the
reference's eleven accent/ink tokens fall in a 5.16–5.25 band: `terracotta-ink`
5.246, `available` 5.245, `overdue` 5.227, `meta` 5.214, `held` 5.214, `retired`
5.214, `leather` 5.210, `sage` 5.181, `brick` 5.160, `onloan` 5.158. (That is ten
tokens but **nine** distinct values — `retired` is byte-identical to `meta`.) Two
tokens sit outside it: `ink` at 11.751, because it is body copy, and `lost` at
5.751, which is simply darker than its neighbours.

The one *low* outlier is `terracotta` at 4.44 — low precisely because it is **not
an ink**. It is a fill carrying white text, so its governing constraint is
white-on-fill (4.583), not itself-on-page.

**Grounds** (chosen by hand, then checked):

| token | light | dark |
|---|---|---|
| `page` | `#fdfbf8` | `#1b1916` |
| `surface` | `#ffffff` | `#24211d` |
| `paper` | `#f2ebe1` | `#2b2721` |

Surface-against-page is 1.033 in light and 1.094 in dark, so cards lift slightly
*better* in dark than in the reference — acceptable, and deliberate.

**Inks are derived against `paper`, not `page`.** This is the correction that
matters most. `paper` is the *worst-case* ground in both modes — it is darker
than `page` in light mode and lighter than `page` in dark mode, so it always
yields the lowest contrast. Section 6 maps `--muted`, `--accent` and
`--secondary` onto it, which puts the 181 `text-muted-foreground` call sites on
`paper` constantly. Deriving against `page` and checking nothing else left
**five of six** dark inks below AA on `paper` (`meta` 4.425, `leather` 4.406,
`terracotta-ink` 4.437, `sage` 4.374, `brick` 4.381). Each dark ink now
reproduces its light counterpart's ratio against `paper`:

| token | light | on light `paper` | dark | on dark `paper` |
|---|---|---|---|---|
| `ink` | `#3a352f` | 10.257 | `#dad6d1` | 10.263 |
| `meta` | `#716962` | 4.551 | `#968d85` | 4.555 |
| `leather` | `#776857` | 4.548 | `#9d8c78` | 4.563 |
| `terracotta-ink` | `#965c33` | 4.579 | `#c37f4f` | 4.572 |
| `sage` | `#477369` | 4.522 | `#5e998b` | 4.527 |
| `brick` | `#af4c44` | 4.504 | `#c87871` | 4.510 |

The light column is the reference's own values, unchanged. They are thin — brick
sits at 4.504 — but they pass, and D2 keeps them verbatim. Every dark value
clears 4.5 against all three grounds (`page`, `surface`, `paper`); the full
matrix is verified in section 6.

**Fills are not derived.** `terracotta` (`#a4673b`) and the `brick` fill
(`#af4c44`) keep their light values in dark mode. A fill's job is to carry white
text, and that constraint does not change with the page behind it: white-on-
terracotta stays 4.583, white-on-brick 5.33. Deriving `terracotta` as if it were
an ink would have lightened it to `#b37040`, dropping white-on-fill to **3.956 —
a WCAG AA failure on the app's primary button.** The fill/ink split in D2 is what
makes this visible.

### D4 — Do not port the six status inks in this phase

The reference defines six status colours (`available` `#457453`, `onloan`
`#8e6231`, `held` `#4d6d8f`, `overdue` `#ad4c42`, `lost` `#94514a`, `retired`
`#716962`). We are not porting them here.

The six copy-item states in `resources/js/lib/copy.ts:155` — "Có sẵn", "Đang cho
mượn", "Đang giữ chỗ", "Đã mất", "Ngừng dùng", "Chưa có bản nào" — currently
render as text through shadcn badges at **four** call sites: `book-card.tsx:48`,
`shelves/book.tsx:157`, `manage/books/show.tsx:319` and `manage/books/index.tsx:132`.

Porting the status inks properly means adding six token pairs (twelve values,
since each needs a dark counterpart), deciding badge fill-vs-ink for each, and
editing four screens. That is per-screen visual work, which D5 puts out of scope,
and it would roughly double this change while the palette itself is still
unproven on screen.

`AGENTS.md` rule 2 asks that a status be conveyed by word **and** colour, so
deferring this leaves that rule partly unmet. **We record it in
`docs/known-gaps.md` as an explicit deferral with the four call sites named**,
rather than letting it pass silently. The states remain distinguishable by word
throughout, so nothing becomes ambiguous in the interim.

### D5 — Per-screen refinement is out of scope

This phase changes tokens only. Screens will shift in colour and type
automatically through the mapping; some will have spacing or weight that suits
the old palette better than the new. Fixing those is a follow-up pass with
screenshots, not part of a change whose correctness rests on touching no
component.

### D6 — Wire both families into `@theme`, or the font port is invisible

`app.css:10` declares `--font-sans: 'Instrument Sans', …` inside `@theme`, and
there is **no `--font-serif` at all**. Downloading the files and writing
`@font-face` rules changes nothing on its own: `font-sans` would still resolve to
Instrument Sans, and `font-serif` — used **15 times across 11 screens**, including
`shelves/profile/overview.tsx:152` and `manage/comments.tsx:300` — would keep
falling through to the browser's generic serif.

So the port must also replace `--font-sans` with `Lexend` and **add**
`--font-serif: 'Literata', ui-serif, Georgia, serif`. Without this, Literata is
downloaded and never used.

### D7 — Error pages get the palette inline, with no webfont

`errors/419.blade.php` and `errors/429.blade.php` render Vietnamese copy, carry
the `fonts.bunny.net` link (`419:18-19`, `429:23-24`) and hardcode neutral greys
(`#fafafa`, `#18121b`, `#52525b`). They are standalone — **neither loads
`app.css`** via `@vite`.

Deleting the CDN link alone would leave them *more* stock-looking, not less. But
wiring them to `app.css` makes an error page depend on a built asset manifest,
which is exactly the dependency an error page should not have — a 419 or 429 must
render when things are already going wrong.

So: keep them self-contained, replace the hardcoded greys in their inline
`<style>` with the reference's `page`/`ink`/`meta`/`hairline` hex values, and use
a **system font stack** rather than a webfont. Diacritics render correctly from
system fonts on every target platform; what matters on these two pages is that
they stop looking like a different application.

## 5. The reference's other base rules

These are part of the identity and were missed on the first two passes. All live
in `old_next/src/app/globals.css`:

- **`body { font-size: 16px; line-height: 1.6; letter-spacing: 0.01em }`**
  (60-67). This changes every screen's typographic colour and is more visible
  than any radius decision.
- **`h1–h4 { line-height: 1.3; text-wrap: balance }`** (69-76), under the comment
  *"Vietnamese diacritics must never clip."* Stacked tone marks on capitals
  overflow tighter leading — the same class of bug as D1's subset requirement.
- **`html { -webkit-text-size-adjust: 100% }`** (56-58).
- **A `cursor: pointer` base-layer block** (78-107) with thirty lines of comment
  recording two rounds of bug reports: Tailwind 4 dropped the preflight rule that
  gave `<button>` a pointer cursor, leaving buttons indistinguishable from dead
  text for hesitant volunteers. This is a deliberate accessibility fix and must
  come across with its comment intact.
- **A `::selection` rule** (109-111) and a **`:focus-visible` terracotta outline**
  (113-116), replacing the stock ring.

**Radius.** The reference has exactly two: `--radius-card: 0.5rem` and
`--radius-control: 0.25rem` (51-52). Adding a `--radius-control` token to
`@theme` would generate a `rounded-control` utility that **nothing uses** —
controls in the ported screens use `rounded-md` (99 sites) and `rounded-sm` (8),
which resolve through `app.css:13-15`. With `--radius: 0.5rem` (8px), those are
6px and 4px today. So the port instead retargets the chain: `--radius-lg` stays
8px (cards already match `radius-card`), and **both `--radius-md` and
`--radius-sm` become `calc(var(--radius) - 4px)` = 4px**, giving the reference's
two-radius system across all 107 call sites without editing a component.

**Not ported:** `@utility hairline` (119-122). It has zero call sites in
`resources/js`, and D5 forbids adding any, so it would ship dead.

## 6. The mapping: shadcn's 33 variables onto the reference palette

This is the artefact that makes the port visible. `app.css` uses Tailwind 4's
two-layer indirection — `@theme` declares `--color-background: var(--background)`,
and `:root` / `.dark` set `--background`. That shape is **preserved**: we change
only the values in `:root` and `.dark`, because `@theme` emits at `:root` and a
`.dark` block cannot override it.

**The one-token-two-jobs conflict.** shadcn has a single `--primary` where the
reference has both `terracotta` (fill) and `terracotta-ink` (text). The app uses
`bg-primary` 14 times *and* `text-primary` 6 times; `destructive` is worse —
`bg-destructive` 18, `text-destructive` 18, `border-destructive` 16. So each such
variable must simultaneously satisfy two constraints: legible as text on the
ground, **and** legible under its own `-foreground` as a fill. Measured:

| variable | value tried | text on `paper` | its `-foreground` on the fill | |
|---|---|---|---|---|
| light `--primary` | fill `#a4673b` | 3.87 | 4.58 | fails |
| light `--primary` | ink `#965c33` | 4.58 | 5.42 | **passes** |
| dark `--primary` | fill `#a4673b` | 3.24 | 3.83 | fails |
| dark `--primary` | ink `#c37f4f` | 4.57 | 5.40 | **passes** |
| light `--destructive` | ink `#af4c44` | 4.50 | 5.33 | **passes** |
| dark `--destructive` | fill `#af4c44` | 2.78 | 3.29 | fails |
| dark `--destructive` | ink `#c87871` | 4.51 | 5.33 | **passes** |

Both columns are measured against the **worst case**: text on `paper` (the lowest-contrast ground) and the foreground the mapping actually assigns in that mode (white in light, `page` in dark).

One rule covers every case: **map accent variables to the reference's *ink*
value, and set the matching `-foreground` to the opposing ground** (white in
light mode, `page` in dark). The cost is that buttons render ~7% darker than the
reference's `#a4673b`; the alternative is either an AA failure or introducing a
second token and editing every call site, which D5 excludes.

| shadcn variable | light | dark | from |
|---|---|---|---|
| `--background` | `#fdfbf8` | `#1b1916` | page |
| `--foreground` | `#3a352f` | `#dad6d1` | ink |
| `--card` | `#ffffff` | `#24211d` | surface |
| `--card-foreground` | `#3a352f` | `#dad6d1` | ink |
| `--popover` | `#ffffff` | `#24211d` | surface |
| `--popover-foreground` | `#3a352f` | `#dad6d1` | ink |
| `--primary` | `#965c33` | `#c37f4f` | terracotta-ink |
| `--primary-foreground` | `#ffffff` | `#1b1916` | white / page |
| `--secondary` | `#f2ebe1` | `#2b2721` | paper |
| `--secondary-foreground` | `#3a352f` | `#dad6d1` | ink |
| `--muted` | `#f2ebe1` | `#2b2721` | paper |
| `--muted-foreground` | `#716962` | `#968d85` | meta |
| `--accent` | `#f2ebe1` | `#2b2721` | paper |
| `--accent-foreground` | `#3a352f` | `#dad6d1` | ink |
| `--destructive` | `#af4c44` | `#c87871` | brick |
| `--destructive-foreground` | `#ffffff` | `#1b1916` | white / page |
| `--border` | `#d3cbc2` | `#4a4136` | hairline |
| `--input` | `#d3cbc2` | `#4a4136` | hairline |
| `--ring` | `#965c33` | `#c37f4f` | terracotta-ink |
| `--chart-1` | `#477369` | `#5e998b` | sage |
| `--chart-2` | `#965c33` | `#c37f4f` | terracotta-ink |
| `--chart-3` | `#776857` | `#9d8c78` | leather |
| `--chart-4` | `#af4c44` | `#c87871` | brick |
| `--chart-5` | `#716962` | `#968d85` | meta |
| `--sidebar-background` | `#ffffff` | `#24211d` | surface |
| `--sidebar-foreground` | `#3a352f` | `#dad6d1` | ink |
| `--sidebar-primary` | `#965c33` | `#c37f4f` | terracotta-ink |
| `--sidebar-primary-foreground` | `#ffffff` | `#1b1916` | white / page |
| `--sidebar-accent` | `#f2ebe1` | `#2b2721` | paper |
| `--sidebar-accent-foreground` | `#3a352f` | `#dad6d1` | ink |
| `--sidebar-border` | `#d3cbc2` | `#4a4136` | hairline |
| `--sidebar-ring` | `#965c33` | `#c37f4f` | terracotta-ink |
| `--radius` | `0.5rem` | unchanged | radius-card |

The reference's own eleven tokens are **also** exposed as `@theme` entries
(`--color-page` and friends) so future work can name them directly — but note
these are **mode-invariant**: `@theme` gives each one value, so the `::selection`
and `:focus-visible` rules from section 5 that consume them keep light-mode
values in dark. The terracotta focus ring survives that (`#a4673b` on `#1b1916`
is 3.83, above the 3:1 non-text floor); it is a deliberate acceptance, not luck.

Two caveats on the table's reach. `--chart-1` through `--chart-5` have **zero**
call sites in `resources/js` (the statistics screen draws hand-rolled SVG), so
those five rows change nothing on screen today and are mapped only for
consistency. Everything else in the table is live: re-pointing `--muted-foreground`
alone moves 181 call sites.

## 7. Testing

The risk this change carries is silent regression: a token dropped, a mode left
on stock values, or a CDN link creeping back. Four guards:

1. **A palette test** asserting `app.css` defines all **33** variables in `:root`
   and the **32** that belong in `.dark`. The counts differ deliberately:
   `--radius` is `:root`-only (`app.css:104`) and the mapping leaves it unchanged
   across modes, so asserting 33 in both would fail against a correct
   implementation.
2. **A stock-value test** asserting **no `hsl(` remains** in either block. Naming
   only the three obvious starter values (`hsl(0, 0%, 3.9%)`, `hsl(0, 0%, 100%)`,
   `hsl(0, 0%, 9%)`) would let a half-finished port through — a leftover
   `--muted-foreground: hsl(0, 0%, 45.1%)` or `--sidebar-ring: hsl(217.2, 91.2%,
   59.8%)` passes all three checks. The palette is authored in hex, so `hsl(` is
   a clean marker for "not yet ported."
3. **A no-CDN test** asserting no Blade under `resources/views` references
   `fonts.bunny.net`, `fonts.googleapis.com` or `fonts.gstatic.com`. Scoping the
   scan to the whole directory — not just `app.blade.php` — is what forces the two
   error Blades of D7 into the port.
4. **A contrast test** over the **full ink × ground matrix**, not just
   foreground/background pairs. This is the guard whose absence produced the worst
   defect in this spec's own drafting: every ink had been measured against `page`,
   none against `paper`, and five of six dark inks were below AA on the ground
   that three semantic variables map onto. The test asserts every ink
   (`foreground`, `muted-foreground`, `primary`, `destructive`) against every
   ground (`background`, `card`, `popover`, `secondary`, `muted`, `accent`) plus
   each fill under its own `-foreground`, ≥ 4.5, in both modes. The measured worst
   case is 4.504 light / 4.510 dark.

Per project practice, **each test must be watched failing before it is accepted**
— mutate the value it protects, see red, restore, confirm `git status
--porcelain` is clean.

## 8. Risks

- **The dark palette is invented.** No reference exists to check it against, and
  D3's method is a heuristic. Expect a hand-tuning pass once it is on screen.
- **The mapping is uniform, the screens are not.** Re-pointing `--accent` moves
  22 call sites at once; a few may land oddly. That is what D5's follow-up is for.
- **Font files add to the bundle.** Twelve woff2 files (Lexend at three weights ×
  three subsets, Literata 600 × three subsets). `unicode-range` means a typical
  page fetches only two or three of them. The cost is accepted for correct
  diacritics and no third-party runtime dependency.
- **The font binaries must be downloaded** from `fonts.bunny.net` during
  implementation. Nothing is vendored today, so this needs explicit sign-off
  before it runs.
- **Status colour stays deferred** (D4), leaving `AGENTS.md` rule 2 partly unmet
  and recorded in `docs/known-gaps.md`.
