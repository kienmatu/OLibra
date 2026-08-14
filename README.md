# OLibra

Hệ thống quản lý tủ sách cộng đồng — a management system for small community bookshelves.

OLibra is built for a church or community bookshelf holding on the order of a hundred books, run by a few volunteers who are often children. It is deliberately **not** a public library system: where library software optimises for catalogue scale and patron self-service, OLibra optimises for a volunteer standing next to a physical shelf with a phone in one hand and a book in the other.

## What it does

- **Readers** see what is on the shelf, what is available today, and can ask to borrow a book.
- **Managers** record lending and returning, assess book condition, approve new readers, and moderate comments.
- **A super administrator** oversees several bookshelves in different places, delegates them to local managers, and can review everything each manager has done.

One deployment hosts many bookshelves, each reached by its own slug.

## Status

**The interface is built and the stack is settled; the backend is not written yet.** The business requirements are settled. The full UI — 42 routes, every screen of all four surfaces — is merged and renders from typed fixtures, with no database or authentication behind it.

| Target | Status |
|---|---|
| Web interface | **Built** — Next.js 16, React 19, TypeScript, Tailwind v4 |
| Language | **Settled** — Vietnamese first, internationalisation-ready |
| Timezone | **Settled** — `Asia/Ho_Chi_Minh` everywhere |
| Backend | **Settled** — inside Next.js; the domain stays framework-free so it can move out later |
| Database | **Settled** — PostgreSQL |
| Object storage | **Settled** — any S3-compatible service. MinIO runs it locally |
| Deployment | **Settled** — Docker Compose; data bind-mounted to `./data` on the host |
| Hosting | **Settled** — a single VPS, Caddy in front, `./deploy.sh`. See [DEPLOYMENT.md](docs/DEPLOYMENT.md) |

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

Earlier work targeted Laravel on shared hosting. That design is complete and preserved in git tags rather than in the working tree:

| Tag | Contents |
|---|---|
| `v0.1.0-laravel-blueprint` | Initial Laravel 12 + Inertia blueprint |
| `v0.2.0-laravel-phase1-plan` | Laravel Phase 1 implementation plan |
| `v0.3.0-laravel-master-spec` | Full Laravel master specification, architecture, agent conventions and rules |

Everything of lasting value from that work — the domain model, the twelve business rules, the state machines, the UX — carried forward into `BUSINESS-REQUIREMENTS.md`. What was dropped was Laravel-specific: folder structures, Eloquent patterns, cPanel deployment, and the constraints of a host with no Node runtime.

## Licence

Not yet determined.
