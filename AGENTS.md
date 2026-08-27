# AGENTS.md

Conventions for anyone — human or agent — working in this repository.

**Read [docs/known-gaps.md](docs/known-gaps.md) before starting work.** It records
what is deliberately unfinished, what was never verified and why, and the traps
that have already cost time in this repo — the `phpunit.xml` `<server>`/`DB_URL`
rules that protect the development database, the MariaDB DDL refusals, and the
tests that passed while guarding nothing. Keep it current: when you defer
something or leave something unverified, add it there rather than only in a
commit message.

## Two applications in this repo

**`app/` is Laravel 13 + Inertia + MariaDB — the live implementation.** This is
where Phase 1 onward's screens, business logic and fixes go. It follows
ordinary Laravel convention: `php artisan make:model` writes to `app/`,
`composer.json`'s `App\` namespace maps there, and every Laravel doc assumes it.

**`old_next/` is the original Next.js 16 + PostgreSQL implementation — reference
only.** It is the spec Phases 1–3 diff their new work against (54 route pages,
116 domain files, ~180 test files encoding the business rules), and it is also
preserved untouched at the `v0.1.0` git tag. It still installs, typechecks,
lints, builds and passes its full test suite from inside `old_next/` — see
`old_next/AGENTS.md` for how — but **it is not maintained going forward.** Do
not add features or fix bugs there; note anything wrong in `docs/known-gaps.md`
instead.

