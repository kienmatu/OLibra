# OLibra — Design System

The visual language for OLibra. Derived from §17 of [BUSINESS-REQUIREMENTS.md](BUSINESS-REQUIREMENTS.md); that document is the authority, this one is the working brief for design tools and implementers.

Every value here is a token. Design tools and code consume the same names, so a screen and its implementation cannot drift. The source of truth for colour, type and radius tokens is `src/app/globals.css` (Tailwind v4's `@theme` block) — see §10.

## Who this is for

Children who may have been reading fluently for only a few years, and adult volunteers who may not use smartphones confidently. Both are served by the same things: large targets, plain words, high contrast, obvious next actions.

It should feel like a warm community bookshelf in a church hall — not enterprise software, and not a children's game either. Calm, generous, legible.

## Non-negotiables

1. **One primary action per screen**, visually dominant. Solid terracotta appears once; if two things on a screen are terracotta, one of them is wrong.
2. **Status is never carried by colour alone.** Every state carries an icon, a Vietnamese word, and a colour.
3. **Plain Vietnamese, no jargon.** All copy is Vietnamese.
4. **Mobile at 375px is the primary manager experience**, not a fallback.
5. **Every interactive element has a visible focus state.** `outline: none` without a replacement ring is a defect.
6. **No shadows, no gradients, no glassmorphism.** Depth comes from 1px hairline borders and flat tonal layers.

---

## 1. Colour

A softened warm palette — nothing saturated, nothing heavy. Every token below is defined once, in `src/app/globals.css`.

### 1.1 Core tokens

| Role | Value | CSS variable | Tailwind utility |
|---|---|---|---|
| Page background | `#FBF9F6` | `--color-page` | `bg-page` |
| Surface / card | `#FFFDFB` | `--color-surface` | `bg-surface` |
| Warm paper (secondary surface) | `#F2EBE1` | `--color-paper` | `bg-paper` |
| Hairline border | `#EDE5DA` | `--color-hairline` | `border-hairline` (or the bundled `hairline` utility — 1px width + this colour in one class) |
| Body text (ink) | `#3A352F` | `--color-ink` | `text-ink` |
| Meta text | `#8A8077` | `--color-meta` | `text-meta` |
| Aged leather | `#9A8874` | `--color-leather` | `text-leather` |
| Primary terracotta | `#BE7B4A` | `--color-terracotta` | `bg-terracotta` / `text-terracotta` / `border-terracotta` |
| Terracotta pressed / ink | `#A9683A` | `--color-terracotta-ink` | `bg-terracotta-ink` / `text-terracotta-ink` |
| Sage accent | `#5A9184` | `--color-sage` | `text-sage` / `bg-sage` / `border-sage` |
| Destructive (soft brick) | `#C0645C` | `--color-brick` | `bg-brick` / `text-brick` / `border-brick` |

Notes on use:

- **Terracotta** is the one primary action per screen — the solid button, the active nav item, the focus ring. **Terracotta-ink** is its hover/pressed state and the colour a terracotta-adjacent link or active label sits in at rest (e.g. the manager sidebar's current item).
- **Paper** is the quiet secondary surface: sidebars, selected chips, the *Bắt buộc* pill, read-only field backgrounds. **Surface** is the default card/input background, a shade lighter than paper.
- **Leather** is a warm neutral used sparingly for small emphasis — avatar initials, sidebar count chips — never for body text.
- **Sage** doubles as the accent for links and confirmation-toned surfaces (e.g. a submitted-feedback panel).
- **Brick** is the only destructive/error colour. There is no separate "destructive surface vs destructive text" pair — the same token does both.

Dark mode is not implemented. It is a future intention only, and will follow the system preference when it lands.

### 1.2 Status

Always icon + word + colour together, rendered as a 10% tint fill with the status ink for both icon and text — never a solid colour with white text, which is louder than this product should be.

| State | Icon | Vietnamese | Ink | Ink utility | Fill utility |
|---|---|---|---|---|---|
| Available | `book-open` | Còn sách | `#4A7C59` | `text-available` | `bg-available/10` |
| On loan | `book-marked` | Đang mượn | `#A9743A` | `text-onloan` | `bg-onloan/10` |
| Held | `bookmark` | Đang giữ chỗ | `#5A7FA6` | `text-held` | `bg-held/10` |
| Overdue | `alert-triangle` | Quá hạn | `#BE5F55` | `text-overdue` | `bg-overdue/10` |
| Lost | `help-circle` | Đã mất | `#94514A` | `text-lost` | `bg-lost/10` |
| Retired | `archive` | Ngừng dùng | `#8A8077` | `text-retired` | `bg-retired/10` |

**Icon and word are mandatory** — a coloured dot is not a status. The six states are defined once, in `src/lib/status.ts`, as a typed record that bundles icon, label and colour together so a component cannot render one without the others.

### 1.3 Contrast

Ink on the page and on the surface both clear AAA (roughly 11.5:1 and 12:1). Meta text, sage, terracotta-ink and brick sit lower — around 3.2–4.2:1 against the page — and that is by design: none of them is ever the sole carrier of meaning (non-negotiable #2). The 10% status tints exist to separate a badge from its surroundings, not to deliver text-level contrast on their own; the icon and the Vietnamese word are what actually communicate the state.

White text on solid terracotta sits close to 3.4:1; white on the pressed state, terracotta-ink, reaches about 4.4:1. Treat button text as a decorative-strength pairing, not a body-text one — never set long-form copy in terracotta-on-white or white-on-terracotta.

### 1.4 Chart palette

Bar and line only. Ordered series, most distinct first:

`#BE7B4A` (terracotta) · `#5A9184` (sage) · `#A9683A` (terracotta-ink) · `#9A8874` (leather) · `#8A8077` (meta)

Never encode a category by colour alone — label the series directly on the chart.

---

## 2. Typography

**Lexend** is the interface font for absolutely everything — headings, body, labels, buttons, navigation, numbers, badges. Self-hosted through `next/font/google` (`--font-lexend`, consumed as `--font-sans`), with the `latin`, `latin-ext` and `vietnamese` subsets all loaded — a missing subset means every `ơ`, `ư` and `đ` falls back to a different face mid-word.

**Literata** (serif) is reserved for exactly one thing: the title of a book. Nothing else is ever serif. It ships at weight 600 only and renders solely through the `BookTitle` component (`src/components/ui/book.tsx`) and its `font-serif` class — no other component reaches for it. (The letter shown on a missing-cover placeholder is set in Literata too, since it stands in for the title itself.)

Base body size **16px**, line-height **1.6**, letter-spacing **~0.01em** — set once on `body` in `globals.css`.

### Scale

| Use | Size |
|---|---|
| Hero | 34px |
| Page title | 28px |
| Large heading | 24px |
| Section heading | 20px |
| Body | 16px |
| Meta | 14px |
| Small | 13px |

Nothing below 12px.

### Rules

- **Never all-caps.** Vietnamese diacritics stack above and below; capitals destroy the word shape and clip the marks.
- Heading line-height is 1.3 (`h1`–`h4` in `globals.css`), with `text-wrap: balance` so a heading never breaks one lonely word onto its own line — headroom that stacked `dấu ngã` and `dấu hỏi` need.
- Body line-height 1.6.
- `html lang="vi"` is set at the root, so screen readers pronounce diacritics correctly.

---

## 3. Shape, spacing, elevation

### 3.1 Radius

Two tokens only — nothing else.

| Token | Value | Tailwind utility | Use |
|---|---|---|---|
| `--radius-control` | 4px | `rounded-control` | Buttons, inputs, badges, book covers, chips |
| `--radius-card` | 8px | `rounded-card` | Cards, panels, modals, large surfaces |

Circular elements (avatar initials, the active-nav indicator dot) use the plain Tailwind `rounded-full` utility — that is not a design token, just a shape.

### 3.2 Spacing

Restricted 4px scale. Nothing off it.

`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`

- Card padding: **16px** mobile, **24px** desktop
- Section gap: 32px mobile, 48px desktop
- Interactive elements never closer than **8px**
- Touch targets minimum **44×44**
- Primary buttons **56px** tall

### 3.3 Elevation

No shadows, anywhere. Depth comes entirely from a 1px hairline border and flat tonal layers — `page` under `paper` under `surface`. A tappable card signals interactivity with a colour shift (a deeper border, or a move from `surface` to `paper`), never with a drop shadow.

---

## 4. Layout

### 4.1 Breakpoints

| Name | Width | Meaning |
|---|---|---|
| **base** | 375 | **Design origin.** Every manager screen starts here. |
| `sm` | 640 | Large phone |
| `md` | 768 | **Tables become cards below this. Hamburger below this. Sidebar appears at this.** |
| `lg` | 1024 | Laptop |
| `xl` | 1280 | Desktop |

Container max width 1200px. Gutters: 16 / 24 / 32.

### 4.2 Catalogue grid

| Width | Columns |
|---|---|
| 375 | 2 |
| 640 | 3 |
| 768 | 4 |
| 1024 | 5 |
| 1280 | 6 |

Gap 12px mobile, 16px tablet, 24px desktop.

### 4.3 Manager chrome

- **Desktop (≥768):** fixed sidebar, full height, `bg-paper` with a `border-hairline` right edge. The active item sits in `text-terracotta-ink` with a 3px `bg-terracotta` indicator on its leading edge; everything else is `text-ink`. Content area gets generous padding.
- **Mobile (<768):** the sidebar collapses; a five-item bottom tab bar is the intended replacement — *Trang chính · Sách · Cho mượn · Người đọc · Thêm*. Five is the ceiling.
- Lend and return are reachable in one tap from anywhere.

---

## 5. Components

Every interactive component specifies six states: **default · hover · pressed · focus-visible · disabled · loading**.

### 5.1 Button

Five variants, three sizes, all `rounded-control`.

| Variant | Look |
|---|---|
| `primary` | `bg-terracotta` + white text, `hover:bg-terracotta-ink` |
| `outline` | 2px `border-terracotta`, `text-terracotta-ink`, `hover:bg-terracotta/8` |
| `quiet` | `border-hairline`, `bg-surface`, `text-ink`, `hover:bg-paper` — the default variant for secondary actions |
| `danger` | `border-brick`, `text-brick`, `hover:bg-brick/8` |
| `ghost` | `text-meta`, `hover:text-ink`, no border |

| Size | Height | Use |
|---|---|---|
| `sm` | 44px | Inline table actions |
| `md` | 48px | Default |
| `lg` | 56px | The one primary action on a manager screen |

The dashboard's two dominant actions — *Cho mượn* and *Nhận trả* — use an even larger paired layout (roughly 96px tall) so they read as unmissable from across a hall.

States shared by all variants:

- **Focus-visible:** a visible ring in terracotta, always present, keyboard and touch alike.
- **Disabled:** reduced opacity, no hover.
- **Loading:** spinner replaces the leading icon, **label stays** (never a bare spinner), button disabled — this is also what prevents a double-submit that would create a duplicate loan.

Icons in buttons never appear without a text label.

### 5.2 Input

Height 48px, `rounded-control`, `border-hairline`, `bg-surface`, 16px text.

| State | Spec |
|---|---|
| Default | `bg-surface`, 1px `border-hairline` |
| Focus | `border-terracotta` + visible outline ring, no offset |
| Invalid | `border-brick` |
| Error message | `text-brick`, 14px, with an `alert-circle` icon beneath the field |
| Disabled | reduced opacity |
| Read-only | `bg-paper`, no border, no focus ring, text at 80% opacity |

### 5.3 Form

- **Single column, always.** Labels above inputs, never beside.
- Required fields marked with the word **Bắt buộc** — a small `bg-paper` / `text-leather` pill — never a bare asterisk.
- Helper text sits between label and input when it explains *why* the field is needed.
- Errors appear beneath the field, in `text-brick`. The first error receives focus on submit.

### 5.4 Card

`bg-surface` (or `bg-paper` for a quieter tone), 1px `border-hairline`, `rounded-card`, generous padding, no shadow ever.

### 5.5 Book card

Cover-dominant. Cover at 2:3, `rounded-control`, `border-hairline`, `object-fit: cover`. Title in `BookTitle` (Literata, semibold), clamped to two lines at 16px; author clamped to one line at 13px in `text-meta`. The availability badge sits pinned to the cover's bottom-left corner with an 8px inset, on a translucent `bg-surface`.

**Missing cover:** a small fixed set of sun-faded kraft tones (`#E4D7C3` · `#DFD3C8` · `#E6D9CC` · `#DCD2BE` · `#E2D5CB` · `#D9CFC0`), chosen deterministically from the book's title, filling the 2:3 frame with the title's first letter centred in Literata at low-opacity ink. The same book always gets the same placeholder, so the grid never looks broken.

### 5.6 Status badge

`rounded-control`, 10% tint fill, status ink for icon and word, no border. Icon 18px, label 14px. **Icon and word are mandatory** — there is no prop that lets a caller drop either.

A larger **status panel** variant (used on a book's own page) adds a 1px border in the status ink around the same tint, a 24px icon and a 20px semibold heading.

### 5.7 Table

Desktop: `bg-surface`, 1px `border-hairline`, header row in `bg-paper` with label-weight text, rows divided by hairlines.

**Below 768px a table becomes stacked cards.** Never a horizontally scrolling table. Each card leads with the identifying field and shows two or three others as label/value pairs. Sorting is a `select` on mobile, clickable column headers on desktop.

### 5.8 Condition picker

A row of large icon buttons, never a dropdown — it is used constantly and speed matters.

- Six options: **Nguyên vẹn · Hơi cũ · Cũ · Rách · Mất trang · Bị vẽ vào**
- Layout: 3×2 grid at 375px, tiles minimum **72×72**; single row of six at ≥768
- Tile: icon above a 13px label, `rounded-control`, 1px `border-hairline`
- **Selected:** `bg-paper` fill **plus a `check` mark** in the corner — not colour alone
- *Nguyên vẹn* is preselected. The note and photo fields appear only when a worse grade is chosen.

### 5.9 Stat card

Manager dashboard. Full-width tappable card. Count leading at large-heading size, label beneath it, `chevron-right` at the trailing edge. A non-zero count that needs attention gets the matching status ink on the number and a tinted left border 4px wide.

### 5.10 Chart

Bar and line only. **No pie charts.** Every chart carries a plain-text summary above it, so the information is available without interpreting the graphic. Gridlines in `border-hairline`, series labelled directly rather than in a legend where it fits.

### 5.11 Bottom tab bar

`bg-surface`, 1px `border-hairline` top. Five items, each a 24px icon above a 12px label. Active item: terracotta icon and label, plus a 3px terracotta indicator along the top edge. Badge counts sit as a small `bg-brick` dot with a number, top-right of the icon.

### 5.12 Icons

Lucide outline set, stroke width **1.75**. **20px inline, 24px standalone** — the two big dashboard actions step up to 28px. Never without a text label in navigation or actions.

---

## 6. States every screen must define

Not decoration — every screen needs all six.

| State | Requirement |
|---|---|
| **Loading** | Skeleton in `paper` matching the real layout's shape. Never a centred spinner on a full page. |
| **Empty** | A muted icon, one plain sentence, and the action that fills it. The catalogue's empty search suggests popular books rather than showing nothing. |
| **Error (region)** | A component crash degrades one region, never the page. Message + *Thử lại* button inside the region's own bounds. |
| **Error (page)** | 403 · 404 · phiên hết hạn · 429 · 500. Plain Vietnamese explanation, no code jargon, and a route back to safety. |
| **Blocked action** | A business-rule violation (reader at loan limit, membership not active, copy already lent) surfaces as a friendly message naming what to do instead — shown **before** the confirm step, never as an error after it. |
| **In flight** | The triggering button disables and shows a spinner, label intact. |

---

## 7. Motion

Restrained. Volunteers are working, not being entertained.

| Token | Duration | Easing | Use |
|---|---|---|---|
| `--motion-fast` | 150ms | `ease-out` | Hover, focus, colour, badge |
| `--motion-base` | 200ms | `ease-out` | Sheet, modal, dropdown, tab change |
| `--motion-slow` | 300ms | `ease-out` | Page-level transition — rare |

No entrance animation on content. No parallax. No auto-playing carousel; the most-borrowed row is a manual horizontal scroll with visible overflow.

`prefers-reduced-motion: reduce` sets every duration to 0ms and replaces transforms with an opacity change.

---

## 8. Accessibility floor

Non-negotiable, checked per screen:

- Touch targets minimum **44×44**, never closer than 8px
- Visible focus ring on every interactive element
- Status carries icon + word + colour together
- Every chart has a text summary
- Every form label is above its input and programmatically associated
- Skip-to-content link as the first focusable element
- Vietnamese `lang` attribute set, so screen readers pronounce diacritics correctly

---

## 9. Voice

- Plain Vietnamese, sentence case. "Cho mượn", never "Giao dịch lưu thông".
- Buttons are verbs: *Cho mượn*, *Nhận trả*, *Duyệt*, *Từ chối*, *Lưu*.
- Honest labels. A book that is out gets **Đăng ký chờ mượn**, not *Mượn ngay*.
- Errors say what to do next, not what went wrong internally.
- No user-facing string is ever hard-coded (§18 of the requirements). Every string in this system ships through the translation layer.

---

## 10. Tokens in code

Colour, font and radius tokens are implemented in `src/app/globals.css` under Tailwind v4's `@theme` block — there is no `tailwind.config.js`; every token is a CSS custom property, and Tailwind derives the matching utility class automatically. §1.1 and §1.2 above give the full colour mapping. The remaining tokens:

| CSS variable | Tailwind utility | Value |
|---|---|---|
| `--font-sans` | `font-sans` | Lexend (`--font-lexend`) |
| `--font-serif` | `font-serif` | Literata (`--font-literata`), `BookTitle` only |
| `--radius-control` | `rounded-control` | 4px |
| `--radius-card` | `rounded-card` | 8px |

A screen or component should never hard-code a hex value or an inline pixel radius — reach for the token's utility class instead, so a future palette change is a one-file edit.
