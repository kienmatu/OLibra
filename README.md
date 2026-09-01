# OLibra

Hệ thống quản lý tủ sách cộng đồng — a management system for small community bookshelves.

OLibra is built for a church or community bookshelf holding on the order of a hundred books, run by a few volunteers who are often children. It is deliberately **not** a public library system: where library software optimises for catalogue scale and patron self-service, OLibra optimises for a volunteer standing next to a physical shelf with a phone in one hand and a book in the other.

## What it does

- **Readers** see what is on the shelf, what is available today, and can ask to borrow a book.
- **Managers** record lending and returning, assess book condition, approve new readers, and moderate comments.
- **A super administrator** oversees several bookshelves in different places, delegates them to local managers, and can review everything each manager has done.

One deployment hosts many bookshelves, each reached by its own slug. The shipped
language is Vietnamese, throughout, including the URLs
(`/tu-sach/dong-thap/danh-muc`). The timezone is `Asia/Ho_Chi_Minh`.

## The stack

**Laravel 13 + Inertia v3 + React 19 + MariaDB 10.11**, one application, at the
repository root. There is no separate API: Inertia carries the props, so the
route map in `routes/web.php` is the whole of the surface.

| | |
|---|---|
| Backend | Laravel 13 on PHP 8.4 (`composer.json` requires `^13.0` and `^8.4`; `php artisan --version` reports 13.29.0) |
| Frontend | React 19 through `@inertiajs/react` 3.6, built by Vite 8 (`vite.config.ts`) |
| Styling | Tailwind v4, tokens in `resources/css/app.css` under `@theme` — there is no `tailwind.config.js` |
| Database | MariaDB 10.11, 30 migrations in `database/migrations/` |
| Uploads | The only upload is a member avatar. It goes to a `local` disk whose root and URL are `AVATAR_DISK_ROOT` / `AVATAR_DISK_URL` (`config/filesystems.php:98-104`); a stock `s3` disk is defined but nothing in `app/` uses it |
| Hosting target | Shared cPanel hosting — see the status note below |

The shape of the code, in one line each:

- `app/Actions/` — the write side, one class per command. 75 files: 73 Actions
  plus two shared traits under `Concerns/`.
- `app/Queries/` — the read side, 48 files: 46 Queries plus two traits. A
  controller calls one of each, and neither calls the other.
- `app/Models/` — 19 Eloquent models, plus `Concerns/BelongsToBookshelf.php` and
  `Scopes/BookshelfScope.php`, which is where tenancy lives: it fails *closed*,
  throwing on an unbound tenant rather than returning every shelf's rows.
- `resources/js/pages/` — 57 Inertia pages.
- `tests/Feature/Architecture/` — 14 architecture pins: tests that fail when a
  *rule* is broken rather than when a behaviour is.

## Running it

Everything runs in Docker, driven by `docker-compose.laravel.yml`. The host's own
PHP is not used and is not expected to work.

```bash
make up      # docker compose -f docker-compose.laravel.yml up -d --build
make fresh   # php artisan migrate:fresh --seed, inside the app container
```

`make up` brings up four services: `app` (FrankenPHP, PHP 8.4, published on
`LARAVEL_APP_PORT`, default 8100), `scheduler` (`php artisan schedule:work`),
`vite` (default port 5175) and `mariadb` 10.11 (default port 3310). Copy
`.env.example` to `.env` first — the `app` service deliberately passes no
`env_file`, so `.env` on the mounted volume is the only source of configuration.

The frontend scripts can also be run directly on the host:

```bash
npm run dev        # vite
npm run build      # vite build  -> public/build
npm run lint       # biome check resources
npm run typecheck  # tsc -p tsconfig.laravel.json --noEmit
```

`npm run build` builds **this** application. Before Phase 4 it built the Next.js
reference instead, which cost one red CI run; the `laravel:*` names
(`laravel:build`, `laravel:lint`, `laravel:typecheck`, `laravel:dev`) are kept as
aliases because the two workflows in `.github/workflows/` and `AGENTS.md` invoke
them by those names.

Other targets: `make shell` (a shell in the app container), `make test`
(optionally `make test FILTER=...`), `make lint`, `make analyse`.

