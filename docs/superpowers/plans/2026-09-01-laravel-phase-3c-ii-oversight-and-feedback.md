# Implementation plan: Phase 3c-ii — oversight and feedback

Spec: `docs/superpowers/specs/2026-09-01-laravel-phase-3c-ii-oversight-and-feedback-design.md`
Branch: `feat/phase-3c-ii-oversight-and-feedback`, cut from `main` at `0993a90`

## Context for whoever picks this up

OLibra is a Vietnamese parish lending-library system being ported from Next.js to
Laravel + Inertia + React. `old_next/` is a **read-only** behavioural reference —
never write to it.

**This is the last phase before cutover.** Phase 4 deletes the Next.js tree and
rewrites the architecture documents. Anything deferred here has no later phase
inside Phase 3 to absorb it.

It closes the last three placeholders — the reader's *Góp ý*
(`routes/web.php:220`), `/admin/audit` (`:828`), `/admin/feedback` (`:829`) —
plus the public contact form 3b-ii deferred *to land with the inbox that reads
it*, and per-manager activity.

**Read the spec.** Three of its decisions reversed during review because the
obvious reading was wrong:

- **Opening a feedback message does NOT mark it read** (D3). Marking is an
  explicit administrator act with its own button and its own audit row.
- **Only the SHELF filter is new** on the audit browser (D5). `AuditLogQuery`
  already implements actor, group and the date range, timezone boundary
  included.
- **Per-manager activity is the actor filter on that browser** (D4), not a
  separate screen. `/admin/managers` links to it with the actor set. That is the
  whole of BR:608.

### The two things this phase makes visible for the first time

**Six administration actions write global audit rows that no screen can read** —
3b-ii's five and 3b-i's `user.promoted_super_admin`. `AuditLogQuery` filters
`bookshelf_id` by hand, so it excludes every one. Task 5 is the screen those rows
have been waiting for.

**The feedback slice has no writer at all.** `Feedback` is referenced in six
places in `app/` and not one of them writes a row. Phase 2b deferred the slice
whole.

### Environment, and the six gates

`AGENTS.md` has the detail. Never run `pint` or `php` on the host; `npm run
build` builds the read-only `old_next` (use `npm run laravel:build`); and **run
all six gates CI runs before claiming done** — `pint --test`, `phpstan analyse`,
`npm run laravel:lint` (Biome, the one people forget), `laravel:typecheck`,
`laravel:build`, `php artisan test`.

### Pins, and the two that read raw source

Spec §6 lists seven. The ones that bite:

- **`RuleViolatedCodesHaveSentencesTest`** globs all of `app/`, asserts
  set-equality, is **blind to a ternary first argument**, and **reads raw source
  — so an example in a comment mints a code.** That has now bitten in two
  consecutive phases. Write literal throws; never spell `new RuleViolated('x')`
  in prose.
- **`WideningArchitectureTest`** likewise reads raw source. Do not write
  `->global(`, `->forShelf(` or `->systemWide(` inside a comment.
- **`TenancyArchitectureTest`**'s allow-list is whole-file and its pattern
  matches `whereNull('bookshelf_id')` too.

### Audit actions land with their writers

Three new, **63 → 66**, all in the existing `community` group — no new group.
Each lands in the same task as its writer; the census asserts set-equality
**both ways**. Count pin `tests/Unit/Audit/AuditSentencesTest.php:435`; group
partition `:427-434`. `AuditSentences::phrase()` is private — assert through
`sentence()`.

### House rule: mandatory falsification

Every test is **watched failing before it is accepted** — mutate, see red,
restore by targeted edit (**never `git checkout -- <file>`**), confirm
`git status --porcelain` is clean. Pest's `toContain` takes no message argument.
`$model->fresh()` ignores soft deletes.

---

## Task 1 — `SubmitFeedback`, the rate limit, and one fence entry

Spec D1, D2, D7. Adds `feedback.submitted` (63 → 64).

Class: **`app/Actions/Community/SubmitFeedback.php`** — a community write, not an
administration one.

1. **The guest fields are written on EVERY submission.** `guest_name` and
   `guest_contact` come from the form each time; `member_id` is *additional*
   attribution when the sender is signed in. They are **not** alternatives. The
   reference records the incident from conflating them: a signed-in reader who
   typed *"Chị Hạnh"* was displayed as *"Quản trị viên"* and the administrator
   rang the wrong person.
2. **The limit is a domain rule**, not route middleware: count `feedback` rows
   over a **rolling 24 hours** off the injected clock, and raise
   `RuleViolated('rate_limited')`. `DAILY_LIMIT = 3`.
3. **Hash `Phone::normalise()`**, not the whitespace-stripped string.
   `AppServiceProvider:123-131` records the Task 13 defect this avoids — five
   spellings of one number each getting their own bucket. Note this is a
   *deliberate divergence* from the reference, which strips whitespace only.
4. **Validate the phone with `assertPhone`.** The reference's QA round found
   `khong-phai-so` accepted and stored on the one form a shelf-less parish has.
