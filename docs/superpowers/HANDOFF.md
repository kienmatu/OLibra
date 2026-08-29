# Handoff — Laravel migration

Committed on purpose: the per-task ledger under `.superpowers/sdd/` is gitignored and
dies with its plan, so this file is what lets a **different session** pick the work up.
Update it as each task lands.

**Last updated:** 2026-08-29. Phase 1 is COMPLETE — #63 merged, `main` = `317a3b3`.
Phase 2 (Community) has started on `feat/phase-2-community`; the plan is being written.

## Where things stand

| Phase | Plan | PR | State |
|---|---|---|---|
| 0 Foundation | `plans/2026-08-26-…-phase-0-foundation.md` | #57, #59 | merged |
| 1a Catalogue | `plans/2026-08-27-laravel-phase-1a-catalogue.md` | #60 | merged |
| 1b Members | `plans/2026-08-28-laravel-phase-1b-members.md` | #61 | merged |
| 1c Circulation | `plans/2026-08-29-laravel-phase-1c-circulation.md` | #62 | merged (`main` = `6661991`) |
| 1d Oversight | `plans/2026-08-29-laravel-phase-1d-oversight.md` | #63 | merged (`main` = `317a3b3`) |
| **2a Requests & holds** | being written | not opened | **in progress** |
| 2b Community voice | not written | — | — |
| 2c Statistics & labels | not written | — | — |

Phase 1 (1a–1d) IS BR §1.4's core loop, and it is done. Next: Phase 2 (Community), then
3 (Network), 4 (Cutover).

**Why Phase 2 is split into 2a/2b/2c.** Spec §11 lists nine features under one phase
(borrow requests, holds and the queue, comments and moderation, announcements, feedback,
statistics, donations, notifications and the reminder sweep, QR labels) — the same
over-wide shape Phase 1 was split for. The cut:

- **2a — requests, holds, notifications, the sweep.** These are one unit, not three:
  `ReceiveReturn` was deliberately NARROWED in 1c (its docblock says so) pending borrow
  requests — `holdForRequestId`, `queuedRequestId`, the `request.approved` pairing and the
  notification all come back here, in one transaction, so a returned copy is never
  observably available to a stranger while a queued reader waits. The reminder sweep is
  the second `Schedule::` line Phase 0's plan reserved for it.
- **2b — community voice.** Comments and moderation (INV-09 visibility), announcements,
  site feedback and its inbox, donations.
- **2c — statistics and QR labels.**

## Phase 2a — current position

Branch `feat/phase-2-community`, cut from `main` at `317a3b3`.

Plan written by Fable and committed at `49e6c93`:
`plans/2026-08-29-laravel-phase-2a-requests-and-holds.md`, **19 tasks**, 6,130 lines.
Both of its open questions are ANSWERED (see rulings below) — Task 18 executes.

**Plan review 1 (Opus): CHANGES REQUESTED** — six Criticals, eleven Importants, every one
found by RUNNING the plan's own code rather than reading it: a false no-deadlock claim
contradicted by shipped code (`UpdateBook` X-locks `bookshelves` then the book row, closing
a cycle with the plan's new book lock); the phase's notification census RED on the very
commit introducing it (`AuditSentences` already carries `'membership_approved'` as a lang
key, so it counted as a notification writer); `(string)` on an enum-cast attribute fataling
every queue row; Task 10's "never observably available" assertion matching its own
`... for update` SELECT; **14 of 41 literal PHP blocks failing Pint** (the seventh time on
this project); `NotificationSentences` failing Larastan three ways; and — the 1d lesson
again — the phase's headline guarantee (the notification lives inside the command's
transaction) breakable with the whole suite green.

**Fix round (Opus, `f68f8f8`).** It rejected the review's own default on the deadlock and
changed the design: **`CreateBorrowRequest` takes no lock at all.** The duplicate rule
becomes a partial unique index — `borrow_requests.live_request_key`, a STORED generated
column `IF(deleted_at IS NULL AND status IN ('pending','approved'), CONCAT(book_id,':',
member_id), NULL)` under UNIQUE, the shape `loans.active_copy_id` and `bookshelves.
slug_active` already use; the friendly sentence stays a plain read, the losing racer's 1062
goes through the shipped `UniqueViolation::translate`. Its reason for refusing the review's
"serialise on `bookshelves`": that creates a NEW cycle with `UpdateReaderProfile`
(X `memberships` → X `users` → audit insert → S `bookshelves`, against X `bookshelves` →
audit insert → S `users`) — the family known-gaps already reproduced with `pcntl_fork`.
DDL verified live against `laravel-mariadb-1`. No cycle-freedom claim survives in the plan.

**Plan review 2 (fresh Opus, told to attack the index design hardest): CHANGES REQUESTED,
but the design SURVIVED.** It re-ran every live-DDL claim against a scratch clone of the
real schema and all of it held — the 1062 message text verbatim, `approved` holding the
key, all five terminal statuses and both soft-delete shapes freeing it, `down()` reversing,
`UniqueViolation::translate` matching the constraint name, both refusal doors rendering the
same sentence with the loser rolling back whole. The rejection of "serialise on
`bookshelves`" was confirmed correct on the cycle ground.

Its two Criticals were about the FIX, not the design:

- **The new notify-inside-transaction guard was broken in both directions.** Blind to
  `$this->notifier?->notify(...)` (`?->` is a different token), so an Action written that
  way could move its notify outside the transaction and the guard would see zero calls —
  Phase 1d's finding reproduced *inside the guard built to prevent it*. And an interpolated
  Vietnamese string inside a closure (`"bản {$code} …"`) unbalanced its brace ledger, so
  CORRECT code reported as an offender — which is how a guard gets deleted.
