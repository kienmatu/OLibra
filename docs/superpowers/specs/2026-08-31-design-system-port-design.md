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

### D1 — Self-host both families, bundled by Vite, with the `vietnamese` subset

The app currently pulls `Instrument Sans` from `fonts.bunny.net` at runtime. The
reference self-hosts, and its `layout.tsx:5` says why:

> Self-hosted at build time by `next/font` — never fetched from a third-party CDN.
> The vietnamese subset is required: diacritics are not optional here.

That second sentence is a correctness constraint, not a preference. The
`vietnamese` Unicode subset covers **U+1EA0–U+1EF1**, which holds most precomposed
tone-marked Vietnamese vowels (ậ, ộ, ữ, ọ…). The `latin-ext` subset covers
U+0100–U+02BA and U+1EF2–U+1EFF and **does not include that range**. A build that
ships only `latin`+`latin-ext` renders a large share of Vietnamese body text from
a fallback font, producing visibly mismatched glyphs mid-word.

We self-host `Lexend` (400/500/600) and `Literata` (600) as woff2 under
`resources/fonts/`, declared with `@font-face` and `font-display: swap`, and
delete the `fonts.bunny.net` `<link>` and `preconnect` from `app.blade.php`.
This also removes a third-party runtime dependency from a self-hosted cPanel
deployment, which is consistent with the rest of the project.

### D2 — Port the reference's light palette verbatim

The ten ground/ink tokens from `old_next/src/app/globals.css` are copied
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

**Why ~5.2 is the reference's constant.** Measuring the reference's own tokens
against `page`, eleven of them cluster tightly: `terracotta-ink` 5.246, `meta`
5.214, `leather` 5.210, `sage` 5.181, `brick` 5.160, plus the six status inks.
`ink` itself sits far above at 11.751 because it is body copy. The single low
outlier is `terracotta` at 4.44 — and it is low precisely because it is **not an
ink**: it is a fill that carries white text, so its constraint is white-on-fill
(4.583), not itself-on-page.

**Grounds** (chosen by hand, then checked):

| token | light | dark |
|---|---|---|
| `page` | `#fdfbf8` | `#1b1916` |
| `surface` | `#ffffff` | `#24211d` |
| `paper` | `#f2ebe1` | `#2b2721` |

Surface-against-page is 1.033 in light and 1.094 in dark, so cards lift slightly
*better* in dark than in the reference — acceptable, and deliberate.

**Inks** (each derived against **its own** light ratio, not a shared constant):

| token | light | ratio | dark | ratio |
|---|---|---|---|---|
| `ink` | `#3a352f` | 11.751 | `#d7d3cd` | 11.768 |
| `meta` | `#716962` | 5.214 | `#938b83` | 5.230 |
| `leather` | `#776857` | 5.210 | `#9b8976` | 5.207 |
| `terracotta-ink` | `#965c33` | 5.246 | `#c27c4b` | 5.244 |
| `sage` | `#477369` | 5.181 | `#5d9689` | 5.170 |
| `brick` | `#af4c44` | 5.160 | `#c7756e` | 5.177 |

**`hairline` is derived against `surface`, not `page`** — dividers overwhelmingly
sit inside cards, so `surface` is the ground that governs whether they are
visible. Against `surface` the light hairline is 1.604; the dark value `#4a4136`
reproduces it at 1.603 (and reads 1.754 against `page`). Deriving it against
`page` instead would have let it regress to 1.42 on the surface where it actually
matters — below the reference's own stated floor for a shadowless design.

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

## 5. What the reference's stylesheet carries besides colour

These were missed on the first pass and are part of the identity:

- `--radius-card: 0.5rem` and `--radius-control: 0.25rem`. Laravel's `--radius`
  is already `0.5rem`, so cards match; controls need the tighter value.
- `h1–h4 { line-height: 1.3 }`, commented in the reference as **"Vietnamese
  diacritics must never clip."** Stacked tone marks on capitals overflow tighter
  leading. This is the same class of bug as D1's subset requirement and must come
  across.
- A `:focus-visible` outline in terracotta — the app currently uses the stock ring.
- A `::selection` rule in warm tones.
- An `@utility hairline` helper.

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

| variable | value tried | text-on-ground | fg-on-fill | |
|---|---|---|---|---|
| light `--primary` | fill `#a4673b` | 4.44 | 4.58 | fails |
| light `--primary` | ink `#965c33` | 5.25 | 5.42 | **passes** |
| dark `--primary` | fill `#a4673b` | 3.83 | 4.58 | fails |
| dark `--primary` | ink `#c27c4b` | 5.24 | 5.24 | **passes** |
| dark `--destructive` | fill `#af4c44` | 3.29 | 5.33 | fails |
| dark `--destructive` | ink `#c7756e` | 5.18 | 5.18 | **passes** |

