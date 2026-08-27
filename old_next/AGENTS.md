# AGENTS.md — `old_next/` (reference app)

**This is the original Next.js + PostgreSQL implementation, kept for reference only.** The
product owner decided the migration to Laravel 13 + Inertia + MariaDB (see the repo root's
`AGENTS.md` and `docs/known-gaps.md`) is the path forward. This tree is not maintained going
forward: Phases 1–3 of that migration diff their new screens and domain logic against it —
54 route pages, 116 domain files, 180-odd test files encoding the business rules — and it is
also preserved untouched at the `v0.1.0` git tag. **Do not add features or fix bugs here.** If
something here is simply wrong, note it in a comment or in `docs/known-gaps.md`; do not "fix
forward" — the whole value of this tree is that it stays exactly what shipped.

It still installs, typechecks, lints, builds and runs its full test suite from this directory
— see below — which is what "reference" means in practice: a working system to run side by
side with the Laravel app while comparing behaviour, not just source to read.

## Why it lives here, not at the repo root

Both stacks used to sit at the repo root together, and Laravel's own `app/` directory
(Models, Http, Providers — the Laravel convention `php artisan make:model` writes to)
collided head-on with the one directory Next.js's router checks first, also named `app/`.
Next silently adopted Laravel's PHP tree as its own App Router root, found no `page.tsx`
anywhere in it, and quietly built nothing. The full incident, root cause and every symptom
it produced are recorded in `docs/known-gaps.md`. This move is the actual fix: rather than
renaming Laravel's directory a second time (the emergency fix, PR #58, renamed it to
`laravel_app/`), the Next.js tree relocated to `old_next/` and Laravel got `app/` back.

**`package.json`, `bun.lock` and `node_modules` stayed at the repo root.** They are one
shared JS toolchain across both apps (Laravel's Inertia/React frontend under `resources/js`
depends on the same React, TypeScript and Tailwind versions this app does), so every script
below is invoked from the root (`bun run dev`, `bun run test`, …) and `cd`s into this
directory, or is run directly against a file path under it. `.env` is shared too — it
documents both stacks' variables in one file; see `../.env.example`.

## Toolchain: Bun locally

**Use Bun for everything local. Do not use npm, pnpm or yarn.**

```bash
bun install          # from the repo root — never `npm install` / `pnpm install`
bun add <pkg>        # never `npm add`
bun remove <pkg>
bun run dev          # http://localhost:3000
bun run build
bun run typecheck
bun run test         # needs the test database — see "Testing" below
bun run check        # typecheck + lint + format:check + test, in that order
```

All of the above run from the repo root — `package.json`'s scripts `cd old_next` (or point at
a file under it) before doing anything, so they behave the same as if this were still the
project root.

Two things worth being precise about, because they are easy to get wrong:

- **Bun is the package manager and script runner locally, and the runtime in
  production.** `bun run dev` invokes the `next` binary, which carries a Node
  shebang, so Next still executes under Node during local development. Pass
  `bun --bun next dev` if you want the Bun runtime locally too.
- **The container runs `bun old_next/server.js`; the container *builds* under Node.**
  That split is a workaround, not a preference: `bun run build` segfaults
  partway through `next build` inside a linux/arm64 container — reproduced on
  Bun 1.3.5 and 1.3.14, on both alpine and Debian, so it is neither a libc
  issue nor a stale version. The same command works under Bun on macOS, which
  is why local development never hits it. See `Dockerfile`.
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
| Database | PostgreSQL |
| Object storage | S3-compatible. **MinIO is an implementation, not the interface** |
| Deployment | Docker Compose (`compose.yaml`); data bind-mounted to `./data` |

Design tokens live in `src/app/globals.css` under `@theme`. There is no
JavaScript Tailwind config; add colours and radii as CSS variables there.

### Why `next.config.ts` sets `outputFileTracingRoot`

This app is nested one directory below the repo root, but `package.json`/`bun.lock`/
`node_modules` are at the root. `output: "standalone"` needs to know that — without the
explicit `outputFileTracingRoot`, Next infers it (and warns), which is fragile to depend on.
With it set, the standalone build lands at `.next/standalone/old_next/server.js`, not
`.next/standalone/server.js` — the `Dockerfile`'s `runner` stage and `CMD` account for this
nesting explicitly.

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
cp .env.example .env      # from the repo root — fill in the three required secrets
docker compose up -d      # postgres, minio, app — run from inside old_next/
docker compose logs -f app
```

**Host ports are deliberately off the defaults.** The app is on **3001** and
PostgreSQL on **5435**, so `bun run dev` keeps 3000 and a Postgres already
running on the machine keeps 5432. Running the container and the dev server at
the same time is the normal case — one is what you changed, the other is what
you are comparing against — and a port clash at that moment is pure friction.
Inside the compose network nothing moved: the app still listens on 3000 and the
database on 5432.

Data lives in `./data` (i.e. `old_next/data`) on the host, not inside the containers, so
`docker compose down -v` cannot take it with it. `./data` is gitignored.

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
docker compose --profile test up -d db-test   # once, or after a long break — from old_next/
bun run test                                  # from the repo root — vitest run
bun run check                                 # typecheck + lint + format:check + test
```

The test database is a **separate** compose service, on its own port
(`POSTGRES_TEST_PORT`, `5436` by default — see `../.env.example`), behind the
`test` profile so an ordinary `docker compose up` never starts it. That
separation is deliberate, not incidental: the suite truncates every table
between tests (`tests/support/db.ts`), and `tests/support/env.ts` refuses to
run against any `TEST_DATABASE_URL` that doesn't name `olibra_test` — pointing
the suite at the development database by mistake would destroy whatever you
were working on, so the guard makes that mistake loud instead of silent.

Test files run against one shared `public` schema and do not run in parallel
with each other (`fileParallelism: false` in `vitest.config.ts`) — the suite
is small enough that serialising it is free, and the alternative is tests
racing each other's `beforeEach` resets on shared state.

This repo's CI no longer runs this suite (retired alongside the collision fix — see
`docs/known-gaps.md`): nothing here is expected to change again, so a permanently-green
check bought nothing. Run it locally on demand instead, exactly as above.

## Current scope (as of the freeze)

UI first. Authentication, persistence and business logic were built inside this app up to
the point of the freeze — pages render from a real PostgreSQL database with real
authentication (see `docs/SDD.md`). This is a historical snapshot, not a moving target: it
is not being extended, and Laravel's own Phase 1+ is where new business logic goes now.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
