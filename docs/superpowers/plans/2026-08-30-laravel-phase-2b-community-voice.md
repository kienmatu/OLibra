# Laravel Migration — Phase 2b: Community Voice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Written 2026-08-30; **reviewed by an independent Opus and fixed** (this revision). Two open questions are recorded below; **neither blocks execution** — each states the behaviour that ships if it goes unanswered, and no task is conditional on an answer.

**What the review found, and where the fixes live.** It built two throwaway worktrees, staged
this plan's code at real paths and ran it against real MariaDB, finishing at 1,295 passing —
so almost everything below is measured rather than argued. What **held**: the scope cut,
ground by ground, and its judgement that 2b is coherent without feedback; Task 3's
notification mutation, reproduced exactly (`1 failed, 1284 passed`, the guard naming the file
and the line, nothing else in 1,285 tests reddening); the retry guard having teeth from Task
2; `ApproveComment`'s `for update` genuinely being the first logged statement; divergence 4's
memberless super admin, built and confirmed failing closed; and every DB-level claim,
including errnos 4025, 1452 and 1062 with the right constraint names.

Three **Criticals**, all fixed at the source rather than annotated: the new
`CommunityArchitectureTest` **cannot be green at Task 1's commit** (it walks a directory that
does not exist yet) and has moved into Task 2 — see Task 1 Step 3 and Task 2 Step 4; Task 5's
`BelongsToBookshelf` mutation was **false in both halves** and is struck with the measurement;
and Tasks 11 and 14 **did not compose**, leaving *Đăng lại* dead for any manager who did not
type an expiry — see the absent-versus-explicit-null paragraphs in both. Nine Importants and
six Minors are fixed in place, each carrying the correction and its reason rather than a
silent edit; the largest of them, `write_target_not_found` having **no sentence in this port**
(divergence 3), would otherwise have written a false entry into `docs/known-gaps.md`, and Task
19's donor pre-fill **cannot ship as first described** and now opens with the answer instead
of a question.

**A SECOND round then corrected the corrections**, which is the shape this project has had go
wrong twice, so everything in it was re-measured against a running suite before it was
written: the `CommunityArchitectureTest` failure count (it is **`4 failed`** with the
directory removed and **`2 failed, 2 passed`** with only the file removed — two different
measurements the first correction conflated, and its "3 failed" was neither); the tenancy pin
Task 5 gave away, which the first correction handed to a Task 20 step that did not contain it
(now measured: deleting `BelongsToBookshelf` from `Comment` gives **`2 failed, 22 passed`**
across `TenancyArchitectureTest` and `TenantIsolationTest`); the mapping seam under C3, where
`$request->date()` erases the absent-versus-empty distinction and
`CarbonImmutable::parse(null)` **returns now** — both measured, both now named in Tasks 11 and
14 with the assertion that catches them; and Task 20 Step 2, which still carried the
`write_target_not_found` sentence divergence 3 had already retracted. Three measured minors
went with them (the key count is **68**, not 64; Task 9 adds no route-order block; the stale
numeral and the stale count live in two *different* `AuditSentencesTest` blocks). One further
precision was found while measuring rather than reported: the shipped
`CirculationArchitectureTest` has **two** `RecursiveDirectoryIterator(app_path('Actions/
Circulation'))` sites, and a blind rename hits the wall-clock one too, where `$root` is
undefined.

