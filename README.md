# OLibra

Hệ thống quản lý tủ sách cộng đồng — a management system for small community bookshelves.

OLibra is built for a church or community bookshelf holding on the order of a hundred books, run by a few volunteers who are often children. It is deliberately **not** a public library system: where library software optimises for catalogue scale and patron self-service, OLibra optimises for a volunteer standing next to a physical shelf with a phone in one hand and a book in the other.

## What it does

- **Readers** see what is on the shelf, what is available today, and can ask to borrow a book.
- **Managers** record lending and returning, assess book condition, approve new readers, and moderate comments.
- **A super administrator** oversees several bookshelves in different places, delegates them to local managers, and can review everything each manager has done.

One deployment hosts many bookshelves: `/portal/dongthap`, `/portal/cantho`, and so on.

## Stack

| Layer | Choice |
|---|---|
| Backend | Laravel 12, PHP 8.4, MySQL |
| Frontend | Inertia.js 2, React 19, TypeScript, Vite |
| Styling | TailwindCSS, shadcn/ui |
| Editor | Tiptap (lazy-loaded) |
| Hosting | cPanel shared hosting — no Node runtime in production |
| Language | Vietnamese first, internationalisation-ready |

## Documentation

| Document | Purpose |
|---|---|
| [Master design specification](docs/superpowers/specs/2026-08-06-olibra-design.md) | The authority on what to build and why: domain model, database design, architecture, UX and UI, permissions, roadmap. |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the system is put together and how requests, borrowing, returning, approval, auditing and notifications flow through it. |
| [AGENTS.md](AGENTS.md) | Conventions for AI agents and engineers: coding standards, naming, folder structure, testing, definition of done. |
| [RULES.md](RULES.md) | Non-negotiable constraints. Read before writing code. |

## Status

Pre-implementation. The design is complete and approved; no application code has been written yet.

Delivery is planned in three phases. Phase 1 — the core lending loop — is a useful product on its own, so the volunteers gain something better than paper even if the project goes no further.

## Licence

Not yet determined.