- Two blocks failed Larastan level 8 while the plan claimed all of them passed (the
  seventh occurrence of that claim being wrong).

Plus a justification that was **false**: "option 2 would queue every *Xin mượn* behind a
bulk `AddCopies`" — measured with two live transactions, the wait already exists through
the FK's shared lock. It was about to be written into `known-gaps.md`.

**Fix round 2 (`b15f582`).** Guard rewritten to skip strings and heredocs wholesale (which
subsumes the brace fix and also kills the `"$obj->notify"` and heredoc false call sites);
both failure modes added as named mutation checks. The false justification is recorded **as
withdrawn** with its measurement rather than deleted. The lock-claim sentences restated:
the index relocates serialisation into the insert's implicit exclusive record lock, the
loser blocks until the winner commits and then gets 1062.

**Verification of fix round 2: APPROVED — code may start.** The rewritten guard was
attacked as new code and held across 32 cases: the nine-case corpus, 23 adversarial ones
(`${...}` interpolation, nested interpolation, a heredoc containing a literal
`DB::transaction(`, a nowdoc, backticks, a method literally named `transaction`, an
abstract declaration, `finally` on both sides, a class body inside `if (true)`, chained
`DB::connection()->transaction()`, two files where one has no transaction at all) and both
named mutants. Larastan's "43/43 clean" claim — wrong twice before — was true this time,
and both counterfactual errors were reproduced verbatim.

Its findings were accuracy defects, fixed in `e680f1d`:

- the bullet stating what was NOT checked **was itself over-claiming** — only two of the
  shipped-file fragments were ever staged for Larastan; it now names the four that were not
- the one surviving justification for taking no lock **cited three line numbers shifted by
  one** and omitted the audit insert, contradicting the known-gaps entry it cites
- the fixture rule applied to `copy_id` was **half-applied**: the same approved row still
  had the reader deciding their own request. `drhFix` now seeds a manager.
- the guard's documented conservative case was **narrower than the guard** (a
  variable-assigned closure and a first-class callable also report), and it has **no
  receiver filter at all** — the first `$user->notify(new Foo)` anyone writes will redden
  the headline guard on correct code. Both bounds are now written down, and the pre-filter,
  which was narrower than the walk it guards, is widened.

## Phase 2a — task ledger

Plan `49e6c93` → review 1 → fix `f68f8f8` → review 2 → fix `b15f582` → verification →
accuracy fixes `e680f1d`. Then per task: implement → review (fresh agent) → fix round.
Nothing merged; no PR open.

- **1 groundwork** — `555f9a8`, `cc2ee28` · approved. The `live_request_key` index, `RequestRules`,
  `LoanTerms::holdExpiry`, the `LendingSettings` days, the `AuditLogQuery` subject join, the
  eleven sentences. Review's four must-fixes: a docblock claiming no writer had ever written
  `$.userId` (three shipped actions had, since 1b); the new audit join **unguarded** (breaking it
  left all 1,044 tests green) — pinned rather than deferred; a stale plan file-map line still
  saying "book lock first"; and "3 days is exactly 72 hours, no DST" (measured **71** across a
  spring-forward). The migration's two DDL statements now roll back as one.
- **2 notifications** — `cb67f1e`, `a196b17` · approved. The write path plus the phase's headline
  guard. **The review broke that guard while it was green:** its `$checked >= 2` floor does not
  grow, so adding one compliant call covered a writer that had moved its notify outside the
  transaction. Floor now derived per file from `OPS_SECTION_7`. The guard also armed on ANY
  identifier named `transaction` (a property or method by that name made a call invisible), so
  "a false alarm, never a silent pass" was false. Then the fix round found a **fifth** defect the
  reviewer's 28-shape sweep missed: nested interpolation `"a {$o->m("b {$p->q}")} c"` desynced the
  quote toggle and reddened CORRECT code — string tracking deleted entirely in favour of counting
  `T_CURLY_OPEN`. 35-case attack set, 0 mismatches. `known-gaps` was false again (7th).
- **3 policy + binding** — `fe23d54`, `01e2aa8` · approved. Nine actor cases, not the plan's two.
  The review disproved the premise the whole test file rested on: **Laravel re-bootstraps per test
  file**, so no runtime-registered route survives — `Route::has(...)` could never be true, and the
  probe was carrying neither `auth` nor `role:reader` while the real routes will carry both. Probe
  moved onto the real URI and the real stack; three new tests it unlocks. The implementer then found
  dropping `auth` left all 18 green (`EnsureShelfRole` redirects a guest by itself on a KNOWN slug),
  and pinned it with an unknown-slug case. New `PolicyRegistrationTest` covers all five policies,
  derived both ways.
