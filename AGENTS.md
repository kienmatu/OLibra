# AGENTS.md

Conventions for anyone — human or agent — working in this repository.

**Read [docs/known-gaps.md](docs/known-gaps.md) before starting work.** It records
what is deliberately unfinished, what was never verified and why, and the traps
that have already cost time in this repo — the `phpunit.xml` `<server>`/`DB_URL`
rules that protect the development database, the MariaDB DDL refusals, and the
tests that passed while guarding nothing. Keep it current: when you defer
something or leave something unverified, add it there rather than only in a
commit message.

## Toolchain: Bun locally

**Use Bun for everything local. Do not use npm, pnpm or yarn.**

```bash
bun install          # never `npm install` / `pnpm install`
bun add <pkg>        # never `npm add`
bun remove <pkg>
bun run dev          # http://localhost:3000
bun run build
bun run typecheck
bun run test         # needs the test database — see "Testing" below
bun run check        # typecheck + lint + format:check + test, in that order
```

`bun.lock` is the committed lockfile. There is no `package-lock.json`,
`pnpm-lock.yaml` or `yarn.lock`, and none should be added — if one appears,
delete it and re-run `bun install`.

Two things worth being precise about, because they are easy to get wrong:

- **Bun is the package manager and script runner locally, and the runtime in
  production.** `bun run dev` invokes the `next` binary, which carries a Node
  shebang, so Next still executes under Node during local development. Pass
  `bun --bun next dev` if you want the Bun runtime locally too.
- **The container runs `bun server.js`; the container *builds* under Node.**
  That split is a workaround, not a preference: `bun run build` segfaults
  partway through `next build` inside a linux/arm64 container — reproduced on
  Bun 1.3.5 and 1.3.14, on both alpine and Debian, so it is neither a libc
  issue nor a stale version. The same command works under Bun on macOS, which
  is why local development never hits it. See the Dockerfile.
- **Nothing in the app may depend on Bun-specific APIs** (`Bun.file`,
  `bun:sqlite` and friends). The runtime is Bun today, but the build already
  runs on Node and the domain layer must stay runnable under a plain test
  runner — a `Bun.*` call in the domain closes both doors.

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16, App Router, TypeScript |
| Styling | Tailwind CSS v4 — CSS-first `@theme`, no `tailwind.config.js` |
| Icons | `lucide-react`, outline style |
| Fonts | `next/font/google`, self-hosted at build time |
| Backend | Inside Next.js. The domain layer stays framework-free — see `docs/SDD.md` §3.1 |
| Database | PostgreSQL — schema designed in `docs/DATABASE.md`, not yet wired up |
| Object storage | S3-compatible. **MinIO is an implementation, not the interface** |
| Deployment | Docker Compose (`compose.yaml`); data bind-mounted to `./data` |

Design tokens live in `src/app/globals.css` under `@theme`. There is no
JavaScript Tailwind config; add colours and radii as CSS variables there.

### Version pins — do not "upgrade" these without checking

Three dependencies are pinned deliberately. All were found the hard way.

- **`typescript` is pinned to `^5.9`, not 7.** `typescript@latest` now resolves
  to the TypeScript 7 native port, which `typescript-eslint` does not support
  ("typescript-eslint does not support TS 7.0"). Linting breaks entirely.
- **`eslint` is pinned to `^9`, not 10.** `typescript-eslint@8`, which
  `eslint-config-next` depends on, ships a scope manager missing
  `addGlobals`, so ESLint 10 throws on every file.
- **`sharp` is declared directly at `^0.35.3`, matching Next 16's own
  `optionalDependency`.** Avatar uploads decode, crop and re-encode through it
  (`src/lib/avatar-image.ts`). Relying on Next's transitive copy would mean a
  Next upgrade that dropped or moved the optional dependency broke uploads in
  production rather than `bun install` in CI. The prebuilt binaries carry
  libheif but **no HEVC codec**, so AVIF decodes and HEIC does not — see
  `src/lib/avatar.ts` on why `accept` must never list HEIC.