Both apps share a few things at the repo root rather than duplicating them:
`package.json`/`bun.lock`/`node_modules` (one JS toolchain — Laravel's own
`resources/js` frontend depends on the same React/TypeScript/Tailwind
versions), `.env`/`.env.example` (one file documents both stacks' variables),
`.gitignore`, `.editorconfig`, `docs/`, and `public/index.php`+`.htaccess`
(Laravel's front controller — `old_next/public/` holds Next's own static
assets, e.g. book cover art). Everything else — source, config, tests,
deployment — belongs to exactly one of the two and lives under it.

This split exists because Laravel's `app/` directory used to collide head-on
with the one directory Next.js's router checks first, also named `app/` — see
`docs/known-gaps.md` for the incident. Moving Next.js out from under the
shared root, rather than renaming Laravel's directory a second time, is the
actual fix.

## Non-negotiable design rules

These come from `docs/BUSINESS-REQUIREMENTS.md` §17 and `docs/DESIGN.md`, and
apply to whichever surface is currently building the UI — `old_next/` as
reference, `resources/js` (Laravel/Inertia) as Phase 1 onward rebuilds each
screen. They are not stylistic preferences — breaking one is a defect.

1. **Sans everywhere; serif only for book titles.** Lexend is the interface
   font for absolutely everything. Literata appears solely on the title of a
   book, and only via the `BookTitle` component. Nothing else reaches for
   `font-serif`.
2. **Status is never colour alone.** Every state carries an icon, a Vietnamese
   word and a colour together. Use `StatusBadge` / `StatusPanel`; the six
   states are defined once in `old_next/src/lib/status.ts` (reference).
3. **One primary action per screen.** Solid terracotta appears once. If two
   things on a screen are terracotta, one of them is wrong.
4. **Touch targets ≥ 44px; primary buttons 56px.** Nothing closer than 8px.
5. **Tables become stacked cards below 768px.** Never a horizontally
   scrolling table.
6. **Forms are single-column, always.** Labels above inputs. Required fields
   marked with the word *Bắt buộc*, never a bare asterisk. Use `Field`.
7. **No shadows, no gradients, no glassmorphism.** Depth comes from 1px
   hairline borders and flat tonal layers.
8. Charts are bar and line only — no pie charts — and every chart carries a
   plain-text summary above it.

## Shared components — check here before writing your own

Pages were once built in parallel by separate agents told not to touch shared
files, and every one of them grew its own status pill. Six near-identical
copies later, the lesson is written down: **look in `old_next/src/components/ui`
(reference) first, and if the Laravel/Inertia equivalent under
`resources/js/components` is missing, add it there rather than inline.**

| Need | Use |
|---|---|
| One of the six copy states (Còn sách, Đang mượn, Đang giữ chỗ, Quá hạn, Đã mất, Ngừng dùng) | `StatusBadge` / `StatusPanel` |
| Any other state pill — membership, role, post status, days remaining, condition | `Pill` (icon and label are both required) |
| The quick-lend step marker | `StepIndicator` |
| A settings switch | `Toggle` from `field.tsx` |
| A labelled form control | `Field` + `Input` / `Textarea` / `Select` |
| A read-only value | `ReadOnlyValue` |
| A book's title | `BookTitle` — the only thing allowed to be serif |
| A cover | `BookCover` |
| A phone number | `PhoneLink` — never plain text |
| Buttons | `Button` / `ButtonLink` / `BigActionLink` |
| A selection checkbox in a list | `Checkbox` from `field.tsx` — never `Toggle`, which commits on change |
| Reading a QR label with the camera | `QrScanner`, or `CopyScanField` where a screen already asks "which book?" |

## Language

Vietnamese is the shipped language and the only one written into the UI.

- All user-facing copy is Vietnamese with full diacritics. Never English in
  the interface, never lorem ipsum.
- Plain words, no jargon: **Cho mượn**, never *Giao dịch lưu thông*.
  **Nhận trả**, never *Tiếp nhận hoàn trả*.
- URLs are Vietnamese too: `/tu-sach/dong-thap/danh-muc`, not `/shelves/.../catalogue`.
- Dates read as dates — *Chúa nhật 20/08 · 14 ngày* — never as timestamps.
  A loan is due at the end of a day, not at 14:23 on that day.
- No user-facing string is hard-coded in a way that blocks a later locale.

## Sample content

Use the same fixtures everywhere so screens line up with the design work:

- Shelf: **Tủ sách Đồng Tháp**, nhà xứ Đồng Tháp, mở sau lễ Chúa nhật.
- Readers: Maria Nguyễn Thị Lan, Giuse Trần Minh, Têrêsa Lê Ngọc Ánh,
  Anna Phạm Thu Hà, Phêrô Nguyễn Văn Bình.
- Books: Dế Mèn Phiêu Lưu Ký (Tô Hoài), Hoàng Tử Bé, Totto-chan Bên Cửa Sổ,
  Đất Rừng Phương Nam.
- Copy codes look like `DT-0142`.

## Laravel/Pest: top-level test helpers are process-global

Pest loads every test file in `tests/` into a **single PHP process**. A
top-level `function foo() {...}` declared in one test file is therefore not
scoped to that file — it is a global symbol for the whole run, and a second
file declaring a function with the same name is a **fatal redeclaration
error**, not a shadowing warning, potentially taking down the entire suite
rather than just the offending file. Before adding a new top-level helper,
`grep -rn "^function <name>" tests/` first. Helpers that already exist
include `makeCatalogueShelf()` (`tests/Feature/Schema/CatalogueSchemaTest.php`),
`tenancyShelf()` (`tests/Feature/Tenancy/TenantContextTest.php`),
`authUser()`/`authzUser()` (`tests/Feature/Auth/AuthenticationTest.php`,
`tests/Feature/Authz/GateTest.php`) and `twoShelves()`
(`tests/Feature/Schema/CompositeTenantFkTest.php`) — not an exhaustive list,
just enough to make the pattern recognisable. When a helper's shape only
makes sense in one file, prefer a closure or a private method on a
`Tests\Support\` class over a bare top-level function.

## Current scope

**Laravel (`app/`): Phase 0 is done** — schema, enums, identity/session, tenancy
and authorization are wired against MariaDB (see
`docs/superpowers/plans/2026-08-26-laravel-migration-phase-0-foundation.md`).
Phase 1 onward builds out the ~54 screens' worth of Actions, Policies and
Controllers, using `old_next/` as the behavioural spec to diff against.

**`old_next/` is frozen** at whatever it reached before the migration started:
a full UI over a real PostgreSQL database with real authentication. It is not
being extended — see "Two applications in this repo" above.