## The six gates

CI ("Laravel CI", `.github/workflows/laravel.yml`) runs six checks. Running four
of them locally and pushing is how this repository gets red pull requests.

```bash
docker exec laravel-app-1 vendor/bin/pint --test                    # 1. format
docker exec laravel-app-1 vendor/bin/phpstan analyse --no-progress  # 2. Larastan level 8
npm run laravel:lint                                                # 3. Biome
npm run laravel:typecheck                                           # 4. TypeScript
npm run laravel:build                                               # 5. Vite
docker exec laravel-app-1 php artisan test                          # 6. Pest
```

**Never run `php` or `vendor/bin/pint` on the host.** The host PHP aborts with a
dyld error before running anything, so a host-side failure is a toolchain
artefact rather than a code failure. Everything PHP goes through the container.

## Status

The web interface, the backend and the database all ship. Phase 3 closed the last
placeholder route on 2026-09-01, and Phase 4 retired the Next.js original.

**Deployment is the exception.** The pipeline exists —
`.github/workflows/deploy-laravel.yml`, `.cpanel.yml`, `deploy/post-deploy.sh` —
and, as the workflow's own header says, nothing in it has ever run against the
real host. [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) still describes the
retired VPS deployment and is marked `STALE` in its first line; it will be
rewritten from the first real deploy rather than ahead of it.
[`docs/HOSTING.md`](docs/HOSTING.md) records what the host probe did and did not
answer, and [`docs/known-gaps.md`](docs/known-gaps.md) records the two things
only a real deploy can check.

## Documentation

| Document | Purpose |
|---|---|
| [BUSINESS-REQUIREMENTS.md](docs/BUSINESS-REQUIREMENTS.md) | The authority on what the product does and why: domain model, business rules, state machines, permissions, UX, roadmap. |
| [DESIGN.md](docs/DESIGN.md) | The visual language — colour, type, shape, components, navigation. Tokens live in `resources/css/app.css`. |
| [SDD.md](docs/SDD.md) | Software design: layers, where each invariant is enforced, cross-cutting concerns. |
| [DATABASE.md](docs/DATABASE.md) | The schema, and which guarantees live in the database rather than in application code. |
| [OPERATIONS.md](docs/OPERATIONS.md) | Every command and query the system performs, transport-neutral. |
| [HOSTING.md](docs/HOSTING.md) | The shared-hosting survey: what was asked of the host, what came back, and what is still unanswered. |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | **Stale** — the retired VPS deployment. See the status note above. |
| [known-gaps.md](docs/known-gaps.md) | What is deliberately unfinished, what was never verified, and the traps that have already cost time here. **Read this before starting work.** |
| [AGENTS.md](AGENTS.md) | Conventions for working in this repository. |

## History

The product was built twice. The first design targeted Laravel on shared hosting
and survives only as tags:

| Tag | Contents |
|---|---|
| `v0.1.0-laravel-blueprint` | Initial Laravel 12 + Inertia blueprint |
| `v0.2.0-laravel-phase1-plan` | Laravel Phase 1 implementation plan |
| `v0.3.0-laravel-master-spec` | Full Laravel master specification, architecture and agent conventions |

The project then moved to **Next.js 16 + PostgreSQL**, which is where the domain
model, the business rules, the state machines and the full UI were actually built
out. `v0.1.0` tags the repository at the end of that era.

The product owner then decided to migrate back to Laravel — this time Laravel 13
+ Inertia + MariaDB — reusing the domain knowledge in `docs/` rather than
restarting from the 2025 blueprint. Through Phases 0–3 the Next.js
implementation was kept at `old_next/` as a read-only behavioural reference;
**Phase 4 deleted it**, and 104 files under `app/`, `resources/` and `tests/`
still carry comments citing it verbatim (`git grep -l old_next -- app resources
tests | wc -l`). Those citations resolve
through the tag on the commit immediately before the deletion:

```bash
git show v0.1.0-next-reference:old_next/src/app/lien-he/page.tsx | sed -n '83p'
```

See [AGENTS.md](AGENTS.md) for the full recipe and for why the plain `v0.1.0` tag
does not serve.

## Licence

Not yet determined.
