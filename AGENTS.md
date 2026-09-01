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
   book. No shared title component exists yet — apply `font-serif` directly,
   and only, on the element that renders a book's title (see `components/book-card.tsx`
   for the current, non-serif example to correct). Nothing else reaches for
   `font-serif`.
2. **Status is never colour alone.** Every state carries an icon, a Vietnamese
   word and a colour together. Compose this from `ui/badge.tsx` (the colour
   and label) plus `ui/icon.tsx` (the icon) — there is no dedicated status
   component. The six copy states are defined once in
   `old_next/src/lib/status.ts` (reference).
3. **One primary action per screen.** Solid terracotta appears once. If two
   things on a screen are terracotta, one of them is wrong.
4. **Touch targets ≥ 44px; primary buttons 56px.** Nothing closer than 8px.
5. **Tables become stacked cards below 768px.** Never a horizontally
   scrolling table.
6. **Forms are single-column, always.** Labels above inputs. Required fields
   marked with the word *Bắt buộc*, never a bare asterisk. Compose this from
   `ui/label.tsx` above `ui/input.tsx` / `ui/select.tsx`, with
   `components/input-error.tsx` for validation messages — there is no single
   labelled-field wrapper component.
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

The table below describes what exists in `resources/js/components` today —
not an aspiration. When you add a component, update this table; a test
(`tests/Feature/Architecture/StyleGuideTest.php`) fails the build if this
table ever names one that isn't there.

| Need | Use |
|---|---|
| One of the six copy states (Còn sách, Đang mượn, Đang giữ chỗ, Quá hạn, Đã mất, Ngừng dùng) | No component yet; compose from `ui/badge.tsx` and `ui/icon.tsx`, using the Vietnamese word and colour from `old_next/src/lib/status.ts` |
| Any other state pill — membership, role, post status, days remaining, condition | `ui/badge.tsx` (icon and label are both required) |
| The quick-lend step marker | No component yet; compose from `ui/badge.tsx` per step and state the requirement inline |
| A settings switch | `ui/toggle.tsx` |
| A labelled form control | `ui/label.tsx` + `ui/input.tsx` / `ui/select.tsx`, with `components/input-error.tsx` for the validation message |
| A multi-line text field | No textarea component yet; there is no native `<textarea>` wrapper either — style a plain `<textarea>` like `ui/input.tsx` until one is added |
| A read-only value | No component yet; render the label (per rule 6) above plain text |
| A book's title | No component yet; apply `font-serif` directly per rule 1 — the only thing allowed to be serif |
| A cover | No component yet; `components/book-card.tsx` inlines its own cover treatment — follow that pattern |
| A phone number | No component yet; render as plain text — there is no linkified phone treatment |
| Buttons | `ui/button.tsx`. For a link styled as a button or plain text link, Inertia's own Link component (from `@inertiajs/react`), as used in `components/text-link.tsx` and `components/book-card.tsx` — there is no separate button-styled-link component |
| A selection checkbox in a list | `ui/checkbox.tsx` — never `ui/toggle.tsx`, which commits on change |
| Reading a QR label with the camera | `components/copy-scanner.tsx` (`CopyScanner`) — camera capture, decode and server resolution are already built there for the lend/return screens |

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

## Before you claim a change is done, run every gate CI runs

CI (`.github/workflows`, "Laravel CI") runs **six** checks. Running four of them
locally and pushing is how this repo gets red PRs:

```bash
docker exec laravel-app-1 vendor/bin/pint --test          # 1. format
docker exec laravel-app-1 vendor/bin/phpstan analyse --no-progress  # 2. Larastan level 8
npm run laravel:lint                                      # 3. Biome  <- easy to forget
npm run laravel:typecheck                                 # 4. TypeScript
npm run laravel:build                                     # 5. Vite
docker exec laravel-app-1 php artisan test                # 6. Pest
```

**Never run `pint` or `php` on the host** — the host PHP is 7.4 and aborts with a
dyld error before running anything, so a host-side "pint failed" is a toolchain
artefact, not a code failure. Run them inside `laravel-app-1`.

**`npm run build` is not the app's build.** The repo root's `build` script maps
to `cd old_next && next build`, which builds the read-only Next.js reference.
The Laravel build is `npm run laravel:build`.

### Pest's `toContain` takes no message argument

`expect($x)->not->toContain($needle, "my message")` **passes unconditionally**.
`toContain` is variadic over needles, so the message becomes a second needle and
the negation is satisfied by that string being absent — which it always is.

This has now shipped a green test over a real defect **twice**, in two different
phases. Both times it was a source-read guard, and both times the thing it
protected was genuinely broken while it stayed green.

```php
// wrong — always passes
expect($source)->not->toContain($needle, "message");
// right
expect(str_contains($source, $needle))->toBeFalse("message");
```

The same shape catches source-read guards generally: a needle that also appears
somewhere unrelated in the file makes the test green forever. Pick a needle that
exists only where the thing you are testing lives, and **prove it by mutation** —
delete the thing, watch red, restore.

### "Pre-existing" means pre-existing on `main`

Phase 3b-i shipped a PHPStan error to CI twice because two separate agents
reported it as pre-existing and out of scope. Both had compared against an
earlier commit **on their own branch**, where the offending file already
existed — but the file did not exist on `main` at all. Their own branch had
introduced it.

Before dismissing a failure as pre-existing, check it against the merge base,
not against a commit you made:

```bash
git stash && git checkout $(git merge-base HEAD origin/main) -- . && <gate>
```

## Current scope

**Laravel (`app/`): Phase 0 is done** — schema, enums, identity/session, tenancy
and authorization are wired against MariaDB (see
`docs/superpowers/plans/2026-08-26-laravel-migration-phase-0-foundation.md`).
Phase 1 onward builds out the ~54 screens' worth of Actions, Policies and
Controllers, using `old_next/` as the behavioural spec to diff against.

**`old_next/` is frozen** at whatever it reached before the migration started:
a full UI over a real PostgreSQL database with real authentication. It is not
being extended — see "Two applications in this repo" above.