**Nothing in either review was disputed.** Every finding was checked against the file — or run
— before its fix was written, and the four checkable in round one were reproduced directly:
`write_target_not_found` absent from `lang/`, `app/` and `tests/`; `TenantIsolationTest`'s
dataset naming all three community models; `manage/books/create.tsx` carrying `donor_name`
and no `donor_membership_id`; and `AuditSentences::phrase()`'s `default =>
self::line('unknown')` arm.

## Context — what this is, and what problem it solves

The Laravel/MariaDB/Inertia rewrite of OLibra has shipped its foundation (Phase 0) and
its core loop: the catalogue (1a), members and registration (1b), lending and returning
(1c), the audit log and dashboards (1d), and the borrow-request queue with holds,
notifications and the reminder sweep (2a). `main` is `fabfbd4`; the suite is **1,272
passing / 8,033 assertions**. Everything a volunteer needs to run a shelf exists.

What does not exist is any way for the shelf to **speak, or be spoken to**. A child who
reads *Dế Mèn Phiêu Lưu Ký* cannot say anything about it. A parish that wants to tell its
readers the shelf is closed next Sunday has nowhere to write it. A family with a bag of
books to give has no way to offer them. Every one of those tables was created in Phase 0
and has never had a row: `comments`, `announcements` and `book_donations` exist, are
constrained, are tenant-scoped, and are written by nothing.

**This plan builds those three, end to end** — the commands, the read shapes, the screens
a reader sees and the screens a manager works from — and it carries INV-9 ("a comment is
publicly visible only when *approved*") into the access path rather than into a caller's
filter.

### The cut: feedback is NOT in this plan, and that is a decision, not an omission

The brief for this phase named four things: comments and moderation, announcements,
**site feedback and its manager inbox**, and donations. Feedback is deferred whole — the
guest-facing form *and* the inbox together — and the reason is structural rather than a
preference about size.

1. **The read half is `super_admin` and cross-shelf, and it lives in `src/domain/admin/`;
   the two handling commands are `super_admin` too.** `getFeedbackInbox`
   (`src/domain/admin/queries/get-feedback-inbox.ts`) says so in as many words:
   "Cross-shelf by nature, which is why this lives under `src/domain/admin/` … No
   shelf-scoped read can express it." `markFeedbackRead` and `resolveFeedback` each open
   with `requireSuperAdmin(ctx)` — **they live in `community/commands/feedback.ts`, not
   under `domain/admin/`**, a correction the review made to this paragraph's first draft;
   the role claim was right and the location was not. BR §1.4 assigns "super-admin tooling"
   to **Phase 3 — the network**.
2. **The `/admin` area of this Laravel port has no real screen yet.** Every route under
   `admin/` renders `ShellController::underConstruction`, and `resources/js/layouts/
   admin-layout.tsx` exists but is imported by nothing (`grep -rn "admin-layout"
   resources/js` returns no hit outside the file itself). Building one super-admin screen
   here means building the area's layout, navigation and cross-shelf read conventions for
   a single feature that Phase 3 will then build them for again.
3. **A site-wide message needs an audit row with a NULL `bookshelf_id`, and
   `AuditRecorder` refuses to write one.** Its `record()` throws
   `RuntimeException('AuditRecorder needs a bound tenant…')` when
   `TenantContext::bookshelfId()` is null, and its class docblock assigns the exception to
   a later phase by name: *"global rows are the cross-shelf admin acts of Phase 3."* The
   reference needs three separate runners for this (`runPublicCommand`,
   `runGlobalCommand`, `runAdminCommand`) and `auditScopeFor` to refuse a caller whose
   scope disagrees with the message. None of that machinery exists here. It is a phase's
   worth of foundation, not a task's.
4. **Feedback must ship whole or not at all.** The reference records what happens
   otherwise, from its own history: `submitFeedback` "has been writable since B3 and
   unreadable ever since… a parish's children could send a note to the people who keep
   their shelf and nobody could open it." Shipping the form here and the inbox in Phase 3
   would reproduce that defect deliberately.

So `shelves/{shelf}/feedback` and `/contact` stay exactly as they are — under
construction, the former still deliberately outside the `role:reader` group
(`routes/web.php` explains why at the route). **Feedback moves to Phase 3 as its first
slice.** Open question 1 below is the one answer that would reverse this.

### How many tasks, and where the seams fall

**Twenty tasks, in three slices plus a wrap-up.** 2a was nineteen for a comparable
surface; 1a–1d were smaller because each had fewer independent state machines. The seams
are drawn where a *state machine* ends, because that is where a task can be reviewed
against a spec rather than against the previous task's leftovers:

- **Slice A — comments and moderation (Tasks 1–8).** One table, one four-value status, one
  invariant with its own numbered test file. Eight tasks because comments carry the phase's
  only notification kind, the phase's only invariant suite, and two screens on opposite
  sides of the moderation boundary.
- **Slice B — announcements (Tasks 9–14).** Six commands over one table, plus a read-time
  expiry rule that must be computed in exactly one place or the reader's list and the
  manager's label disagree about one notice.
- **Slice C — donations (Tasks 15–19).** Three commands, two read shapes, and the one table
  in this schema whose actor column is a **membership** id rather than a user id.
- **Task 20 — the guarantee sweep.** The OPS §4.4 walk, the durable record, the seeder, and
  the mutation checks the phase's headline claims rest on.

Each slice is ordered write-side first (settings and policy, then commands, then queries,
then screens) so every commit is green and every screen is built against a read shape that
already has tests.

**What is deliberately NOT here, beyond feedback:** the shelf home page
(`GetShelfHome`, deferred "whole" in `docs/known-gaps.md`) stays deferred — its
centrepiece is a pinned-announcement card, which this plan makes computable, but its other
cards are the *Góp ý* and *Tặng sách* entry points, one of which belongs to the deferred
slice; building it now means building it twice, which is the exact reason its own
known-gaps entry gives for deferring it. The manager's per-book comment panel is likewise
out (divergence 9). Statistics and QR labels remain 2c's.

**Goal:** A reader can say something about a book and a manager can decide whether the
parish sees it; a manager can write, pin, publish, unpin and pull shelf news that lapses on
the clock with nothing having run; and a reader can offer books to the shelf and read what
was decided about their offer, while a manager works that queue and hands the donor's
identity to the add-book form the reference's own §16.3 describes.

**Tech Stack:** unchanged — PHP 8.4, Laravel 13, Inertia v3, React 19, Tailwind v4,
MariaDB 10.11, Pest 5, Larastan level 8, Pint, Biome 2, Bun.

**Spec:** `docs/superpowers/specs/2026-08-26-laravel-mariadb-inertia-migration-design.md`

**The reference implementation is the specification.** `old_next/src/domain/community/`
— `policy.ts`, `commands/{announcements,comment-moderation,donations}.ts`,
`queries/{get-announcements,get-comments,get-my-donations}.ts` — plus its tests:
`old_next/tests/domain/community/comments.test.ts` (14 tests),
`announcements-feedback-donations.test.ts` (the announcement and donation halves),
`old_next/tests/invariants/inv-09-comment-visibility.test.ts` (6 tests), and the
`old_next/tests/lib/` action tests (`comment-action.test.ts`,
`comment-moderation-actions.test.ts`). **Every command's docblock in the reference is its
specification, and every Action task below starts by reading the TypeScript it ports.**
`commands/feedback.ts` and `tests/domain/admin/feedback-inbox.test.ts` are read for
context and ported by nobody in this plan.

### The schema is already there — verified, not assumed

All four Phase 0 migrations exist and this plan **adds no migration at all**:

| Table | Migration | What it already carries |
|---|---|---|
| `comments` | `2026_08_26_000010_create_comments_table.php` | `comments_status_check` over the four statuses, `comments_public (book_id, created_at)`, `SoftDeletes`, the `comments_book_fk` composite tenant FK (CASCADE) |
| `announcements` | `2026_08_26_000011_create_announcements_table.php` | the `slug_key` STORED generated column under `announcements_bookshelf_id_slug_key` UNIQUE, alive rows only; `is_pinned`, nullable `published_at`/`expires_at`, `SoftDeletes` |
| `book_donations` | `2026_08_26_000013_create_book_donations_table.php` | `book_donations_status_check`, `book_donations_declined_has_reason`, `book_donations_queue (bookshelf_id, created_at)`, the `book_donations_donor_membership_fk` composite FK (RESTRICT), **no `deleted_at`** |
| `feedback` | `2026_08_26_000012_create_feedback_table.php` | (deferred slice) nullable `bookshelf_id`, the `feedback_bookshelf_immutable` trigger |

Models, enums and casts exist too: `App\Models\{Comment,Announcement,BookDonation}` and
`App\Enums\{CommentStatus,DonationStatus}`. `Comment` and `Announcement` carry
`SoftDeletes`; `BookDonation` does not, because its table has no `deleted_at`.
`Announcement::$guarded = ['slug_key']` — writing the generated column is errno 1906.

---

## Divergences from the reference — numbered, with reasons

1. **These Actions live in `app/Actions/Community/`, and the two directory-scoped
   circulation guards widen by ROOT rather than by name.**
   `CirculationArchitectureTest`'s retry walk hardcodes
   `app_path('Actions/Circulation')`, and its own docblock states the rule it enforces as
   a **property**: "every Action under app/Actions/Circulation that opens a write
   transaction passes an attempts count, and a new one cannot become a silent
   non-retrying participant merely by being written." A second Actions directory that
   opens write transactions is exactly a new silent participant. So Task 1 gives the walk
   a `?string $root` parameter (defaulting, inside the body, to the directory it walks
   today), renames it `actionTransactionCalls`, and `CommunityArchitectureTest` calls it
   with `app_path('Actions/Community')`.

   **Why these writes are held to the retry rule, stated without a claim this plan has not
   earned.** Every insert here takes a SHARED lock on the shelf's `bookshelves` row
   through its own `bookshelf_id` FK, and the audit insert that accompanies it takes a
   second one plus a shared lock on the acting user's `users` row —
   `docs/known-gaps.md`'s lock-order entry records both edges, and records the family of
   cycles it **reproduced with two real OS processes** (`UpdateReaderProfile` /
   `SetReaderCredentials` holding X `users` and wanting S `bookshelves`, against a
   transaction holding X `bookshelves`). `CreateComment` additionally takes a shared lock
   on the `books` row through `comments_book_fk`, which `UpdateBook` takes exclusively
   after opening with `X(bookshelves)`.
   **No cycle is claimed to be reachable here, none is claimed to be unreachable, and no
   frequency is claimed or measured.** What is claimed is narrower and is the guard's own
   argument: the reachability question has been answered wrongly twice on this project,
   the retry costs one argument per call, and an untranslated 1213 is a server error where
   every other refusal in this system is a Vietnamese sentence. `ConcurrencyRetry::ATTEMPTS`
   goes on every `DB::transaction` in this phase.

2. **`comments_enabled`, not BR §5.5's `allow_comments`.** The requirements table spells
   the setting `allow_comments`; every implementation spells it `comments_enabled` — the
   reference's reader (`community/policy.ts`) and its writer
   (`admin/commands/bookshelves.ts`) alike. Verified by grep across the whole repository
   (excluding `vendor/`, `node_modules/` and `.git/`) **at `fabfbd4`, before this plan file
   existed**: the string `allow_comments` occurred on exactly one line anywhere —
   `docs/BUSINESS-REQUIREMENTS.md`'s settings table — and in no source, test, migration,
   language file or reference file at all. This plan is itself now a second occurrence, which
   is why the measurement is dated rather than stated as a standing fact; re-run it excluding
   `docs/superpowers/plans/` if you want the original number. One key, one spelling,
   and it is the one with an implementation on both sides. `comments_require_approval` is
   spelled the same in both documents and needs no decision. Task 20 records the BR §5.5
   row as a documentation lag, and records that whoever builds `/manage/settings` (not this
   phase) must write `comments_enabled`.

3. **Route-model binding replaces the reference's fold of "no such row" into the refusal
   code, for all three entities.** `pendingComment`, `announcement` and `pendingDonation`
   each answer "missing" and "wrong status" with one code, so a caller cannot tell them
   apart. Here `{comment}`, `{announcement}` and `{donation}` are bound through the shelf
   relation under `scopeBindings()` **and** through `BookshelfScope` on the model, so a
   nonexistent id and a foreign shelf's id are both a **404** before the Action runs, while
   a wrong-status row on the caller's own shelf is a `RuleViolated` → **302** carrying the
   Vietnamese sentence.

   This is **2a's divergence 15 generalised**, and it is recorded here rather than left in
   an inline comment. What spec §5.4 (the migration design spec's "The TenantIsolation
   suite", **not** `BUSINESS-REQUIREMENTS.md` §5.4, which is a field list) demands is that
   a foreign shelf's row be indistinguishable from a nonexistent one — that holds, in both
   directions, and it is what the 404 buys. What it does not buy: a manager of this shelf
   can distinguish "no such comment here" from "a comment here I already decided". The
   caller is a manager of the shelf whose row it is; the leak is within their own tenant.
   Accepted, named, and carried to Task 20's known-gaps entry.

   **Consequence to state out loud, corrected against the file:** `write_target_not_found`,
   which the reference's announcement commands throw when a row is missing, is thrown by
   **nothing** in this port **and has no sentence here either** — the string appears nowhere
   under `lang/`, `app/` or `tests/` (measured, not counted by eye: `require`ing
   `lang/vi/rules.php` returns **68** keys and `array_key_exists` on this one is false. The
   previous revision said 64 — a number nobody re-ran, in a divergence about a claim nobody
   re-ran, which is precisely what Task 20's count-word grep exists to catch). The plan's first draft claimed the sentence already existed and told
   Task 20 to record an inert orphan, which would have written a **false entry** into the
   very document whose own step opens "a known-gap that has silently become false is worse
   than one that is missing". So: route-model binding answers 404 where the reference threw
   this code, the code is never minted here, no `lang` key is added, and there is nothing for
   the census to be silent about. Task 20 records the substitution itself, not an orphan.

4. **The `membershipId` input is dropped; the session is the scope.** The reference's
   `createComment` and `offerDonation` each take a caller-supplied `membershipId` and
   compare it against `ctx.actor.membershipId`, because their forms posted a hidden field.
   Here `TenantContext::membership()` **is** the caller's own membership of the bound
   shelf, resolved by `ResolveTenant` from the session, so there is no field to lie in.
   The `not_permitted` refusal survives and is **not** defence against nothing:
   `Gate::before` returns `true` for any `act-as-*` ability when `users.is_super_admin`,
   and `ResolveTenant` resolves only `active` memberships, so a super admin acting on a
   shelf they do not belong to passes the middleware and the policy with a **null**
   membership. Both Actions fail closed on that path and Task 15 and Task 2 each pin it
   over HTTP (the 2a Task 12 precedent, where that path was proven real).

5. **Announcement bodies are plain text; `body_text` is derived, and the `bodyText`
   parameter is dropped.** The reference accepts an optional plain derivation beside a rich
   body and falls back to the rich body when none is supplied. This port has no rich-text
   editor and this plan does not build one, so the create/update forms post one plain
   field, which is stored in **both** `body` and `body_text` — the excerpt still comes from
   `body_text` (the column BR §5.4 names for it), so nothing downstream changes shape when a
   rich editor eventually lands. Shipping a `bodyText` parameter with no caller is the
   "implemented, reachable from nowhere" shape 2a's divergence 3 refused. Recorded in
   known-gaps with exactly what a later editor restores.

6. **Read-time expiry is evaluated against `App\Support\Clock`, bound as a parameter, not
   against a database `now()` function.** The reference compares `published_at` and
   `expires_at` against `olibra_now()` inside SQL — a Postgres function its fixed clock can
   override. MariaDB has no such hook, and this project's rule is that domain time comes
   from `Clock`. So `AnnouncementsQuery` takes **one** instant from `Clock::now()` per call
   and binds it into every comparison it makes. The reference's actual worry is preserved
   exactly: its docblock forbids the *page* from re-deriving state ("`new Date()` in a React
   component is a third clock"), and here the state is still computed server-side from the
   same bound instant the list filter uses.

7. **The manager's `state` label is computed in PHP from the same bound instant, not in a
   SQL `case`.** One instant, one comparison direction, one place — which is what the
   reference's `case` expression was for. Task 12 pins the agreement at the boundary: an
   announcement whose `expires_at` equals the bound instant is absent from the reader list
   **and** labelled `expired` on the manager list, and moving either comparison alone
   reddens.

8. **Pins have no cap, and none is added.** OPS §4.4 leaves this as its own open question
   and settles it at "multiple pins allowed, ordered by recency among themselves", because
   BR §16.1's "pinned first, most recent next" only means something if more than one may be
   pinned. Ported as-is. A cap later is a partial unique index and a refusal, not a change
   to these commands — the reference says so and it is still true here.

9. **The comment queries ship without the reference's `bookId` narrowing.** Both manager
   comment queries take an optional `bookId` in the reference, serving a comments panel on
   the manager's own book page. This port does not build that panel, so the parameter would
   be reachable from nowhere — divergence 3's precedent again. `BookCommentsQuery` (the
   reader's, INV-9's home) is by book because that is the only way it is ever called.
   Recorded in known-gaps with the reference's shape for whoever adds the panel.

10. **`comment_approved` carries no payload, matching the reference.** `approveComment`
    calls `notify(tx, { userId, kind: "comment_approved" })` with nothing else, so the
    sentence names no book: a reader with two approved comments reads the same line twice.
    Ported rather than improved — adding a title is a product change, not a port — and
    recorded in known-gaps as a candidate improvement with the one-line shape it would take.

11. **`OfferDonation` ships without the reference's photo parameter.** The reference's input
    is `photo?: string | null` and **the column it lands in is `book_donations.photo_url`** —
    the two names differ and the first draft of this list used the input's name for the
    column, which the review corrected. This port has no uploader (1a dropped the cover
    uploader for the same reason, recorded in known-gaps), so `photo_url` stays null and the
    parameter is absent rather than present-and-uncallable. The column is still read and
    rendered where a row has one, so a later uploader adds a writer and no reader.

12. **The moderation and donation queues are unpaged, and the decided lists are capped.**
    The reference argues both: a queue is worked rather than browsed (oldest first,
    unbounded), and a "recently decided" list beside it is capped at ten and deliberately
    not a browsable archive, because a shelf of a few hundred books does not accumulate one.
    The cap is a parameter so the caller states it. Ported whole, including the argument.

---

## Global Constraints

Phase 0's, 1a–1d's and 2a's Global Constraints all still bind — branch
`feat/phase-2b-community-voice`, cut from merged `main` = `fabfbd4`; MariaDB 10.11 via the
`mariadb` driver; PHP 8.4; UUIDv7 `VARCHAR(36) ascii_bin`; `DATETIME(6)` UTC; English URIs;
Pint + Larastan level 8 + Biome + tsc + Vite build clean at every commit; one commit per
task in lowercase `type: sentence` style. Additionally, for this plan:

- **`old_next/` is read-only.** `git diff origin/main...HEAD -- old_next/` stays **empty**
  for the whole branch. Task 20 runs that exact command and pastes its (empty) output. No
  task in this plan edits, fixes or extends anything under `old_next/`; what is wrong there
  goes into `docs/known-gaps.md`.

- **Anti-enumeration (spec §5.4 — the MIGRATION DESIGN spec's "The TenantIsolation suite",
  NOT `BUSINESS-REQUIREMENTS.md`, whose own §5.4 is "What is recorded about each thing" and
  contains no such rule): refusals over HTTP are 404, never 403.** Every new route sits
  inside `role:manager` or `role:reader`; every new Form Request's `authorize()` is
  `abort_unless(Gate::allows(...), 404)`. A **`RuleViolated` is a 302**, not a 404 and not a
  500: `bootstrap/app.php` renders every one of them as
  `back()->withErrors(['rule' => __('rules.'.$code)])`, and `back()` follows the Referer, so
  the sentence lands on whichever page posted. This sentence is written out because the
  coordinator got it wrong once on this project and shipped the error into a docblock.

- **No hand-written `where('bookshelf_id', <value>)`.** Tenancy comes from `BookshelfScope`.
  `TenancyArchitectureTest`'s allow-list is **whole-file**, so adding an entry spends the
  tripwire for that file permanently — this plan adds **no entry to it**, and Task 20
  re-runs the test to say so. `Comment`, `Announcement` and `BookDonation` all carry
  `BelongsToBookshelf`, so every read and write in this phase is scoped by the model.

- **Domain time goes through `App\Support\Clock`.** Nothing calls `now()`/`Carbon::now()`
  directly. **The no-wall-clock grep reads RAW source including comments**, and its
  lookbehind exempts only `-`/`>` — so writing the literal `Clock` + `::now()` **inside a
  comment** reddens the suite. Task 5 of 2a measured this. Refer to it in prose as "the
  clock's own accessor", never as a spelled-out call.

- **Every reader-facing notification is written by `Notifier::notify()` inside the
  command's own `DB::transaction`.** This phase adds exactly one kind, `comment_approved`,
  and the task that adds it adds — in the **same commit** — its writer, its
  `lang/vi/notifications.php` sentence, its `NotificationSentences` match arm and its
  `OPS_SECTION_7` census row. `NotificationsAreReaderFacingTest` holds kind↔writer
  **set-equal in both directions** and derives its per-file floor from that same table, so
  a kind with no writer, a writer with no row, and a writer that went quiet are each red.

- **Every write transaction in this phase retries:** `DB::transaction($cb,
  ConcurrencyRetry::ATTEMPTS)` (divergence 1). Task 1 widens the guard by root so this is
  enforced rather than remembered.

- **`comments.author_id` and `comments.moderated_by` are `users(id)`. `book_donations.
  donor_membership_id` is `memberships(id)` — the inversion — while `book_donations.decided_by`
  beside it is `users(id)`.** It is the only table *this phase writes* that points at
  `memberships`, and it is **not** the only one in the schema:
  `book_copies.acquired_from_membership_id` is another, and it is precisely the provenance
  column the donation table is deliberately not (`add_composite_tenant_fks` declares both
  FKs). The reference's own "the only table in the slice" is scoped to its slice for the
  same reason. Both directions appear in a single
  insert in Slice C, and neither is inferable from the column name. Every variable is named
  for the id it holds (`$userId`, `$donorMembershipId`); a user id compared against
  `donor_membership_id` matches nothing and reads as "this reader has never offered
  anything" rather than as an error, which is why Task 17 pins it with a fixture whose two
  ids are both present and different.

- **`SessionGuard` caches the `actingAs` user for a whole test method** — every actor switch
  is its own `it()` block or a fresh request. Fired repeatedly on this project; zero
  tolerance.

- **UUID v7 keys are chronologically monotonic**, so an ordering test that seeds in the
  intended order proves nothing. **Every ordering test in this plan seeds OUT of the
  intended order**, and every same-instant tiebreak test pins the mechanism explicitly and
  says in a comment why the engine already agrees.

- **Pest traps.** `expect()->and()` short-circuits, AND a failed `expect()` aborts the whole
  test method — two facts that must each be shown failing live in two `it()` blocks. Prove
  an absence key-by-key with `array_key_exists()`; never `not->toHaveKeys([...])` (it means
  "has ALL"); never `not->toHaveKey($k, "msg")` (it passes unconditionally); never
  `toContain` on a whole row for a positional claim. **Every exclusion test seeds the thing
  to be excluded** — a fixture with nothing to exclude cannot prove exclusion, and that is
  the single most important sentence in this list for a phase whose headline invariant is an
  exclusion.

- **Every new literal `new RuleViolated('code')`** is written in the short imported form and
  added to `RuleViolatedCodesHaveSentencesTest`'s `toEqualCanonicalizing` list **in the same
  task**. That list is a deliberate edit, not a magic number.

- **Free-text rules lead with `bail` and carry `encoding:UTF-8`.** `FreeTextEncodingGuardTest`
  sweeps every Form Request automatically; new requests pass it rather than being exempted
  from it. Any id-shaped input that reaches a query without route binding is validated
  `uuid` so an emoji is a field error, never an errno 1267 collation 500 (the `SafeId`
  lesson).

- **Test helper names and top-level `const`s are process-global** (AGENTS.md). The COMPLETE
  registry this plan mints — checked against `grep -rhn "^function \|^const " tests/`, which
  at `fabfbd4` finds **152** top-level functions and **4** top-level `const`s, none of them
  colliding with the names below:

  `csgFix` (1) · `cmcFix` (2) · `cmaFix` (3) · `cmdFix` (4) · `bcqFix` and `inv9Fix` (5) ·
  `cmqFix` (6) · `bcsFix` (7) · `mmsFix` (8) · `anwFix` (9) · `anuFix` (10) · `anpFix` (11) ·
  `anqFix` (12) · `arsFix` (13) · `amsFix` (14) · `dofFix` (15) · `dddFix` (16) · `dnqFix`
  (17) · `drsFix` (18) · `dmqFix` (19) — **twenty functions**, plus two more:
  `actionTransactionCalls` — Task 1's **rename** of the shipped circulation walk, so
  `circulationTransactionCalls` ceases to exist in the same commit (`grep -rn
  "circulationTransactionCalls" tests/` returns nothing afterwards, which is the check) — and
  `wallClockOffenders`, minted by **Task 2** with `CommunityArchitectureTest` itself.
  **No new top-level `const`.** `OPS_SECTION_7` already exists and Task 3 adds a row to it
  rather than redeclaring it. Before adding any helper, run the grep.

- **A fixture that describes a state no command produces is a broken fixture.** A `rejected`
  comment carries `moderated_by`, `moderated_at` and `moderation_note` together; a `hidden`
  one carries the first two and may carry the third; a `declined` donation carries
  `decision_note` **in the same statement** as its status, because
  `book_donations_declined_has_reason` is `CHECK (status <> 'declined' OR decision_note IS
  NOT NULL)` and a two-step update raises errno 4025 between the steps.

- **Fixture names dodge `UserFactory`'s pool** ('Trần Minh' is in it verbatim) and
  `DemoShelfSeeder`. A second-shelf template calls `TenantContext::actSystemWide()` before
  creating rows, then `set()` to rebind.

- **`make test FILTER=…`** runs a filtered suite; `make lint` is Pint plus Biome; `make
  analyse` is Larastan. `make lint` carries a **known baseline** on this branch — three
  Biome warnings, one info (the `biome.json` schema-skew diagnostic, reported on every run),
  and no Pint or Larastan finding. That baseline is inherited, recorded in
  `docs/known-gaps.md`, and **not to be added to**. Scratch output goes to `.artifacts/`
  (gitignored).

- **`php artisan tinker` bypasses `phpunit.xml`'s overrides and runs against the real dev
  database `olibra`, not `olibra_testing`.** There is no `.env.testing`, so `--env=testing`
  does not fix it. Diagnostics go through a throwaway Pest block, not tinker.

---

## Open questions — two, both with a recommendation and a default that ships

Neither blocks execution. If Kien has not answered by the time Task 1 starts, the
recommendation ships and the alternative stays one small change away.

### OQ1 — Does a shelf's own manager read the feedback addressed to their shelf?

**Context.** `/shelves/{shelf}/feedback` is live today as an under-construction page,
deliberately outside the reader gate so a guest can reach it. Nothing writes to the
`feedback` table and nothing reads it. The reference restricts both handling commands to
`super_admin` and OPS §4.4 flags this as unresolved in its own words: "Whether a shelf's own
`manager`/`admin` should see (and resolve) feedback addressed to *their* shelf specifically
is not resolved by either document — this catalogue follows the built UI."

**Recommendation: keep it super-admin, and let feedback move whole to Phase 3** (the cut
argued in Context above).

**What each answer costs, concretely.**

- **Super-admin (recommended).** `/shelves/{shelf}/feedback` and `/contact` stay
  under construction for one more phase. Phase 3 then ships the whole thing at once:

  > `/admin/feedback` — **Hộp thư góp ý**
  > `[Chưa đọc 3] [Đã đọc] [Đã xử lý]`
  > **Chị Hạnh** · Tủ sách Đồng Tháp · *Giờ mở cửa* · 20/08 · **Chưa đọc**
  > **Ẩn danh** · Toàn hệ thống · *Xin thêm sách thiếu nhi* · 18/08 · Đã đọc

  Cost: a parish's guest form stays dark until Phase 3.

- **Shelf managers too.** Then the *shelf-scoped half* comes back into 2b as roughly two
  extra tasks — `SubmitFeedback` plus a manager inbox at `/manage/feedback` reading
  `$shelf->feedback()` — and the row a manager would see is:

  > `/manage/feedback` — **Góp ý của tủ sách**
  > **Chị Hạnh** · *Giờ mở cửa* · 20/08 · **Chưa đọc** · [Đánh dấu đã đọc] [Đã xử lý]

  Cost: site-wide messages (`bookshelf_id IS NULL`, the `/contact` form) still cannot ship,
  because they still need the global audit row Phase 3 builds — so feedback would ship
  **half**, which is the shape reason 4 of the cut argues against. It also widens a
  permission the reference deliberately narrowed, and widening later is one predicate where
  narrowing later is a removed screen.

**Timing matters as much as the answer, and it changes what the answer means.** "Shelf
managers too" does not merely add two tasks: arriving **mid-flight** it reopens the cut's
fourth ground, because the site-wide half still cannot ship without Phase 3's global audit
row — so feedback would go out **half**, which is the shape the cut exists to refuse. So:
an answer arriving **before Task 1 starts** can widen 2b; an answer arriving **after** is a
Phase-3 decision either way, and is recorded as one rather than reopening a branch in
progress.

**Answerable in a sentence:** *"Shelf managers should / should not read their own shelf's
feedback."*

### OQ2 — Does a reader see their own comment while it is waiting for approval?

**Context.** On a moderating shelf (the default — `comments_require_approval` defaults to
**true**, and BR §5.5 chose that direction deliberately), a comment starts `pending`. The
reference's reader-facing query returns approved comments only, and its docblock is explicit
that this includes the author's own: "A `pending`, `rejected` or `hidden` comment is absent
for everyone here, **including its own author**. That is the requirement as written; if a
reader should see their own comment awaiting moderation, that is a product decision and a
different query, not a loosened predicate on this one."

So today's ported behaviour is: a child types a comment, presses **Gửi**, and the page
comes back with their words nowhere on it.

**Recommendation: ship parity — invisible — but with a success flash that says why**, so
the disappearance is explained rather than silent:

> *Đã gửi. Bình luận của bạn sẽ hiển thị sau khi được duyệt.*

**What each answer costs, concretely.** Take Têrêsa's comment on *Dế Mèn Phiêu Lưu Ký*,
posted at 14:05 and not yet moderated:

| | Recommended (parity + flash) | The alternative (own pending shown) |
|---|---|---|
| What Têrêsa sees | the flash above; the comment list unchanged | her comment, in place, marked **Đang chờ duyệt** |
| What anyone else sees | nothing | nothing |
| INV-9's test | one query, one predicate: `status = approved` | the invariant must now distinguish "publicly visible" from "visible to its author", and `Inv09CommentVisibilityTest` grows an author-viewer case for every exclusion it already makes |
| Cost | a child who does not read the flash re-posts; nothing dedupes comments, so the shelf gets two | a second predicate on the one query the invariant lives in — and the reference's own warning is that a test which filters in the caller "would pass against a query with no `status` predicate at all" |

**Answerable in a sentence:** *"A reader should / should not see their own comment while it
waits."*

---

## Ported readings — settled by the reference or an earlier phase, listed so nobody relitigates them silently

1. **Moderation is the default.** `comments_require_approval` defaults to **true**: a shelf
   that has never opened its settings screen moderates. Turning it off is a deliberate act,
   and OPS §4.4 makes it the only way a comment starts life `approved`.
2. **A shelf may moderate comments, or decline to take them at all**, and the two settings
   are distinct. `comments_enabled` false is a sentence about the shelf's choice, not about
   anything the reader did wrong.
3. **INV-9 lives in the access path, never in a caller's filter.** The named test asserts the
   exclusion *through* the reader query, because a test that read every row and filtered in
   PHP would pass against a query with no status predicate at all — which is precisely the
   defect INV-9 exists to prevent.
4. **A comment body is returned raw and rendered escaped.** React escapes by default; a query
   that stripped tags would silently rewrite what a child wrote. The invariant suite pins
   this with a `<script>` body that round-trips as literal text.
5. **The comment body is NOT in the audit payload.** BR §14 asks the log to record what
   changed rather than duplicate it, and a second copy is a second thing to redact if a child
   ever asks for theirs to be removed. The row itself survives and holds the words.
6. **Rejection requires a reason; hiding does not.** OPS §4.4 draws the distinction: a
   rejection is a message to an author who is waiting to hear, while hiding removes something
   already published, possibly months later, with nobody to tell.
7. **A rejected or hidden comment is read-only.** Neither status has a command that moves it
   anywhere else, so the screens that list them render no action.
8. **Expiry is never written by a job.** An announcement lapses the instant `expires_at`
   passes, with nothing having run, and comes back if a manager republishes it with a fresh
   expiry — BR §8's derived-state rule, the same shape holds and overdue loans already follow.
9. **`published_at IS NULL` means draft**, which is why publishing is its own command with its
   own audit action and its own refusal rather than an update that happens to set a column.
   Hiding an announcement clears `published_at`, which is what "not public" *means* for this
   table — there is no separate flag — and it is also what makes *Đăng lại* work afterwards.
10. **Each announcement command names its own audit action as a literal.** A factory that
    assembled the name from a parameter would be invisible to `AuditActionCensusTest`'s
    literal-only regex, and that census's second test fails the build on a computed name. The
    reference records the same guard for the same reason.
11. **Receiving a donation writes no book and no copy.** BR §7.7 and OPS §4.4 both say so: a
    bag of books is not a catalogue entry, and only a person holding them knows what they are.
    The manager separately runs the add-book form with **Người tặng** pre-filled — which is
    the handoff Task 19 wires, and the only link between the two tables is the donor's
    membership id carried by hand. The named test asserts no `books` and no `book_copies` row
    appears, so the convenience fails rather than shipping.
12. **The donation table is the offer, never a copy's provenance.** Provenance lives on
    `book_copies.acquired_from` / `acquired_from_membership_id`, written by a different
    command, and survives the offer being tidied away. There is no foreign key between them
    because a bag of ten books can become three copies, or none.
13. **Managers get no notifications, structurally.** BR §15 gives the reason. The census is
    the guard, not a behavioural spot-check.

---

## File Structure

```
app/Support/Community/
  CommentSettings.php        comments_enabled / comments_require_approval, off the shelf row