- **4 `CreateBorrowRequest`** — `fe55f57`, `75f9c36` · approved after 1 review round. The session
  running this task was CUT OFF mid-dispatch: its implementer died leaving an uncommitted test file
  and no Action, and the file carried three deviations from the plan's test block, each justified by
  a "measured" comment that could not have been measured because the Action never existed. All three
  were re-run by the replacement and all three held — the suspended reader really does hit
  `AuthorizationException` before the Action's own INV-4 branch (the shipped 1c `RenewLoanTest`
  shape); the gate-opened defence-in-depth probe is the only thing that reaches either inner guard;
  and `AuditSentencesTest` really has no every-action-renders sweep, so deleting the lang line left
  the whole suite green (the plan's own escape clause then requires the render test, which shipped).
  The review's Important was this project's signature failure mode once more: the Action's docblock
  and a test comment both claimed the `act-as-reader` gate refuses "no membership at all", so
  `not_permitted` was defence in depth. **`Gate::before` returns `true` for any `act-as-*` when
  `is_super_admin`**, and `ResolveTenant` filters on `status = Active`, so a super admin on a shelf
  they do not belong to passes the middleware and the policy with a NULL membership and lands on
  that throw. It fails closed, but the comments said the path could not exist and Task 12 would have
  read them. Two of the coordinator's own fix instructions were wrong and the implementer measured
  them down: splitting the actor switch into two `it()` blocks fixes nothing (the first `actingAs`
  is inside `cbrFix` itself), and the suggested `getQueryLog()` layer-pin is a **tautology** —
  `Connection::run()` logs only after the callback returns, so a throwing insert is never logged
  (`getQueryLog()`=0, `beforeExecuting()`=1). `DB::beforeExecuting` shipped instead.
- **5 `ApproveBorrowRequest`** — `cda2f7c`, `b3e144c` · approved on the FIRST review with zero
  Criticals and zero Importants, the first task this phase to manage that. The reviewer spot-checked
  every external citation the new comments make — `kinds.ts:73-74`, `audit-actions.ts:407-410`,
  `OPERATIONS.md:1119-1126`'s eight-row table, the `ascii_bin` column behind the measured errno
  1267, the SoftDeletes claim, the census-exclusion claim — and all of them held. It also checked
  the lock order against every shipped circulation command (`LendCopy` copy→membership,
  `ReceiveReturn` copy→loan, `VoidLoan` copy→loan, `RenewLoan` loan-only, this one copy→request)
  and confirmed nothing else in the codebase locks a `borrow_requests` row, so no AB–BA pair is
  introduced. Seven Minors; four were fixed in `b3e144c` (a comment crediting the audit entry with
  storing the title when only the notification does; a `known-gaps.md` entry claiming a stronger
  route pin than the test's three URI fragments catch; a doubled `Clock::now()` whose two instants
  differ in production; an inert `orderBy` implying queue semantics `copyHoldable` does not have).
  **A new trap worth knowing:** `CirculationArchitectureTest`'s no-wall-clock grep reads RAW source
  including comments, and its lookbehind exempts only `->`, so writing the literal `Clock::now()`
  *in a comment* reddens the suite. Measured, and now recorded in the comment that hit it.
- **6 `RejectBorrowRequest`** — `78ce05d`, `257ee6c`, `b42b7fe` · approved after 2 review rounds.
  A faithful mirror of Task 5 (the reviewer credited what was correctly NOT copied: no
  `TenantContext`, no copy lock, no `LendingSettings`), and every citation in its comments was run
  down and held. Its Important was the **fifth** occurrence of the `SessionGuard` family: the INV-8
  test did not pin `actor_id`, and the report's defence of that was false — `decided_by` comes from
  the `$actor` parameter every test passes explicitly, `actor_id` from `Auth::id()`, and the two are
  unconnected. The consequence was traced rather than asserted: `audit_log.actor_id` is nullable,
  `AuditLogQuery`'s actor join is a LEFT join, and a null actor renders the `system_actor` fallback,
  so a silent actor-switch failure left all five tests green. Fixed, then MEASURED — removing the
  fixture's sign-in reddens exactly the new assertion (`null` against the manager's uuid).
  **Round 2 was the coordinator's own error, and it is the eighth occurrence of the family.** The
  round-1 reword I supplied — "all three are one answer to the caller — a 404" — was false:
  `bootstrap/app.php:93` renders `RuleViolated` as `back()->withErrors(['rule' => ...])`, a 302
  carrying the Vietnamese sentence, never a 404 and never a 500. Only the two
  `ModelNotFoundException` cases 404. The docblock now states the narrower property that is actually
  true: "no such request" and "another shelf's" are indistinguishable FROM EACH OTHER, which is the
  anti-enumeration guarantee, while "already decided" is a redirect that leaks nothing because
  `findOrFail` ran first and did not throw, so the request is already known to be the caller's own
  shelf's. Round 2 also fixed a process gap: round 1 had left no trace in its report file.
- **7 `CancelOwnRequest`** — `1cdb15f`, `23cfca1` · approved after 1 review round. The hardest of the
  three request commands, and it came back clean on both named risks, each reasoned independently
  rather than accepted: the copy→request lock order is identical to `ApproveBorrowRequest` and adds
  no AB–BA pair beyond divergence 1's admitted window, and the guarded release reads the LOCKED row
  rather than the route-bound snapshot and derives `releasedCopyId` from the affected-row count —
  **stricter than the reference it ports**, which computes that from a pre-read state and so reports
  a released copy it did not release on a lost race. The implementer refused two of its own brief's
  claims after running them down, one of them the 404-vs-302 confusion the coordinator had shipped
  at Task 6. Its Important was the ninth occurrence of the family: a docblock parenthetical claiming
  `CatalogueQuery` is `borrowable()`'s only caller (it is not — the second call site is inside
  `CountsCopies::withCopyCounts()`, which feeds `available_count` for six query classes), and it
  arrived when the implementer's own self-review NARROWED correct inherited prose into a false claim.
  Two guards that nothing pinned were also closed, both measured: the audit payload's null
  `released_copy_id`, and the pending path taking no copy lock at all.
