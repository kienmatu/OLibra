# OLibra — Software Design Document

**Status:** Proposed. Derived from [BUSINESS-REQUIREMENTS.md](BUSINESS-REQUIREMENTS.md), which is the authority on *what* and *why*. This document covers *how*, and may be revised freely as long as it does not contradict that one.

**Companion documents:** [DATABASE.md](DATABASE.md) for the schema, [OPERATIONS.md](OPERATIONS.md) for the operation catalogue, [DESIGN.md](DESIGN.md) for the visual language.

---

## 1. Purpose and the state of play

The user interface is built and merged: 42 route files, 249 prerendered pages, rendering from typed fixtures with no backend behind them. The business requirements are settled. **The stack is now settled too** — Next.js, PostgreSQL and S3-compatible object storage, all through Docker Compose.

This document was written before that decision and deliberately without depending on it, and that framing is kept rather than rewritten away, because the discipline it produced is what keeps the decision reversible. Writing a design against a chosen framework tends to smuggle the framework's assumptions into the domain — rules that live in controllers, validation that lives in form objects, business logic that cannot be tested without booting the web server. §21 of the requirements forbids that outcome: *business logic stays separable from the delivery mechanism, so a public API can be added later without duplicating a single rule.*

So the checklist in §10 is no longer a tool for choosing. It is the list of properties the chosen stack has to keep having.

So this document describes:

- the **layers** and what may depend on what,
- the **invariants** and where each one is enforced,
- the **cross-cutting concerns** (auth, audit, time, i18n, errors) as requirements rather than implementations,
- and finally, **what any candidate stack must be able to do** — which is the thing that will actually help you choose.

---

## 2. What is already decided

| Decision | Status | Source |
|---|---|---|
| Vietnamese-first UI, i18n-ready | **Settled** | §18 |
| Timezone `Asia/Ho_Chi_Minh` everywhere | **Settled** | §4 |
| No outbound email in v1 | **Settled** | §4 assumption 2 |
| Multi-tenant from the first row of data | **Settled** | §1.4 |
| Next.js for the web UI | **Built** | README, and the merged code |
| PostgreSQL | **Settled** | DATABASE.md |
| Backend inside Next.js | **Settled** | §3.4 |
| S3-compatible object storage | **Settled** | §6.8 |
| Docker Compose deployment | **Settled** | §8 |
| Hosting | **Open** | — |

Two of these deserve a note.

**Next.js is decided for the UI but that does not decide the backend.** Next can host the backend (route handlers, server actions) or be a pure front end talking to a separate service. §3.4 treats that as a live question rather than a settled one.

**"Docker deployment" is a meaningful constraint on hosting, not just packaging.** It rules out platforms that only run functions, and it means the application is expected to be a long-lived process — which makes connection pooling, in-process caching and background work straightforward in a way serverless does not. See §8.

---

## 3. Architecture

### 3.1 Layers

Four layers. Dependencies point **inwards only**; nothing in an inner layer may import from an outer one.

```
┌──────────────────────────────────────────────────────────┐
│  Delivery        HTTP handlers, server actions, CLI,     │
│                  scheduled entry points                  │
├──────────────────────────────────────────────────────────┤
│  Application     One class or function per operation.    │
│                  Transactions. Authorisation. Audit.     │
├──────────────────────────────────────────────────────────┤
│  Domain          Entities, state machines, the fourteen  │
│                  invariants, derived-state calculations  │
├──────────────────────────────────────────────────────────┤
│  Infrastructure  Repositories, database, storage, clock  │
└──────────────────────────────────────────────────────────┘
```

Infrastructure sits at the bottom of the drawing but is depended on through **interfaces defined in the domain**. The domain declares what it needs (`LoanRepository`, `Clock`); infrastructure implements it. That inversion is what makes the domain testable without a database and what makes §21's "public API later, no duplicated rules" achievable.

### 3.2 What each layer may contain

**Domain.** The entities of §5.1, the state machines of §7, the condition list of §9, the derived-state calculations of §8, and the fourteen rules of §6 expressed as code that can be exercised without I/O. No SQL, no HTTP, no framework imports, no `now()` — time arrives through a `Clock` (§6.3).