app/Actions/Community/
  CreateComment.php          reader posts; pending or approved by the shelf's setting
  ApproveComment.php         pending -> approved; the phase's one notification writer
  RejectComment.php          pending -> rejected, reason REQUIRED
  HideComment.php            approved -> hidden, reason optional
  CreateAnnouncement.php     draft or published, slug unique within the shelf
  UpdateAnnouncement.php     present fields validated, absent fields untouched
  PublishAnnouncement.php    draft -> published, and "Dang lai" for a lapsed one
  HideAnnouncement.php       published -> draft (published_at cleared)
  PinAnnouncement.php        is_pinned true
  UnpinAnnouncement.php      is_pinned false
  OfferDonation.php          reader offers; donor_membership_id is a memberships(id)
  ReceiveDonation.php        pending -> received; writes NO book and NO copy
  DeclineDonation.php        pending -> declined, reason required, one statement
app/Policies/
  CommentPolicy.php  AnnouncementPolicy.php  BookDonationPolicy.php
app/Queries/
  BookCommentsQuery.php          INV-9's home: approved only, newest first
  CommentModerationQuery.php     the queue, the decided lists, the four counts
  AnnouncementsQuery.php         reader list + detail + manager list, one bound instant
  DonationQueueQuery.php         pending offers, oldest first, donor name and membership id
  MyDonationsQuery.php           a reader's own offers, scoped by MEMBERSHIP id
  ManagerDashboardQuery.php      (modified: + counts.pendingComments, delegated)
  BookDetailQuery.php            (modified: + comments for the book page)
app/Http/Requests/Community/
  StoreCommentRequest.php  RejectCommentRequest.php  HideCommentRequest.php
  StoreAnnouncementRequest.php  UpdateAnnouncementRequest.php  PublishAnnouncementRequest.php
  OfferDonationRequest.php  DeclineDonationRequest.php
app/Http/Controllers/Manage/
  CommentModerationController.php   index / approve / reject / hide
  AnnouncementController.php        index / create / store / edit / update / publish / hide / pin / unpin
  DonationController.php            index / receive / decline
app/Http/Controllers/Reader/
  CommentController.php        store (from the book page)
  AnnouncementController.php   index / show (by slug)
  DonationController.php       create / store / index (own offers)
app/Providers/AppServiceProvider.php   (+ Gate::policy for the three new policies)
lang/vi/validation.php      (+ attributes for every new field, or a message reads "body")
app/Models/
  Bookshelf.php      (+ comments(), announcements(), donations() relations for scoped bindings)
  Comment.php        (+ book(), author() relations)
  Announcement.php   (+ author() relation)
  BookDonation.php   (+ donor() relation onto Membership)
app/Support/Audit/AuditSentences.php   (+ the community group, + thirteen actions and arms)
app/Support/Notifications/
  NotificationKind.php        (+ CommentApproved)
  NotificationSentences.php   (+ its arm)
