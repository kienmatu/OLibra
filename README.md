# OLibra

Hệ thống quản lý tủ sách cộng đồng — a management system for small community bookshelves.

OLibra is built for a church or community bookshelf holding on the order of a hundred books, run by a few volunteers who are often children. It is deliberately **not** a public library system: where library software optimises for catalogue scale and patron self-service, OLibra optimises for a volunteer standing next to a physical shelf with a phone in one hand and a book in the other.

## What it does

- **Readers** see what is on the shelf, what is available today, and can ask to borrow a book.
- **Managers** record lending and returning, assess book condition, approve new readers, and moderate comments.
- **A super administrator** oversees several bookshelves in different places, delegates them to local managers, and can review everything each manager has done.

One deployment hosts many bookshelves, each reached by its own slug.

## Status

**The product is migrating from Next.js + PostgreSQL to Laravel 13 + Inertia + MariaDB.**
The business requirements, UI design and technical design below are stack-independent and
still the authority on what the product does. The Next.js implementation reached a complete
UI over a real database with real authentication; it is preserved as a reference under
[`old_next/`](old_next/) — see [AGENTS.md](AGENTS.md) — and is not being extended further.
Laravel, at the repo root's `app/`, is where new work lands: Phase 0 (schema, identity,
tenancy) is done, and Phase 1 onward rebuilds the screens against it.

| Target | Status |
|---|---|
| Web interface | **Migrating** — Laravel/Inertia/React rebuild of the Next.js UI below `resources/js`, diffed against `old_next/` |
| Language | **Settled** — Vietnamese first, internationalisation-ready |
| Timezone | **Settled** — `Asia/Ho_Chi_Minh` everywhere |
| Backend | **Migrating** — Laravel at `app/`; the domain layer stays framework-agnostic where it can |
| Database | **Migrating** — PostgreSQL (`old_next/`, reference) → MariaDB (`app/`, live) |
| Object storage | **Settled** — any S3-compatible service. MinIO runs it locally |
| Deployment | Next.js reference: Docker Compose under `old_next/`, data bind-mounted to `old_next/data`. Laravel: cPanel/shared hosting, see `.github/workflows/deploy-laravel.yml` |
| Hosting | Next.js reference: a single VPS, Caddy in front, `old_next/deploy.sh`. See [DEPLOYMENT.md](docs/DEPLOYMENT.md) (historical) |

UI design came first; the technical design follows the screens, not the other way round.

## Documentation

| Document | Purpose |
|---|---|
| [BUSINESS-REQUIREMENTS.md](docs/BUSINESS-REQUIREMENTS.md) | The authority on what the product does and why. Stack-independent: domain model, business rules, state machines, permissions, UX, roadmap. |
| [DESIGN.md](docs/DESIGN.md) | The visual language — colour, type, shape, components, navigation. |
| [SDD.md](docs/SDD.md) | Software design: layers, where each invariant is enforced, cross-cutting concerns, and what any candidate backend stack must be able to do. |
| [DATABASE.md](docs/DATABASE.md) | The schema, and which guarantees live in the database rather than in application code. |
| [OPERATIONS.md](docs/OPERATIONS.md) | Every command and query the system performs, transport-neutral. |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Standing the system up on a VPS: first deploy, routine deploys, backups, restores, rollback, troubleshooting. |
| [AGENTS.md](AGENTS.md) | Conventions for working in this repository. |

## History

The very first design targeted Laravel on shared hosting. That work is preserved in git tags
rather than in the working tree:

| Tag | Contents |
|---|---|
| `v0.1.0-laravel-blueprint` | Initial Laravel 12 + Inertia blueprint |
| `v0.2.0-laravel-phase1-plan` | Laravel Phase 1 implementation plan |
| `v0.3.0-laravel-master-spec` | Full Laravel master specification, architecture, agent conventions and rules |

The project then moved to Next.js + PostgreSQL, which is where the domain model, the twelve
business rules, the state machines and the full UI (42+ routes) were actually built out —
`BUSINESS-REQUIREMENTS.md` and the rest of `docs/` describe that work and remain the
authority on the product regardless of stack.

**The product owner then decided to migrate back to Laravel** — this time to Laravel 13 +
Inertia + MariaDB, reusing the domain knowledge `docs/` accumulated rather than starting from
the original 2025 blueprint above. The Next.js implementation is kept as a reference under
[`old_next/`](old_next/) rather than deleted; see [AGENTS.md](AGENTS.md) for how the two
coexist and `docs/known-gaps.md` for why the layout looks the way it does. `v0.1.0` tags the
repository as it stood at the end of the Next.js era, before this migration began.

## Licence

Not yet determined.
