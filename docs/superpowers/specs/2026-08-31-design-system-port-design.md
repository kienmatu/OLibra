# The design-system port — design

**Date:** 2026-08-31
**Status:** awaiting approval
**Branch:** `feat/design-system-port`, cut from `main` at `7704d10`

## Context

OLibra is a Vietnamese parish library system being rewritten from a Next.js
application (`old_next/`, kept in-tree read-only as a behavioural reference) onto
Laravel + Inertia + React + MariaDB. Phases 0 through 3a are merged: the
catalogue, members, circulation, oversight, community, statistics, QR labels, and
the network foundation.

Forty-two screens have been built. **None of them uses OLibra's design system.**
`resources/css/app.css` is still the stock Laravel/shadcn starter theme — pure
white, near-black, greys, and `Instrument Sans` served from a third-party CDN.
The reference's own identity — a warm paper palette with terracotta reserved for
the one primary action per screen, Lexend for the interface and Literata for book
titles — was never ported.

This was not a decision anybody recorded. The screens were migrated for
behaviour, phase by phase, and the token layer underneath them was left as the
starter kit shipped it.

## Problem statement

Two of the three problems here are **rendering defects**, not matters of taste.

**Vietnamese text renders in two different typefaces, mid-word, on every screen.**
`resources/views/app.blade.php:10` requests `instrument-sans:400,500,600` from
`fonts.bunny.net` with no subset parameter. Measured in the browser against the
live app, the two loaded faces declare:

```
U+0-FF, U+131, U+152-153, …                      (latin)
U+100-2BA, U+2BD-2C5, …, U+1E00-1E9F, U+1EF2-1EFF (latin-ext)
```

**U+1EA0–U+1EF1 is covered by neither.** That block holds most Vietnamese
precomposed tone-marked vowels — `ế` (U+1EBF), `ồ` (U+1ED3), `ủ` (U+1EE7), `ợ`
(U+1EE3). So in *Tủ sách Đồng Tháp*, the `ủ` and `ồ` come from a system fallback
while every other letter comes from Instrument Sans.

The reference guarded against exactly this, in a comment at
`old_next/src/app/layout.tsx:5`: *"Self-hosted at build time by next/font — never
fetched from a third-party CDN. The vietnamese subset is required: diacritics are
not optional here."*

**Eleven screens already ask for a serif book title and do not get one.**
`font-serif` is applied — correctly, only to book titles — in **eleven files**,
enumerated rather than summarised because an earlier draft of this paragraph
listed nine while claiming eleven, having been written from truncated grep output:

```
manage/borrow-requests.tsx      manage/returns/index.tsx
manage/comments.tsx             manage/returns/lost.tsx
manage/lend/confirm.tsx         shelves/profile/history.tsx
manage/lend/index.tsx           shelves/profile/overview.tsx
manage/lend/new-reader.tsx
manage/lend/reader.tsx
manage/overdue.tsx
```

AGENTS.md rule 1 is honoured in the markup. But
`resources/css/app.css` defines only `--font-sans`; there is **no `--font-serif`**,
so those titles fall back to the browser's Times or Georgia rather than Literata.

**And the visual identity is absent.** No terracotta token exists anywhere in
`app/` or `resources/` — the single match in the codebase is a comment quoting the
rule it cannot follow. AGENTS.md rule 3 says *"Solid terracotta appears once"*;
there is nothing for a screen to be solid terracotta *with*.

## Why now

**42 screens exist; 14 placeholder routes remain**, nearly all of them in Phases
3b and 3c, which are the most screen-heavy slices left. Porting the tokens before
3b means those fourteen are built correct the first time. Porting after means
restyling fifty-six.

Ruled by the product owner on 2026-08-31: **before 3b.**

## Decisions taken

### D1. Fonts are self-hosted and bundled, with the Vietnamese subset

Lexend for the interface, Literata 600 for book titles, both served from this
origin via Vite rather than from `fonts.bunny.net`.

**Subsets: `latin`, `latin-ext`, and `vietnamese`.** The third is the whole point
— it is the block the current setup omits, and its absence is the rendering bug
above.

Two reasons for self-hosting rather than fixing the CDN URL:

1. **It is the reference's own recorded decision**, stated in the comment quoted
   above, and it was made for this application's users.
2. **It matches the ruling this project already made** in Phase 2c, when the QR
   scanner was found fetching its WebAssembly module from `fastly.jsdelivr.net` at
   scan time. That was fixed to serve from this origin, on an unverified shared
   cPanel host, for a product whose dominant interaction is a volunteer holding a
   phone in a parish hall (BR §1.3). Text rendering deserves the same treatment;
   the failure is gentler — a fallback face rather than a broken feature — but the
   dependency is the same shape.

`resources/fonts/` already holds `Lexend-Regular.ttf` and `Lexend-SemiBold.ttf`,
added in Phase 2c for the PDF label sheet. **Those are for TCPDF, not the
browser** — the web build needs `woff2`, and this port adds them separately
rather than reusing the print assets.

### D2. The light palette is ported verbatim

From `old_next/src/app/globals.css`:

```
--color-page:      #fdfbf8     --color-terracotta:     #a4673b
--color-surface:   #ffffff     --color-terracotta-ink: #965c33
--color-paper:     #f2ebe1     --color-sage:           #477369
--color-hairline:  #d3cbc2     --color-brick:          #af4c44
--color-ink:       #3a352f
--color-meta:      #716962
--color-leather:   #776857
```

**Copied, not re-derived.** The hairline in particular carries a fix the reference
already made once, recorded in its own comment: `#ede5da` *"sat at 1.05:1 on warm
paper — the dividers between rows were effectively invisible. In a design with no
shadows the borders are the structure, so they have to be seen."* Re-deriving that
value would risk re-making the mistake.