routes/web.php              (the community routes; under-construction rows replaced)
lang/vi/rules.php           (+ the refusal sentences and the flash lines)
lang/vi/audit.php           (+ the community phrases and the group label)
lang/vi/notifications.php   (+ comment_approved)
resources/js/pages/shelves/book.tsx             (modified: the comments panel and its form)
resources/js/pages/shelves/announcements/{index,show}.tsx
resources/js/pages/shelves/donate.tsx
resources/js/pages/shelves/profile/donations.tsx
resources/js/pages/manage/comments.tsx
resources/js/pages/manage/announcements/{index,form}.tsx
resources/js/pages/manage/donations.tsx
resources/js/pages/manage/dashboard.tsx         (modified: the fourth stat card)
resources/js/pages/manage/audit.tsx             (modified: the fourth group chip)
resources/js/layouts/manage-layout.tsx          (modified: a nav item per new manager screen)
resources/js/lib/copy.ts                        (extended)
database/seeders/DemoShelfSeeder.php            (extended: a living comment queue and a notice)
docs/OPERATIONS.md                              (Task 20's §4.4 walk, if it finds a lag)
tests/Feature/Architecture/CommunityArchitectureTest.php   NEW
tests/Feature/Architecture/CirculationArchitectureTest.php (modified: the walk takes a root)
tests/Feature/Invariants/Inv09CommentVisibilityTest.php    NEW
tests/Feature/Community/…   tests/Unit/Community/…   docs/known-gaps.md
```

---

## Slice A — comments and moderation (INV-9)

### Task 1: Comment groundwork — the shelf's two settings, the policy, the relations, the refusal sentences, and the shipped transaction walk widened by root

Read first: `old_next/src/domain/community/policy.ts` (whole file — both settings and both
defaults are specified there), `app/Support/Circulation/LendingSettings.php` (the shape
this mirrors), `app/Policies/BorrowRequestPolicy.php` (the shape the three new policies
mirror, including why the model parameter goes unread), and
`tests/Feature/Architecture/CirculationArchitectureTest.php`'s walk helper.

**Files:**
- Create: `app/Support/Community/CommentSettings.php`
- Create: `app/Policies/CommentPolicy.php`
- Create: `tests/Unit/Community/CommentSettingsTest.php`
- Modify: `app/Providers/AppServiceProvider.php` (+ `Gate::policy(Comment::class, …)`)
- Modify: `app/Models/Bookshelf.php` (+ `comments()`), `app/Models/Comment.php` (+ `book()`, `author()`)
- Modify: `lang/vi/rules.php` (the comment refusals and the two flash lines)
- Modify: `tests/Feature/Architecture/CirculationArchitectureTest.php` (the walk takes a root)
- Modify: `tests/Unit/Catalogue/RuleViolatedCodesHaveSentencesTest.php` (nothing yet — see step 4)

**Interfaces:**
- Produces: `CommentSettings::fromShelf(Bookshelf $shelf): self` with `bool $commentsEnabled`, `bool $commentsRequireApproval`, both defaulting **true**.
- Produces: `actionTransactionCalls(?string $root = null)` — the renamed circulation walk, defaulting to the directory it walks today.

- [ ] **Step 1: `CommentSettings`**

```php
<?php

namespace App\Support\Community;

use App\Models\Bookshelf;

/**
 * BR §5.5's two comment settings, read off the shelf row the tenant
 * middleware already loaded — the port of community/policy.ts's
 * commentsEnabled and commentsRequireApproval, and the same shape
 * App\Support\Circulation\LendingSettings uses for the lending numbers.
 * One module, not a coalesce in each command: two copies of "default to
 * true" is how one later stops matching the settings screen.
 *
 * BOTH DEFAULT TRUE, and the two directions mean different things.
 * A shelf that has never opened its settings screen stores {} and both
 * take comments AND moderates them — the safe direction, chosen by the
 * requirements: turning moderation off is a deliberate act by somebody
 * who has decided their parish does not need it, and it is the only way
 * a comment starts life approved (OPS §4.4).
 *
 * THE KEY IS comments_enabled, not BR §5.5's allow_comments (plan
 * divergence 2). Both the reference's reader (community/policy.ts) and
 * its writer (admin/commands/bookshelves.ts) spell it this way, and
 * `allow_comments` occurs in no source tree at all — only in that one
 * requirements table. Whoever builds /manage/settings writes this
 * spelling; docs/known-gaps.md records the lag.
 */
final readonly class CommentSettings
{
    public function __construct(
        public bool $commentsEnabled,
        public bool $commentsRequireApproval,
    ) {}

    public static function fromShelf(Bookshelf $shelf): self
    {
        $settings = (array) $shelf->settings;

        return new self(
            commentsEnabled: (bool) ($settings['comments_enabled'] ?? true),
            commentsRequireApproval: (bool) ($settings['comments_require_approval'] ?? true),
        );
    }
}
```

Its unit test (`tests/Unit/Community/CommentSettingsTest.php`, fixture helper `csgFix`
building an unsaved `Bookshelf` with a given settings array — no database, the
`LendingSettingsTest` precedent) asserts four things in four `it()` blocks, because each
must be able to fail alone: an empty blob gives true/true; `comments_enabled => false`
gives false and leaves moderation true; `comments_require_approval => false` gives true and
false; and a blob holding **only** one key leaves the other at its default (the case a
settings screen that writes one toggle at a time produces).

- [ ] **Step 2: the relations and the policy**

`Bookshelf` gains `comments(): HasMany<Comment, $this>` — the relation `scopeBindings()`
resolves `{comment}` through, exactly as `borrowRequests()` serves `{borrowRequest}`. Copy
that method's docblock discipline: state that the tenancy guarantee has **two** independent
layers (this relation's own FK filter and `BookshelfScope` on the model) and that this
task has **not** measured which of them is doing the work, rather than inheriting 2a's
measured claim about a different relation.

`Comment` gains `book(): BelongsTo<Book, $this>` and `author(): BelongsTo<User, $this>` —
`author_id` is a `users(id)`, and the method name says so. **`author()` must name its
foreign key explicitly — `belongsTo(User::class, 'author_id')`** — because Eloquent's
convention derives `user_id` from the method name and this column is not called that. A
silently wrong key here makes the reader's comment list render every author as blank.

`CommentPolicy` mirrors `BorrowRequestPolicy`: `create(User $user): bool` delegating to
`act-as-reader`, and `approve` / `reject` / `hide` each taking `(User $user, Comment
$comment)` and delegating to `act-as-manager`. **The `$comment` parameter is read by
nothing, and that is the rule rather than an oversight** — the moment a body reads the row,
a denial becomes an existence oracle. What the row IS gets decided by the Actions; what it
BELONGS to gets decided by the binding. Register it in `AppServiceProvider::boot()` beside
the five existing `Gate::policy` calls; `PolicyRegistrationTest` derives its census from
`app/Policies` and from the provider's source, so it covers the new policy the day it lands
and needs no edit.

- [ ] **Step 3: the shipped guard is widened by root — and the community guard is NOT created here**

**`tests/Feature/Architecture/CommunityArchitectureTest.php` is created by TASK 2, not by
this task, and this paragraph is the correction that makes the phase's first commit green.**
The plan's first draft created it here and claimed its non-vacuity block "passes vacuously
until Task 2 lands the first Action". The independent review **measured that and it is false
in both directions**, and this paragraph's own first correction then got the number wrong,
so both are now measured and written down:

- **`app/Actions/Community/` does not exist at this commit** — git tracks no empty directory,
  so `mkdir` does not rescue it either. Three of the four blocks construct a
  `RecursiveDirectoryIterator` over that path and each throws
  `UnexpectedValueException: RecursiveDirectoryIterator::__construct(/app/app/Actions/Community): Failed to open directory: No such file or directory`;
  the fourth fails on `expect($files)->not->toBe([])` after an empty `glob()`. **Measured:
  `4 failed`** — not the "3 failed" the first correction stated, which counted the throws and
  forgot the `glob()` block.
- The non-vacuity block failing on its own derivation (`Expecting [] not to be empty`) is
  that block **working correctly**, which is the reason not to soften it.

**Do not add an `is_dir()` guard**: a block that passes on absence is precisely what these
guards exist to refuse. So the whole file moves into the commit that lands the first Action,
where every one of its four blocks has something real to walk — measured there as `4 passed`
(7 assertions).

What this task does do is widen the shipped guard. In `CirculationArchitectureTest.php`, rename `circulationTransactionCalls()` to
`actionTransactionCalls(?string $root = null)` and open its body with
`$root ??= app_path('Actions/Circulation');`, replacing the hardcoded path in the
`RecursiveDirectoryIterator` line **inside the helper — and ONLY that one.** The file
contains **two** `RecursiveDirectoryIterator(app_path('Actions/Circulation'), …)` sites: the
helper's, and a second inside the no-wall-clock `it()` block near the end, which keeps its
literal. A blind find-and-replace hits both, and `$root` is undefined inside that closure —
found by doing exactly that while measuring this task, so it is written down rather than left
for the implementer. **A default parameter value cannot be a function call in
PHP**, which is why the default is applied in the body rather than in the signature. Update
the two existing `it()` blocks to call it with no argument — their behaviour is unchanged
because the default is the path they walked. Add one sentence to the helper's docblock
recording that it is now root-parameterised and who else calls it, and change the second
`it()`'s title only if it names the directory (read it before editing).

The specification for `CommunityArchitectureTest`'s four blocks lives in **Task 2, Step 4**,
where the file is written. Do not write it here.

- [ ] **Step 4: the sentences**

`lang/vi/rules.php` gains, in a new `── Community (Phase 2b) ──` block, the reference's
`ERROR_MESSAGES` verbatim for the codes this slice throws:

```
'comments_disabled' => 'Tủ sách hiện không nhận bình luận.',
'empty_body' => 'Vui lòng nhập nội dung bình luận.',
'comment_not_pending' => 'Bình luận này đã được xử lý.',
'comment_not_approved' => 'Chỉ có thể ẩn bình luận đang hiển thị.',
```

plus two flash lines (the `lend_success_flash` precedent — UI copy kept beside the refusals
so server copy stays in `lang/vi/`, and inert to the code census, which walks
`new RuleViolated(...)` literals only):

```
'comment_pending_flash' => 'Đã gửi. Bình luận của bạn sẽ hiển thị sau khi được duyệt.',
'comment_published_flash' => 'Đã gửi bình luận.',
```

Two flashes, not one, because the shelf's own setting decides which is true, and a single
"đã gửi" line on a moderating shelf is exactly the silence open question 2 is about.
`reject_reason_required` already exists (1b minted it) and is reused rather than
re-spelled — OPS §4.4 gives `RejectComment` that same sentence, so this is one code with
one sentence, not a fifth split.

**`RuleViolatedCodesHaveSentencesTest`'s list is NOT edited in this task**: nothing throws
these codes yet, and the census walks throwers, not sentences. Tasks 2–4 add their codes to
that list in the commits that first throw them. Note this explicitly in the commit message
so a reviewer does not read the omission as a miss.

- [ ] **Step 5: run, mutation-check, commit**

Run: `make test FILTER=CommentSettingsTest && make test FILTER=CirculationArchitectureTest && make test FILTER=PolicyRegistrationTest` — PASS. `CommunityArchitectureTest` does not exist at this commit and must not (see Step 3).

Mutation checks, each restored afterwards with `git status --porcelain` clean:
1. Change `CommentSettings`' `comments_enabled` default to `false` → the empty-blob block
   reddens and the two single-key blocks stay green. **If more than one block reddens, the
   fixtures are not independent and the test is wrong, not the mutation.**
2. Spell the key `allow_comments` in `fromShelf` → the `comments_enabled => false` block
   reddens (the setting stops being read) while the empty-blob block stays green — which is
   the measurement that divergence 2 is load-bearing rather than cosmetic.
3. Delete the `?? true` from `commentsRequireApproval` → PHP raises on the missing key under
   the empty blob; the block reddens. (Restore; the point is that the default is not
   supplied by the caller.)
4. **The rename's extent, pinned by identity rather than by a mutation.** The plan's first
   draft said "point the default at `app_path('Actions/Members')` → the non-vacuity block
   reddens". The review measured it: the **retry** block reddens, not the non-vacuity one,
   which stays green because every file under `Actions/Members` contains a literal
   `DB::transaction(` — and worse, `Actions/Catalogue` would redden identically, so the
   mutation only proves the default is *read*, never that it points anywhere in particular.
   Since this task **edits a shipped guard** rather than satisfying it, the proof has to pin
   the walk's extent directly: add a block asserting that the no-argument call and an
   explicit `actionTransactionCalls(app_path('Actions/Circulation'))` return **identical
   call-site keys** — `expect(array_keys($a))->toEqualCanonicalizing(array_keys($b))`. That
   is falsified by any default that is not that directory, including a sibling one.

```bash
make lint && make analyse
git add app/Support/Community app/Policies app/Models app/Providers lang/vi tests/
git commit -m "feat: comment settings, policy, and the transaction walk widened by root"
```

---

### Task 2: `CreateComment` — a reader says something about a book

Read first: `old_next/src/domain/community/commands/comment-moderation.ts`'s file docblock
and `createComment` (whole), and `comments.test.ts` tests 1–5. The docblock's note that
`comments.author_id` is a `users(id)` — "the usual direction in this schema, and the
opposite of `book_donations`' `donor_membership_id` two tables along" — is the trap this
phase carries end to end.

**Files:**
- Create: `app/Actions/Community/CreateComment.php`
- Create: `app/Http/Requests/Community/StoreCommentRequest.php`
- Create: `app/Http/Controllers/Reader/CommentController.php`
- Create: `tests/Feature/Community/CreateCommentTest.php`
- Create: `tests/Feature/Architecture/CommunityArchitectureTest.php` (moved here from Task 1 — see Step 4)
- Modify: `routes/web.php` (the reader's comment POST)
- Modify: `app/Support/Audit/AuditSentences.php` (+ the `community` group, + `comment.created`)
- Modify: `lang/vi/audit.php` (+ `comment_created`, + the group label)
- Modify: `resources/js/pages/manage/audit.tsx`, `resources/js/lib/copy.ts` (the fourth chip)
- Modify: `tests/Unit/Audit/AuditSentencesTest.php` (the group list and the count)
- Modify: `tests/Unit/Catalogue/RuleViolatedCodesHaveSentencesTest.php` (+ this task's codes)

**Interfaces:**
- Produces: `CreateComment::execute(User $actor, Book $book, string $body): array{commentId: string, status: CommentStatus}` — throws `not_permitted`, `comments_disabled`, `empty_body`, `shelf_not_found`; audit `comment.created`; no notification (a manager is not told, BR §15). **The `status` key is in the signature deliberately**, and Step 3's code block returns it — the controller picks between two flash sentences and must take that fact from the Action's own result rather than re-reading the shelf setting, because two readings of one setting is how a screen and a command start disagreeing.
- Produces: `wallClockOffenders(string $root): array` — the community half of the no-wall-clock grep (Step 4).

- [ ] **Step 1: Write the failing tests**

`tests/Feature/Community/CreateCommentTest.php`, fixture `cmcFix(array $settings = [], string $slug = 'dong-thap-cmc')` returning `[Bookshelf, User $reader, Book]` — a shelf with the given settings blob, an active reader membership, a published book, `TenantContext::set()` and `actingAs($reader)`, on the `rjbFix` shape. Blocks:

1. **a moderating shelf files the comment as pending** — the default blob `[]`; assert
   `status`, `author_id === $reader->id` (a users id), `body`, `moderated_by` null.
2. **a shelf that does not moderate publishes immediately** — `['comments_require_approval'
   => false]`; status `approved`, and still `moderated_by` null, because nobody looked at it.
3. **a shelf that has turned comments off refuses** —
   `['comments_enabled' => false]`, `toThrow(RuleViolated::class, 'comments_disabled')`, and
   `Comment::query()->count()` is 0.
4. **an empty body is refused, whitespace included** — `"   "`, `empty_body`, zero rows.
5. **INV-8: `comment.created` records the status and the book, and not the body** — the
   audit row's `after` bag matches `['status' => 'pending', 'book_id' => $book->id]`, and
   the body is absent **key-by-key**: `expect(array_key_exists('body', $after))->toBeFalse()`
   — never `not->toHaveKey`, which passes unconditionally. Assert the rendered sentence
   through `AuditLogQuery` too, so the new group's phrase is reachable and not merely
   present.
6. **the memberless super admin is refused, over HTTP** — a `is_super_admin` user with **no
   membership** of this shelf POSTs the comment. `Gate::before` grants every `act-as-*`
   ability to a super admin, and `ResolveTenant` resolves only active memberships, so this
   caller passes the middleware and the policy with a null membership and must meet
   `not_permitted`. Its own `it()` block (the `SessionGuard` rule), asserting the Vietnamese
   sentence off the redirect's error bag and that no row was written. **This is divergence
   4's pin and 2a proved the path real; do not weaken it to a unit call.**

- [ ] **Step 2: Run to verify failure** — `make test FILTER=CreateCommentTest`. Expected: FAIL.

- [ ] **Step 3: Implement**

```php
<?php

namespace App\Actions\Community;

use App\Enums\CommentStatus;
use App\Exceptions\RuleViolated;
use App\Models\Book;
use App\Models\Comment;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Community\CommentSettings;
use App\Support\ConcurrencyRetry;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A reader comments on a book — OPS §4.4's CreateComment, and INV-9's
 * entry point. Port of comment-moderation.ts's createComment.
 *
 * comments.author_id is a users(id), the usual direction in this schema
 * and the OPPOSITE of book_donations.donor_membership_id two tables
 * along, which this phase also writes. The parameter is a User for that
 * reason: a membership id here would insert a row referencing nothing
 * and no FK would stop it, because author_id points at users.
 *
 * The caller's membership is not an input (plan divergence 4): the
 * session already resolved one for the bound shelf. not_permitted is
 * still reachable and is not defence against nothing — Gate::before
 * grants every act-as-* ability to a super admin, so a super admin with
 * no membership of this shelf passes the policy with a null membership
 * and lands here. It fails closed and CreateCommentTest posts that
 * exact case over HTTP.
 *
 * WHICH STATUS a comment starts in is the SHELF's decision, not this
 * command's: moderation is the default, and OPS §4.4 makes turning it
 * off the only way a comment starts approved. INV-9 is untouched either
 * way — it says approved comments are the visible ones, not that a
 * manager must have looked at them.
 *
 * The BODY IS NOT IN THE AUDIT PAYLOAD. It is the reader's own words on
 * a row that survives, and BR §14 asks the log to record what changed
 * rather than to duplicate it — a second copy is a second thing to
 * redact if a child ever asks for theirs to be removed.
 *
 * No lock: this command re-reads nothing and guards no uniqueness rule.
 * The transaction is here so the row and its audit entry commit
 * together, and it retries because every write transaction in this phase
 * does (plan divergence 1).
 */
final class CreateComment
{
    public function __construct(
        private TenantContext $tenant,
        private AuditRecorder $audit,
    ) {}

    /** @return array{commentId: string, status: CommentStatus} */
    public function execute(User $actor, Book $book, string $body): array
    {
        Gate::forUser($actor)->authorize('create', Comment::class);

        $membership = $this->tenant->membership();
        if ($membership === null || $membership->user_id !== $actor->id) {
            throw new RuleViolated('not_permitted');
        }

        $shelf = $this->tenant->bookshelf();
        if ($shelf === null) {
            throw new RuleViolated('shelf_not_found');
        }

        $settings = CommentSettings::fromShelf($shelf);
        if (! $settings->commentsEnabled) {
            throw new RuleViolated('comments_disabled');
        }

        // Trimmed, so a body of three spaces is the same as none. The
        // column is NOT NULL and would take the whitespace happily.
        $trimmed = trim($body);
        if ($trimmed === '') {
            throw new RuleViolated('empty_body');
        }

        $status = $settings->commentsRequireApproval
            ? CommentStatus::Pending
            : CommentStatus::Approved;

        return DB::transaction(function () use ($actor, $book, $trimmed, $status): array {
            $comment = Comment::query()->create([
                'book_id' => $book->id,
                'author_id' => $actor->id,
                'body' => $trimmed,
                'status' => $status,
            ]);

            $this->audit->record('comment.created', 'comment', $comment->id, null, [
                'status' => $status->value,
                'book_id' => $book->id,
            ]);

            // status is returned, not re-derived by the controller: it
            // picks between two flash sentences and a second reading of
            // the shelf setting is how a screen and a command start
            // disagreeing about one shelf.
            return ['commentId' => $comment->id, 'status' => $status];
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
```

`bookshelf_id` is absent from the `create()` array on purpose: `BelongsToBookshelf`'s
creating hook stamps it from the bound tenant, and naming it would be the hand-written
scope this project bans.

- [ ] **Step 4: the community architecture guard, the audit group, the sentence, the route, the surface**

**Create `tests/Feature/Architecture/CommunityArchitectureTest.php` HERE** — moved out of
Task 1, where the review measured its three directory-walking blocks failing on a directory
that does not exist yet. In this commit `app/Actions/Community/CreateComment.php` exists, so
every block has something real to walk and none of them can pass on absence. Four `it()`
blocks:

1. **the retry rule** — `[, $offenders] = actionTransactionCalls(app_path('Actions/Community'));`
   then `expect($offenders)->toEqual([]);`
2. **the guard is not vacuous** — the same derivation the circulation file uses, and it has
   teeth from this commit: every file whose comment-stripped source contains the literal
   `DB::transaction(` must appear in the walk's own tally, and the tally must not be empty.
   Step 5's mutation 1 is where both blocks are shown to discriminate.
3. **no Action under `app/Actions/Community` reads the wall clock** — a fresh helper,
   `wallClockOffenders(string $root): array`, running the same regex the circulation grep
   uses, called here with the community root. **Two copies of a four-token regex is the
   deliberate choice**: the alternative is editing a shipped guard to share a helper, and
   the duplication is disclosed here and in `docs/known-gaps.md` rather than left to be
   discovered. The title names the directory it actually walks — a test whose name
   overclaims its body is how a rule gets believed without being enforced.
4. **no Action under `app/Actions/Community` skips the audit recorder** — the
   `CatalogueArchitectureTest` tripwire, ported by shape rather than by copy: each file must
   constructor-inject an `AuditRecorder` **and** call `->record(` on whatever the constructor
   named the property, so an Action pasted without audit fails the build rather than quietly
   shipping unaudited. There is no allow-list; every command in this directory audits.

**Tasks 14 and 19** each add one further block to this file — the announcement and donation
route-order assertions. Task 9 adds none (it ships no route), and the previous revision said
it did; nothing else edits this file.


`AuditSentences::ACTIONS` gains `'comment.created' => 'community',` and `GROUPS` gains
`'community'` — the reference files every community action under its own group
(`audit-actions.ts`'s `cong-dong`), and folding comments into `books` would put shelf news
there next task with no home at all. `lang/vi/audit.php` gains
`'comment_created' => 'viết một bình luận',` — the reference's phrase **verbatim**
(`audit-actions.ts`'s `comment.created`), which names neither the title nor the author. That
is deliberate there and stays deliberate here: the payload holds `book_id` and no title, and
the alternative is widening the payload to make a sentence prettier. The match arm therefore
takes no `strtr` at all, the `copy_lost_reported` shape. **Read `AuditSentences::phrase`
before writing it and reuse the house helpers; do not mint a second spelling of `which()`.**

`AuditSentencesTest`: add `'community'` to the partition test's hardcoded group list, and
bump `toHaveCount(27)` to **28**. That count is the pin that makes an added action a
deliberate edit; every task in this phase that adds actions bumps it, ending at **40**.
**Two different blocks in that file carry the staleness and both are edited here, because
naming "that block" was ambiguous in the previous revision:** the numeral lives in the
**`groupOf`** block's `it()` title ("…answers the family for the 27 actions and null for a
stranger") while `toHaveCount(27)` lives in the **`actionsInGroup` partition** block's body.
Drop the numeral from the title outright — the property is what the block tests — and bump
the count in the assertion; eight tasks in this plan bump the latter, and none of them would
have touched the former. This project already carries a standing correction for
exactly that class of staleness ("drop the number and state the property"); a title naming a
count nobody re-derives is the same defect one line higher.

**One mechanism worth knowing before adding any audit arm, and it is the opposite of the
notification one:** `AuditSentences::phrase()` ends in `default => self::line('unknown')`,
so a missing match arm is **not** a build error the way a missing `NotificationSentences`
arm is — it renders the undescribed-action fallback to a volunteer. What catches it is
`AuditActionCensusTest`'s two-directional set-equality, not Larastan. Every task in this
phase adds arms to both files; only one of the two fails at compile time.

`resources/js/pages/manage/audit.tsx`: widen the row's `group` union with `"community"`,
add it to `GROUP_KEYS`, and add `copy.manageAudit.groups.community = "Cộng đồng"` —
the reference's own label, and the ordinary word a volunteer uses.

Route, inside the existing `['auth', 'role:reader']` group so the 404 for a non-member is
`EnsureShelfRole`'s:

```php
Route::post('/books/{book}/comments', [CommentController::class, 'store'])->name('books.comments.store');
```

`StoreCommentRequest`: `authorize()` is `abort_unless(Gate::allows('act-as-reader'), 404);`
and the rule is `'body' => ['bail', 'required', 'string', 'max:2000', 'encoding:UTF-8']` —
free text leads with `bail` and carries the encoding rule, which
`FreeTextEncodingGuardTest` sweeps for. Add `body` to `lang/vi/validation.php`'s
`attributes` array, or the field renders as "body" inside an otherwise-Vietnamese message.

The controller redirects back to the book page with the flash the shelf's own setting
chooses — `comment_pending_flash` when the created comment is `pending`,
`comment_published_flash` when it is `approved` — taken from the **`status` key Step 3's
Action already returns**, never by re-reading the setting in the controller.

- [ ] **Step 5: Run, mutation-check, commit**

Run: `make test FILTER=CreateCommentTest && make test FILTER=AuditActionCensusTest && make test FILTER=AuditSentencesTest && make test FILTER=CommunityArchitectureTest && make test FILTER=FreeTextEncodingGuardTest` — PASS.

Mutation checks:
1. Drop `ConcurrencyRetry::ATTEMPTS` from the transaction → `CommunityArchitectureTest`'s
   retry block reddens, **and its non-vacuity block stays green** (this file is in the tally,
   which is what the non-vacuity block asserts). This is the commit the guard is born in and
   the first at which it can discriminate at all — which is why it is born here and not in
   Task 1. Record both numbers.
1b. **`rm -r app/Actions/Community` — the directory, not just the file** — and run
   `CommunityArchitectureTest` → **`4 failed`**: three `UnexpectedValueException:
   RecursiveDirectoryIterator::__construct(…/Actions/Community): Failed to open directory`
   plus the audit-recorder block's `expect($files)->not->toBe([])` after an empty `glob()`.
   Restore with `git checkout`.
   **Deleting only the FILE is a different measurement and the first correction conflated
   them.** With the directory left in place the walk opens fine and there is no iterator
   error anywhere: **`2 failed, 2 passed`** — blocks 1 and 3 pass on an empty directory
   (nothing to offend), and only the non-vacuity block and the `glob()` block discriminate.
   Both numbers were measured; the directory-removal one is Task 1's real state and is the
   reason this file is not created there. Perform it once so nobody later "fixes" the guard
   with an `is_dir()` check: a block that passes on absence is what these guards exist to
   refuse — and the file-only run is the demonstration that two of the four blocks already
   do exactly that when the directory is empty.
2. Delete the `comments_disabled` branch → block 3 reddens and nothing else does.
3. Add `'body' => $trimmed` to the audit `after` bag → block 5's `array_key_exists`
   assertion reddens. If it does not, the assertion was written with a form that passes
   unconditionally — fix the test, not the mutation.
4. Remove `role:reader` from the route → the non-member's 404 becomes a **403**, which is
   the anti-enumeration rule measured rather than assumed. Restore.

```bash
make lint && make analyse
git add app/Actions/Community app/Http app/Support/Audit lang/vi resources/js routes tests/
git commit -m "feat: createcomment — a reader speaks, and the shelf decides whether it shows"
```

---

### Task 3: `ApproveComment` — the one status that makes a comment public, and the phase's one notification

Read first: `comment-moderation.ts`'s `pendingComment` helper and `approveComment`, and
`comments.test.ts` tests 6 and 11. Then read
`tests/Feature/Architecture/NotificationsAreReaderFacingTest.php` **whole** — this task
lands the kind that file has been reserving since 2a, and its four blocks are the
acceptance criteria for the notification half.

**Files:**
- Create: `app/Actions/Community/ApproveComment.php`, `tests/Feature/Community/ApproveCommentTest.php`
- Modify: `app/Support/Notifications/NotificationKind.php` (+ `CommentApproved`), `NotificationSentences.php` (+ its arm), `lang/vi/notifications.php`
- Modify: `tests/Feature/Architecture/NotificationsAreReaderFacingTest.php` (+ the census row)
- Modify: `app/Support/Audit/AuditSentences.php`, `lang/vi/audit.php`, `tests/Unit/Audit/AuditSentencesTest.php` (count → 29)
- Modify: `tests/Unit/Notifications/NotificationSentencesTest.php`, `tests/Unit/Catalogue/RuleViolatedCodesHaveSentencesTest.php`

**Interfaces:**
- Produces: `ApproveComment::execute(User $actor, Comment $comment): array{commentId: string}` — throws `comment_not_pending`; audit `comment.approved`; notification `comment_approved` to the **author**, never the manager.

- [ ] **Step 1: Write the failing tests**

`ApproveCommentTest`, fixture `cmaFix(string $status = 'pending', string $slug = 'dong-thap-cma')` returning `[Bookshelf, User $manager, User $author, Comment]`, seeding a manager membership, a reader membership, a book and a comment in the given status, then `TenantContext::set()` and `actingAs($manager)`. Blocks:

1. **approving publishes it and records who looked** — status `approved`, `moderated_by`
   the manager's users id, `moderated_at` non-null, `moderation_note` null.
2. **approving notifies the AUTHOR, and nobody else** — exactly one `Notification` row, its
   `user_id` the author's, its `kind` `comment_approved`, and its payload empty
   **key-by-key** (divergence 10 — the reference sends no payload, so a title appearing here
   would be a silent product change). Assert the manager has none: seed nothing to make that
   true, just count rows for the manager's id, which is the exclusion this block exists for.
3. **a comment already decided cannot be approved again** — fixture status `approved`,
   `toThrow(RuleViolated::class, 'comment_not_pending')`, and zero notifications. Its own
   `it()`, because the throw would abort the method before a second fact could be shown.
4. **the comment lock is the transaction's first statement** — the `RejectBorrowRequest`
   query-log shape: `DB::flushQueryLog()`, enable, execute, and assert the first logged
   query names `comments` and contains `for update`.
5. **INV-8 and the rendered sentence** — the audit row's `before`/`after` carry the two
   statuses, and `AuditLogQuery` renders the reference's phrase for it.
6. **the notification is written INSIDE the transaction** — not a new assertion, a pointer:
   `NotificationsAreReaderFacingTest`'s fourth block covers this file automatically the
   moment the census row names it. Step 5's mutation 3 is the proof, and this block is
   therefore deliberately **not** written here. Say so in a comment, so a later reader does
   not conclude the guarantee is untested.

- [ ] **Step 2: Run to verify failure** — `make test FILTER=ApproveCommentTest`. FAIL.

- [ ] **Step 3: Implement**

```php
<?php

namespace App\Actions\Community;

use App\Enums\CommentStatus;
use App\Exceptions\RuleViolated;
use App\Models\Comment;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use App\Support\ConcurrencyRetry;
use App\Support\Notifications\NotificationKind;
use App\Support\Notifications\Notifier;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A manager publishes a comment — BR §7.6's pending -> approved, and the
 * ONLY transition that makes one publicly visible (INV-9). Port of
 * comment-moderation.ts's approveComment.
 *
 * INV-9 itself is not enforced here and must not be. "A comment is
 * publicly visible only when approved" lives in BookCommentsQuery's
 * status predicate; this command CHANGES the status, which is a
 * different thing from where the rule is kept. A moderation screen that
 * also filtered would be a second definition of visibility that a book
 * page could disagree with.
 *
 * The AUTHOR is told, never the manager who approved it — BR §15's rule
 * that managers get none, and OPS §7's table names this command as the
 * writer. comments.author_id is a users(id), which is what
 * Notifier::notify takes. The notification carries no payload, matching
 * the reference: a reader with two approved comments reads the same
 * sentence twice, and adding a title would be a product change rather
 * than a port (plan divergence 10).
 *
 * moderation_note is cleared rather than left, so an approval after a
 * rejected draft of the same row cannot leave a stale reason attached to
 * a published comment. The reference does the same and for the same
 * reason.
 *
 * One lock, the comment row, taken as the transaction's first statement.
 * A row that does not exist, or belongs to another shelf, never reaches
 * this command: the binding 404s it (plan divergence 3). "Already
 * decided" is a RuleViolated, which renders as a redirect carrying the
 * Vietnamese sentence and leaks nothing, because the binding already
 * established the row is this shelf's.
 */
final class ApproveComment
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
        private Notifier $notifier,
    ) {}

    /** @return array{commentId: string} */
    public function execute(User $actor, Comment $comment): array
    {
        Gate::forUser($actor)->authorize('approve', $comment);

        return DB::transaction(function () use ($actor, $comment): array {
            // FIRST statement — the only lock this command takes.
            $locked = Comment::query()->lockForUpdate()->findOrFail($comment->id);

            if ($locked->status !== CommentStatus::Pending) {
                throw new RuleViolated('comment_not_pending');
            }

            $locked->update([
                'status' => CommentStatus::Approved,
                'moderated_by' => $actor->id,
                'moderated_at' => $this->clock->now(),
                'moderation_note' => null,
            ]);

            $this->audit->record('comment.approved', 'comment', $locked->id,
                ['status' => 'pending'],
                ['status' => 'approved'],
            );

            $this->notifier->notify($locked->author_id, NotificationKind::CommentApproved);

            return ['commentId' => $locked->id];
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
```

- [ ] **Step 4: the kind, its sentence, its census row**

`NotificationKind` gains `case CommentApproved = 'comment_approved';`, and its class
docblock's line reserving the kind for 2b is **replaced** by nothing — delete the
reservation rather than leaving a promise that has been kept. `lang/vi/notifications.php`
gains `'comment_approved' => 'Bình luận của bạn đã được duyệt.',`.
`NotificationSentences`' match gains
`NotificationKind::CommentApproved => self::line('comment_approved'),` — no `strtr`, the
`MembershipApproved` shape, because the payload is empty. **The match is exhaustive and
Larastan level 8 turns a missing arm into a build error**, which is the mechanism, not the
test.

`NotificationSentencesTest` gains a block asserting the sentence renders from an empty
payload; its existing census (kinds ↔ non-underscored lang keys) covers the new key
automatically.

`NotificationsAreReaderFacingTest`'s `OPS_SECTION_7` gains
`'comment_approved' => ['app/Actions/Community/ApproveComment.php'],`, **hand-transcribed
from `docs/OPERATIONS.md` §7's own row in this commit** — the file's docblock requires that
and says why a wrong transcription is invisible to the test. Its docblock's "comment_approved
arrives in 2b with ApproveComment" sentence is updated to say it has arrived, and the
per-file floor derived from the table then requires this file to contribute a call site the
walk actually saw.

`AuditSentences::ACTIONS` gains `'comment.approved' => 'community',`; `lang/vi/audit.php`
gains `'comment_approved' => 'duyệt một bình luận',` (the reference's phrase verbatim);
`AuditSentencesTest`'s count goes to **29**. `comment_not_pending` joins
`RuleViolatedCodesHaveSentencesTest`'s list.

- [ ] **Step 5: Run, mutation-check, commit**

Run: `make test FILTER=ApproveCommentTest && make test FILTER=Notification && make test FILTER=AuditActionCensusTest && make test FILTER=AuditSentencesTest` — PASS.

Mutation checks:
1. Delete the `OPS_SECTION_7` row → the census's set-equality block reddens (a writer with
   no row), and its "the table covers every kind" block reddens too (a kind with no row).
   **Two blocks, and both must be seen** — run the file and read the count, do not stop at
   the first failure.
2. Delete the `notify` call → the census reddens the other way (a row with no writer) **and**
   block 2 of this task's own test reddens. Record both numbers.
3. **Move the `notify` call to after `DB::transaction(...)` returns.** This is the phase's
   headline guarantee and the only mutation that proves it:
   `NotificationsAreReaderFacingTest`'s fourth block must redden **naming this file and its
   line**, and nothing else in the suite may redden with it. 2a measured `1 failed, 1259
   passed` for the equivalent mutation on three files at once; record what this one gives.
4. Narrow the status guard to `!== CommentStatus::Rejected` → block 3 reddens (an
   `approved` row would be approved again) and block 1 stays green.

```bash
make lint && make analyse
git add app/Actions/Community app/Support lang/vi tests/
git commit -m "feat: approvecomment — the comment goes public and its author is told"
```

---

### Task 4: `RejectComment` and `HideComment` — the two negative decisions, and why only one of them needs a reason

Read first: `comment-moderation.ts`'s `rejectComment` and `hideComment` (both whole,
including `hideComment`'s docblock, which is the specification for the asymmetry), and
`comments.test.ts` tests 7–10 and 12.

Two Actions, one task: they are one state machine's two negative arrows over one table, they
share `pendingComment`'s shape, and the *difference* between them — a required reason versus
an optional one — is only reviewable with both in front of you. They are two **classes**,
not one, because this codebase's Actions are single-purpose and `AuditActionCensusTest`
requires each to name its own action as a literal.

**Files:**
- Create: `app/Actions/Community/RejectComment.php`, `app/Actions/Community/HideComment.php`
- Create: `app/Http/Requests/Community/RejectCommentRequest.php`, `HideCommentRequest.php`
- Create: `tests/Feature/Community/CommentDecisionsTest.php`
- Modify: `AuditSentences.php`, `lang/vi/audit.php`, `AuditSentencesTest` (count → 31), `RuleViolatedCodesHaveSentencesTest`

**Interfaces:**
- `RejectComment::execute(User $actor, Comment $comment, string $reason): array{commentId: string}` — throws `reject_reason_required`, `comment_not_pending`; audit `comment.rejected`; **no notification** (the reference sends none: the reason is on the row and the author reads it where the comment was).
- `HideComment::execute(User $actor, Comment $comment, ?string $reason = null): array{commentId: string}` — throws `comment_not_approved`; audit `comment.hidden`; no notification.

- [ ] **Step 1: Write the failing tests**

`CommentDecisionsTest`, fixture `cmdFix(string $status = 'pending', string $slug = …)` —
`cmaFix`'s shape under a different name, because a second file may not redeclare it. Blocks,
each its own `it()`:

1. rejecting is terminal, keeps the row (`deleted_at` null — BR §11), and stores the reason
   in `moderation_note` with `moderated_by`/`moderated_at`;
2. **rejecting notifies nobody** — `Notification::query()->count()` is 0. The exclusion is
   real: the row it would notify about exists, and the author exists, so this block seeds
   the thing it excludes;
3. rejecting requires a reason, and whitespace is not one — `"   "` throws
   `reject_reason_required` and the row is untouched (assert the status, not just the throw);
4. hiding takes an **optional** reason where rejecting requires one — `null` succeeds,
   status `hidden`, `moderation_note` null;
5. hiding with a reason stores it;
6. only an approved comment can be hidden — a `pending` fixture throws
   `comment_not_approved`;
7. a decided comment cannot be decided again — an `approved` fixture rejected throws
   `comment_not_pending`;
8. INV-8 for both actions, with the reason travelling into the payload and out through the
   rendered sentence — the reference's `because()` clause, which `AuditSentences` already
   has a helper for.

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement**

`RejectComment` is `ApproveComment`'s shape with three differences and no others:

```php
        // Required, and trimmed. OPS §4.4 quotes the screen's own copy for
        // why: "Từ chối cần ghi lý do, bạn đọc sẽ thấy lý do này." A reason
        // the author reads is the point, and three spaces is not one. The
        // code is 1b's reject_reason_required, reused rather than split a
        // fifth time — OPS §4.4 gives this command that same sentence.
        $trimmed = trim($reason);
        if ($trimmed === '') {
            throw new RuleViolated('reject_reason_required');
        }
```

placed **before** the transaction (it needs no row), then inside it the same locked read and
`comment_not_pending` guard, an update to `CommentStatus::Rejected` writing
`'moderation_note' => $trimmed`, and

```php
            $this->audit->record('comment.rejected', 'comment', $locked->id,
                ['status' => 'pending'],
                ['status' => 'rejected', 'reason' => $trimmed],
            );
```

with **no** `notify` call. `HideComment` is the same again with `CommentStatus::Approved`
expected, `comment_not_approved` thrown, `CommentStatus::Hidden` written, and the reason
optional:

```php
        $trimmed = ($reason === null || trim($reason) === '') ? null : trim($reason);
```

and an audit `after` bag that carries `'reason'` only when there is one — the reference
writes `reason ? {status, reason} : {status}`, and `AuditSentences::payloadRows` renders an
**absent** key as an em dash and a **stored null** as the string "null", which are different
facts. Port the conditional shape, not a `'reason' => null`.

Each Action's docblock states the asymmetry in the reference's own terms: a rejection is a
message to an author who is waiting to hear; hiding removes something already published,
often months later, with nobody to tell.

- [ ] **Step 4: the sentences and the Form Requests**

`AuditSentences::ACTIONS` gains both actions under `community`; `lang/vi/audit.php` gains
the reference's phrases verbatim —
`'comment_rejected' => 'từ chối một bình luận:because',` and
`'comment_hidden' => 'ẩn một bình luận:because',` — reusing the existing `_because` helper
line rather than a second spelling. Count → **31**. `comment_not_approved` joins the code
census (`reject_reason_required` is already there).

`RejectCommentRequest`: `authorize()` is `abort_unless(Gate::allows('act-as-manager'), 404);`
and `'reason' => ['bail', 'required', 'string', 'max:500', 'encoding:UTF-8']`.
`HideCommentRequest` is the same with `nullable` in place of `required`. **Two Form Requests,
not one shared class**, because the required/optional difference is the whole product
decision and one class with a conditional rule hides it.

- [ ] **Step 5: Run, mutation-check, commit**

Mutation checks: (1) make hiding's reason required → block 4 reddens and block 5 stays
green; (2) write `'reason' => null` instead of omitting the key on a reasonless hide → block 8's
assertion reddens **on the PRESENCE of a `reason` row**, not on an em dash. The first draft
said the em dash is the observable difference and the review corrected it: `payloadRows`
takes the union of the two bags' keys, so an omitted key produces **no row at all**, while a
stored null produces a row whose *before* column is an em dash (the key is absent from
`before` either way) and whose *after* column is the string `"null"`. An implementer
asserting an em-dash row in the unmutated case would be writing a failing test against a
correct command. Assert row presence instead — no `reason` row unmutated, one mutated; (3) add a `notify` call to `RejectComment` → block
2 reddens **and** `NotificationsAreReaderFacingTest`'s census reddens (a writer with no row),
which is the guard proving it covers new writers automatically.

```bash
make lint && make analyse
git commit -m "feat: rejectcomment and hidecomment — one needs a reason, the other does not"
```

---

### Task 5: `BookCommentsQuery` and the INV-9 suite — the invariant lives in the access path

Read first: `old_next/src/domain/community/queries/get-comments.ts`'s `getBookComments`
(its docblock **is** INV-9's specification) and
`old_next/tests/invariants/inv-09-comment-visibility.test.ts` (all six tests).

This is the phase's load-bearing task. The invariant is an **exclusion**, and this project's
Global Constraints say an exclusion test whose fixture has nothing to exclude proves
nothing — so every block below seeds the thing it excludes.

**Files:**
- Create: `app/Queries/BookCommentsQuery.php`, `tests/Feature/Community/BookCommentsQueryTest.php`
- Create: `tests/Feature/Invariants/Inv09CommentVisibilityTest.php` (a new directory)

**Interfaces:**
- Produces: `BookCommentsQuery::run(Book $book): list<array{id: string, body: string, authorName: string, createdAt: string}>` — approved, undeleted, newest first, and nothing else.

- [ ] **Step 1: Write the failing tests**

Two files, two fixtures (`bcqFix`, `inv9Fix`), because the query test asks "does this shape
come back right" and the invariant test asks "can anything make an unapproved comment
visible". They are different questions and the second must survive the first being deleted.

`Inv09CommentVisibilityTest` ports the reference's six, with the two Laravel-specific
additions the port earns:

1. **a pending comment is absent from the member-facing query** — seed one approved and one
   pending on the same book, assert the returned ids contain the approved and not the
   pending, **by id**, not by count;
2. **approving is what makes it visible, and nothing else does** — run the query, then
   `ApproveComment`, then run it again: the id appears only after. Seed OUT of order (a
   later-created approved comment plus an earlier pending one) so the v7 monotonicity cannot
   supply the answer;
3. **a rejected comment is never visible, to anyone** — including, on today's ported
   behaviour, its own author (open question 2's default; if that question is answered the
   other way, this block is where the change lands, and the block says so in a comment);
4. **hiding pulls a comment that was already public** — approved, visible, hidden, gone;
5. **a body containing `<script>` round-trips as literal text** — the query returns it raw
   and does not rewrite what a child wrote; escaping is the renderer's job;
6. **one shelf's comments never appear on another's book page** — two shelves, one approved
   comment each, read under each context in its own `it()` block (the `SessionGuard` rule),
   and each read finds exactly its own;
7. **a soft-deleted comment is absent** — `Comment` carries `SoftDeletes`, so the model's own
   scope does this; the block exists because deleting the trait would otherwise leave the
   suite green;
8. **the exclusion survives the query being asked for a book with nothing approved** — an
   empty list, not an error, and not a leak of the pending row's existence.

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement**

```php
<?php

namespace App\Queries;

use App\Enums\CommentStatus;
use App\Models\Book;
use App\Models\Comment;

/**
 * The comments a member sees on a book's page — APPROVED ONLY, and that
 * is INV-9 living in the access path rather than in a caller's filter.
 * Port of get-comments.ts's getBookComments.
 *
 * A pending, rejected or hidden comment is absent for everyone here,
 * INCLUDING ITS OWN AUTHOR. That is the requirement as written; if a
 * reader should see their own comment awaiting moderation, that is a
 * product decision and a DIFFERENT query, not a loosened predicate on
 * this one (the plan's open question 2).
 *
 * Inv09CommentVisibilityTest asserts the exclusion THROUGH this query
 * rather than by reading every row and filtering in PHP, because a test
 * that filtered would pass against a query with no status predicate at
 * all — which is precisely the defect INV-9 exists to prevent.
 *
 * THE BODY IS RETURNED RAW. Comments are plain text rendered escaped (BR
 * §5.4); React escapes by default, and a query that "helpfully" stripped
 * tags would silently rewrite what a child wrote.
 *
 * Tenancy is BookshelfScope's, on Comment itself — no bookshelf_id
 * appears here. Soft-deleted rows are excluded by the model's own scope,
 * which is why deleted_at appears nowhere either; the invariant suite
 * pins both, so removing a trait cannot leave the suite green.
 *
 * id desc beside created_at desc: created_at carries no unique
 * constraint, and this project has twice measured what an ordering
 * without a unique tiebreak does across pages. On today's engine the
 * tiebreak is redundant — InnoDB appends the primary key to a secondary
 * index — and it is written down anyway, with the mutation that DOES
 * redden it recorded in the test.
 */
final class BookCommentsQuery
{
    /** @return list<array{id: string, body: string, authorName: string, createdAt: string}> */
    public function run(Book $book): array
    {
        return array_values(Comment::query()
            ->with('author')
            ->where('book_id', $book->id)
            ->where('status', CommentStatus::Approved)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->get()
            ->map(fn (Comment $comment): array => [
                'id' => $comment->id,
                'body' => $comment->body,
                'authorName' => (string) $comment->author?->full_name,
                'createdAt' => (string) $comment->created_at->toISOString(),
            ])
            ->values()
            ->all());
    }
}
```

The reference `join`s `users`; this eager-loads instead, because a `join` is
`TenancyArchitectureTest`'s own documented blind spot and there is nothing to gain from
entering it. The two nullsafe decisions in that `map` are **not** symmetric, and
they were measured rather than guessed: `author` reaches Larastan as `User|null` (a
`belongsTo` accessor), so `?->` is required there, while `created_at` reaches it as a
non-nullable `Carbon` and `?->` on it is a level-8 error (`nullsafe.neverNull`) — the first
draft of this block carried it and Larastan rejected it. Write the asymmetry into the code
with that reason, or the next reader "fixes" one of the two.

- [ ] **Step 4: Run, mutation-check, commit**

Mutation checks — **the whole point of this task**, and each is named for the block it must
redden:
1. Delete the `status` predicate → invariant blocks 1, 3 and 4 redden. If only one does, the
   fixtures are sharing state.
2. Change the predicate to `!= rejected` → block 1 reddens (pending becomes visible) and
   block 4 reddens (hidden becomes visible), while block 3 stays green — which is the
   measurement that the predicate is `= approved` rather than "not the bad ones".
3. **STRUCK — the first draft's mutation here was false in both halves, and the review
   measured it.** It said "delete `BelongsToBookshelf` from `Comment` → block 6 reddens" and
   called that block the trait's "only behavioural pin in this phase". Block 6 stays
   **green**, and structurally must: this query narrows by `book_id`, and
   `comments_book_fk (bookshelf_id, book_id)` means a foreign shelf's comment hangs off a
   foreign shelf's book, so the book predicate has already excluded it. No fixture can make
   this block sensitive to the trait. The sentence was false too — that mutation reddens
   five tests, among them `TenancyArchitectureTest` (whose first block requires the trait on
   every model whose table carries `bookshelf_id`) and `TenantIsolationTest` (whose dataset
   has named `Comment`, `Announcement` and `BookDonation` since Phase 0, verified by opening
   it). **What block 6 actually pins is the BOOK narrowing**, which is worth pinning and is
   what its comment should say; `Comment`'s model-level tenancy is held by two shipped guards
   this phase does not edit, and Task 20 step 5 re-runs both and pastes the numbers rather
   than this task claiming them.
4. Delete `SoftDeletes` from `Comment` → block 7 reddens.
5. Flip `orderByDesc('created_at')` to ascending → the query test's ordering block reddens.
   Deleting `orderByDesc('id')` alone leaves it **green** on today's engine, for the reason
   the docblock gives; record that number rather than implying the line is pinned.

```bash
make lint && make analyse
git commit -m "feat: bookcommentsquery — inv-9 in the access path, with the suite that proves it"
```

---

### Task 6: `CommentModerationQuery` — a queue to work, three lists to read, four numbers to show

Read first: `get-comments.ts`'s `getPendingComments`, `getRecentComments` and
`countCommentsByStatus`, including the argument in `getRecentComments`' docblock for why the
queue stays its own method rather than folding in as a fourth status.

**Files:**
- Create: `app/Queries/CommentModerationQuery.php`, `tests/Feature/Community/CommentModerationQueryTest.php`
- Modify: `app/Queries/ManagerDashboardQuery.php` (+ `counts.pendingComments`, **delegated**)
- Modify: `tests/Feature/Oversight/ManagerDashboardQueryTest.php`

**Interfaces:**
- `queue(): list<array{…, title: string, authorName: string}>` — `pending` only, **oldest first**, unbounded.
- `decided(CommentStatus $status, int $limit = 10): list<…>` — one already-decided status, newest first, **capped**.
- `counts(): array{pending: int, approved: int, rejected: int, hidden: int}` — one statement, zeroes filled in from the enum.
- `countPending(): int` — what the dashboard card delegates to.

- [ ] **Step 1: Write the failing tests**

Fixture `cmqFix`. Blocks:

1. **the queue is oldest first** — seed three pending comments **out of order** (create the
   middle one last and set `created_at` explicitly), assert the returned order by id against
   the ids the fixture itself relates, never against creation order;
2. **the queue is pending only** — seed one of every status and assert the returned ids
   contain the pending one and no other, key by key;
3. **`decided` returns one status, newest first, capped** — seed twelve approved, ask for
   ten, assert the count and that the newest is first;
4. **`decided` for a status with no rows is an empty list, not an error**;
5. **`counts` fills in the zeroes** — a shelf with only pending comments still answers four
   keys, each present, three of them `0`. The reference's reason is the point: a `group by`
   returns only statuses that have rows, and a well-moderated shelf is *usually* in that
   state;
6. **counts and the queue agree** — `count($query->queue())` equals `$query->counts()['pending']`
   equals `$query->countPending()`. Three readings of one fact, and this is the block that
   catches two of them drifting;
7. **another shelf's comments are in neither** — two shelves, comments on both, read under
   one context, in its own `it()`;
8. **the dashboard's fourth card is the same number** — `ManagerDashboardQuery`'s
   `counts.pendingComments` equals `countPending()`, which it must be, because it delegates
   rather than restating the filter (the `pendingRequests` precedent, whose docblock gives
   the rule: "the card and the screen it links to cannot drift apart the way two independent
   counts could").

- [ ] **Step 2–3: implement**

One class, three shapes, and a **shared private builder** for the parts that are genuinely
the same — the eager loads and the columns — but **not** for the ordering or the cap, which
are what makes a queue a queue and an archive an archive. 2a's Task 11 review is the
precedent in both directions: it required one shared builder where two methods duplicated
filters character for character, and the reference here argues the opposite for these two
specifically. Follow the reference; write the argument down at the seam.

`counts()` is one grouped query plus a PHP fill from `CommentStatus::cases()` — never four
`count(*)` queries, and never a `Record` whose keys came from the database. Larastan level 8
will want the fill typed; build it as
`array_fill_keys(array_map(fn (CommentStatus $c) => $c->value, CommentStatus::cases()), 0)`
and overwrite from the grouped rows.

`ManagerDashboardQuery` gains `pendingComments` inside `counts`, constructor-injecting
`CommentModerationQuery` beside the existing `BorrowRequestQueueQuery`. **Its docblock is
stale in two places, not one, and the whole opening sentence is replaced** — the first draft
of this task named a single line and the review found the second: the opening sentence says
the query is "narrowed to the two of BR §16.3's four stat cards whose queues exist", which
became three at 2a and becomes **four of four** here, and the parenthesis after it —
"(plan divergence 6: Yêu cầu mượn and Bình luận chờ duyệt are Phase 2's, and no substitute
card is promoted into their slots)" — is a citation into a plan whose divergence 6 this
commit discharges, and is deleted rather than reworded. A comment that says a thing is future,
on the commit that ships it, is this project's most repeated defect; a comment that says it
twice is the same defect surviving a partial fix.

- [ ] **Step 4: Run, mutation-check, commit**

Mutations: (1) make the queue newest-first → block 1 reddens (this is why the fixture seeds
out of order — with in-order seeding, v7 monotonicity would have made both orders agree on
ids and the block would be green either way, which is the false green 2a hit twice);
(2) drop the `pending` filter from `countPending` → blocks 6 and 8 redden together, which is
the delegation being load-bearing; (3) have the dashboard count pending comments itself with
its own `where` instead of delegating → **every block stays green**, and that is the point:
record the number, say the agreement is a convention this test cannot enforce, and leave the
delegation with its reason in the docblock rather than claiming a guard that does not exist.

```bash
git commit -m "feat: commentmoderationquery — the queue, the archives, the four chips, one count"
```

---

### Task 7: The reader's comments on the book page — the list, the form, and the two flashes

Read first: `old_next/src/app/tu-sach/[shelf]/(doc-gia)/sach/[slug]/page.tsx`'s comments
area (the `comments_enabled` branch it renders around) and
`old_next/tests/lib/comment-action.test.ts`. Then read
`resources/js/pages/shelves/book.tsx` **whole** — it is 338 lines and it already carries
2a's request panel; this task extends it and must not disturb that.

**Files:**
- Modify: `app/Queries/BookDetailQuery.php` (+ `comments`, + `commentsEnabled`)
- Modify: `resources/js/pages/shelves/book.tsx`, `resources/js/lib/copy.ts`
- Create: `tests/Feature/Community/BookCommentsScreenTest.php`

- [ ] **Steps**

`BookDetailQuery` gains two keys: `comments` (from `BookCommentsQuery`, injected — not a
second copy of the predicate) and `commentsEnabled` (from `CommentSettings::fromShelf`, so
the page can hide the form on a shelf that takes none rather than offering a box that
refuses). It does **not** gain a "can I comment" flag beyond that: whether the viewer is a
member is already decided by the route's `role:reader`.

The page renders, under the existing panels: a heading, the approved comments newest first
with author name and date (`lib/dates.ts`'s formatter, never a timestamp — AGENTS.md's
language rule), and — when `commentsEnabled` — a single-column `Field` + `Textarea` + one
button. **The primary action on this screen is already *Xin mượn*** (AGENTS.md rule 3: solid
terracotta appears once), so the comment button is the secondary style. All copy goes through
`resources/js/lib/copy.ts`; Biome's `noJsxLiterals` enforces it for bare text and string
props are on you.

`BookCommentsScreenTest` (fixture `bcsFix`) asserts, each in its own block: the page's props
carry only approved comments; the form's POST creates one and redirects back with the
**pending** flash on a moderating shelf and the **published** flash on a shelf that does not
moderate; a signed-in non-member is 404 by the route group, not 403; and an empty body is a
per-field validation error, not a banner.

**Known blind spot, stated rather than implied:** this repo has **no frontend rendering
tests at all** — `assertInertia` checks server-side props only, and 1d measured the
consequence (swapping two stat cards' values left every test, plus Pint, Larastan, Biome,
tsc and the build, entirely green). So the assertions above pin the props and the redirects;
that the list is rendered under the right heading, and that the form posts to the route whose
name it was given, are **unpinned by anything** and are checked by reading. Say so in the
commit.

```bash
git commit -m "feat: the book page takes comments, and says what happens to them"
```

---

### Task 8: The manager's moderation screen — `/manage/comments`, and the dashboard's fourth card

Read first: `old_next/src/app/tu-sach/[shelf]/quan-ly/binh-luan/page.tsx`'s docblock whole
— it argues why the chips filter, why only one list is ever fetched, why there is no *Tất
cả* chip, and why rejected and hidden render read-only. Every one of those arguments ports.

**Files:**
- Create: `app/Http/Controllers/Manage/CommentModerationController.php`, `resources/js/pages/manage/comments.tsx`
- Create: `tests/Feature/Community/ManagerModerationScreenTest.php`
- Modify: `routes/web.php` (the placeholder `/manage/comments` GET keeps its route **name**; three POSTs join it)
- Modify: `resources/js/pages/manage/dashboard.tsx`, `resources/js/layouts/manage-layout.tsx`, `resources/js/lib/copy.ts`

- [ ] **Steps**

Routes, inside the existing `['auth', 'role:manager']` group, the GET replacing
`ShellController::underConstruction` and keeping the name `shelves.manage.comments` so the
nav item added in this same commit and anything Ziggy-named later still resolve:

```php
Route::get('/comments', [CommentModerationController::class, 'index'])->name('comments');
Route::post('/comments/{comment}/approve', [CommentModerationController::class, 'approve'])->name('comments.approve');
Route::post('/comments/{comment}/reject', [CommentModerationController::class, 'reject'])->name('comments.reject');
Route::post('/comments/{comment}/hide', [CommentModerationController::class, 'hide'])->name('comments.hide');
```

`{comment}` resolves through `Bookshelf::comments()` under the group's `scopeBindings()` and
through `BookshelfScope` on the model independently — divergence 3's two layers. The
approve POST is **bodiless and therefore carries no Form Request**, matching the ruling this
project already made for `handover` and `release`; reject and hide each have one, because
they carry a field. **State the asymmetry the way `BorrowRequestController`'s docblock does
and re-measure it rather than arguing by analogy**: with `role:manager` hypothetically
dropped, reject and hide answer 404 from their Form Requests while approve answers 403 from
the Action's own `Gate::authorize` — so on this page the middleware is the load-bearing
guard for that one POST. Measure it; do not copy the sentence.

`?status=` narrows which list is fetched, and an absent or unrecognised value resolves to
**`pending`** — this screen's own default view — rather than to "no filter", which is the
one place this project's `QueryParam` narrowing has a concrete fallback instead of null. The
reference's reason ports: the four statuses partition the table and there is no fifth query
here that reads them combined, so a merged "Tất cả" chip would either lie or cost what the
cap exists to avoid. A hand-typed `?status=deleted` renders a known, working view.

The page: four filter chips carrying their counts (from `counts()`, queried, **not** counted
from the list on screen), then either the queue (with *Duyệt* / *Từ chối* per row, the
reject reason inline in the row whose form produces it — the 2a whole-branch review moved
field errors out of a page head for exactly this reason) or one capped decided list. Rows in
the `approved` list carry *Ẩn*; `rejected` and `hidden` rows carry no action at all, because
no command moves them. Tables become stacked cards below 768px (AGENTS.md rule 5).

Dashboard: the fourth stat card, *Bình luận chờ duyệt*, linking to this screen, reading
`counts.pendingComments`. Nav: one *Bình luận* item in `manage-layout`.

`ManagerModerationScreenTest` (fixture `mmsFix`), blocks each independently failing: the
index renders with the queue and the four counts; each POST performs its command and
redirects with its flash; a reader of the shelf gets **404** on the GET and on each POST
(and the POSTs are separate blocks — a failed assertion aborts the method, which is the
structure defect 2a's Task 14 shipped and had to fix); an unknown `?status=` renders the
pending view rather than an error; and the reject POST with an empty reason is a **field**
error on that row, not a banner.

Mutations: (1) drop `role:manager` from the group → measure what each of the four routes
answers and record all four numbers, then restore; (2) count the chips from the rendered
list instead of from `counts()` → the block that seeds more decided rows than the cap
reddens; (3) delete the `?status=` fallback so an unknown value means "no filter" → the
unknown-status block reddens.

```bash
git commit -m "feat: the moderation screen — a queue to work and three archives to read"
```

---

## Slice B — announcements

### Task 9: `CreateAnnouncement` — shelf news, drafted or published, with a slug a person can read

Read first: `old_next/src/domain/community/commands/announcements.ts`'s file docblock and
`createAnnouncement` + `pickSlug` (whole), and
`announcements-feedback-donations.test.ts` tests for the blank-field refusal and the slug
collision. Then read `app/Support/Catalogue/Slugs.php` — `fromTitle`/`nextAvailable` already
exist and this task **reuses them rather than porting `pickSlug` a second time**; a second
slug derivation is the drift `CatalogueArchitectureTest`'s folding guard exists to prevent.

**Files:**
- Create: `app/Actions/Community/CreateAnnouncement.php`, `app/Policies/AnnouncementPolicy.php`, `app/Http/Requests/Community/StoreAnnouncementRequest.php`, `tests/Feature/Community/CreateAnnouncementTest.php`
- Modify: `app/Models/Bookshelf.php` (+ `announcements()`), `app/Models/Announcement.php` (+ `author()`), `app/Providers/AppServiceProvider.php`, `lang/vi/rules.php`, `AuditSentences.php` (count → 32), `lang/vi/audit.php`, `RuleViolatedCodesHaveSentencesTest`

**Interfaces:**
- `CreateAnnouncement::execute(User $actor, string $title, string $body, bool $pinned = false, ?CarbonImmutable $publishedAt = null, ?CarbonImmutable $expiresAt = null): array{announcementId: string, slug: string}` — throws `announcement_fields_required`; audit `announcement.created`.

- [ ] **Steps**

The refusal code is the reference's `announcement_fields_required` ("Vui lòng điền tiêu đề
và nội dung."), **not** OPS §4.4's abbreviated `validation_failed`. This is the two-ledger
rule 1c already applied: `errors.ts` is one code to one sentence, OPS's failure-mode lists
abbreviate, and the reference command throws the specific code. Task 20's OPS walk records
the lag rather than changing the command.

The slug is `Slugs::nextAvailable(Slugs::fromTitle($title), $existing)` where `$existing`
is the shelf's live announcement slugs read **inside the transaction**. That read is not a
uniqueness guarantee and the docblock must not imply it is: the guarantee is the shipped
`announcements_bookshelf_id_slug_key` UNIQUE over the `slug_key` generated column, which is
alive-rows-only, and a racing pair loses to errno 1062. **Decide, in this task, whether that
1062 is translated by `App\Support\UniqueViolation` and give it a sentence, or is allowed to
be a 500.** The recommendation is to translate it — the shipped helper matches by constraint
name and the shape is `LendCopy`'s — and to say plainly that no race has been measured and
none is claimed to be likely; two managers typing the same headline in the same second is
the case, and a 500 for it is the thing 1c's `UniqueViolation` was built to stop.

`body_text` is written from the same trimmed plain body as `body` (divergence 5); the column
is NOT NULL and an empty string there would make a published announcement unfindable by a
later search, which is the reference's own reason for its fallback.

Both fields trimmed, and blank in **either** refuses — one code for both, matching the
reference, because "Vui lòng điền tiêu đề và nội dung" is one sentence about one form.

`is_pinned`, `published_at` and `expires_at` are all writable at create: a manager may draft,
or may publish immediately, and OPS §4.4 lists all three as create inputs. The audit `after`
bag carries `title`, `slug` and `published` (a bool derived from whether a publication time
was given) — the reference's shape exactly.

Tests (`anwFix`): a draft is created with `published_at` null; a published one carries the
given instant; a blank title refuses and a blank body refuses (**two blocks** — a failed
`expect` aborts the method); a second announcement with the same title on the same shelf gets
`-2`; a soft-deleted announcement's slug is **free again**, which is what the generated
column's `IF(deleted_at IS NULL, …)` buys and which nothing else in this phase pins; a
second **shelf** may hold the identical slug, in its own `it()`; and INV-8.

Mutations: (1) write `body_text` as `''` → the excerpt block in Task 12 will redden later,
so pin it **here** with a block asserting `body_text` is non-empty; (2) skip the collision
suffix → the `-2` block reddens; (3) drop the shelf filter from the existing-slug read →
nothing reddens on a single-shelf fixture, which is why the two-shelf block exists.

```bash
git commit -m "feat: createannouncement — shelf news, drafted or posted, with a readable address"
```

---

### Task 10: `UpdateAnnouncement` — a present field is validated, an absent field is untouched, and a cleared expiry is a third case

Read first: `updateAnnouncement` whole. Its `expiresAt` comment is the specification and the
trap: **three cases, and SQL can express two.** Absent means leave it alone, an explicit
`null` means clear the expiry, and a date means set one. A `coalesce` conflates the first two
and makes "this announcement no longer expires" unexpressible.

**Files:** `app/Actions/Community/UpdateAnnouncement.php`, `UpdateAnnouncementRequest.php`,
`tests/Feature/Community/UpdateAnnouncementTest.php`, audit count → 33.

**Interfaces:** `execute(User $actor, Announcement $announcement, array $changes): array{announcementId: string}` where `$changes` is a shaped array documented with a `@param` — `array{title?: string, body?: string, expiresAt?: ?CarbonImmutable}` — because the *presence* of a key is load-bearing and an object with nullable properties cannot express it. `array_key_exists`, never `isset`, never `??`, on every read of that array: `isset($changes['expiresAt'])` is **false** for an explicit null, which silently collapses "clear it" into "leave it".

Tests (`anuFix`), each its own block: a title-only change leaves the body; a present-but-blank
title refuses; a present-but-blank body refuses; **an absent `expiresAt` leaves an existing
expiry alone**; **an explicit null clears it**; a date sets it; INV-8 records the title before
and after. The two expiry blocks are the task.

Mutations: (1) replace the `array_key_exists` read with `isset` → the clear-it block reddens
and the leave-it-alone block stays green, which is exactly the asymmetry that makes the bug
silent; (2) `?? $existing->expires_at` in place of the three-case branch → the same block
reddens. Both are the reference's named trap, measured.

```bash
git commit -m "feat: updateannouncement — clearing an expiry is not the same as not mentioning it"
```

---

### Task 11: `PublishAnnouncement`, `HideAnnouncement`, `PinAnnouncement`, `UnpinAnnouncement` — four one-column writes, four audit actions, four literals

Read first: all four in `announcements.ts`, including the docblock above `pinAnnouncement`
explaining why they are written out rather than generated from a factory — **and note that
this codebase enforces that reason mechanically**: `AuditActionCensusTest`'s second block
fails the build on a computed action name, per file. Four classes, one task, because they
are four arrows on one machine and reviewing them apart hides the one that is different.

**Files:** four Actions, `PublishAnnouncementRequest.php`,
`tests/Feature/Community/AnnouncementStateTest.php`, audit count → **37**, and
`already_published` into `lang/vi/rules.php` plus the code census.

**The one that is different is `PublishAnnouncement`,** and its refusal is not about the
column being non-null. *Đăng lại* — republishing something that has expired — goes through
this same command, so the refusal is about a **live** publication: it fires when the row is
already published **and** no new expiry was supplied. An expired announcement is published
and lapsed, and re-publishing it is the whole point of the second button. Port that
condition exactly; it is the kind of guard a later reader "simplifies" into
`published_at !== null` and thereby kills the button.

**And "was an expiry supplied" is Task 10's absent-versus-explicit-null distinction again,
which the first draft of this task did not mention at all.** The review found the two tasks
did not compose: as originally written, Task 11 pinned only the *with a date* success and
Task 14 rendered *Đăng lại* as a plain row button, so the button was **dead** for any manager
who did not type an expiry. The resolution, and it is a decision this task makes rather than
leaves open:

- `PublishAnnouncementRequest` carries `expires_at` as `['nullable', 'date']`, so the form
  can send the key with an empty value. Over real HTTP that arrives as `''`, Laravel's global
  `ConvertEmptyStringsToNull` turns it into `null`, and `nullable` short-circuits `date` — so
  **the key is present in `validated()` with a null value**, which is the shape the whole
  distinction rests on.
- The Action takes `array $changes` shaped `array{expiresAt?: ?CarbonImmutable}` and reads it
  with **`array_key_exists`, never `isset` and never `??`** — `isset` is false for an
  explicit null, which would collapse "clear the expiry, and republish" into "say nothing",
  and turn a successful republish into `already_published`. This is the identical trap Task
  10 spends a whole task on, and it bites harder here because the wrong answer is a refusal
  rather than a stale column.
- **The controller's mapping from `validated()['expires_at']` to `$changes['expiresAt']` is
  the seam where all three shapes collapse, and BOTH idiomatic spellings for it are traps.
  Measured, both:**
  - `$request->date('expires_at')` returns **null for an absent key AND for a present-empty
    one** — it erases the very distinction this Critical is about, silently, with the Form
    Request and the Action both correct. (`has()` still tells them apart — false vs true — and
    so does `array_key_exists` on `validated()`; `filled()` does **not**: it is false for the
    present-empty case.)
  - `CarbonImmutable::parse(null)` returns **now** — measured against a frozen clock, the
    parsed value compared equal to `CarbonImmutable::now()`. So a mapping that reaches for
    `parse()` on the cleared expiry turns *Đăng lại* into "republish, expiring immediately":
    the notice is posted and lapses in the same instant, and every assertion about status,
    flash and `published_at` still passes.

  So the mapping is: **`array_key_exists('expires_at', $validated)` for presence, then a
  null-preserving cast** — `$validated['expires_at'] === null ? null :
  CarbonImmutable::parse($validated['expires_at'])`. Never `date()`, never `filled()`, never a
  bare `parse()`.
- **An explicit null IS a supply.** Republishing a lapsed notice with no expiry at all is the
  ordinary case — a parish saying "the shelf is closed until further notice" — so *Đăng lại*
  sends `expires_at` present and empty, and that succeeds and clears the column.

Two blocks beyond the ones below pin it: **publishing a lapsed announcement with `expiresAt`
present and explicitly null succeeds and leaves `expires_at` null**, and **publishing a
lapsed announcement with the key ABSENT refuses with `already_published`**. Task 14 then
states which of the two shapes its *Đăng lại* button posts, and pins that.

`HideAnnouncement` clears `published_at`, which is what "not public" *means* for this table —
there is no separate flag the way comments have a status — and is also what makes *Đăng lại*
work afterwards. Say so in its docblock; a future reader will otherwise add a column.

Tests (`anpFix`), each its own block: publishing a draft sets the instant from the clock;
publishing an already-live announcement refuses with `already_published`; publishing a lapsed
one **with** a fresh expiry succeeds (the *Đăng lại* case); hiding returns it to draft and it
can then be posted again (the reference's own named test); pinning and unpinning each flip the
flag and audit; and **more than one may be pinned at once** (divergence 8 / the ported
reading), which is a block rather than a comment because "no cap" is a claim a later partial
index would falsify.

Mutations: (1) narrow the publish guard to `published_at !== null` → both *Đăng lại* blocks
redden and the already-published block stays green; (1b) read the expiry with `isset` instead
of `array_key_exists` → the explicit-null *Đăng lại* block reddens with `already_published`
while the with-a-date block stays green, which is the asymmetry that makes this bug silent
and is the same measurement Task 10 owes; (2) have `HideAnnouncement` write a new column or a
status instead of clearing `published_at` → the post-again block reddens;
(3) assemble any of the four action names from a variable → `AuditActionCensusTest`'s
per-file literal block reddens, which is the mechanical version of the reference's argument.

```bash
git commit -m "feat: publish, hide, pin and unpin — four arrows, four names, one table"
```

---

### Task 12: `AnnouncementsQuery` — one bound instant, three shapes, and a lapse that happens with nothing having run

Read first: `get-announcements.ts` whole — `getAnnouncements`, `getAllAnnouncements`,
`getAnnouncementDetail` and `toRow`. The docblock on `AnnouncementState` is the argument this
task must not lose: the page must not re-derive state, because that is a third clock.

**Files:** `app/Queries/AnnouncementsQuery.php`, `tests/Feature/Community/AnnouncementsQueryTest.php`.

**Interfaces:**
- `published(): list<…>` — published, not yet lapsed, **pinned first, then most recent, then id**;
- `detail(string $slug): ?array` — the **same** filter, so a lapsed announcement is not readable by pasting its URL; `null` for a draft, a lapsed one, or a slug naming nothing, which the controller turns into one 404;
- `managed(): list<…>` — everything including drafts and lapsed ones, each carrying a `state` of `showing`, `draft` or `expired`.

- [ ] **Steps**

**One instant per call.** `Clock::now()` is read **once** at the top of each method into a
local, and every comparison binds that local (divergence 6). Two reads of the clock inside
one method is 2a's measured defect: two instants that differ in production and agree in every
test.

The `state` is computed in PHP from the same local (divergence 7), by a **private static
helper both `managed()` and `published()` call** — `published()` uses it as a filter and
`managed()` uses it as a label, so the reader's list and the manager's chip **cannot**
disagree about one notice. That shared helper is the whole design; if it is duplicated, the
disagreement the reference warns about is back.

The excerpt is `body_text` truncated, because a rich body truncated mid-tag is how a list
renders half an element — true today only in principle (divergence 5 makes the two columns
equal), and the column is used anyway so nothing downstream changes shape when a rich editor
lands.

Ordering: `is_pinned desc, published_at desc, id desc` for the reader,
`is_pinned desc, coalesce(published_at, created_at) desc, id desc` for the manager — a draft
has no publication time and would otherwise sort last forever, where a manager wants their
newest draft in front of them.

Tests (`anqFix`), each its own block, all fixtures seeded **out of** intended order:

1. a draft is invisible to `published()` and present in `managed()` with state `draft`;
2. **an announcement lapses on the clock alone, with no write and no job** — seed one with an
   expiry, read it, advance the clock, read again, and assert **no row changed** (compare
   `updated_at` before and after, so "nothing wrote" is a fact rather than a hope);
3. **the boundary agrees in both directions** — at `expires_at` exactly equal to the bound
   instant, the row is absent from `published()` **and** labelled `expired` by `managed()`.
   Two `it()` blocks, because a failed expect aborts the method and both halves must be able
   to fail alone;
4. pinned first, then most recent — and **more than one may be pinned**, ordered among
   themselves by recency;
5. `detail()` returns null for a draft, for a lapsed one, and for a slug naming nothing —
   three blocks, so the three are not covered by whichever fails first;
6. another shelf's announcement is in none of the three shapes.

Mutations: (1) read the clock twice in one method → nothing reddens (record the number and
say so: this is a convention the docblock carries, not a guard); (2) move the `state`
derivation into a second inline expression → block 3 reddens only if the two copies are made
to differ, so **make them differ deliberately** (flip one comparison to `<`) and record that
block 3 is what catches it; (3) drop the expiry predicate from `detail()` → block 5's
lapsed-URL case reddens, which is the difference between a filter and a rule.

```bash
git commit -m "feat: announcementsquery — one instant, and a notice that lapses with nothing running"
```

---

### Task 13: The reader's Bản tin — the list and one notice

**Files:** `app/Http/Controllers/Reader/AnnouncementController.php`,
`resources/js/pages/shelves/announcements/{index,show}.tsx`,
`tests/Feature/Community/ReaderAnnouncementsTest.php`, routes, copy.

The GET `/announcements` replaces the under-construction placeholder **keeping its route
name** (`shelves.announcements`) — the header already links to it under the name **Bản tin**,
which 2a renamed deliberately so the personal bell could keep *Thông báo*. Do not rename
either.

Detail takes **`string $slug`, not a bound model** — `Route::get('/announcements/{slug}', …)`
— and that is a decision the review forced the first draft to make. It had written
`{announcement:slug}` and then had the controller re-query by slug, leaving the bound model
unread: two lookups, one of them dead, and a binding whose 404 semantics (any live row on
this shelf) silently differ from the query's (published and unlapsed only). One lookup, one
rule: the controller asks `AnnouncementsQuery::detail($slug)` and `abort_unless` on null, the
same shape the reader book page uses for an unpublished book — which 2a proved matters, when
a draft book became an existence oracle through a sibling POST. The **manager** routes bind
`{announcement}` by id as usual, so no `getRouteKeyName()` override exists on the model and
neither surface forces a key on the other. `RouteOrderTest` requires `role:` on every reader
route regardless, and a `{slug}` parameter is not a model binding, so nothing in the tenancy
layer is skipped: `AnnouncementsQuery` is `BookshelfScope`-scoped like every other query
here, which is what keeps another shelf's slug a 404.

Tests (`arsFix`), separate blocks: the list carries published, unlapsed notices with the
pinned one first; a draft's slug 404s; a lapsed one's slug 404s; a non-member is 404 by the
route group. The frontend blind spot from Task 7 applies unchanged and the commit says so.

```bash
git commit -m "feat: ban tin — the shelf's notices, and one of them on its own page"
```

---

### Task 14: The manager's announcements screen — write, publish, pin, pull

**Files:** `app/Http/Controllers/Manage/AnnouncementController.php`,
`resources/js/pages/manage/announcements/{index,form}.tsx`,
`tests/Feature/Community/ManagerAnnouncementsScreenTest.php`, routes, nav, copy.

**These routes are new**, not placeholder replacements: `routes/web.php` has no
`/manage/announcements` today (checked). They go inside the existing `['auth',
'role:manager']` group. **Declaration order is load-bearing** — `announcements/create`
before `announcements/{announcement}`, or Laravel binds "create" as an id, which is spec §6's
rule and which `RouteOrderTest` pins for the books block; add the same assertion for this
block in `CommunityArchitectureTest` rather than trusting the habit.

The index shows all three states with their chips (`showing` / `draft` / `expired`), each row
carrying only the buttons a command exists for: *Đăng ngay* or *Đăng lại* depending on the
state, *Ẩn* on a showing one, *Ghim* / *Bỏ ghim* on any, *Sửa* always.

**What *Đăng lại* posts is load-bearing and is settled by Task 11, not left to the markup.**
`PublishAnnouncement` refuses an already-published row unless an expiry was **supplied**, and
a lapsed announcement is still published — so a *Đăng lại* button that posts an empty body
refuses, and the button is dead for every manager who does not type a date. This task's
button therefore posts `expires_at` **present and empty** (an explicit null, which Task 11
treats as a supply and which clears the column), and the row offers an optional date field
beside it for a manager who wants one. **Pin it**: a block that posts *Đăng lại* with no date
and asserts a 302 with the success flash, a `published_at` that moved, **and `expires_at`
still null afterwards**, and a second block that posts a date and asserts the column took it.

**That third assertion is not padding and the previous revision omitted it.** Status, flash
and a moved `published_at` all pass under the `CarbonImmutable::parse(null)` trap Task 11
records — the notice would be republished with an expiry equal to the publish instant, lapsing
immediately, and the two blocks would be green. The column's value is the only thing that
tells the two apart. Without all three, Task 11's guard and this screen can disagree with the
whole suite green — which is exactly what the plan's first draft shipped and the review
caught. The form is
single-column with labels above inputs and required fields marked with the word *Bắt buộc*,
never an asterisk (AGENTS.md rule 6), and one primary action.

Tests (`amsFix`), each POST in its own block, plus: a reader is 404 on the index and on each
POST; the create form's blank submit is a field error; and the route-order assertion.

```bash
git commit -m "feat: the announcements screen — write it, post it, pin it, pull it"
```

---

## Slice C — donations

### Task 15: `OfferDonation` — a reader offers books, and the one column in this schema that points at a membership

Read first: `old_next/src/domain/community/commands/donations.ts`'s file docblock **whole**
— it is the specification for the id direction, for why the command is deliberately thin, and
for why this table is the offer and never a copy's provenance — and `offerDonation`. Then
read the `book_donations` migration: the table has **no `deleted_at`**, so the model carries
no `SoftDeletes`, and BR §11's undo does not apply here.

**Files:**
- Create: `app/Actions/Community/OfferDonation.php`, `app/Policies/BookDonationPolicy.php`, `app/Http/Requests/Community/OfferDonationRequest.php`, `tests/Feature/Community/OfferDonationTest.php`
- Modify: `app/Models/Bookshelf.php` (+ `donations()`), `app/Models/BookDonation.php` (+ `donor()` onto `Membership`), `AppServiceProvider`, `lang/vi/rules.php`, `AuditSentences.php` (count → 38), `lang/vi/audit.php`, `RuleViolatedCodesHaveSentencesTest`

**Interfaces:**
- `OfferDonation::execute(User $actor, string $description, ?int $estimatedCount = null): array{donationId: string}` — throws `not_permitted`, `empty_description`; audit `donation.offered`; no notification.

- [ ] **Step 1: Write the failing tests**

Fixture `dofFix`. Blocks, each independently failing:

1. **an offer is stored against the caller's MEMBERSHIP, not their user id** — assert
   `donor_membership_id === $membership->id` **and**, separately,
   `donor_membership_id !== $reader->id`. The second assertion is not redundant: it is the
   whole trap, and a fixture where the two ids happen to be unrelated uuids is exactly the
   construction that makes the mistake visible;
2. an empty description is refused, whitespace included, and no row is written;
3. the estimated count is optional and stores null;
4. **the memberless super admin is refused over HTTP** — divergence 4's second pin, the same
   construction as Task 2's block 6, in its own `it()`;
5. INV-8: the payload carries the status and the count and **not** the description — proved
   key-by-key with `array_key_exists`. (The reference stores the count and not the text; a
   description is free text a child wrote, and BR §14 asks the log to record what changed.)

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement**

```php
<?php

namespace App\Actions\Community;

use App\Exceptions\RuleViolated;
use App\Models\BookDonation;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\ConcurrencyRetry;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Tặng sách — a reader offers books they no longer want. BR §7.7's
 * pending, OPS §4.4's OfferDonation. Port of donations.ts's
 * offerDonation.
 *
 * book_donations.donor_membership_id REFERENCES memberships(id) — a
 * MEMBERSHIP id, which is the reverse of this codebase's recurring trap
 * and the only table in this phase that works this way. decided_by, two
 * columns along and written by the next task, is a users(id) like every
 * other actor column in the schema. Neither is inferable from the column
 * name, both appear in this one table, and OfferDonationTest asserts the
 * stored value is the membership's id AND is not the user's.
 *
 * DELIBERATELY THIN. OPS §4.4 says why: free text and a rough count,
 * "because a child does not know a publisher or an ISBN, and book data
 * is only worth recording once a volunteer has the book in hand". The
 * reference's optional photo is not ported — this app has no uploader
 * and shipping a parameter no caller can supply is the reachable-from-
 * nowhere shape (plan divergence 11).
 *
 * This table is the OFFER, never a copy's provenance. Provenance lives
 * on book_copies.acquired_from / acquired_from_membership_id, written by
 * a different command, and survives the offer being tidied away. There
 * is no foreign key between them, because a bag of ten books can become
 * three catalogued copies, duplicates, or nothing at all.
 *
 * The caller's membership is not an input (plan divergence 4); it comes
 * from the session. not_permitted stays reachable for the same reason
 * CreateComment's does — a super admin passes every act-as-* gate and
 * may hold no membership here — and OfferDonationTest posts that case.
 *
 * No lock: nothing is re-read and no uniqueness rule is guarded. A
 * reader may offer twice; the reference has no duplicate rule and none
 * is added.
 */
final class OfferDonation
{
    public function __construct(
        private TenantContext $tenant,
        private AuditRecorder $audit,
    ) {}

    /** @return array{donationId: string} */
    public function execute(User $actor, string $description, ?int $estimatedCount = null): array
    {
        Gate::forUser($actor)->authorize('create', BookDonation::class);

        $membership = $this->tenant->membership();
        if ($membership === null || $membership->user_id !== $actor->id) {
            throw new RuleViolated('not_permitted');
        }

        $trimmed = trim($description);
        if ($trimmed === '') {
            throw new RuleViolated('empty_description');
        }

        return DB::transaction(function () use ($membership, $trimmed, $estimatedCount): array {
            $donation = BookDonation::query()->create([
                // A memberships(id). See the class docblock.
                'donor_membership_id' => $membership->id,
                'description' => $trimmed,
                'estimated_count' => $estimatedCount,
            ]);

            // status is left to the column default ('pending'), the one
            // place the schema and this command cannot disagree.
            $this->audit->record('donation.offered', 'donation', $donation->id, null, [
                'status' => 'pending',
                'estimated_count' => $estimatedCount,
            ]);

            return ['donationId' => $donation->id];
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
```

`lang/vi/audit.php` gains `'donation_offered' => 'đề nghị tặng sách',` — the reference's
phrase verbatim, naming nothing, so the arm takes no `strtr`.

`OfferDonationRequest`: `abort_unless(Gate::allows('act-as-reader'), 404);` and
`'description' => ['bail', 'required', 'string', 'max:2000', 'encoding:UTF-8']`,
`'estimated_count' => ['nullable', 'integer', 'min:1', 'max:1000']`. Add both to
`lang/vi/validation.php`'s `attributes`.

- [ ] **Step 4: Run, mutation-check, commit**

Mutations: (1) write `$actor->id` into `donor_membership_id` → block 1's second assertion
reddens **and** the insert may still succeed, because `donor_membership_id`'s composite FK
points at `memberships (bookshelf_id, id)` and a user id matches no row — so record which of
the two failures actually arrives, an assertion or an errno 1452, and write the answer into
the test's comment rather than predicting it here; (2) drop the `empty_description` guard →
block 2 reddens; (3) put the description into the audit payload → block 5 reddens.

```bash
git commit -m "feat: offerdonation — a reader offers, against their membership and not their account"
```

---

### Task 16: `ReceiveDonation` and `DeclineDonation` — the decision that writes no book, and the one that must write two columns at once

Read first: `receiveDonation` and `declineDonation` whole. `receiveDonation`'s docblock names
itself "the decision most likely to be 'improved' later by somebody who reasons that a
received donation ought to create its own catalogue entry. **It must not.**" Port that
sentence and the test that backs it.

**Files:** two Actions, `DeclineDonationRequest.php`,
`tests/Feature/Community/DonationDecisionsTest.php`, audit count → **40**,
`donation_not_pending` into `lang/vi/rules.php` and the code census.

**The constraint that shapes `DeclineDonation`:** `book_donations_declined_has_reason` is
`CHECK (status <> 'declined' OR decision_note IS NOT NULL)`. Status and note therefore go in
**one** `update()`, never two — an update that moved the status first raises errno 4025
between the steps, and the sentence a volunteer would read would be a database error rather
than OPS's. Say this in the code, at the update.

The reason is **required and trimmed**, matching every other rejection flow in this catalogue,
and the code is the shared `reject_reason_required` (OPS §4.4 gives this command that same
sentence). The check runs **before** the transaction, so a blank reason never opens one.

**`ReceiveDonation` writes no `books` row and no `book_copies` row**, and the named test
asserts zero of each after it runs — so the convenience fails rather than shipping. The
manager separately runs the add-book form with **Người tặng** pre-filled, which Task 19
wires; the only link between the two tables is the donor's membership id carried by hand.

Tests (`dddFix`), each its own block: receiving flips the status and records `decided_by`
(a **users** id — the second half of the trap, asserted against the manager's user id and
against the manager's membership id being different) and `decided_at`; **receiving writes no
book and no copy**; declining stores the status and the reason together; declining with
whitespace refuses and leaves the row `pending`; an offer is decided once (a `received`
fixture declined throws `donation_not_pending`, and a `declined` one received does too — two
blocks); and INV-8 for both, with the reason travelling into the payload.

Mutations: (1) split the decline into two `update()` calls → the decline block reddens with
**errno 4025**, which is the constraint doing exactly what its own name says; record the
message; (2) make `ReceiveDonation` create a `Book` → the no-book block reddens; (3) fold
"no such offer" into `donation_not_pending` rather than letting the binding 404 → nothing
reddens, and that is divergence 3 being a convention rather than a guard — say so.

```bash
git commit -m "feat: receivedonation and declinedonation — accepted, or refused with a reason"
```

---

### Task 17: `MyDonationsQuery` and `DonationQueueQuery` — a reader's own offers, and a queue that drains

Read first: `get-my-donations.ts` whole. Its docblock's warning is the test this task owes:
"Comparing a user id here matches nothing, which would read as *this reader has never offered
anything* rather than as an error."

**Files:** two query classes, `tests/Feature/Community/DonationQueriesTest.php`.

**Interfaces:**
- `MyDonationsQuery::run(Membership $membership): list<…>` — the caller's own offers, newest first, carrying the status and, for a declined one, its `decision_note`, **because that note is the whole reason a decline requires a reason: the reader reads it.** The parameter is a `Membership`, not a `User`, and the type is the guard: passing the wrong id becomes impossible at the call site rather than silent at the predicate.
- `DonationQueueQuery::run(): list<…>` — `pending` only, **oldest first**, with the donor's name and their membership id, because BR §16.3 makes *Duyệt* open the add-book form with **Người tặng** pre-filled: the screen needs the name to show and the id to pass on.
**There is deliberately no `countPending()` on the donation queue**, and it is absent from
the list above rather than declared-and-then-forbidden (the first draft declared it in
Interfaces and told the implementer not to write it, which is a contradiction a reader
resolves by writing it). `ManagerDashboardQuery`'s docblock names BR §16.3's four cards and
all four are accounted for after Task 6; a fifth with no requirement behind it, or a counting
method with no caller, is the reachable-from-nowhere shape divergences 9 and 11 already
refuse.

Tests (`dnqFix`), each its own block:

1. **a reader sees their own donations, scoped by membership and not by user** — seed two
   readers' offers, read as one, assert by id;
2. **the same query given a user id returns nothing** — not a block that can be written
   through the typed API, and that is the point: record in a comment that the type makes it
   unwritable, and pin the *predicate* instead by asserting the returned rows' donor ids
   equal the membership's id;
3. a declined offer carries its reason back to the reader;
4. the queue is pending only — seed one of each status;
5. the queue is oldest first — **seed out of order**;
6. the queue carries the donor's name and membership id;
7. another shelf's offers appear in neither, in its own `it()`.

The queue joins `memberships` and `users` for the donor's name. `BookDonation` carries
`BelongsToBookshelf`, so tenancy is the model's; use the `donor()` relation with
`with('donor.user')` rather than a raw `join`, for the reason Task 5 gives — a `join`
condition is `TenancyArchitectureTest`'s documented blind spot and there is nothing to gain
from entering it.

Mutation: compare `donor_membership_id` against a user id in `MyDonationsQuery` → block 1
reddens with an **empty list**, not an error, which is the failure mode the reference warns
about, and the block's message should say so.

```bash
git commit -m "feat: the donation queries — my offers by membership, the queue oldest first"
```

---

### Task 18: The reader's *Tặng sách* screen and their own offers

**Files:** `app/Http/Controllers/Reader/DonationController.php`,
`resources/js/pages/shelves/donate.tsx`, `resources/js/pages/shelves/profile/donations.tsx`,
`tests/Feature/Community/ReaderDonationsTest.php`, routes, copy.

Two placeholders become real, **both keeping their route names**: `shelves.donate` (the offer
form, inside the reader group) and `shelves.profile.donations` (the reader's own list, inside
the profile group). A note in `docs/known-gaps.md` records that `donate` is a **308 redirect**
in the reference rather than a page, and says Phase 1's author should model it as a redirect
— **that entry is now stale in one half and this task settles it**: this plan builds
`donate` as the offer form itself, because the reference's redirect points at the page this
task ships and a redirect to one's own form is a hop with no purpose. Task 20 amends the
entry rather than leaving a note that contradicts the code.

The form is single-column: a `Textarea` for the description marked *Bắt buộc*, an optional
number for the rough count, one primary action. No photo field (divergence 11). The list
shows each offer with its status word and, for a declined one, the manager's reason —
`StatusBadge` is for the six copy states, so these use `Pill`, which requires both an icon
and a label (AGENTS.md's component table).

Tests (`drsFix`), separate blocks: the form POSTs and creates an offer against the caller's
membership; the list shows the caller's offers and not another reader's; a declined offer's
reason reaches the props; a blank description is a field error; a non-member is 404 from the
route group.

```bash
git commit -m "feat: tang sach — a reader offers books, and reads what was decided"
```

---

### Task 19: The manager's donation queue, and the handoff to the add-book form

**Files:** `app/Http/Controllers/Manage/DonationController.php`,
`resources/js/pages/manage/donations.tsx`,
`tests/Feature/Community/ManagerDonationsScreenTest.php`, routes, nav, copy.

**New routes** (there is no `/manage/donations` today), inside the manager group, `create`-
style static segments before any bound one, with the order assertion added to
`CommunityArchitectureTest` beside Task 14's.

The queue lists pending offers oldest first with the donor's name, the description, the rough
count and the date. Two actions per row: **Duyệt** and **Từ chối** (the reason inline in the
row's own form).

**The handoff is the interesting half, and the answer is already known: the pre-fill does
NOT ship in this phase.** The plan's first draft wrote it as a question to answer with the
files open, and the review answered it by opening them: `StoreBookRequest` does validate
`donor_membership_id` (`bail, nullable, uuid, prohibits:donor_name`, with an existence check
through `Membership::query()`), but `resources/js/pages/manage/books/create.tsx` has **no
such field** — not in its form type, not in its `useForm` seed, not in its transform, and the
controller passes no donor prop. BR §16.3's *Duyệt* → "add-book form with **Người tặng**
pre-filled" therefore needs a member picker on that form, which `docs/known-gaps.md` records
as deferred out of 1a for want of `GetReadersList`.

So this task ships the **fallback**, deliberately and up front: *Duyệt* performs
`ReceiveDonation` and redirects back to the queue with the donor's name in the success flash,
so the volunteer knows whose bag they are holding when they walk to the add-book form. Task
20 amends the known-gaps entry that says the pre-fill "is Phase 2's, and lands on this same
field" to say what actually shipped and what is still owed — one field on one form, plus the
query-parameter seed — rather than leaving a note that reads as done.

Whatever the outcome, the docblock states the rule the reference states: **receiving writes
no book**, and the pre-fill is a convenience on a separate command that a manager runs with
the books in their hands.

Tests (`dmqFix`), separate blocks: the index renders the queue; *Duyệt* receives and
redirects to the queue with the donor's name in the flash (assert the name, since that flash
is the whole of the handoff this phase ships); *Từ chối* declines with its reason and refuses
without one as a field error; a reader is 404 on
the index and on each POST, each in its own block; and the route-order assertion.

```bash
git commit -m "feat: the donation queue — decided oldest first, and the donor handed to the form"
```

---

### Task 20: The guarantee sweep — the OPS §4.4 walk, the durable record, the seeder, and the mutations this phase's claims rest on

This task writes no feature. It exists because 1d and 2a both found, at exactly this point,
that the branch was shipping claims nobody had re-run.

- [ ] **Step 1: The gates, whole**

Run the full suite, Pint, Larastan level 8, Biome, tsc and the Vite build, and **paste the
numbers** — not "all green". Then run, and paste the empty output of:

```bash
git diff origin/main...HEAD -- old_next/
```

Biome must be at the inherited baseline exactly — three warnings, one info — and if it is
not, the delta is this branch's and is fixed here, not recorded.

- [ ] **Step 2: The OPS §4.4 walk — perform it, do not read it**

Walk `docs/OPERATIONS.md` §4.4 command by command against the shipped code and write down
every disagreement, with the code opened rather than remembered. The ones this plan already
predicts, so that finding them is confirmation rather than discovery:

- OPS's failure-mode lists abbreviate three codes the reference's `errors.ts` spells in full
  (`not_pending` / `not_approved` for comments, `not_pending` for donations, and
  `validation_failed` where `announcement_fields_required` is thrown). The commands throw
  `errors.ts`'s spellings, per the two-ledger rule 1c established with `title_has_no_copies`.
  **This is a documentation lag, not a contract change** — decide whether it is fixed here as
  a §4.4 edit or raised at the PR as a one-row edit, and say which, following 2a's precedent
  that a wrap-up is the wrong place to edit a shipped command's OPS entry unannounced.
- `write_target_not_found` is thrown by nothing in this port (divergence 3) **and has no
  sentence here either** — measured on the shipped file: `lang/vi/rules.php` returns **68**
  keys and `array_key_exists('write_target_not_found', …)` is false. So there is no orphan to
  record: what goes on the record is the **substitution** — route-model binding answers 404
  where the reference threw this code — and nothing is added to `lang/`. **This bullet is the
  correction of a correction**: divergence 3 was fixed in the previous round while this step
  still carried "its sentence stands in `lang/vi/rules.php`. Record it", which would have
  written a false entry into the document whose own Step 3 opens "a known-gap that has
  silently become false is worse than one that is missing".
- OPS §4.4's own two open questions about **feedback** are untouched by this phase, and the
  §4.4 entries for `SubmitFeedback`, `MarkFeedbackRead`, `ResolveFeedback` and
  `ArchiveFeedback` describe commands nothing implements. Record that as **deferred to Phase
  3 with this plan's four reasons**, not as a gap.
- OPS §4.4's pin-cap open question is settled at "no cap" by this port, matching the
  reference. Record the decision where the question is.

- [ ] **Step 3: `docs/known-gaps.md` — add what is new, and AMEND what this branch made false**

The document has been factually wrong sixteen times, always the same way: a plausible claim
written without being run down. **A known-gap that has silently become false is worse than
one that is missing**, so this step is half additions and half amendments.

New entries: divergence 3's within-shelf existence oracle for managers; divergence 2's
`allow_comments` documentation lag and the key `/manage/settings` must write; divergence 5's
dropped `bodyText` with exactly what a rich editor restores; divergence 9's dropped `bookId`
narrowing with the reference's shape; divergence 10's payload-less `comment_approved` and the
one-line shape an improvement would take; divergence 11's absent photo; the duplicated
wall-clock regex from Task 1 step 3; the absence of any rate limit or duplicate rule on
comments and on donations (the reference has neither, and a reader can post unboundedly);
and the deferred feedback slice with its four reasons and the OQ1 answer if one arrived.

Amendments — each of these is a **shipped** entry this branch falsifies, and leaving any of
them standing is the failure mode:

- **`Bookshelf::feedback()` has no test of its own**, whose text says "Phase 2, which is
  where the relation gets used for real, is the natural place to add the test alongside the
  first real caller." Phase 2b does **not** use it. Amend with the cut, or the next reader
  goes looking for a caller that does not exist.
- **the `donate` 308-redirect entry**, settled by Task 18.
- **the donation-queue pre-fill entry**, settled by Task 19 with whatever actually shipped.
- **`GetShelfHome` is deferred to Phase 2, whole**, whose stated reason is that its
  centrepiece is a Phase-2 announcement card. That card is now computable; the entry must say
  what still blocks the page (its *Góp ý* card, from the deferred slice) rather than a reason
  that has expired.
- **the OPS §3.3 walk table, which is stale in FOUR cells and one whole row** — the first
  draft of this step named two of them, and the review found the rest, which is exactly what
  this step's own count-word grep exists to catch. Its `GetBorrowRequestQueue,
  GetDonationQueue, GetCommentsList, GetAnnouncementsList (manager)` row says "**Phase 2** —
  no matching class under `app/Queries`" for all four: `GetBorrowRequestQueue` was answered
  by 2a's `BorrowRequestQueueQuery` and the row was already stale before this branch;
  `GetCommentsList` and `GetAnnouncementsList` are answered by Tasks 6 and 12;
  `GetDonationQueue` by Task 17. **The row has nothing left in it** — name all four classes
  and strike it. And the neighbouring `GetManagerDashboard` row still reads "narrowed to two
  of BR §16.3's four stat cards" and lists the two: it became three at 2a and four here, and
  it appears in no list the first draft wrote.
- **the reader-detail entry** saying the page ships "without its Xin mượn button, comments,
  or the manager's lend/return shortcuts" — two of those three are now false.
- **`$guarded = []` leaves `Comment::moderated_by` mass-assignable** — this phase ships the
  Form Requests that gate the comment surface; re-read the entry and say precisely which half
  of it is now closed and which is not.

Then run the sweep this project's own rule requires: **grep for the words that COUNT things**
(`the two`, `both`, `the only`, `exactly`, `no other`, and bare numerals) across every file
this branch touched, because a phrase-scoped grep finds what you remember and a count-word
grep finds what your change broke. Every enumeration this branch shipped gets run down; this
plan's Context and Divergences sections included.

- [ ] **Step 4: `DemoShelfSeeder`**

Extend it, deterministically, so `make fresh` produces a shelf a person can look at: one
pending comment and one approved comment on a seeded book, one pinned published announcement
and one draft, and one pending donation offer. The seeder stays gated behind
`app()->environment('local')` and `SeederTest` — which forces the environment to
`production`, runs the deploy's own `db:seed --force`, and asserts nothing the demo seeder
writes exists — must stay green **with the new rows added to what it asserts absent**. That
test exists because `deploy/post-deploy.sh` runs `db:seed --force` unconditionally.

- [ ] **Step 5: The mutation checks this phase's headline claims rest on — perform all of
  them, restore each, and `git status --porcelain` clean between**

1. **Move `ApproveComment`'s `notify` call to after its transaction returns** →
   `NotificationsAreReaderFacingTest`'s fourth block reddens naming that file and its line,
   and **nothing else in the suite does**. That number is the measurement of how much this
   phase's notification guarantee rests on one architecture test.
2. **Drop `ConcurrencyRetry::ATTEMPTS` from one community transaction** →
   `CommunityArchitectureTest`'s retry block reddens; its non-vacuity block stays green.
3. **Delete the `status = approved` predicate from `BookCommentsQuery`** → the INV-9 suite
   reddens in more than one block. Paste the count. This is the phase's headline invariant
   and "it is enforced" is a claim, not a fact, until this number exists.
4. **Delete `BelongsToBookshelf` from `Comment`** → **`2 failed, 22 passed`** across
   `TenancyArchitectureTest` and `TenantIsolationTest`: the first's "puts BelongsToBookshelf
   on every model whose table carries bookshelf_id" block, and the second's "shows every
   trait-carrying model only its own colliding rows" block. **This bullet exists because Task
   5 gave the pin away to this step and the first draft of this step did not have it** — a
   pin handed to nobody is worse than one never claimed. Repeat it for `Announcement` and
   `BookDonation`, both of which that dataset has named since Phase 0. Measured on the
   revision of this plan, at the 1,272-passing baseline.
4b. **Add a hand-written `where('bookshelf_id', …)` to any new query** →
   `TenancyArchitectureTest`'s *allow-list* block reddens naming that file — a different
   block from 4's, and the first draft ran the two together. This proves this phase added **no**
   entry to that whole-file allow-list, which is the thing the allow-list's own comment says
   is spent permanently once added.
5. **Gut `OPS_SECTION_7` to `[]`** → its own second block reddens, so the census cannot be
   emptied silently.
6. **Empty `AuditSentences::ACTIONS`' community entries one at a time** →
   `AuditActionCensusTest` reddens in both directions.

```bash
git commit -m "docs: the phase 2b guarantee sweep — the ops walk, the record, and the mutations"
```

---

## Self-review (performed at planning time)

**What was verified by opening the file**, rather than remembered: all four Phase 0
community migrations and their constraints; the four models and their traits, casts and
`$guarded` values; `BookshelfScope`, `BelongsToBookshelf` and `TenantContext`'s public
surface; `AuditRecorder` (including the `RuntimeException` that grounds the feedback cut) and
`AuditSentences`' `ACTIONS`/`GROUPS`; `AuditActionCensusTest`, `TenancyArchitectureTest`,
`NotificationsAreReaderFacingTest`, `CirculationArchitectureTest`'s walk helper and its
hardcoded root, `CatalogueArchitectureTest`, `PolicyRegistrationTest` and `RouteOrderTest`;
`RuleViolatedCodesHaveSentencesTest`'s list; `AuditSentencesTest`'s hardcoded group list and
its `toHaveCount(27)`; `routes/web.php` whole; `bootstrap/app.php`'s `RuleViolated` renderer;
`AppServiceProvider`'s `Gate::before` and role gates; `LendingSettings`, `Slugs`,
`ConcurrencyRetry`, `AuditSecrets`; `BorrowRequestPolicy`, `BorrowRequestController`,
`RejectBorrowRequestRequest`, `MyNotificationsQuery`, `ManagerDashboardQuery`,
`BookDetailQuery`; `lang/vi/{rules,audit,notifications}.php`; `resources/js`'s page and layout
inventory and `copy.ts`'s head; `Makefile`; and, in `old_next/`, the whole of
`domain/community/` plus `kernel/errors.ts`'s community block and `kernel/audit-actions.ts`'s
community entries, and OPS §4.4 whole.

**What was NOT verified and is inferred**, stated so a reviewer can aim at it:

- **The five complete PHP files in this plan were checked mechanically, and here is exactly
  how, because "all blocks pass" has been a false claim on this project three times.** This
  plan holds **ten** fenced `php` blocks: **five are complete files** and **five are
  fragments** (a validation rule, a route line, a guard clause, a ternary, a `record()` call).
  The five complete files — `CommentSettings`, `CreateComment`, `ApproveComment`,
  `BookCommentsQuery`, `OfferDonation` — were extracted, written to their real paths, and run
  through `vendor/bin/pint --test` (**PASS, 5 files**) and `vendor/bin/phpstan analyse` at
  level 8 against this repo's own `phpstan.neon` (**[OK] No errors**). To make that run
  possible, two things the plan's own tasks add were staged with them: `NotificationKind`'s
  `CommentApproved` case and `Comment`'s `book()`/`author()` relations. Everything staged was
  then removed and the tree returned to `git status --porcelain` clean, with Larastan green on
  the untouched repo.
  **Re-run unchanged after this revision's edits** (the `CreateComment` block was widened to
  return its `status`): Pint **PASS, 5 files**; Larastan level 8 **[OK] No errors**; tree
  returned clean.
  **The first run found two real defects in this plan's own drafts, both fixed in the text:**
  `created_at?->toISOString()` is a level-8 `nullsafe.neverNull` error (the shipped
  `MyNotificationsQuery` spells it without the nullsafe and the reason is the property's
  non-nullable type), and `Comment::author()` needs its foreign key named explicitly or
  Eloquent derives `user_id`.
  **The five FRAGMENTS were not checked by anything** — they are not parseable alone — and
  neither is any test block, any TypeScript, or any prose instruction in this plan.
- **Passing Pint and Larastan is not passing the suite.** Neither tool catches a wrong column
  name that happens to type-check, a relation that resolves but joins the wrong rows, or an
  Eloquent behaviour I have assumed. **No block was executed against the database.**
- **One claim in the plan text was measured rather than asserted:** adding a
  `NotificationKind` case without its `NotificationSentences` arm is a Larastan error, not a
  test failure — reproduced verbatim as
  `Match expression does not handle remaining value: …NotificationKind::CommentApproved`
  (`match.unhandled`) during the staging run above. Task 3 states that mechanism and it is
  true.
- **`ManagerBookDetailQuery` was not opened.** `StoreBookRequest` and
  `manage/books/create.tsx` **were** opened by the review, which is why Task 19 now states
  the answer (no pre-fill this phase) instead of posing the question — one of three places
  the review landed exactly where this section aimed it.
- **`resources/js/pages/shelves/book.tsx` was not read in full** (its line count and its 2a
  request panel were). Task 7 says to read it whole first.
- **`lang/vi/validation.php` was not opened**; the instruction to add attribute names comes
  from the known-gaps entry describing that file's shape, not from the file.
- **`AuditSentences::phrase()` fails SOFT where `NotificationSentences::sentence()` fails
  hard**, and the first draft stated the Larastan mechanism for notifications and said nothing
  for audit — right by omission, wrong by silence, since every task here adds arms to both.
  The `default => self::line('unknown')` arm is now stated in Task 2, where the first audit
  arm lands: a missing audit arm renders the undescribed-action fallback to a volunteer and is
  caught by `AuditActionCensusTest`'s set-equality, never by the compiler.
- **No lock-order claim in this plan has been measured with two OS processes**, and none is
  made. Divergence 1 argues for the retry from the shape of the shipped FK edges and
  explicitly claims neither reachability nor unreachability nor frequency.
- **The `AuditSentencesTest` count arithmetic (27 → 40) is arithmetic**, not a measurement;
  it will be wrong the moment any task adds or drops an action, and each task's step that
  bumps it is the place to re-derive rather than trust it.
- **`git diff origin/main...HEAD -- old_next/` was not run** at planning time; Task 20 runs it.

**Where this plan is most likely to be wrong.** The three UI tasks (7, 8, 14, 18, 19) specify
props, routes and tests but not markup, and this repo has **no frontend rendering tests at
all** — so their acceptance is by reading, and the plan says so at each of them rather than
implying a coverage that does not exist.

## Execution notes

- **Every dispatch carries this instruction and it is load-bearing:** when a brief's claim
  disagrees with what you measure, **measure and refuse the brief**. Four of 2a's twelve
  false claims were the coordinator's, every one caught by an implementer who ran the thing
  instead of complying. This plan is not exempt: where a step says "measured", it means the
  implementer measures it, not that the planner did.
- **Read the neighbouring comments your change falsifies**, and grep for count-words rather
  than for the phrase you remember.
- **Do not write a complete enumeration.** Describe the mechanism, name the doors, and keep
  only claims a test pins. Five of them were wrong on the previous branch, twice inside the
  corrections themselves.
- **Do not cite line numbers into files that can move.** Cite the file plus the symbol.
  Coordinates into `old_next/` and `lang/` are fine — those are frozen.
- **A justification for not measuring something is itself a claim**, and it was wrong twice
  on the previous branch. Give it the scrutiny you would give a measurement.