5. **New refusal codes:** `rate_limited` and `feedback_fields_required`. Neither
   exists in `lang/vi/rules.php` today, so both need a sentence **and** a
   `RuleViolatedCodesHaveSentencesTest` entry in this commit.
6. **The fence takes ONE file, not a directory.**
   `WideningArchitectureTest:125` passes `offendersFor($pattern, [])` — an empty
   **path-suffix allow-list**, and the `systemWide` block above it already names
   three individual files. Add exactly
   `app/Actions/Community/SubmitFeedback.php`.
   **Do not widen it to the directory**: `app/Actions/Community/` already holds
   `CreateAnnouncement`, the pin/unpin pair and the comment and donation
   actions — the shelf-scoped commands that fence exists to stop opting out of
   tenancy.
7. **Only the public path needs the configurator at all.** `AuditRecorder::record()`
   throws only when no tenant is bound (`:91-107`), so the shelf surface audits
   normally. The fence is touched for one call site.

**`feedback.guest_hash` has no index.** Decide whether to add one; the count runs
on every submission.

**Tests:** a signed-in reader's submission writes both the typed name and
`member_id`; five spellings of one phone are one sender; the fourth message in a
rolling 24 hours is refused with a Vietnamese sentence, not a 429; an invalid
phone is refused.

**Falsify:** hash the raw phone and watch the five-spellings test go red.

---

## Task 2 — The reader's *Góp ý*

Spec D1. No new audit actions.

`routes/web.php:220`, replacing `underConstruction`. It sits **outside** the
`role:reader` group deliberately — `RouteOrderTest:101,117` *exempts* it from the
role-gate assertion (an exemption, **not** a pin: adding `role:reader` would
leave the suite green), and `HandleInertiaRequests:83-86` carries the same
intent.

So the form is guest-reachable, and `member_id` is not guaranteed even here.
It writes the bound shelf, and it runs under a bound tenant — **no configurator,
no fence contact.**

The reference's shelf form **omits the shelf field on purpose** (*"The shelf is
not named in the form"*); the shelf comes from the route.

**Tests:** a signed-in reader's message carries the shelf and `member_id`; a
guest's carries the shelf and no `member_id`; neither can name a shelf in the
body of the request.

---

## Task 3 — The public contact form

Spec D1, D2. No new audit actions.

The form 3b-ii deferred, on the existing `/contact` page. It writes a **null**
`bookshelf_id` — site-wide.

**The page is public** — no membership, no shelf, no tenant. It must touch **no
shelf-scoped model**, or `BookshelfScope` throws for exactly the visitor it
exists for. `Feedback` is deliberately not `BelongsToBookshelf`, which is what
makes this work.

This is the **only** surface that produces a shelf-less message, and therefore
the only call site that needs Task 1's `global()`.

3b-ii shipped the page rendering the three contact details and a sentence for the
unconfigured case. The reference renders the card **or** the form, never both —
`hasContact = name || phone`. Follow that: the form is for the gap it exists to
close.

**Tests:** a caller with no membership and no shelf submits successfully and the
row has a null `bookshelf_id`; the page touches no shelf-scoped model.

**Falsify:** touch a shelf-scoped model in the controller and watch the
no-membership test throw.

---

## Task 4 — `/admin/feedback`

Spec D3, D6, D8, D9. Adds `feedback.read` and `feedback.resolved` (64 → 66).

**Super-admin only** — ruled by the product owner on 2026-09-01, matching the
reference, which gates every feedback *read* and both handling writes on
`requireSuperAdmin`. `Bookshelf::feedback()` therefore becomes unused; **keep
it** and record it (Task 7).

Shape, all of it from the reference:

- **List, detail and the unread count resolve in ONE read**, so the panes cannot
  disagree about what is unread.
- **Opening a message does NOT mark it read.** Marking is an explicit act with
  its own button. An earlier spec draft had these conflated.
- **An unknown filter value means "no filter"**, never an empty list — *"an empty
  inbox that reads as 'no messages' is the shape of a bug this project has
  already shipped twice."*
- **`guest_contact` in the detail only, never the list**; `guest_hash` in
  neither.
- **Unread first, then newest.**
- **An unread badge** in the admin shell, **sharing the inbox's own predicate** —
  the `pendingDonations` shape (`HandleInertiaRequests:132`). 3a had to fix
  predicate drift once; do not write a second predicate.
- **A null shelf renders "Toàn hệ thống"**, not blank.
- **The typed name and the signed-in account are separate facts** — never one
  standing in for the other.

**The audit row's shelf comes from the MESSAGE** (D6), not the caller:
`forShelf($message->bookshelf_id)` when it names one, `global()` when it does
not. Mark-read and resolve run from `/admin` with no tenant bound, so they
configure explicitly or the recorder throws. These two Actions live in
`app/Actions/Admin/` — they are administration, and need no fence change.

**Status only** — `new` / `read` / `resolved` with `handled_by`/`handled_at`.
Nothing is deleted or edited.

**`feedback.archived` is NOT ported.** `OPERATIONS.md:721-731` lists
`ArchiveFeedback` provisionally with an open question about an inert button;
BR:610 asks only for read and resolved. Annotate that OPS entry rather than
silently ignoring it — the count is 66 **because** it stays out.