### D3. The dark palette is derived by preserving the reference's contrast ratios

**The reference has no dark mode.** Grepped: zero matches for
`prefers-color-scheme`, `.dark` or `dark:` in `old_next/src/app/globals.css`. The
Laravel starter shipped a complete dark palette which all 42 screens inherit, and
the product owner ruled on 2026-08-31 to **keep dark mode** rather than drop it.

So a dark palette must be created. It is **derived, not invented.** Measuring the
reference's light palette against its own page colour shows a deliberately tuned
system:

| token | on `#fdfbf8` |
|---|---|
| ink | 11.75:1 |
| meta | 5.21:1 |
| terracotta | 4.44:1 |
| hairline | 1.55:1 |
| all six status inks | 5.16 – 5.75:1 |

Six independent status colours landing within 0.6 of each other is a decision,
not a coincidence. **The derivation therefore holds hue and saturation constant
and moves only lightness, until each token hits its own reference ratio against a
warm dark ground of `#1b1916`:**

| token | light | dark | achieved | target |
|---|---|---|---|---|
| ink | `#3a352f` | `#d7d3cd` | 11.77:1 | 11.75 |
| meta | `#716962` | `#938b83` | 5.23:1 | 5.21 |
| terracotta | `#a4673b` | `#b37040` | 4.43:1 | 4.44 |
| sage | `#477369` | `#558a7e` | 4.45:1 | 4.44 |
| brick | `#af4c44` | `#c1665e` | 4.45:1 | 4.44 |
| hairline | `#d3cbc2` | `#42392f` | 1.55:1 | 1.55 |

Every value within 0.03 of its target. **The hairline target is 1.55:1 and not a
WCAG threshold on purpose** — it is the value the reference arrived at by fixing a
real invisibility problem, and the same reasoning applies on a dark ground where
borders are still the only structure.

`page`, `surface` and `paper` invert the lightness ordering while keeping the warm
hue: `#1b1916`, `#24211d`, `#2b2721`.

### D4. The six status inks are deliberately NOT ported

The reference defines six: `available #457453`, `onloan #8e6231`, `held #4d6d8f`,
`overdue #ad4c42`, `lost #94514a`, `retired #716962`.

**They have almost no consumers here.** The six copy-state labels (*Còn sách, Đang
mượn, Đang giữ chỗ, Quá hạn, Đã mất, Ngừng dùng*) appear in exactly **two files**:
`resources/js/lib/copy.ts`, which defines the strings, and
`resources/js/pages/manage/books/lost.tsx`.

Six tokens with one consuming screen is how dead tokens accumulate — the same
YAGNI failure this port is fixing at the font layer, where `--font-serif` was
*absent* while eleven screens asked for it. Adding the inverse is no better.

They belong with whatever screen genuinely needs them. **AGENTS.md rule 2 is
unaffected**: status is still never colour alone, and the shadcn badge variants
pick up the new palette automatically.

### D5. Per-screen refinement is out of scope

Changing the tokens shifts all 42 screens at once. Judging each one — terracotta
placement under rule 3, the 44px/56px touch targets under rule 4, whether a
particular badge should now use a status ink — is separate work and a separate
review surface. **This slice changes the token layer and the two font families,
and nothing else.**

One exception, because it is the same change: `AGENTS.md` rule 1 names
`components/book-card.tsx` as *"the current, non-serif example to correct"*. A
book title that stays sans while eleven other screens go serif is an inconsistency
this port creates, so correcting that one file belongs here.

## Testing

**Most of this cannot be tested in this repository**, and the spec says so rather
than implying otherwise. There is no frontend rendering test runner — the only
`vitest` scripts point at `old_next/`, and `assertInertia` sees server-side props
only. Nothing automated can see a colour.

What **can** be pinned, and should be:

- **No `fonts.bunny.net` reference survives** anywhere in `resources/views/` — a
  grep-shaped test, and the one that stops the CDN dependency creeping back.
- **`--font-sans` resolves to Lexend and `--font-serif` to Literata** in the built
  CSS, so the eleven serif screens get the family they have been asking for.
- **The `vietnamese` subset is present in the built font CSS** — the assertion that
  corresponds to the actual bug. A build that ships `latin` only would otherwise
  look identical to a correct one.
- **Every token the reference defines has a counterpart**, light and dark, so a
  half-ported palette fails rather than degrades.

The palette itself is verified the way it was derived — **by measuring contrast
ratios**, with the derivation script's output recorded — and by before-and-after
screenshots of a representative light and dark screen.

## Explicitly not in scope

- The six status inks (D4).
- Per-screen refinement: terracotta placement, touch targets, spacing (D5).
- Any change to a screen's structure, copy or behaviour.
- Phase 3b's features. This slice ships before 3b so that 3b's fourteen screens
  are built against the real tokens.

## Risks

1. **Every screen changes at once, and almost nothing can catch a regression.**
   That is inherent to a token port and it is why D5 keeps the change to the token
   layer: a diff that touches only `app.css`, `app.blade.php` and the font assets
   is one a reviewer can actually read, and screenshots can carry the rest.
2. **The dark palette has never been seen by anyone.** It is derived and
   measured, but derivation is not judgement — it should be looked at on a real
   screen before merge, and the product owner may want values moved.
3. **Bundle size.** Three subsets across two families adds woff2 to the build.
   Worth measuring rather than assuming: the parish connection is the constraint
   this product designs around, and a font payload that hurts first paint would
   trade one rendering problem for another.