- **8 `LendCopy` re-widened** — `6985690`, `9cea723` · approved after 1 review round. The riskiest
  task of the phase: it modifies a SHIPPED, MERGED Phase 1 command. **1c's `LendCopyTest` is
  untouched and green (13/13), verified by the re-reviewer with `git diff`** — and it turned out to
  be the thing that enforces "the hold probe reads after both locks", because the probe runs
  unconditionally on the walk-up path too, so moving it up reddens the shipped file. A stronger
  proof than a new assertion, needing no edit. The close is STRICTER than the reference: the
  reference's `update borrow_requests … where id = …` has no status guard and can overwrite a
  request that lost a race; this one is `where('status', Approved)` — Task 7's affected-row-count
  idiom. One change beyond the brief, judged correct on all four questions: `loan.created`'s audit
  `before` bag stored the literal `['copy_state' => 'available']`, which became a fabricated record
  once a collected hold reaches the lend from `held`; it now stores the real prior state, matching
  `lend-copy.ts:290`, byte-identical for walk-up lends (now pinned), and nothing downstream reads it.
- **9 `HandoverRequest`** — `c6f15e5`, `5d2b16d` · approved after 1 review round. Divergence 11
  honoured exactly: no transaction, no lock, delegation only — and it now has an EXECUTABLE pin
  (two query-log blocks: the first `FOR UPDATE` is on `book_copies`, and no locking read touches
  `borrow_requests`), which the coordinator required over the brief's comment-only shape, because
  nothing otherwise caught the inverse mistake — adding a request lock here would invert the lock
  order and create the twin of the AB–BA edge Task 8 had made one commit earlier. Measured: adding
  `lockForUpdate()` to the pre-flight gives `2 failed, 12 passed`. **Its own self-review found a real
  hole before any reviewer did:** `Gate::authorize('handover', …)` was pinned by nothing — the whole
  suite stayed green with the call deleted — closed with a block that rebinds `TenantContext` rather
  than taking a second `actingAs`, and which discriminates for a subtle reason (the row is `expired`,
  so deleting the gate changes the exception CLASS). Both of its refusals of the brief were verified
  as accurate corrections of a wrong brief rather than the narrowing-into-untruth that produced three
  of this project's nine failures. Its Important was a fourth instance of that family all the same:
  the architecture test's exemption comment kept the broad claim ("every fact they read is
  re-established on locked rows") that the Action's own docblock had already retracted two files
  over — false, because `LendCopy` never re-reads the request row this command was asked about. While
  fixing it the implementer found a THIRD overstatement of its own ("on LOCKED rows" for two plain
  reads) and fixed that too.