One rule covers every case: **map accent variables to the reference's *ink*
value, and set the matching `-foreground` to the opposing ground** (white in
light mode, `page` in dark). The cost is that buttons render ~7% darker than the
reference's `#a4673b`; the alternative is either an AA failure or introducing a
second token and editing every call site, which D5 excludes.

| shadcn variable | light | dark | from |
|---|---|---|---|
| `--background` | `#fdfbf8` | `#1b1916` | page |
| `--foreground` | `#3a352f` | `#d7d3cd` | ink |
| `--card` | `#ffffff` | `#24211d` | surface |
| `--card-foreground` | `#3a352f` | `#d7d3cd` | ink |
| `--popover` | `#ffffff` | `#24211d` | surface |
| `--popover-foreground` | `#3a352f` | `#d7d3cd` | ink |
| `--primary` | `#965c33` | `#c27c4b` | terracotta-ink |
| `--primary-foreground` | `#ffffff` | `#1b1916` | white / page |
| `--secondary` | `#f2ebe1` | `#2b2721` | paper |
| `--secondary-foreground` | `#3a352f` | `#d7d3cd` | ink |
| `--muted` | `#f2ebe1` | `#2b2721` | paper |
| `--muted-foreground` | `#716962` | `#938b83` | meta |
| `--accent` | `#f2ebe1` | `#2b2721` | paper |
| `--accent-foreground` | `#3a352f` | `#d7d3cd` | ink |
| `--destructive` | `#af4c44` | `#c7756e` | brick |
| `--destructive-foreground` | `#ffffff` | `#1b1916` | white / page |
| `--border` | `#d3cbc2` | `#4a4136` | hairline |
| `--input` | `#d3cbc2` | `#4a4136` | hairline |
| `--ring` | `#965c33` | `#c27c4b` | terracotta-ink |
| `--chart-1` | `#477369` | `#5d9689` | sage |
| `--chart-2` | `#965c33` | `#c27c4b` | terracotta-ink |
| `--chart-3` | `#776857` | `#9b8976` | leather |
| `--chart-4` | `#af4c44` | `#c7756e` | brick |
| `--chart-5` | `#716962` | `#938b83` | meta |
| `--sidebar-background` | `#ffffff` | `#24211d` | surface |
| `--sidebar-foreground` | `#3a352f` | `#d7d3cd` | ink |
| `--sidebar-primary` | `#965c33` | `#c27c4b` | terracotta-ink |
| `--sidebar-primary-foreground` | `#ffffff` | `#1b1916` | white / page |
| `--sidebar-accent` | `#f2ebe1` | `#2b2721` | paper |
| `--sidebar-accent-foreground` | `#3a352f` | `#d7d3cd` | ink |
| `--sidebar-border` | `#d3cbc2` | `#4a4136` | hairline |
| `--sidebar-ring` | `#965c33` | `#c27c4b` | terracotta-ink |
| `--radius` | `0.5rem` | unchanged | radius-card |

The reference's own ten tokens are **also** exposed as `@theme` entries
(`--color-page` and friends), so future work can name them directly. But the
mapping above is what makes the existing 42 screens change appearance.

## 7. Testing

The risk this change carries is silent regression: a token dropped, a mode left
on stock values, or a CDN link creeping back. Three guards:

1. **A palette test** asserting `app.css` defines every one of the 33 variables in
   both `:root` and `.dark`, and that no stock starter value (`hsl(0, 0%, 3.9%)`,
   `hsl(0, 0%, 100%)`, `hsl(0, 0%, 9%)`) survives in either block. This fails
   loudly if a mode is half-ported.
2. **A no-CDN test** asserting no Blade under `resources/views` — `app.blade.php`
   **and both error Blades**, which today carry the `fonts.bunny.net` link and
   hardcoded greys while rendering Vietnamese copy — references
   `fonts.bunny.net`, `fonts.googleapis.com`, or `fonts.gstatic.com`. Scoping the
   scan to the whole directory is what forces the error pages into the port
   rather than leaving them visibly stock.
3. **A contrast test** computing WCAG ratios for every foreground/ground pair in
   the mapping table and asserting ≥ 4.5, in both modes. This is the guard that
   would have caught the `#b37040` fill failure described in D3.

Per project practice, **each test must be watched failing before it is accepted**
— mutate the value it protects, see red, restore, confirm `git status
--porcelain` is clean.

## 8. Risks

- **The dark palette is invented.** No reference exists to check it against, and
  D3's method is a heuristic. Expect a hand-tuning pass once it is on screen.
- **The mapping is uniform, the screens are not.** Re-pointing `--accent` moves
  22 call sites at once; a few may land oddly. That is what D5's follow-up is for.
- **Font files add to the bundle.** Four woff2 faces with the vietnamese subset;
  the cost is accepted for correct diacritics and no third-party dependency.
- **Status colour stays deferred** (D4), leaving `AGENTS.md` rule 2 partly unmet
  and recorded in `docs/known-gaps.md`.