Also: `eslint-config-next` v16 exports a **native flat-config array**. Spread
it directly in `eslint.config.mjs`. Do not wrap it in `@eslint/eslintrc`'s
`FlatCompat` — that throws "Converting circular structure to JSON".

## Running the stack

```bash
cp .env.example .env      # fill in the three required secrets
docker compose up -d      # postgres, minio, app
docker compose logs -f app
```

**Host ports are deliberately off the defaults.** The app is on **3001** and
PostgreSQL on **5435**, so `bun run dev` keeps 3000 and a Postgres already
running on the machine keeps 5432. Running the container and the dev server at
the same time is the normal case — one is what you changed, the other is what
you are comparing against — and a port clash at that moment is pure friction.
Inside the compose network nothing moved: the app still listens on 3000 and the
database on 5432.

Data lives in `./data` on the host, not inside the containers, so
`docker compose down -v` cannot take the parish's records with it. Back up that
one directory and you have backed up everything. `./data` is gitignored.

**The QR scanner needs HTTPS in front of the app.** `getUserMedia` is only
available in a secure context — HTTPS, or `localhost` during development. The
compose stack terminates no TLS of its own, so over plain HTTP the "Quét mã
bản" button reports in Vietnamese that the browser cannot open the camera and
typing the copy code remains the only path. Nothing breaks; the feature is
simply absent. Put a reverse proxy in front before telling volunteers the
scanner works.

**The application speaks S3, never MinIO.** MinIO is what runs in compose;
production may be AWS S3, Cloudflare R2 or Backblaze B2, and switching is a
change of environment variables. Never import a MinIO SDK, and never assume
path-style addressing — `S3_FORCE_PATH_STYLE` is configuration because MinIO
needs it and AWS does not.

## Testing

```bash
docker compose --profile test up -d db-test   # once, or after a long break
bun run test                                  # vitest run
bun run check                                 # typecheck + lint + format:check + test
```

The test database is a **separate** compose service, on its own port
(`POSTGRES_TEST_PORT`, `5436` by default — see `.env.example`), behind the
`test` profile so an ordinary `docker compose up` never starts it. That
separation is deliberate, not incidental: the suite truncates every table
between tests (`tests/support/db.ts`), and `tests/support/env.ts` refuses to
run against any `TEST_DATABASE_URL` that doesn't name `olibra_test` — pointing
the suite at the development database by mistake would destroy whatever you
were working on, so the guard makes that mistake loud instead of silent.

Test files run against one shared `public` schema and do not run in parallel
with each other (`fileParallelism: false` in `vitest.config.ts`) — the suite
is small enough that serialising it is free, and the alternative is tests
racing each other's `beforeEach` resets on shared state. `bun run check` was
always typecheck + lint + format:check + test; test is the part that is new
as of this harness, and it is why `check` now needs `db-test` running to pass
locally, the same as CI's `check` job needs its `postgres` service.

## Non-negotiable design rules

These come from `docs/BUSINESS-REQUIREMENTS.md` §17 and `docs/DESIGN.md`. They
are not stylistic preferences — breaking one is a defect.

1. **Sans everywhere; serif only for book titles.** Lexend is the interface
   font for absolutely everything. Literata appears solely on the title of a
   book, and only via the `BookTitle` component. Nothing else reaches for
   `font-serif`.
2. **Status is never colour alone.** Every state carries an icon, a Vietnamese
   word and a colour together. Use `StatusBadge` / `StatusPanel`; the six
   states are defined once in `src/lib/status.ts`.
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
copies later, the lesson is written down: **look in `src/components/ui` first,
and if something is missing, add it there rather than inline.**

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

## Current scope

UI first. Authentication, persistence and business logic are deliberately
absent — pages render from typed fixtures in `src/lib/fixtures`. Forms do not
submit. Do not add a database layer or auth without being asked.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