- **10 `ReceiveReturn` re-widened** — `3831c97`, `15b5dac` · approved after 1 review round. **The task
  the phase was cut around, and it landed.** A second shipped 1c command modified, its signature
  changed (`void` → the reference's result shape), `ReturnController::store` updated in the same
  commit so every commit stays green, and the SECOND door onto `request_approved`. 1c's
  `ReceiveReturnTest` untouched and 12/12 green, verified by the re-reviewer against the fix stat —
  which matters doubly, because the fix round deliberately touched the plain-return path.
  **The headline guarantee is real and is pinned honestly.** The plan's own first reviewer had caught,
  in the plan TEXT before any code existed, that a "nothing observes it as available" assertion could
  be satisfied by its own `FOR UPDATE` select. It is not: the load-bearing observation is
  `DB::getQueryLog()`, which issues no SQL, the three `'for update'` occurrences in the test file are
  string literals compared against logged text, and mutation 1 falsifies it by count. The isolation
  half — a second connection observing mid-transaction — is NOT earnable under `RefreshDatabase`, and
  the report says so rather than implying otherwise.
  **The third lock's direction claim survived an independent enumeration** of every `lockForUpdate`
  site under `app/` plus `HandoverRequest`'s delegation: nothing anywhere holds a request lock and
  then wants a *loan*, which is what a new AB–BA pair would have required, so this command joins the
  copy→request side and adds no direction. Both `request_approved` doors match byte for byte.
  Its Important was **plan-mandated and the plan lost**: the brief's own Step 3 code specified
  `(string) $copy->book?->title`, which fed both the audit bag and the notification, so a soft-deleted
  book's row stored `""` where 1c stored `null` — on the merged plain path. The self-review had cleared
  it against `AuditSentences::str()` (which maps `""` → `null`) but not against `payloadRows` →
  `renderValue`, which `json_encode`s untrimmed. Now nullable in the audit bag, cast only for the
  notification, and pinned in **both** directions.
- **11 `BorrowRequestQueueQuery`** — `30fe2ac`, `2e8503f`, `c8f9163` · approved after 2 review rounds.
  The phase's first read-side task, and the one that produced its most interesting argument. The
  query itself was verified sound INDEPENDENTLY of `TenancyArchitectureTest` — whose own comment
  names `join()` conditions as a blind spot, so a green run there proves less than it looks: the
  reviewer checked instead that `BookshelfScope` qualifies its predicate as `<table>.bookshelf_id`
  (so the join is anchored to the already-constrained column and cannot widen the tenant) and that
  `memberships_one_per_shelf UNIQUE (member_key)` makes fan-out impossible.
  Five Importants. Two were the brief losing to itself: it demanded the badge and list be
  "structurally impossible" to disagree and then mandated two method bodies duplicating the filters
  character for character (now one shared `waiting()` builder), and it set a mutation gate the task
  left unmet on scope grounds when the plan's Global Constraints made it owed. One was a real
  divergence — under `actSystemWide()` `run()` threw while `countWaiting()` returned a count spanning
  **every shelf**, a cross-tenant badge beside a list that refuses to render; both now go through one
  bound-tenant guard. And the soft-delete join predicates were pinned by nothing: deleting all four
  left every test green, because Eloquent's `SoftDeletes` scope does not reach a raw `join`.
  **The eleventh occurrence of the failure mode landed in the entry written to record a gap** — a
  `known-gaps.md` note that misattributed the `id` tiebreak to BR §7.2 (which contains no tiebreak
  rule), cited a docblock that does not exist, and prescribed exactly the degenerate two-row fixture
  the reference documents as having produced two false-green tiebreak tests against a broken query.

  **The finding worth Kien's attention: one of this phase's tests pins spelling, not behaviour, and
  that is now known and written down.** The reference's tiebreak fixture was discriminating because
  of POSTGRES, not because of its shape — 28 rows is chosen for being past the threshold below which
  Postgres sorts stably, forcing an unstable sort that permutes ties. Correct order IS ascending id
  on both engines; no fixture can make the correct answer differ from it, and the only lever is the
  engine shuffling ties, which MariaDB does not offer at this size. So the fixture was ported
  faithfully and lost its discriminating property to the engine. The tiebreak is therefore pinned by
  a generated-SQL assertion — a golden-string test — which the coordinator ruled satisfies the plan's
  constraint (that constraint's own premise is the case where behaviour cannot discriminate, and what
  it asks for there is an explicit pin plus a comment). The bound is now stated everywhere it is
  claimed: it holds while MariaDB's filesort stays in-memory and order-preserving, and is untested
  against a sort-buffer spill to merge passes or a join-reordering plan change.
- **12 the reader's request surface** — `c6600eb`, `c25bf0c`, `2f2eb83` · approved after 2 review
  rounds. The first task in the phase a person will actually see, and it discharged both items held
  since Task 4. **404-never-403 is measured, not assumed:** removing `role:reader` turns the
  non-member's 404 into a 403, and the reviewer independently traced why the Actions' own
  `Gate::authorize` can never be what an HTTP caller meets — both policies ask `act-as-reader`, the
  identical ability `EnsureShelfRole` just checked for the identical user, so no state passes the
  middleware and fails the policy. **`not_permitted` has a real UI path**, pinned by a memberless
  super admin POSTing and reading the Vietnamese sentence off the page's props.
  Two Importants. The **draft-book existence oracle** is the one worth knowing about: the request
  POST accepted an unpublished book where the sibling GET 404s it, so a guessed draft slug returned
  302 + success flash while a nonexistent one returned 404 — and the row then surfaced on the manager
  queue. The reference omits that filter deliberately, but on the premise that "a draft book is one a
  reader has no URL for anyway" — **and this task created that URL**, so the inherited decision rested
  on a premise the same commit falsified. Closed with `abort_unless`, pinned, plus a zero-rows
  assertion.
  **Coordinator ruling, reversing the implementer:** the "Xin mượn" button is HIDDEN for a memberless
  viewer, restoring the reference's behaviour. Its argument for showing it — that hiding would make
  `not_permitted` unreachable — was false about its own test, which POSTs directly over HTTP and never
  renders the page; hiding leaves that test green character for character.

  **The lesson of this task is a claim SHAPE, and it generalises.** One comment in `book.tsx` was
  wrong three times running, every time by asserting a **complete enumeration** of refusal codes —
  first by including one that is unreachable, then by excluding two that are reachable (the banner
  is not scoped to the create route: `bootstrap/app.php` renders every `RuleViolated` through
  `back()->withErrors` and `back()` follows the Referer, so the cancel door feeds the same banner).
  A sibling file's untouched docblock already contradicted the third version as it was being written.
  The fix was not a better list: it was to stop enumerating, describe the mechanism, name the two
  doors, and keep only the one negative code-level fact that has a test behind it. **Complete
  enumerations are the hardest claims to verify and the easiest to falsify silently** — every future
  Action throwing through a shared renderer invalidates one. Worth applying to the remaining tasks.
- **13 the dashboard's requests half** — `090c189`, `37c3fc5`, `0287626` · approved after 2 rounds.
  The implementer did two things unprompted that the trap list is meant to produce: the
  neighbouring-comment grep found a SECOND file carrying the same stale "the requests half is
  Phase 2's" claim (`MyLoansController`, outside its brief) and it fixed both; and it **refused its
  own brief's comment text**, which said the reader and manager surfaces "cannot disagree" — false
  against the divergence documented one task earlier, and writing it would have put a fourth wrong
  spelling of the rule into the code. Both calls were upheld on review.
  Its Importants: the list ordering was pinned by nothing (all four brief-supplied fixtures leave
  the reader exactly one row, so both `orderBy` calls delete green — the brief's gap, closed with an
  out-of-order fixture that asserts its own id relationships rather than assuming them), and this
  diff falsified a neighbouring comment's COUNT.
- **14 the manager's queue screen** — `1d93310`, `99eef2f` · approved after 2 rounds. The phase's
  largest UI task, and it discharged the constraint that had ridden on it since Task 5: `copy_id` is
  validated `uuid`, measured BOTH ways — deleting the token and posting `copy_id='🙂'` reproduced
  `SQLSTATE[HY000] 1267` live, restoring it gives a field error — which was the condition
  `known-gaps.md` attached when it accepted that entry. The test pins the field error *and*
  separately that `find('🙂')` still throws, so the claim stops being true out loud if the column's
  collation is ever widened.
  **All four enumeration-shaped claims in its diff were run down and held** — the first task where
  that check came back entirely clean, including the first enumeration on this branch to survive
  verification unchanged (no page under `resources/js/pages` imports lucide-react).
  Its Important was a test structure that masked its own failures: four independently-failing facts
  in one `it()`, where the GET's `assertNotFound()` aborted the method so the three POST assertions
  never ran. The proof it mattered was in the implementer's own report — it had measured that block
  "with the GET assertion disabled" to see its own finding. After the split, re-running the mutation
  with **no test edited** surfaces both failures at once.
- **15 the return screen's hold picker** — `4dc42c9`, `d7ff719` · approved after 1 round. It finished
  the screen work Task 10 deferred, and it **measured two of its own brief's claims false** — both
  confirmed by the reviewer with the halves the implementer could not check itself. The brief's
  `?loan=` tests omitted `q=`, which short-circuits the search to `[]` so the loan can never be
  chosen: changing the tests was right, because the only `loan=`-bearing link in the whole frontend
  also sends `q` and can only render when the list is non-empty. And the `prepareForValidation()`
  `''→null` merge is **dead on the HTTP path** — Laravel's global `ConvertEmptyStringsToNull` already
  does it (verified present in this app's stack, not assumed) — so the three lines are kept as a
  local guarantee rather than a live one, with the comment corrected in both places.
  **Its Important is the clearest argument in this phase for reading untested code.** A hold
  selection outlived the loan it was made for: the loan-row link carries `preserveState`, so the
  component is not remounted, and the radios were uncontrolled, so the DOM and the form data
  diverged. Pick loan A, choose a waiter, click loan B — nothing appears checked, the form still
  holds the first waiter, and confirming **does not apply the return**; it refuses with a sentence
  the manager has no way to explain. If the second title had nobody waiting, the fieldset was not
  rendered at all, so the refusal arrived with the feature invisible — and the field-error slot lived
  inside that hidden fieldset. No test in this repo could have caught it; it was found by reading.
  Fixed with controlled radios plus a reset effect, and the reviewer traced the fix against Inertia's
  own source to confirm `setData`'s stability, so the effect's dependency omission is correct rather
  than a suppressed bug.
- **16 the notifications surface** — next.

**Two rulings on this task's authorization surface, both no-change:** the queue GET's single
middleware layer is the house idiom (`OverdueController` and `DashboardController` carry no
controller Gate either; `RouteOrderTest` requires a `role:` gate on every `/manage` route regardless
of spelling; and the new presence pin names this GET explicitly). And handover's missing Form Request
is not this task's defect — Task 12 shipped the same shape for bodiless POSTs — but it is **carried
to Task 18**, which adds a fourth POST to this page and is the right place for a bodiless Form
Request if the phase wants symmetry. Worth knowing: with `role:manager` dropped, this one screen
answers three different ways — the GET renders 200 to a reader, approve/reject 404 from their Form
Requests, and handover 403 from the Action's own Gate.

**A verification lesson worth keeping, from Task 14's last round.** A `sed` correction silently did
nothing: its pattern assumed `section (24 keys)` sat on one line, the text wrapped across two, so it
matched nothing and exited 0 — and the confirming `grep` searched the line *above* the number, so it
could not have seen the failure. **Verification that cannot see its subject.** The re-read that
caught it then caught four more errors in the same report, including a `grep -c` count asserted
without being run — reproducing the exact failure one paragraph after describing it. The habit that
works: re-read your own fix-round section against the file it describes, and prefer a check that
reads the line carrying the claim over one that searches for a string you remember.

**The rule this phase earned, and the one to carry into 2b and 2c.** A complete enumeration in a
comment has now been wrong FIVE times on this branch — "the codes a reader can cause", "exactly two
codes", "the two screens", and twice more in the corrections themselves. The failure is the claim
SHAPE, not the authors: a shared renderer, a new surface, or a new writer silently falsifies every
enumeration downstream of it, and no phrase-scoped grep finds them, because the author greps for the
claim they remember rather than for claims their change breaks.

Two habits came out of it, both now in every dispatch:
- **Do not enumerate.** Describe the mechanism, name the doors, and keep only code-level claims that
  have a test behind them.
- **Sweep for what your change falsifies, not for what you remember.** When you add a surface, grep
  for the words that COUNT surfaces — "two screens", "both", "the only", "exactly", "no other".

A third, smaller one, from Task 13's last round: "the same X" is a claim too. Two things can share
a field name and differ in the copy key — and if the comment exists to be found by grep, the
difference is the whole point.

**Four of this phase's twelve false claims were written by the coordinator, all one pattern:**
reasoning about a mechanism from its name rather than its implementation — a `getQueryLog()`
assertion that was a tautology (T4), "`RuleViolated` is a 404" (T6), "split the `expect` chain into
separate statements" (T8, when a failed `expect` aborts the whole method), and "an ordinary reader
whose membership vanishes reaches the banner" (T12, when they meet a 404). Every one was caught by
an implementer measuring instead of complying, because every dispatch carries the instruction to do
exactly that. That instruction is load-bearing and should stay in the remaining briefs.

**A hazard for every future agent on this repo, now in `known-gaps.md`:** `php artisan tinker`
bypasses `phpunit.xml`'s `force="true"` overrides entirely, so diagnostics run against the real dev
database `olibra`, not `olibra_testing`. Task 11's implementer hit this, disclosed it, and cleaned up
row by row. Verified at `phpunit.xml:59-90` and `.env:194`; `--env=testing` does not fix it, because
this repo has no `.env.testing`.

**Trap-passing is now measurably working.** Task 10's implementer proactively found and fixed the
neighbouring-file fallout its own change caused — the now-false `known-gaps.md` "deliberately
narrower" entry, a false docblock sentence in the guard's own test file, and four stale line
references across three files — because the dispatch carried that failure mode as a named trap
rather than leaving it to a reviewer. It then caught its OWN fix-round correction being false before
shipping it (a draft claimed `grep -rn Notifiable app/` finds nothing; it finds two comment lines in
`Bookshelf.php`). First time in the phase the ten-times failure mode was stopped before the commit.

**A plan promise withdrawn at Task 9, and two constraints it puts on Task 18.** Divergence 11 said
the handover race yields "a stale *sentence* … never a wrong write". False: if a cancel commits in
the window it releases the copy to `available` and the delegation then writes an ordinary walk-up
loan closing nobody's request. Right copy, right reader, and the reference had unlocked reads too —
so nothing changes in code, but the promise is withdrawn in the plan rather than left standing.
Task 18's `ReleaseExpiredHold` reproduces the same shape, and it also **must not null
`borrow_requests.copy_id`** when it releases: `HandoverRequest`'s `Expired → hold_expired` branch
fires only while `copy_id` is populated, so nulling it would kill that branch in production while
Task 9's test — which sets `status` alone — stayed green.

**The one thing on this branch that is genuinely new risk, and Kien should see it.** Task 8 CREATED
an AB–BA lock edge that did not exist before. `LendCopy` now holds the copy lock and then locks a
`borrow_requests` row; `CancelOwnRequest`'s documented residual window is the mirror (request first,
copy second, when the snapshot names no copy). Same (copy C, request R) pair, opposite order → an
InnoDB **1213** deadlock, arriving as a `QueryException` that nothing translates (`UniqueViolation`
handles 1062 only), rolling the whole transaction back — so the manager sees a server error, not a
Vietnamese sentence. **Ruling: accepted, not fixed.** There is no better ordering inside one
transaction without a retry loop, and this plan's house rule refuses cycle claims that two real OS
processes have not earned. No frequency is claimed and none was measured. It is now written into the
Action's comment and into the plan's divergence 1; Task 19 carries it into known-gaps. If Kien wants
it designed away rather than recorded, that is a real decision and it is his.

**Two `known-gaps.md` corrections landed here** rather than waiting for Task 19: the entry claiming
`LendCopy`'s hold-collection branch is unported is now **false**, so it is struck with its reason
(a known-gap that has silently become false is worse than one that is missing — this document's
whole failure mode is claims nobody re-ran), and the INV-5 entry's line citation is updated
(`LendCopy.php:75` → `:81`). Entries that are merely MISSING still wait for Task 19.

**Two more source corrections landed at Task 7** (this commit):

- **New divergence 15.** `CancelOwnRequest` does not fold "no such request" into `not_own_request`
  the way the reference does, so a reader holding a valid id for their own shelf can distinguish
  "exists, someone else's" (302) from "does not exist" (404). The split is CORRECT — OPS §4.2 lists
  the two failure modes separately, and spec §5.4 only demands that a foreign shelf's request be
  indistinguishable from a nonexistent one — but the leak is real, it was shipping as an inline
  comment only, and this phase records divergences as a numbered list. Task 19 records the oracle in
  known-gaps.
- **The Global Constraints anti-enumeration sentence was wrong** and is rewritten. It claimed "no
  such request", "another shelf's request" and "already decided" share one code per command. They do
  not, in any of the three shipped commands: the first two are `ModelNotFoundException` → 404, while
  "already decided" is a `RuleViolated` → 302 carrying the Vietnamese sentence. The code was right
  and the constraint text was wrong, so the text moved, not the code.

**A second plan defect struck at the source** (this commit): Task 5's Step 6 mutation 2 predicted
that flipping the hold filter to `<` reddens "the live-hold test **instead**". It reddens BOTH —
the live rival drops out of the filter so its approval wrongly succeeds, and the lapsed rival enters
it so its approval is wrongly refused. Stronger than predicted, not weaker; both tests stay
load-bearing. Corrected rather than struck.

**Owed to Kien, found during Task 5 and NOT fixed:** `make lint` is not pristine on this branch —
three Biome warnings plus one info in `resources/js`, and a Biome schema-version mismatch (2.5.8
config against a 2.5.10 CLI). All pre-existing and untouched by Phase 2a; the gate has been reported
green while carrying them. The whole-branch review inherits it.

**Struck from the plan at the source** (this commit): Task 4's Step 6 **mutation 2** was
unsatisfiable and contradicted mutation 2b by construction — narrowing the duplicate read to
`Pending` cannot redden what deleting the read entirely must leave green, since the partial unique
index covers both statuses and the loser's 1062 becomes the same `duplicate_request`. It is replaced
by the layer pin that DOES redden, with the `getQueryLog()` tautology written down beside it. Verified
confined to Task 4: the pattern appears once in the whole plan.

**Two items carried forward, neither belonging to Task 4:**

- **Task 12** must render this Action's refusals as 404, not 403. `execute()` throws
  `AuthorizationException`, which HTTP-renders 403 by default, against spec §5.4. It must also give
  `not_permitted` a UI path, now that the super-admin door is known to be real.
- **The final whole-branch review** gets the `Gate::before` bypass shape — gate passes, membership
  null — which applies to EVERY Action authorising through an `act-as-*` gate. `CreateBorrowRequest`
  fails closed; the Phase 1 commands have never been audited for it.

**One correction landed at the source** (`d93d4e9`): the 404-never-403 rule was cited as "BR §5.4"
throughout the plan, `known-gaps.md` and a shipped docblock. `BUSINESS-REQUIREMENTS.md` §5.4 is
"What is recorded about each thing" and `grep -in "enumerat"` over it returns nothing. The section
number is right, the document was not — it is the **migration design spec's** §5.4, "The
TenantIsolation suite". Fixed before it could propagate into the remaining sixteen tasks.

## Phase 1d — closed

Branch `feat/phase-1d-oversight`, 10 tasks, plan committed at `541a017`. Merged as #63.

- **1 Audit sentences** — `0d48b10` · approved
- **2 AuditSecrets guard** — `58b0399`, `3617fb5` · approved
- **3 AuditLogQuery** — `97675c0`, `b4c0252` · approved
- **4 Audit screen** — `6ee9b79` · approved
- **5 Dashboard query** — `13f95ed` · approved
- **6 Dashboard screen** — `7e9bd75` · approved
- **7 `Csv` helper** — `d75f53d` · approved
- **8 export queries** — `afbcc17`, `62bd534` · approved, two nits carried into 9
- **9 export route** — `52283bd`, `d52d17e`, `9978e71`, `7089338` · approved
- **10 wrap-up** — `41c1e4c`, `794cac4`, `9109585` · approved

PR #63 opened, whole-branch reviewed. Its Critical — the audit secrets guard could be
unwired with the whole suite green — plus two Importants fixed in `3d3362f`; a docblock
that repeated a false "reaches no screen" claim corrected in `e599c6a`.

Suite at 1,031 passing on merge. All gates green (Pest, Pint, Larastan level 8, Biome,
tsc, Vite build).

## How the loop runs

Per task: `task-brief` → implement (fresh agent) → `review-package` → review (fresh agent)
→ fix round if the review requests changes → next task. Both scripts live in the
superpowers plugin's `subagent-driven-development/scripts/`.

At the end: open the PR, run a **whole-branch** review (it has caught what per-task review
structurally cannot, in every phase so far), fix, then hand the merge decision to Kien.

## Product-owner rulings (do not relitigate)

**Phase 1b** — manager-registered readers are `active`; the `already_registered_here`
existence oracle is accepted; registration throttle is two-key (30/min/IP + 20/day per
hashed phone); the reactivate button ships.

**Phase 1c** — the quick-lend escape hatch is wired (this made 1b's `active` ruling real);
a suspended reader **cannot** renew (accepted as unreachable, matching the reference); the
void-loan button ships; a copyless title gets its own true refusal sentence.

**Phase 2a** — OQ1 = **B**: a lapsed hold gets a manager exit. `ReleaseExpiredHold` ships
(plan Task 18 EXECUTES), one **Trả về kệ** button on expired rows only, guarded on the clock
(`hold_expires_at <= now` — a manager may not yank a live hold), writing BR §7.2's own
`approved → expired` arrow plus `held → available` in one transaction, new audit action
`request.expired`, OPS §4.2 amended in the same commit. Kien overrode the plan's parity
default: the reference's gap strands a copy in `held` forever unless the READER cancels.
OQ2 = **A**: the reject reason stays **optional** (parity; the form says "Không bắt buộc.",
an empty box stores NULL). Tasks 6/14 take no B-delta.

**Phase 1d** — the audit expansion shows **raw before/after, manager-gated** (verified: it
reveals strictly less than the reader-detail screen already does); `loan.returned`'s previous
condition is **restored** (Task 10, capture-then-use — reading it after the copy update
records the *post*-return value); CSV exports ship **synchronous** with the memory ceiling
recorded; the audit log reads **all of it**, 25/page, filtered, never pruned.

## Standing instructions from Kien

- Run to a PR with an agent review, then announce — do not merge.
- **Every plan: Opus writes it, a DIFFERENT Opus reviews it** before any code. (Ruling
  2026-08-29, mid-2a: Fable wrote the 2a plan and its review came back with six Criticals.
  Only the author changed — the write → independent-review gate is unchanged.)
- Keep this file current so a disrupted session can resume elsewhere.

## Owed by Kien, not by the agents

- **`main` has no branch protection.** CI runs and passes but a red gate would not block a
  merge. Unchanged since Phase 1a.
- **`docs/HOSTING.md` rows 2–14 are unrun.** The deploy pipeline has never touched the
  cPanel host.

## Open item worth a decision later

**This repo has no frontend rendering tests at all** (the only vitest scripts point at
`old_next`). Task 6's reviewer proved the consequence: swapping the two stat cards' values on
the dashboard leaves all 23 of its tests — plus Pint, Larastan, Biome, tsc and the build —
entirely green, because `assertInertia` checks server-side props only. No page in this
codebase can catch a mis-wired label/value pair. Recorded in Phase 1d's known-gaps; whether
to adopt component-level tests is a real decision, not a task.

## Read next

`docs/known-gaps.md` — the durable record, and the thing to trust *after* verifying: it has
been factually wrong six times, always the same way (a plausible claim written without being
run down). `AGENTS.md` for house conventions.