**Application.** One unit per operation in [OPERATIONS.md](OPERATIONS.md). Each opens a transaction, checks authorisation, loads what it needs, calls the domain, persists, writes the audit record, and returns. It is the only layer allowed to know about transactions.

**Delivery.** Translates a request into an operation call and an outcome into a response. It contains no business decisions. A rule that can only be reached through an HTTP handler is a rule that will be missing from the CLI, the import script, and the API added later.

**Infrastructure.** Implements the interfaces. Owns SQL, file storage, password hashing, and the real clock.

### 3.3 The rule that keeps this honest

**Any operation must be callable from a test with no web server running.** If lending a book requires constructing a request object, that is a design failure, not a testing inconvenience. §6 requires a named test per business rule; those tests should read like the rules do.

### 3.4 Where the backend lives — settled

Three shapes, with the trade-offs that actually matter for *this* product rather than in general.

| | **A. Inside Next.js** | **B. Separate service** | **C. Next plus a thin API** |
|---|---|---|---|
| Shape | Route handlers and server actions in the existing app | Next is a pure front end; a separate backend owns the domain | Domain in Next, with a small public API surface added later |
| Deploys | One | Two | One |
| Language | TypeScript throughout | Free choice | TypeScript throughout |
| Fits Docker | Yes | Yes | Yes |
| Risk | Domain logic drifts into route handlers unless §3.1 is held deliberately | Two codebases, shared types to keep in sync, more infrastructure for a volunteer-run project | Same drift risk as A |
| Suits | A small team that wants one thing to operate | A team that wants the domain in a different language, or a real API from day one | A likely middle path |

**Decision: A — the backend lives inside Next.js.** The grounds are operational weight rather than elegance. This system serves a few hundred books and a few dozen volunteers; §1 says explicitly that where volunteer convenience and architectural purity conflict, the volunteer wins. Two services to deploy, monitor and keep in sync is a real ongoing cost for a project whose maintainers are unpaid.

**What makes this safe rather than sloppy** is §3.1, and it is now a condition of the decision rather than an observation about it. If the domain lives in its own directory with no framework imports, moving to a separate service later is a packaging change, not a rewrite. If it does not, this becomes a one-way door — and the door closes quietly, one route handler at a time, which is why §3.3's rule about being callable from a test with no web server running is the thing to enforce in review.

**What would have justified B** is wanting the domain in a language other than TypeScript. That is a legitimate reason, and it was not chosen.

---

## 4. The four surfaces

§1.2 defines four surfaces. They share a domain and differ in authorisation and routing.

| Surface | Audience | Route shape | Notes |
|---|---|---|---|
| Marketing | Anyone | `/`, `/gioi-thieu`, `/bai-viet/…` | Public, SEO-relevant, no tenant |
| Portal | Anyone | `/tu-sach` | Directory of shelves, no tenant |
| A bookshelf | Everyone | `/tu-sach/{slug}/…` | **Tenant-scoped.** The slug is the tenant key |
| Administration | Super admin | `/quan-tri/…` | Cross-tenant by design |

The slug in the URL selects the tenant. Resolving it is the first thing every shelf-scoped request does, and the resolved bookshelf id is what gets pushed into the database session for Row Level Security (DATABASE.md §3). **A shelf-scoped request that fails to resolve a tenant must fail, not fall back to a default.**

Administration is the deliberate exception: it runs as a role that bypasses RLS, and every such query is a conscious cross-tenant read (§13, INV-10).

---

## 5. Where the invariants live

DATABASE.md §7 has the full table. The summary that matters for application design:

- **Six are structural** — enforced by constraints, indexes, or grants. Application code cannot violate them even by accident.
- **Six need application discipline inside a transaction** — INV-3, INV-4, INV-5, INV-6, INV-7, INV-8.

For those six, the design requirement is simple and non-negotiable: **the check and the write happen in the same transaction, in the application layer, never in the delivery layer.** A check in a route handler is a check that the CLI and the import script will not perform.