**Tests:** an unknown filter shows everything; `guest_contact` is absent from the
list payload and present in the detail; opening does not change status; marking
read then resolved moves the status and stamps the handler; the badge equals the
inbox's own count on a non-empty fixture; a message's audit row carries the
message's shelf.

**Falsify:** mark read on open and watch the "opening does not change status"
test go red.

---

## Task 5 — `/admin/audit`, and the six rows nobody could see

Spec D5. No new audit actions.

`routes/web.php:828`. A new query in `app/Queries/Admin/`.

**Only the shelf filter is new.** `AuditLogQuery::run(?actorId, ?group, ?from,
?to, int $page)` (`:56`) already implements actor, group and the date range
including the civil-day boundary (`:76-84`), and `Manage\AuditLogController:46-47`
already parses `?from=`/`?to=`.

**Compose, do not duplicate — and be precise about what.** Sentence rendering is
**already** shared via the static `AuditSentences::*` (`:161-165`) and is not in
`AuditLogQuery` to move. What would be duplicated is the **join and select
block** (`:88-146`): two `leftJoin`s with their
`CONVERT(… USING ascii) COLLATE ascii_bin` guards (this repo's *"six-times-paid
live 500"*), the four-way `coalesce`, the page size and the
`occurred_at desc, id desc` order. The two classes differ in exactly one private
method, `scoped()` (`:207-221`). **Extract the builder, or make the scope
injectable — pick one and say why.**

**The all-shelves case needs NO filter.** `AuditLog` carries no global scope, so
global rows come back for free. **The shelf filter is the one that needs a
literal `bookshelf_id` predicate**, and `whereHas('bookshelf', …)` cannot express
"site-wide only". `TenancyArchitectureTest`'s allow-list is whole-file and its
pattern matches `whereNull('bookshelf_id')`, so **the new file takes an
allow-list entry, deliberately** — the way `AuditLogQuery` already does.

Carry from the reference: pagination (25 a page, already in `AuditLogQuery`), the
`<details>` before/after diff (BR §14's own placement for raw values), and a
neutral rendering for an action with no sentence.

**Tests:** global rows appear when no shelf is named and vanish when one is — the
six actions invisible until now; each of BR:606's four filters narrows and they
compose; the shelf-scoped `/manage/{shelf}/audit` still shows only its own rows.

**Falsify:** add a shelf predicate to the all-shelves case and watch the global
rows disappear.

---

## Task 6 — Per-manager activity

Spec D4. No new audit actions, no new screen.

**BR:608 is the actor filter on Task 5's browser.** The reference ships it as a
link: `quan-tri/quan-ly-vien/page.tsx:263` is
`` `/quan-tri/nhat-ky?nguoi=${m.userId}` ``, and the audit page's docstring says
*"Filtering by actor is the way through today — a manager belongs to one shelf —
and the managers list links here with the actor already set."*

So: `/admin/managers` (3b-i's screen, which already lists every manager with a
`lastActiveAt` read from the audit log) gains a link per row carrying the actor.
That is the whole task.

**Do not build a separate screen, and do not map BR:608's five phrases onto
audit actions.** The reference declined that deliberately, and the five do not
partition a manager's log — `request.*`, `announcement.*`, `comment.*`,
`membership.suspended` and the `profile_change.*` family all sit in it and belong
to none of them. *"Grouped by type"* is answered by the browser's existing group
chips.

**Test:** the managers list links to the audit browser with the actor set, and
following it shows only that actor's rows.

---

## Task 7 — Record what this phase leaves open

`docs/known-gaps.md`, a `## Phase 3c-ii` section after the last `##`, in the
file's convention. Record:

- **`Bookshelf::feedback()` is now unused**, kept rather than deleted because the
  archived-shelf export will want it. BR §13.2 can be read as granting managers
  a shelf-level inbox; the product owner ruled super-admin-only on 2026-09-01,
  matching the reference.
- **`feedback.archived` is not ported**, and `OPERATIONS.md:721-731`'s
  provisional `ArchiveFeedback` entry is annotated rather than left to imply a
  gap.
- **Two deliberate divergences from the reference** in the rate limit: hashing a
  *normalised* phone (stricter than the reference's whitespace-strip), and a
  24-hour count that is genuinely global here where the reference's is
  shelf-blind by accident — silently closing a gap the reference documents.
- **The archived-shelf resolver filter and its export are now Phase 4's or
  later's.** This was the last phase of 3 that could have scoped them.
- **Whatever Task 1 decided about indexing `feedback.guest_hash`.**

---

## Definition of done

- **All six CI gates green**, run in the container.
- Every test watched failing and restored; `git status --porcelain` clean.
- Audit count at 66, census green both directions, partition at `community`.
- Screenshots of `/admin/feedback`, `/admin/audit` and the reader's *Góp ý*, in
  both modes.
- No task left the suite red across a boundary.
- **No placeholder routes remain** — `grep -c underConstruction routes/web.php`
  is 0 for real routes.
