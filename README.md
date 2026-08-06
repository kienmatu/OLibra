# OLibra

Hệ thống quản lý tủ sách cộng đồng — a management system for small community bookshelves.

OLibra is built for a church or community bookshelf holding on the order of a hundred books, run by a few volunteers who are often children. It is deliberately **not** a public library system: where library software optimises for catalogue scale and patron self-service, OLibra optimises for a volunteer standing next to a physical shelf with a phone in one hand and a book in the other.

## What it does

- **Readers** see what is on the shelf, what is available today, and can ask to borrow a book.
- **Managers** record lending and returning, assess book condition, approve new readers, and moderate comments.
- **A super administrator** oversees several bookshelves in different places, delegates them to local managers, and can review everything each manager has done.

One deployment hosts many bookshelves, each reached by its own slug.

## Status

**Pre-implementation, restarting.** The business requirements are settled and complete. The technical design is being rebuilt from scratch on a new stack; no application code exists yet.

| Target | Choice |
|---|---|
| Application | Next.js |
| Hosting | Vercel |
| Database | Neon (Postgres) |
| Language | Vietnamese first, internationalisation-ready |

Nothing else is decided. UI design comes first; the technical design follows the screens, not the other way round.

## Documentation

| Document | Purpose |
|---|---|
| [BUSINESS-REQUIREMENTS.md](docs/BUSINESS-REQUIREMENTS.md) | The authority on what the product does and why. Stack-independent: domain model, business rules, state machines, permissions, UX, roadmap. |
| [DESIGN.md](docs/DESIGN.md) | The visual language — colour, type, shape, components, navigation. |

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