INV-8 — every state transition writes an audit record — is the one most likely to erode. §14 requires the audit write to be in the same transaction as the change it describes, so the two can never diverge, and forbids deferring it to a background job. The practical way to hold this is to make the audit write part of the operation's own commit path rather than something a caller remembers, and to have the named test for each rule assert the audit row exists.

---

## 6. Cross-cutting concerns

### 6.1 Authentication and authorisation

Not yet designed in detail; §13 defines the permission set and the role hierarchy, and that is enough to build against.

Requirements that constrain the eventual choice:

- **Sessions, not stateless tokens, unless there is a reason.** There is no public API in v1 and no third-party client. Server-side sessions are simpler to revoke, which matters when a manager is offboarded (§2).
- **Password reset is manager-issued** (§4 assumption 2). No email flow, no reset tokens by mail. The UI already reflects this: the login screen tells the reader to phone the manager.
- **Roles are per membership, not per user** — except `is_super_admin`, which is global. Authorisation therefore needs the bookshelf in scope before it can answer anything.
- **§13.3 is explicit that hiding an action in the UI is never the security control.** The server-side check must exist independently. The UI already hides what a role cannot do; that is a courtesy, not a defence.

### 6.2 Derived state

§8 forbids storing overdue status, hold expiry and availability. DATABASE.md §6 provides views that compute them.

The application requirement is that **no code path writes a derived value**, and reviewers should treat any migration adding an `is_overdue`-shaped column as a defect. The temptation appears when a list gets slow; the answer is an index, not a cached boolean.

### 6.3 Time

A single `Clock` interface, injected. The domain never calls the system clock directly.

This is not architectural fastidiousness. §8's rules are all comparisons against "now", the timezone is fixed at `Asia/Ho_Chi_Minh` regardless of where the process runs, and testing "a loan becomes overdue at midnight" requires controlling time. Three good reasons, any one sufficient.

Dates that mean a day — `due_on` above all — are `date`, never an instant. A book is due at the end of a day, not at 14:23 on that day.

### 6.4 Auditing

§14 describes two complementary sources:

1. **Automatic change capture** on create, update and delete, giving the before/after record for every tracked entity. Passwords and session tokens are never captured.
2. **Explicit domain events** for things that are not simple field changes — "manager approved this registration", "manager skipped this reader in the queue" — with a meaningful action name the browser can filter and label.

Both write to `audit_log` in the same transaction as the change. The audit browser renders each entry as a readable Vietnamese sentence, with raw before/after values available on expansion; the UI for this is already built.

**The action name is a stable machine-readable string** (`loan.lent`, `membership.approved`). The Vietnamese sentence is rendered from it at read time, so wording changes do not rewrite history — the same reasoning as notifications (DATABASE.md §4.9).

### 6.5 Errors

§17.7 requires business-rule violations to surface as a friendly message naming what to do instead, not a stack trace and not a generic failure.

The design requirement: **a violated invariant raises a named error carrying enough context for the delivery layer to render a Vietnamese message.** `LoanLimitReached` with the limit and the current count, not `Error("validation failed")`.

Two cases deserve naming because they are the ones users will actually hit:

- **INV-1 lost race.** Two managers lend the same copy in the same second. One transaction fails on the unique index. The message must say the copy has just been lent, not "database error". §2 requires it to "fail cleanly and see a plain message, never a silently corrupted record".
- **INV-5 loan limit.** The reader is at their limit. §16.3 requires this to surface *before* the confirm step of the lending flow, never as an error afterwards — the UI already does this by showing blocked readers with the reason inline.

### 6.6 Internationalisation

Vietnamese is the only shipped locale, and §18 requires that no user-facing string is ever hard-coded — adding a locale should be a translation task, not a rewrite.

Consequences for the design, all of which the UI already honours:

- Notification and audit *content* is stored as a kind plus a payload, never as a rendered sentence.
- Dates and numbers are formatted through the locale, never with hand-written format strings.
- URLs are Vietnamese (`/tu-sach/dong-thap/danh-muc`), which suits the audience and reads well in search results.

### 6.7 Search

§12: diacritic-insensitive substring matching over title and author, and the normalisation applied when storing must be **identical** to the one applied to the search term.

The trap is that this identity is easy to assert and easy to break — there are now two implementations, one in TypeScript (`src/lib/search.ts`) and one in SQL (DATABASE.md §5). They must be kept in agreement **by a test that runs both against the same inputs**, not by intention. This already caused one bug: a hyphen surviving normalisation meant `totto chan` did not match `Totto-chan`.

### 6.8 File storage

Cover images, avatars, condition photographs.

**Settled: any S3-compatible object storage.** MinIO runs it in Docker Compose; production may equally be AWS S3, Cloudflare R2 or Backblaze B2.

The distinction that matters is that **MinIO is an implementation, not the interface**. The application speaks S3 and never imports a MinIO SDK, so changing provider is a change of environment variables — endpoint, region, bucket, credentials — and nothing else.

One flag carries most of that portability: `S3_FORCE_PATH_STYLE`. MinIO addresses buckets by path, AWS S3 by host name. Hard-coding either is precisely what would tie the application to one provider, so it is configuration.

A second URL is needed beyond the endpoint. The application reaches storage over the internal container network while a browser reaches it from outside, so `S3_PUBLIC_URL` is what goes into an `<img>` and `S3_ENDPOINT` is what the server talks to. Conflating them works locally and breaks the moment anything sits behind a proxy.

Condition photographs are the one case with a retention question: they are attached to condition assessments, which §11 lists among the never-deleted. The image should follow the same rule.

---

## 7. Phasing

§1.4 defines three delivery phases and notes that multi-tenancy is present from the first day of data, so later phases add features rather than rewriting foundations.

| Phase | Contents | Design note |
|---|---|---|
| **1 — the core loop** | Books and copies, readers and registration approval, lending and returning with condition assessment, the audit log, the manager dashboard, the public catalogue and search, CSV export | One tenant, stored as one tenant among many. Every table carries `bookshelf_id` from the first migration |
| **2 — community** | Borrow requests, holds, the queue, comments and moderation, announcements, feedback, statistics | Adds tables; changes none |
| **3 — the network** | Portal, multiple shelves, super-admin tooling, cross-shelf statistics, marketing site and blog, per-manager audit views | Adds surfaces; the tenancy model is already there |

§1.4 also says Phase 1 is a genuinely useful product on its own: if the project stalls after it, the volunteers still have something better than paper. That is worth holding onto when scoping — the UI for all three phases already exists, which makes it tempting to build all three at once.

---

## 8. Deployment

Docker is the expected target. What follows is the shape, not a finished ops plan.

**Composition.** `compose.yaml` at the repository root runs three services — the application, PostgreSQL and MinIO — plus a one-shot container that creates the bucket and exits. A reverse proxy terminating TLS sits in front in production and is deliberately not in the compose file, because it belongs to the host rather than to the application.

**Data is bind-mounted to `./data` on the host rather than held in named volumes.** `docker compose down -v` removes named volumes, and a parish's entire history disappearing because somebody typed `-v` is not a risk worth carrying for the convenience. Backing up one directory backs up everything. This was verified rather than assumed: a row and an object were written, the stack was destroyed with `down -v`, and both were still there afterwards.

**The application runs under Bun** (`bun server.js` is PID 1), so the lockfile, the local scripts and the production process all agree. The image *builds* under Node, which is a workaround rather than a preference: `bun run build` segfaults partway through `next build` inside a linux/arm64 container, reproduced across two Bun versions and both libc flavours, while succeeding under Bun on macOS. Node is what Next.js is tested against, so compiling there costs nothing.

Because that arrangement rests on a compatibility Next.js does not promise, the Dockerfile carries a `smoke` stage that boots the built server under Bun and fails the build unless it serves the landing page. A Next upgrade that breaks the Bun runtime therefore breaks the build, which is where a failure of this kind should surface rather than in production.

The build uses `output: "standalone"`, which traces the server down to the files it actually uses, so no `node_modules` reaches the runtime image.

**What Docker buys here that serverless would not:**

- A long-lived process, so a connection pool is straightforward. Row Level Security needs a session variable set per transaction (DATABASE.md §3), and a pooler in *transaction* mode is compatible with that while *session* mode is not — a decision to make before writing the data layer, not after.
- Background work — image processing, cache warming, tidying expired holds — can be an in-process scheduler rather than an external service. §8 already guarantees none of it is load-bearing for correctness, so a missed run is not an incident.

**Configuration** is environment variables, with `.env.example` committed and documenting every one. Real values are never committed; `.gitignore` already reflects this.

**Backups** are covered in DATABASE.md §10, and the one thing worth repeating here is that a named volume for `PGDATA` and an archive target off the host are both required, not optional. A compose file with the data directory in an anonymous volume is one `docker compose down -v` away from losing the parish's records.

**Migrations run before the new application version serves traffic**, and must be backwards-compatible with the version still running during a rolling deploy. DATABASE.md §9 covers the discipline.

---

## 9. Testing

§6 requires each of the fourteen rules to have a named, dedicated test. §21 makes those tests part of the definition of done.

There is currently **no test suite at all** — the UI shipped without one, which was defensible for static pages rendering from fixtures and stops being defensible the moment logic exists.

Four levels, in the order they earn their keep:

| Level | Covers | Needs a database |
|---|---|---|
| **Domain** | The fourteen rules, state machine transitions, derived-state calculations, folding | No |
| **Operation** | Each command end to end: authorisation, transaction, audit row written | Yes |
| **Constraint** | That the database actually rejects what it should — INV-1 under concurrent inserts above all | Yes |
| **Interface** | The critical journeys: lend in three steps, receive a return | Yes, plus a browser |

The constraint level is the one most often skipped and the one that would catch the most dangerous regression. **A test that opens two transactions and tries to lend the same copy from both must exist**, and it must assert that exactly one succeeds. That test is the only thing standing between the design and a silently double-lent book.

The tooling choice is open and deliberately not made here.

---

## 10. What the stack must keep being able to do

Written as a checklist for choosing a stack; kept as a checklist for holding on to one. Each line traces to a requirement rather than a preference, so none of them stop mattering now that the choice is made — they are what a future change of framework, driver or data layer would have to preserve.

1. **Run several statements in one transaction, under application control.** Needed by all six application-enforced invariants, and by INV-8's same-transaction audit write.
2. **Set a session variable per transaction** (`set local`). Needed for Row Level Security. Rules out data layers that hide the connection entirely.
3. **Distinguish a unique-violation error from other database errors.** Needed to turn a lost INV-1 race into a friendly Vietnamese message instead of a 500.
4. **Express the domain without framework imports.** Needed by §21's separability requirement, and by §3.3's testability rule.
5. **Choose the connection pooling mode deliberately.** Transaction-mode pooling is compatible with point 2; session-mode is not.
6. **Format dates and numbers through a locale**, and resolve user-facing strings from a catalogue. §18.
7. **Stream a CSV export** without buffering a whole table. §2, Phase 1.
8. **Run in a container** without a proprietary runtime.

Points 1, 2 and 3 are the disqualifying ones — they are why a data layer that hides the connection cannot be adopted here later, however pleasant its API. Everything else is negotiable.

---

## 11. Open questions

Listed rather than silently resolved.

1. **Testing tooling** — §9. Needs deciding before logic is written, not after. With the stack settled, this is now the largest open question.
2. **Session storage** — in-process, database, or cache. In-process is simplest and correct while exactly one application container runs; the moment a second one does, sessions have to move to the database or a cache. Worth choosing deliberately rather than discovering under load.
3. **TLS and the reverse proxy** — outside the compose file by design (§8), but somebody has to own it before anything is public.
4. **Audit retention** — DATABASE.md §13. No requirement exists; the volume makes it non-urgent but the question should be answered before it is.
6. **Whether the UI keeps its fixtures as a demo mode.** They currently render every screen with no database. Keeping that path working is cheap and makes the design reviewable by non-technical people indefinitely — but it is a second code path, and second code paths rot.
