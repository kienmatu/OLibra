# Laravel Migration — Phase 1b: Members — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Not started

**Goal:** The members slice of BR §1.4's core loop, running end to end: a stranger registers from the public form and lands `pending`; a manager registers on behalf, works the approval queue, corrects a reader's details, sets credentials, suspends, reactivates and marks left — every write audited in its own transaction (INV-8) — plus the manager's readers roster with the parish-unit filter, the reader detail page with its administrative actions, and the pending-registrations queue with the similar-name warning, all filling routes Phase 0 left as `under-construction`.

**What this plan is not.** Phase 1 (BR §1.4's core loop) is split into four plans, each producing working software (the split is recorded in the 1a plan's header):

- **1a Catalogue** — done. Categories, books, copies.
- **1b Members** — this plan. Readers, registration, approval. Independent of 1a (it consumes only 1a's Task-1 groundwork: `Clock`, `RuleViolated`, `AuditRecorder`, `lang/vi/*`).
- **1c Circulation** — quick-lend, return, renewals, overdue, void. Needs 1a and 1b.
- **1d Oversight** — audit-log surfacing, manager dashboard, CSV export.

**The OPS §4.3 census, taken fresh for this plan.** §4.3 contains **17 command entries: 16 live commands and 1 retired**. By name: `RegisterMembership`, `ManagerRegisterReader`, `RegisterMemberOnBehalf`, `ApproveMembership`, `RejectMembership`, `SuspendMembership`, `ReactivateMembership`, `MarkMembershipLeft`, `SetReaderCredentials`, `UpdateReaderProfile`, `UpdateOwnProfile` *(retired 2026-08-12 — nothing to port)*, `ProposeProfileChange`, `ApproveProfileChange`, `RejectProfileChange`, `CancelProfileChange`, `ChangeOwnPassword`, `ProposeAvatarChange`. **This plan implements 10** (the first ten). The member-facing queries this plan implements are `GetReadersList`, `GetReaderDetail` and `GetPendingRegistrations` (OPS §3.3).

**One query more, from §3.2 rather than §3.3.** `GetParishUnits` (OPS:71) is the fourth member-facing query this plan implements — as `ParishContextQuery` (Task 2), consumed by the registration form, the on-behalf form and the roster filter. OPS attaches an **open question** to it (OPS:75): the query is listed under §3.2's *reader*-gated set, yet public registration reaches it as a `guest`. This plan implements the guest reading — `RegistrationController::create` binds the tenant with a null membership and returns the shelf's **live** units only — on the grounds that a parish's list of `Giáo họ` is not personal data and BR §16.1's picker cannot exist without it. It is nevertheless a reader-gated query answered to guests, and Task 16 records it under known-gaps' "Decisions taken on the product owner's behalf".

**Deliberately absent, each named with the phase that owns it:**

- **The membership-writing commands of §4.5** — `AssignManager` (OPS:873), `RevokeManager` (OPS:883) and `PromoteSuperAdmin` (OPS:893). They live in the Administration ledger, not §4.3, but they write `memberships.role` and `users.is_super_admin` and so belong in this slice's exclusion census rather than going unmentioned: all three are **Phase 3's** admin tooling, alongside the parish-unit commands below. Nothing in this plan grants or revokes a role — `Registration`'s walk-back *demotes* to `reader` and that is the only role write anywhere in 1b.

- **The profile-change lifecycle, whole** — `ProposeProfileChange`, `ApproveProfileChange`, `RejectProfileChange`, `CancelProfileChange`, `ProposeAvatarChange`, and the queries `GetPendingProfileChanges` (§3.3), `GetMyProfileChangeRequest` (§3.2), `GetPendingManagerChanges` (§3.4). Spec §11 assigns "the profile-change queues" to **Phase 3**, alongside the §9-routing machinery (subject-role decisions, the cross-shelf `/admin/profile-changes` queue) they cannot ship without.
- **`ChangeOwnPassword` and `GetMyProfile`** — deferred **with the reader profile page to Phase 3**, the same defer-the-page-whole reasoning 1a used for `GetShelfHome`: BR §16.2's profile page is one screen whose substance is "view details, propose changes, change password", and the propose half is Phase 3's. Building a view-only profile page now means rebuilding it when proposals land. A reader who forgets their password meanwhile has exactly the recovery path BR §2 describes — the volunteer at the shelf (`SetReaderCredentials`, this plan). This is a scope judgment this plan makes explicitly, not something the spec states; if the product owner wants a reader-facing profile page sooner, `GetMyProfile` + `ChangeOwnPassword` are a self-contained slice that can run any time after this plan.
- **`SearchReadersForLending`** (§3.3) — 1c's quick-lend step 2.
- **`GetManagerDashboard`'s pending-registrations stat card** (§3.3) — 1d builds the dashboard; the count becomes computable with this plan's data.
- **`ExportReadersCSV`** (§3.3) — 1d.
- **The parish-unit and taxonomy admin commands** (`UpdateParishTaxonomy`, `CreateParishUnit`, `RenameParishUnit`, `ReorderParishUnits`, `DeleteParishUnit` — OPS §4.5) — Phase 3's admin tooling. This plan **reads** taxonomy and units everywhere BR §5.6 requires (registration pickers, roster filter, parish lines) and seeds demo units so 1b is usable; it writes none.
- **Notification rows** — Phase 2 (spec §11). The reference's `approveMembership`/`rejectMembership` write `membership_approved`/`membership_rejected` notifications inside the command transaction (OPS §7); this plan's Actions deliberately do not, and Task 16 records in `docs/known-gaps.md` that Phase 2 must add those two writes when the notification system lands.
- **The avatar** — no uploader anywhere in this plan, matching the reference exactly: its own registration pages dropped the photograph tile ("a file input with nowhere to send anything"), and `ProposeAvatarChange` is Phase 3's. `Registration` accepts an `avatar_object` storage key for input-shape parity (like 1a's `donor_membership_id`), and nothing supplies one.

**Architecture:** Per the spec's §1.3 carve-out and 1a's established shape: single-purpose Action classes in `app/Actions/Members/`, Form Requests in `app/Http/Requests/Members/`, `MembershipPolicy` delegating to the act-as gates, thin controllers, Inertia pages. Pure functions with no I/O in `app/Support/Members/` (the state graph, phone shape, parish taxonomy rules, profile-field normalisation, trigram similarity); read shapes in `app/Queries/`. Every command writes its audit rows in the same `DB::transaction` as its state change (INV-8, OPS §1).

**Tech Stack:** unchanged — PHP 8.4, Laravel 13, Inertia v3, React 19, Tailwind v4, MariaDB 10.11, Pest 5, Larastan level 8, Pint, Biome 2, Bun.

**Spec:** docs/superpowers/specs/2026-08-26-laravel-mariadb-inertia-migration-design.md

**The reference implementation is the specification.** `old_next/src/domain/members/` (commands, queries, `policy.ts`, `registration.ts`, `parish-taxonomy.ts`, `profile-fields.ts`, `scoped-user.ts`) and `old_next/tests/domain/members/` encode rules that took multiple fix-waves to get right (CRITICAL 1's suspended-walk-back, IMPORTANT 3's un-suspend-by-approval, IMPORTANT 4's soft-deleted identity, IMPORTANT 5's probe side-effects, the anti-probe username rules, QA T18's phone shape, PO-round-1's saint-name and phone-or-reason). Every Action task below starts by reading the TypeScript test it ports. Where this plan diverges from the reference, the divergence is named inline with its reason. The divergences, collected:

1. **Membership lifecycle commands take `lockForUpdate()` on the membership row as the transaction's FIRST statement**, replacing the reference's plain select-then-update. The reference could afford that under Postgres's per-statement READ COMMITTED (plus RLS filtering cross-shelf updates to zero rows); under InnoDB's REPEATABLE READ the read view pins at the transaction's first consistent read, so a plain read followed by an unguarded `UPDATE` races a concurrent decision — two managers approving the same application, or an approval racing a suspension, would blindly overwrite each other. This is the exact rule 1a paid two fix rounds for (known-gaps: "nothing may read before the lock"), applied here from the start. The commands this binds: `ApproveMembership`, `RejectMembership`, `SuspendMembership`, `ReactivateMembership`, `MarkMembershipLeft`, `SetReaderCredentials`, `UpdateReaderProfile`.
2. **Registration takes no lock; its check-then-write hazards are backed structurally.** The username pre-check and the walk-back read can both go stale, and each has a unique index behind it: `users_username_key` (errno 1062 → `username_taken`, and in `SetReaderCredentials` → `username_in_use`) and `memberships_one_per_shelf` (1062 → `already_registered_here`). A new `App\Support\UniqueViolation` helper translates by constraint name. **The one hazard with no structural backstop is the no-username triple-match** (`full_name` + `date_of_birth` + `phone`): two concurrent registrations of the same child can create two `users` rows. The reference has the identical hole; the product's own answer to duplicate people is BR §3's similar-name warning on the approval queue, where a human who knows the family decides. Accepted, and recorded in known-gaps by Task 16 rather than papered over with a lock on a global table.
3. **`pg_trgm`'s `similarity()` does not exist on MariaDB.** The similar-name warning becomes `App\Support\Members\NameSimilarity`, a pure-PHP implementation of pg_trgm's trigram measure (fold → per-word two-space/one-space padding → trigram sets → |∩|/|∪|), computed over the shelf's active roster in the query class rather than in SQL. Pinned against pg_trgm's own measured value: the reference's SQL comment (`old_next/src/domain/members/queries/get-pending-registrations.ts:73-74`) records `similarity('tran minh', 'tran minh duc') -> 0.714, verified` — **0.714 to three places, not 0.714286**; the exact rational the trigram sets give is 10/14, which is what the unit test asserts with a delta. At BR §1's few-hundred readers per shelf, PHP-side is comfortably cheap.
4. **`olibra_fold(u.full_name)` at query time becomes a STORED generated column `users.full_name_folded`** (Task 3), emitted by `FoldExpression` exactly as Phase 0 froze `books.title_folded`. MariaDB has no `olibra_fold()` function to call inline; the generated column is this repo's established §4.2 mechanism, gives the roster its sort and search key, and `FoldParityTest`'s treaty already covers the expression. The roster's order is `full_name_folded, memberships.id` — the same folded-sort + unique-tiebreak pair whose absence the reference records shipping twice (Đ-names sorting last; paged walks losing readers).
5. **The reference's crypto-wiring machinery does not port** (`NotWired`, `setPasswordHasher`, `crypto-wiring.ts`, `registration-not-wired.test.ts`). It existed because Turbopack bundled the domain twice; Laravel's `Hash` facade is one process-global service, configured for argon2id by Phase 0 (spec §7's row). Password hashing is `Hash::make`/`Hash::check`, full stop.
6. **Refusal sentences live in `lang/vi/rules.php`** (spec §7), verbatim from OPS §4.3 where it names one and from the reference's `ERROR_MESSAGES` (`old_next/src/domain/kernel/errors.ts`) for the rest — including `suspension_reason_required`, which is the *screen's* rule, kept at the Form Request layer exactly as the reference kept it in `actions.ts` rather than in the command (OPS §4.3 marks the command's reason optional).

   **The sentences are OPS's; the CODE SPELLINGS are the reference's, and the two ledgers disagree.** OPS §4.3 abbreviates five codes that the shipped `errors.ts` spells out, and this plan follows the reference so the port is a port:

   | OPS §4.3 | this plan (= `old_next` `errors.ts`) | OPS line |
   |---|---|---|
   | `not_pending` | `registration_not_pending` | 410, 421 |
   | `reason_required` | `reject_reason_required` | 420 |
   | `not_active` | `not_active_cannot_suspend` | 431 |
   | `not_suspended` | `not_suspended_cannot_reactivate` | 441 |
   | `not_found` (SetReaderCredentials) | `membership_not_found` | 467 |
   | `username_taken` (SetReaderCredentials) | `username_in_use` | 468 |
   | `has_active_loans` | `member_has_active_loans` | 453 |

   Two of these are load-bearing rather than cosmetic. `username_taken` is OPS's name for **both** the registration collision and the credentials collision; the reference splits them because the sentences differ ("hãy chọn tên khác" to a stranger at the public form, "đã có người dùng" to a manager at the desk), and this plan keeps the split. `member_has_active_loans` must NOT be `has_active_loans`: `lang/vi/rules.php` already holds a 1a key of that exact name whose sentence is about a **book** ("Không thể xoá sách đang có bản được mượn."), and reusing it would render the wrong sentence to a manager marking a reader left. **`member_has_active_loans` also has no OPS sentence at all** (OPS:453 gives the code in prose and stops) — the Vietnamese in Task 1 is authored by this plan, and Task 16 records it as such, the way OPS itself flags `PROFILE_CORRECTED_COPY` (OPS:506).

   The one code kept in OPS's spelling against the reference's own habit is `thieu-so-dien-thoai`, per divergence 7 — and there the two ledgers agree anyway.
7. **Query-string and form field names are English** (`?shelf=`, `?status=`, `?unit=`, `?q=`, `?page=`; posts carry `username`, `saint_name`, `date_of_birth`, …) where the reference used Vietnamese (`?tu-sach=`, `trang-thai`, `ten-thanh`) — spec §6: no Vietnamese in URIs, and a query string is part of the URI. **Exception:** the refusal code **`thieu-so-dien-thoai` is kept verbatim** — it is a stable OPS §4.3 failure code the ledger names by that exact spelling, not a URI.
8. **`ManagerRegisterReader` ships with no route.** In the reference it is implemented, tested, and wired to no screen — the quick-lend escape hatch (`/manage/lend/reader`) is 1c's surface. This plan ports the Action and its tests, and Task 16's architecture test pins the route's *absence* so wiring it is a decision, not an accident — 1a's `DeleteBook` precedent.
9. **A refusal no longer costs the typed form.** The reference deliberately carried nothing back through its query-string redirects (a child's data in browser history) and paid a fully re-typed form per refusal. Under Inertia, `useForm` state lives in the client and `RuleViolated` renders as `back()->withErrors(['rule' => …])` — nothing enters the URL and nothing is lost. The same privacy line holds by construction; the UX cost the reference documented paying disappears.
10. **The phone-missing confirmation is a shadcn `<Dialog>`, not a port of the reference's `PhoneConfirmDialog`.** Same behaviour BR §16.1 specifies: submitting with a blank phone opens a danger-styled dialog demanding a typed reason; with JavaScript unavailable the server refuses `thieu-so-dien-thoai` and the page renders the same reason field inline — nothing is reachable only through the dialog.

## Global Constraints

Phase 0's and 1a's Global Constraints all still bind — branch `feat/phase-1b-members`, MariaDB 10.11 via the `mariadb` driver, PHP 8.4, UUIDv7 `VARCHAR(36) ascii_bin`, `DATETIME(6)` UTC, enums as `VARCHAR(20) ascii_bin` + CHECK, English URIs, Bun/Composer, Pint + Larastan level 8 clean at every commit, commit per task in lowercase `type: sentence` style. Additionally, for this plan:

- **`old_next/` is read-only.** Nothing under it is edited, moved or deleted.
- **No hand-written `where('bookshelf_id', …)`** outside `app/Models/Scopes/BookshelfScope.php` — `TenancyArchitectureTest` greps for it. Cross-table reads go through scoped model queries (see Task 12's holding-count shape) rather than joins that would need a tenant predicate.
- **Never call `withoutGlobalScopes()` with no argument** (known-gaps: it strips `SoftDeletingScope` too). The one named skip is `withoutGlobalScope(BookshelfScope::class)`.
- **Every command writes audit in the same transaction** (INV-8, OPS §1). No Action returns before its `AuditRecorder` call has run inside `DB::transaction`.
- **The audit records the act, never the secret** (BR §2, §14): no password, no hash, no session token in any audit field — `credentials.set` carries **no before and no after**, and the tests assert the row's serialized form contains neither the password nor its hash.
- **Personal data stays behind the manager line** (BR §4 assumption 5, §5.3): date of birth, parents' names, phone, parish placement and `manager_notes` appear only in manager-gated read shapes. **A page never receives a field it does not render** — the roster rows carry no DOB/parents/phone at all (only the detail and the approval card do, because those screens render them), no read shape ever carries `password_hash`, and the audit entry for a registration carries no phone, no DOB and no parents' names (the reference's `registrationAudit` rule, kept).
- **`SessionGuard` caches the `actingAs` user for the rest of a test method** (known-gaps, bit 1a twice). Guest and non-member coverage is ALWAYS its own `it()` block, never appended after any `actingAs(...)` — including one inside a fixture helper. This matters most in Task 13: registration IS the guest path.
- **UUID v7 primary keys make an unordered scan return rows in creation order** (known-gaps), so an ordering assertion seeded in already-sorted order proves nothing. Every ordering test in this plan seeds in an order that DIFFERS from the asserted order (Task 12's roster sort), and where the tiebreak key is the v7 id itself — which always equals creation order — the test pins the mechanism (the ORDER BY clause) and says so, rather than pretending a data assertion could falsify it.
- **Derived state is computed on read** (BR §8): holding counts, days-remaining and overdue flags come from `loans` plus `Clock` at query time. If a task seems to need a `holding_count` column, the task is wrong.
- **Domain time goes through `App\Support\Clock`** — `now()` is UTC; `today()` is the date in `Asia/Ho_Chi_Minh`.
- **Search folds through `App\Support\Fold::fold()` only**; the stored side is Task 3's `full_name_folded` generated column. Nothing re-implements folding.
- **Test helper names are process-global** (AGENTS.md). Every helper this plan adds is prefix-namespaced per file and was checked against `grep -rn "^function " tests/` plus 1a's registry: `mempol…`/`polFixture` (Task 4), `uvBuild` (Task 5), `regFixture`/`regInput` (Task 6), `obhFixture`/`obhInput` (Task 7), `lcFixture` (Task 8), `credFixture` (Task 9), `corrFixture` (Task 10), `ptUnit` + `pregFixture`/`pregMember` (Tasks 2, 11), `rosterFixture`/`rosterMember` (Task 12), `pubregShelf`/`pubregBody` (Task 13), `mrsFixture`/`mrsReader` + `rqFixture` (Task 14), `rdFixture` (Task 15). Before adding any further helper, grep first.
- **Factories under a bound tenant:** call `Membership::factory()->for($shelf)` / pass `bookshelf_id` explicitly, or build fixtures before binding the tenant.
- **No inline Vietnamese in TSX** — client copy in `resources/js/lib/copy.ts` (interpolation via `t()`), server copy in `lang/vi/`, enforced by Biome's `noJsxLiterals`. String props are reviewed by hand.
- **Mass-assignment discipline:** every write path that feeds request input into a model goes through a Form Request's `validated()`. `User::$fillable` deliberately excludes `username`/`password_hash`/`is_super_admin`; the credential writes in this plan assign those columns directly and by name.
- **`make test FILTER=…`** runs a filtered suite inside the compose `app` container; `make lint` is Pint; `make analyse` is Larastan.
- **Scratch output** goes to `.artifacts/` (gitignored).

## Open questions surfaced by this plan — the product owner's, not this plan's, to settle

1. **`ManagerRegisterReader`: `active` or `pending`?** OPS §4.3 flags its own entry as an *inference*: immediate-`active` is derived from BR §1.3's quick-lend intent (a `pending` member cannot be lent to, INV-4, so a pending result would defeat the escape hatch's purpose), while BR §4's assumption 3 — "a manager *approving* a registration constitutes the consent needed to hold a minor's data" — is worded around approving, which reads two-step. `RegisterMemberOnBehalf` is explicitly `pending` per BR §16.1, and OPS records that the requirements never say the two commands must agree. **This plan implements `active`, explicitly and by name** (Task 7's test is titled for the decision), for two reasons: (a) the migration's mandate is feature parity with `v0.1.0` — the reference ships `active`, and changing it mid-migration would be a product change smuggled into a port; (b) the consent argument is still satisfied in substance, because the manager typing the form *is* the manager BR §4 trusts, and `approved_by`/`approved_at` record them by name so an active membership never looks as though it approved itself. If the product owner rules the other way, the change is one enum value in `ManagerRegisterReader::execute` plus one assertion — Task 7 marks the exact line.
2. **`MarkMembershipLeft` blocks on active loans.** OPS §4.3 lists `has_active_loans` and flags it "inferred from general soundness, not stated explicitly", offering the alternative reading (leaving is allowed, loans keep displaying). Implemented as OPS lists it, matching the reference; reversing later is one predicate and one test.
3. **`POST /register` gets an infrastructure throttle this plan invents.** OPS §8 (OPS:1158) records `RegisterMembership` rate limiting as *unaddressed* — "listed here as unaddressed rather than assumed fine" — named in neither source document. An open, unauthenticated form that writes rows should not ship with nothing at the edge, so Task 13 adds a named limiter at the route layer — infrastructure-level, not a domain rule, exactly the register OPS §8 puts such protection in. Recorded by Task 16 under known-gaps' "Decisions taken on the product owner's behalf".

   **What the limiter must NOT be, and why.** The obvious shape — `Limit::perMinute(10)->by($request->ip())` — is wrong for this parish, and OPS §8 already says so by example. The one rate limit the document *does* specify, for the other guest-open write (`SubmitFeedback`, OPS:1154-1156), is **3 per phone number per day**, keyed on a **hashed identifier** (§5.4), not per IP. Per-IP is the wrong key here for two independent reasons:

   - **Registration happens in a room.** BR §16.1's scenario is a volunteer with a tablet after Sunday Mass, or a family on the parish wifi. A parish behind one NAT is *one IP for every registrant*, so a per-IP minute budget throttles the legitimate event and nobody else. Ten per minute survives a family of three, but not a catechism class of forty queuing at one laptop — which is precisely the use this form exists for.
   - **Per-IP is the weakest key against the actual threat.** A spam script rotates addresses for pennies; the parish cannot.

   **This plan therefore ships a two-key limiter, and the executor must implement it as such:**

   ```php
   RateLimiter::for('register', fn (Request $request) => [
       // The burst guard: generous enough that a room full of people
       // registering one after another never sees it, tight enough that a
       // single host cannot hammer the endpoint. Per MINUTE, per IP.
       Limit::perMinute(30)->by('ip:'.($request->ip() ?? 'unknown')),
       // The volume guard, modelled on OPS §8's SubmitFeedback rule: a
       // HASHED identifier, per DAY. A phone number is the thing a real
       // family has one of and a script has none of. Blank phone (the
       // phone-missing path) falls back to the IP for the day budget so
       // the reason-instead-of-a-number route is not an open bypass.
       Limit::perDay(20)->by('reg:'.hash('sha256', (string) (
           $request->string('phone')->trim()->value() ?: 'ip:'.$request->ip()
       ))),
   ]);
   ```

   Neither number is derivable from the requirements; both are this plan's, and Task 16 records them as such with the note that the burst limit is the one to loosen first if a real registration event trips it. **The product owner's actual call is not "10 or 30" — it is whether an unauthenticated write endpoint may ship with a limit nobody asked for.** The alternative reading is defensible: ship it unlimited and let the parish's host handle it, since OPS §8's silence may be deliberate.

   **What the throttle does not do.** It is not a defence against the probe described in the guest-write section below — `already_registered_here` still confirms, to anyone who knows a child's name, birthday and phone, that the child is registered at this shelf. That is the reference's behaviour and this plan's, and no rate limit changes it.
4. **The reader profile page (and with it `ChangeOwnPassword`) waits for Phase 3.** The scope note above makes the argument; it is a real deferral of a reader-visible capability and the product owner should see it stated.

5. **`ReactivateMembership` gets a button this plan invents.** OPS §4.3 flags its own entry (OPS:443): "there is no visible 'Kích hoạt lại' button anywhere in the 47 screens" — the command exists in the reference and reaches no surface. Task 15 puts it on the reader detail beside Suspend, on the grounds that a suspension with no way back is a trap and `not_suspended_cannot_reactivate` exists to be shown to somebody. This is the *inverse* of the `ManagerRegisterReader` decision (implemented, deliberately route-less) and the plan should be consistent about which way it errs; it errs toward the button here because suspension is reversible by design (BR §7.5 draws the arrow both ways) whereas quick-lend's screen is 1c's to build. If the product owner would rather ship suspend-only for now, delete the one form in `show.tsx` and the route — the Action and its tests stay.

6. **Public registration answers a `reader`-gated query to guests, and confirms membership existence to anyone who knows a child's triple.** Two separate disclosures, both inherited from the reference, both worth the product owner seeing named:
   - `GetParishUnits` / `ParishContextQuery` is listed under OPS §3.2's reader-gated set, with OPS's own open question at :75 about registration reaching it as a guest. This plan answers it to guests (live units only) because BR §16.1's picker cannot exist otherwise.
   - `already_registered_here` is an **existence oracle**. A stranger who knows a child's exact `full_name` + `date_of_birth` + `phone` learns, from one POST, whether that child is registered at this parish — and CRITICAL 1's fix (a suspended row refuses rather than walking back) makes suspended, pending and active all answer with the same sentence, which is the *good* half: the oracle reveals membership, never status. The reference has the identical property and the anti-probe rules deliberately address the **username** channel only. No throttle closes this; only dropping the no-username triple-match would, and that would break BR §5.3's cross-shelf identity reuse for the majority of readers who have no username at all. Accepted, and recorded by Task 16 under known-gaps rather than left implied by the phrase "anti-probe rules".

---

## File Structure

```
app/Actions/Members/
  Registration.php               shared body of the three registration commands (not itself an OPS command)
  RegisterMembership.php         guest self-registration → pending
  ManagerRegisterReader.php      manager, quick-lend escape hatch → active (NO route this phase)
  RegisterMemberOnBehalf.php     manager types for a child → pending
  ApproveMembership.php          pending → active
  RejectMembership.php           pending → rejected (reason required)
  SuspendMembership.php          active → suspended (reason optional in the Action)
  ReactivateMembership.php       suspended → active
  MarkMembershipLeft.php         any → left, blocked while holding books
  SetReaderCredentials.php       username+password together, sessions revoked, secret-free audit
  UpdateReaderProfile.php        manager's direct, audited correction (INV-13's second path)
app/Support/Members/
  MembershipTransitions.php      BR §7.5's graph + refusal codes (pure)
  Phone.php                      isValid / PATTERN / assert (pure)
  ParishTaxonomy.php             value object + fromSettings/default (pure)
  ParishUnits.php                options / validateSelection / describeSelection / unitName / hasVisibleLevel2 (pure)
  ProfileFields.php              FIELDS / REQUIRED / normalisePatch / diff (pure)
  NameSimilarity.php             pg_trgm-compatible trigram similarity (pure)
app/Support/UniqueViolation.php  errno-1062 → RuleViolated translation by constraint name
app/Queries/
  ParishContextQuery.php         taxonomy + all units (soft-deleted included) for the bound shelf
  ReadersListQuery.php           GetReadersList
  ReaderDetailQuery.php          GetReaderDetail
  PendingRegistrationsQuery.php  GetPendingRegistrations + similar-name warning
app/Policies/MembershipPolicy.php
app/Http/Requests/Members/
  RegisterMembershipRequest.php
  RegisterReaderOnBehalfRequest.php
  RejectMembershipRequest.php
  SuspendMembershipRequest.php
  SetReaderCredentialsRequest.php
  UpdateReaderProfileRequest.php
app/Http/Controllers/RegistrationController.php             public GET/POST /register
app/Http/Controllers/Manage/ReaderController.php            index / create / store / show / updateProfile
app/Http/Controllers/Manage/ReaderLifecycleController.php   credentials / suspend / reactivate / markLeft
app/Http/Controllers/Manage/RegistrationQueueController.php index / approve / reject
database/migrations/2026_08_28_000001_add_users_full_name_folded.php
database/factories/ParishUnitFactory.php
database/seeders/DemoShelfSeeder.php                        (extended: taxonomy, units, demo readers)
resources/js/components/parish-unit-fields.tsx              the zero/one/two pickers, shelf's own labels
resources/js/components/registration-person-fields.tsx      the Bản thân / Gia đình sections both forms share
resources/js/pages/register.tsx                             public registration
resources/js/pages/manage/readers/index.tsx                 roster
resources/js/pages/manage/readers/create.tsx                on-behalf form
resources/js/pages/manage/readers/show.tsx                  detail + administrative actions
resources/js/pages/manage/registrations/index.tsx           approval queue
resources/js/lib/copy.ts                                    (extended)
lang/vi/rules.php                                           (extended)
lang/vi/validation.php                                      (attributes extended)
routes/web.php                                              (readers/registrations/register filled in)
app/Models/Bookshelf.php                                    (+ readers() relation for the {reader} binding)
tests/Unit/Members/…  tests/Feature/Members/…  tests/Feature/Architecture/…  docs/known-gaps.md
```

---

### Task 1: Members groundwork — the refusal sentences, `MembershipTransitions`, `Phone`

Read first: `old_next/src/domain/members/policy.ts` (the whole file) and `old_next/tests/domain/members/policy.test.ts` — the tests below are their port.

**Files:**
- Modify: `lang/vi/rules.php` (append keys — never rewrite 1a's)
- Modify: `lang/vi/validation.php` (the `attributes` array only)
- Create: `app/Support/Members/MembershipTransitions.php`
- Create: `app/Support/Members/Phone.php`
- Test: `tests/Unit/Members/MembershipTransitionsTest.php`
- Test: `tests/Unit/Members/PhoneTest.php`

**Interfaces:**
- Consumes: `App\Enums\MembershipStatus` (Phase 0 backed enum: `Pending|Active|Suspended|Left|Rejected`), `App\Exceptions\RuleViolated` (1a Task 1 — `__construct(string $code)`, rendered from `lang/vi/rules.php`).
- Produces:
  - `MembershipTransitions::check(MembershipStatus $from, MembershipStatus $to): ?string` — `null` when the edge exists in BR §7.5's graph (plus the three documented extra arrows), otherwise the refusal code. `MembershipTransitions::assert(...)` throws `RuleViolated` with that code.
  - `Phone::isValid(string $phone): bool`, `Phone::assert(string $phone): void` (throws `RuleViolated('phone_invalid')`), `Phone::PATTERN` (the HTML `pattern` mirror, `[+0-9][0-9 .-]{7,13}`).
  - Every refusal code this plan throws, present in `lang/vi/rules.php`.

- [ ] **Step 1: Write the failing tests**

Create `tests/Unit/Members/MembershipTransitionsTest.php`:

```php
<?php

use App\Enums\MembershipStatus as S;
use App\Exceptions\RuleViolated;
use App\Support\Members\MembershipTransitions;

it('is BR §7.5\'s diagram, arrow for arrow, plus the three documented extras', function () {
    // The diagram: pending → active | rejected; active ⇄ suspended;
    // active/suspended → left. The extras, each with its source:
    // any → left including left→left (OPS §4.3 "Any status → left"; M6's
    // idempotent re-click), and rejected/left → pending (BR §2 re-apply,
    // walked back on the same row because memberships_one_per_shelf ignores
    // status).
    $allowed = [
        [S::Pending, S::Active], [S::Pending, S::Rejected],
        [S::Active, S::Suspended], [S::Suspended, S::Active],
        [S::Pending, S::Left], [S::Active, S::Left], [S::Suspended, S::Left],
        [S::Rejected, S::Left], [S::Left, S::Left],
        [S::Rejected, S::Pending], [S::Left, S::Pending],
    ];

    foreach ($allowed as [$from, $to]) {
        expect(MembershipTransitions::check($from, $to))
            ->toBeNull("{$from->value}->{$to->value} should be allowed");
    }

    // Everything else refuses. 5×5 minus self-loops the graph never asks
    // about — walk the full grid so a sixth arrow added by accident is red.
    foreach (S::cases() as $from) {
        foreach (S::cases() as $to) {
            $isAllowed = collect($allowed)->contains(
                fn (array $edge) => $edge[0] === $from && $edge[1] === $to,
            );
            if (! $isAllowed) {
                expect(MembershipTransitions::check($from, $to))
                    ->toBeString("{$from->value}->{$to->value} should refuse");
            }
        }
    }
});

it('names the refusal by what the caller was trying to do', function () {
    // policy.test.ts "approving something already decided names the
    // registration, not the request" + the suspend/reactivate sentences.
    expect(MembershipTransitions::check(S::Pending, S::Suspended))->toBe('not_active_cannot_suspend')
        ->and(MembershipTransitions::check(S::Left, S::Suspended))->toBe('not_active_cannot_suspend')
        ->and(MembershipTransitions::check(S::Left, S::Active))->toBe('not_suspended_cannot_reactivate')
        ->and(MembershipTransitions::check(S::Rejected, S::Active))->toBe('not_suspended_cannot_reactivate')
        // A replayed approval: from=active, to=active came from Approve, not
        // Reactivate — ApproveMembership's own sentence.
        ->and(MembershipTransitions::check(S::Active, S::Active))->toBe('registration_not_pending')
        ->and(MembershipTransitions::check(S::Active, S::Rejected))->toBe('registration_not_pending')
        ->and(MembershipTransitions::check(S::Suspended, S::Pending))->toBe('registration_not_pending');
});

it('assert throws RuleViolated carrying the code', function () {
    MembershipTransitions::assert(S::Active, S::Rejected);
})->throws(RuleViolated::class, 'registration_not_pending');

it('every refusal code the graph can produce has a Vietnamese sentence', function () {
    foreach (['not_active_cannot_suspend', 'not_suspended_cannot_reactivate', 'registration_not_pending'] as $code) {
        expect(__('rules.'.$code))->not->toBe('rules.'.$code);
    }
});
```

Create `tests/Unit/Members/PhoneTest.php`:

```php
<?php

use App\Exceptions\RuleViolated;
use App\Support\Members\Phone;

it('accepts the shapes the seed and the dev database actually carry', function () {
    // QA T18's measured corpus: ten digits, grouped or solid, dots or
    // dashes, optional +84.
    foreach (['0912 345 678', '0999888777', '091.234.5678', '+84 912 345 678', '091-234-5678'] as $phone) {
        expect(Phone::isValid($phone))->toBeTrue($phone);
    }
});

it('refuses khong-phai-so and wrong digit counts', function () {
    foreach (['khong-phai-so', '09xx xxx xxx', '12345678', '012345678901', ''] as $phone) {
        expect(Phone::isValid($phone))->toBeFalse($phone);
    }
});

it('assert throws phone_invalid, whose sentence exists', function () {
    expect(fn () => Phone::assert('khong-phai-so'))
        ->toThrow(RuleViolated::class, 'phone_invalid')
        ->and(__('rules.phone_invalid'))->toBe('Số điện thoại chưa đúng. Ghi 10 số, ví dụ 0912345678.');
});

it('the HTML pattern mirror is the generous approximation, not the rule', function () {
    // PHONE_PATTERN in the reference: a hint that saves a round trip;
    // Phone::assert is what decides.
    expect(Phone::PATTERN)->toBe('[+0-9][0-9 .-]{7,13}');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `make test FILTER=Members`
Expected: FAIL — `Class "App\Support\Members\MembershipTransitions" not found`.

- [ ] **Step 3: Implement**

Create `app/Support/Members/MembershipTransitions.php`:

```php
<?php

declare(strict_types=1);

namespace App\Support\Members;

use App\Enums\MembershipStatus;
use App\Exceptions\RuleViolated;

/**
 * BR §7.5's state machine — the PHP form of old_next/src/domain/members/
 * policy.ts's ALLOWED set and refusalFor(). Written as data so the diagram
 * in the requirements and the table here can be compared by eye.
 *
 * Two families of extra arrows the diagram does not draw, both the
 * reference's own hard-won decisions (its docstring holds the full
 * argument):
 *  - any → left, INCLUDING left → left (OPS §4.3: "Any status → left";
 *    M6: a re-clicked "Đánh dấu đã rời" is idempotent, not a bespoke
 *    refusal).
 *  - rejected → pending and left → pending (BR §2: re-applying walks the
 *    SAME row back, because memberships_one_per_shelf ignores status).
 *    suspended has NO → pending edge: a suspended reader is reactivated by
 *    a manager, never walked back by resubmitting the public form
 *    (CRITICAL 1).
 */
final class MembershipTransitions
{
    private const array ALLOWED = [
        'pending->active', 'pending->rejected',
        'active->suspended', 'suspended->active',
        'pending->left', 'active->left', 'suspended->left',
        'rejected->left', 'left->left',
        'rejected->pending', 'left->pending',
    ];

    /** The refusal code for a forbidden edge, or null when allowed. */
    public static function check(MembershipStatus $from, MembershipStatus $to): ?string
    {
        if (in_array("{$from->value}->{$to->value}", self::ALLOWED, true)) {
            return null;
        }

        return self::refusalFor($from, $to);
    }

    public static function assert(MembershipStatus $from, MembershipStatus $to): void
    {
        $code = self::check($from, $to);

        if ($code !== null) {
            throw new RuleViolated($code);
        }
    }

    /**
     * Ordered by what the caller was TRYING to do (the reference's
     * refusalFor, comment for comment): to=suspended is Suspend's verb;
     * to=active from a terminal state is a reactivation attempt; anything
     * else reaching here is a replayed decision on a pending application.
     */
    private static function refusalFor(MembershipStatus $from, MembershipStatus $to): string
    {
        if ($to === MembershipStatus::Suspended) {
            return 'not_active_cannot_suspend';
        }

        if ($to === MembershipStatus::Active
            && in_array($from, [MembershipStatus::Left, MembershipStatus::Rejected], true)) {
            return 'not_suspended_cannot_reactivate';
        }

        return 'registration_not_pending';
    }
}
```

Create `app/Support/Members/Phone.php`:

```php
<?php

declare(strict_types=1);

namespace App\Support\Members;

use App\Exceptions\RuleViolated;

/**
 * QA remediation T18's phone rule, ported whole: 9–11 digits after
 * stripping spaces, dots and dashes, optionally +84-prefixed — the shape
 * read off the seed and the live dev database, not assumed. `khong-phai-so`
 * typed into a phone box must be a sentence, never a tel: link to nowhere.
 *
 * Every caller is responsible for its own blank check first: null means
 * "no phone on file", not "an invalid one" — Registration refuses a blank
 * phone only when no reason accompanies it (thieu-so-dien-thoai), and calls
 * assert() only once it has decided the phone is not blank.
 */
final class Phone
{
    /**
     * The HTML pattern mirror — a generous approximation (pattern cannot
     * express "strip separators, then count"), a hint that saves a round
     * trip; assert() is what decides.
     */
    public const string PATTERN = '[+0-9][0-9 .-]{7,13}';

    public static function isValid(string $phone): bool
    {
        $stripped = preg_replace('/[\s.\-]/u', '', trim($phone)) ?? '';

        return preg_match('/^(\+84)?\d{9,11}$/', $stripped) === 1;
    }

    public static function assert(string $phone): void
    {
        if (! self::isValid($phone)) {
            throw new RuleViolated('phone_invalid');
        }
    }
}
```

Append to the returned array in `lang/vi/rules.php` (sentences are OPS §4.3's verbatim where it names one, and `old_next/src/domain/kernel/errors.ts`'s `ERROR_MESSAGES` verbatim for the rest — do not re-word any):

```php
    // ── Members (Phase 1b) ────────────────────────────────────────────
    'membership_not_found' => 'Không tìm thấy bạn đọc này.',
    'username_taken' => 'Tên đăng nhập đã được dùng, hãy chọn tên khác.',
    'username_in_use' => 'Tên đăng nhập này đã có người dùng.',
    'password_too_short' => 'Mật khẩu cần ít nhất 8 ký tự.',
    'passwords_dont_match' => 'Mật khẩu nhập lại không khớp.',
    'required_fields_missing' => 'Vui lòng điền đầy đủ các trường bắt buộc.',
    'validation_failed' => 'Vui lòng kiểm tra lại thông tin.',
    'already_registered_here' => 'Bạn đã đăng ký ở tủ sách này rồi.',
    'registration_not_pending' => 'Đơn đăng ký này đã được xử lý.',
    'reject_reason_required' => 'Vui lòng ghi lý do từ chối.',
    'not_active_cannot_suspend' => 'Chỉ có thể tạm khoá tài khoản đang hoạt động.',
    'not_suspended_cannot_reactivate' => 'Chỉ có thể kích hoạt lại tài khoản đang tạm khoá.',
    'member_has_active_loans' => 'Bạn đọc này còn sách chưa trả, hãy nhận trả trước.',
    'empty_proposal' => 'Vui lòng thay đổi ít nhất một trường.',
    'not_permitted' => 'Bạn không có quyền thực hiện việc này.',
    'phone_invalid' => 'Số điện thoại chưa đúng. Ghi 10 số, ví dụ 0912345678.',
    'thieu-so-dien-thoai' => 'Bạn chưa nhập số điện thoại. Hãy nhập số, hoặc cho biết lý do chưa có.',
    'parish_unit_l1_not_found' => 'Đơn vị bậc 1 đã chọn không tồn tại.',
    'parish_unit_l2_not_found' => 'Đơn vị bậc 2 đã chọn không tồn tại.',
    'parish_unit_l2_not_in_l1' => 'Đơn vị bậc 2 đã chọn không thuộc đơn vị bậc 1 đã chọn.',
    'suspension_reason_required' => 'Vui lòng ghi lý do tạm khoá.',
    'shelf_not_found' => 'Không tìm thấy tủ sách này.',
```

Append to the `attributes` array in `lang/vi/validation.php` (1a's known-gaps entry records exactly this obligation — an unlisted attribute renders as snake-case-with-spaces English inside a Vietnamese sentence):

```php
        'username' => 'tên đăng nhập',
        'password' => 'mật khẩu',
        'saint_name' => 'tên thánh',
        'full_name' => 'họ và tên',
        'date_of_birth' => 'ngày sinh',
        'father_name' => 'tên cha',
        'mother_name' => 'tên mẹ',
        'phone' => 'số điện thoại',
        'phone_missing_reason' => 'lý do chưa có số điện thoại',
        'email' => 'email',
        'reason' => 'lý do',
        'shelf' => 'tủ sách',
        'parish_unit_l1_id' => 'đơn vị bậc 1',
        'parish_unit_l2_id' => 'đơn vị bậc 2',
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `make test FILTER=Members`
Expected: PASS (all four + four).

- [ ] **Step 5: Lint, analyse, commit**

Run: `make lint && make analyse`

```bash
git add app/Support/Members lang/vi tests/Unit/Members
git commit -m "feat: membership state graph, phone rule, and the members refusal sentences"
```

---

### Task 2: Parish taxonomy — the pure rules, the context query, the factory, the seeded units

Read first: `old_next/src/domain/members/parish-taxonomy.ts`, `old_next/src/domain/members/parish-context.ts`, and `old_next/tests/domain/members/parish-taxonomy.test.ts` — the pure tests below port that file's core cases.

**Files:**
- Create: `app/Support/Members/ParishTaxonomy.php`
- Create: `app/Support/Members/ParishUnits.php`
- Create: `app/Queries/ParishContextQuery.php`
- Create: `database/factories/ParishUnitFactory.php`
- Modify: `app/Models/ParishUnit.php` (add `HasFactory`)
- Modify: `database/seeders/DemoShelfSeeder.php` (taxonomy + units + demo readers)
- Test: `tests/Unit/Members/ParishTaxonomyTest.php`
- Test: `tests/Feature/Members/ParishContextQueryTest.php`

**Interfaces:**
- Consumes: `App\Models\ParishUnit` (Phase 0 — `BelongsToBookshelf`, `SoftDeletes`, `$guarded = ['name_scope_key']`), `App\Support\TenantContext` (`bookshelf(): ?Bookshelf`), `Bookshelf::$casts['settings'] => AsArrayObject`.
- Produces:
  - `ParishTaxonomy` — readonly VO: `int $levels` (1|2), `bool $nested`, `string $level1Label`, `string $level2Label`; `ParishTaxonomy::default()` (one level, `Tổ`, not nested); `ParishTaxonomy::fromSettings(mixed $raw)` (defensive: anything unreadable falls back per-field — a registration must not fail because a settings blob is malformed).
  - Unit rows travel as arrays everywhere: `array{id: string, level: int, parentId: ?string, name: string, sortOrder: int, deletedAt: ?string}`.
  - `ParishUnits::options(array $units, int $level, string|null|false $parentId = false): array` — live units of a level, ordered `sortOrder` then name (`localeCompare` becomes `Collator('vi')`); `false` = no parent filter, `null` = parent-is-null, id = children of.
  - `ParishUnits::validateSelection(ParishTaxonomy $t, array $units, ?string $l1, ?string $l2): ?string` — `null` ok, or `parish_unit_l1_not_found` / `parish_unit_l2_not_found` / `parish_unit_l2_not_in_l1`. Deleted units still count as "exists" (a recorded parish is history); the nesting check applies only when `levels === 2 && nested`.
  - `ParishUnits::describeSelection(...): string` — "Tổ 3 · Giáo họ Thánh Tâm", smaller unit first, `""` when nothing set, level-2 half suppressed when `levels === 1`.
  - `ParishUnits::unitName(array $units, ?string $id): string` — the name or `"Chưa có"`.
  - `ParishUnits::hasVisibleLevel2(ParishTaxonomy $t, array $units): bool` — nested requires a live level-1 parent with live children.
  - `ParishContextQuery::run(): array{taxonomy: ParishTaxonomy, units: list<array{…}>}` — the bound shelf's taxonomy from `settings['parish_taxonomy']` (snake keys: `levels`, `nested`, `level1_label`, `level2_label`) and **every** unit including soft-deleted, ordered level/sort_order/name.
  - `ParishUnit::factory()` — `['level' => 1, 'name' => 'Tổ 1', 'sort_order' => 0]`, no bookshelf in the definition (the trait refuses a factory that invents its own shelf — pass `->for($shelf)`).

- [ ] **Step 1: Write the failing pure tests**

Create `tests/Unit/Members/ParishTaxonomyTest.php`:

```php
<?php

use App\Support\Members\ParishTaxonomy;
use App\Support\Members\ParishUnits;

function ptUnit(string $id, int $level, ?string $parentId = null, string $name = 'Tổ 1', int $sort = 0, ?string $deletedAt = null): array
{
    return ['id' => $id, 'level' => $level, 'parentId' => $parentId, 'name' => $name, 'sortOrder' => $sort, 'deletedAt' => $deletedAt];
}

it('defaults to one level labelled Tổ, not nested', function () {
    $t = ParishTaxonomy::default();

    expect($t->levels)->toBe(1)
        ->and($t->nested)->toBeFalse()
        ->and($t->level1Label)->toBe('Tổ');
});

it('reads settings defensively, falling back per-field', function () {
    $t = ParishTaxonomy::fromSettings(['levels' => 2, 'nested' => true, 'level1_label' => 'Giáo họ', 'level2_label' => 'Tổ']);
    expect($t->levels)->toBe(2)->and($t->nested)->toBeTrue()
        ->and($t->level1Label)->toBe('Giáo họ')->and($t->level2Label)->toBe('Tổ');

    // levels 3, a blank label, a non-array — each falls back rather than
    // throwing: a registration must not fail on a malformed settings blob.
    expect(ParishTaxonomy::fromSettings(['levels' => 3])->levels)->toBe(1)
        ->and(ParishTaxonomy::fromSettings(['level1_label' => '  '])->level1Label)->toBe('Tổ')
        ->and(ParishTaxonomy::fromSettings('junk')->levels)->toBe(1)
        ->and(ParishTaxonomy::fromSettings(null)->levels)->toBe(1);
});

it('options orders by sortOrder then Vietnamese name, and never offers a deleted unit', function () {
    $units = [
        ptUnit('b', 1, null, 'Tổ 2', 1),
        ptUnit('a', 1, null, 'Tổ 1', 0),
        ptUnit('gone', 1, null, 'Tổ 0', 0, '2026-01-01T00:00:00Z'),
        // Same sortOrder as 'a': the name decides, in vi collation.
        ptUnit('d', 1, null, 'Tổ Đức Mẹ', 0),
    ];

    expect(array_column(ParishUnits::options($units, 1), 'id'))->toBe(['a', 'd', 'b']);
});

it('options distinguishes no-parent-filter, parent-is-null, and children-of', function () {
    $units = [
        ptUnit('p', 1, null, 'Giáo họ'),
        ptUnit('c1', 2, 'p', 'Tổ 1'),
        ptUnit('c2', 2, null, 'Tổ lẻ'),
    ];

    expect(array_column(ParishUnits::options($units, 2), 'id'))->toBe(['c1', 'c2'])
        ->and(array_column(ParishUnits::options($units, 2, null), 'id'))->toBe(['c2'])
        ->and(array_column(ParishUnits::options($units, 2, 'p'), 'id'))->toBe(['c1']);
});

it('validateSelection enforces existence, level, and nesting — and only nesting when nested', function () {
    $nested = new ParishTaxonomy(2, true, 'Giáo họ', 'Tổ');
    $flat = new ParishTaxonomy(2, false, 'Giáo họ', 'Tổ');
    $units = [ptUnit('p1', 1), ptUnit('p2', 1), ptUnit('c1', 2, 'p1')];

    expect(ParishUnits::validateSelection($nested, $units, null, null))->toBeNull()
        ->and(ParishUnits::validateSelection($nested, $units, 'p1', 'c1'))->toBeNull()
        ->and(ParishUnits::validateSelection($nested, $units, 'missing', null))->toBe('parish_unit_l1_not_found')
        // A level-2 id in the level-1 slot is not-found, not borrowed.
        ->and(ParishUnits::validateSelection($nested, $units, 'c1', null))->toBe('parish_unit_l1_not_found')
        ->and(ParishUnits::validateSelection($nested, $units, 'p1', 'missing'))->toBe('parish_unit_l2_not_found')
        ->and(ParishUnits::validateSelection($nested, $units, 'p2', 'c1'))->toBe('parish_unit_l2_not_in_l1')
        // Not nested: no relationship checked at all.
        ->and(ParishUnits::validateSelection($flat, $units, 'p2', 'c1'))->toBeNull();
});

it('a deleted unit still validates — a recorded parish is history, not an error', function () {
    $t = new ParishTaxonomy(2, true, 'Giáo họ', 'Tổ');
    $units = [ptUnit('p1', 1), ptUnit('c1', 2, 'p1', 'Tổ 1', 0, '2026-01-01T00:00:00Z')];

    expect(ParishUnits::validateSelection($t, $units, 'p1', 'c1'))->toBeNull();
});

it('nested=true while levels=1 is ignored, not an error', function () {
    // Design §3.2: dropping to one level keeps `nested` for a later return;
    // a leftover l2 selection must not be checked against a level that no
    // longer renders.
    $t = new ParishTaxonomy(1, true, 'Tổ', 'Tổ');
    $units = [ptUnit('p1', 1), ptUnit('c1', 2, 'p2-gone')];

    expect(ParishUnits::validateSelection($t, $units, 'p1', 'c1'))->toBeNull();
});

it('describeSelection writes smaller unit first with the shelf\'s own separator, and suppresses level 2 at one level', function () {
    $two = new ParishTaxonomy(2, true, 'Giáo họ', 'Tổ');
    $one = new ParishTaxonomy(1, false, 'Tổ', 'Tổ');
    $units = [ptUnit('p1', 1, null, 'Giáo họ Thánh Tâm'), ptUnit('c1', 2, 'p1', 'Tổ 3')];

    expect(ParishUnits::describeSelection($two, $units, 'p1', 'c1'))->toBe('Tổ 3 · Giáo họ Thánh Tâm')
        ->and(ParishUnits::describeSelection($two, $units, 'p1', null))->toBe('Giáo họ Thánh Tâm')
        ->and(ParishUnits::describeSelection($one, $units, 'p1', 'c1'))->toBe('Giáo họ Thánh Tâm')
        ->and(ParishUnits::describeSelection($two, $units, null, null))->toBe('');
});

it('unitName answers Chưa có for nothing, and looks up deleted units too', function () {
    $units = [ptUnit('gone', 1, null, 'Tổ Cũ', 0, '2026-01-01T00:00:00Z')];

    expect(ParishUnits::unitName($units, null))->toBe('Chưa có')
        ->and(ParishUnits::unitName($units, 'missing'))->toBe('Chưa có')
        ->and(ParishUnits::unitName($units, 'gone'))->toBe('Tổ Cũ');
});

it('hasVisibleLevel2 requires a live parent when nested', function () {
    $nested = new ParishTaxonomy(2, true, 'Giáo họ', 'Tổ');
    $orphaned = [
        ptUnit('p1', 1, null, 'Giáo họ', 0, '2026-01-01T00:00:00Z'),
        ptUnit('c1', 2, 'p1'),
    ];
    $live = [ptUnit('p1', 1), ptUnit('c1', 2, 'p1')];

    expect(ParishUnits::hasVisibleLevel2($nested, $orphaned))->toBeFalse()
        ->and(ParishUnits::hasVisibleLevel2($nested, $live))->toBeTrue()
        ->and(ParishUnits::hasVisibleLevel2(ParishTaxonomy::default(), $live))->toBeFalse();
});
```

Create `tests/Feature/Members/ParishContextQueryTest.php`:

```php
<?php

use App\Models\Bookshelf;
use App\Models\ParishUnit;
use App\Queries\ParishContextQuery;
use Tests\Support\TenantHarness;

it('reads the bound shelf\'s taxonomy and every unit, soft-deleted included', function () {
    $shelf = Bookshelf::factory()->create([
        'slug' => 'dong-thap',
        'settings' => ['parish_taxonomy' => ['levels' => 2, 'nested' => true, 'level1_label' => 'Giáo họ', 'level2_label' => 'Tổ']],
    ]);
    $parent = ParishUnit::factory()->for($shelf)->create(['level' => 1, 'name' => 'Giáo họ Thánh Tâm']);
    ParishUnit::factory()->for($shelf)->create(['level' => 2, 'parent_id' => $parent->id, 'name' => 'Tổ 3']);
    ParishUnit::factory()->for($shelf)->create(['level' => 1, 'name' => 'Giáo họ Cũ'])->delete();

    TenantHarness::actAs($shelf);
    $context = app(ParishContextQuery::class)->run();

    expect($context['taxonomy']->level1Label)->toBe('Giáo họ')
        ->and($context['taxonomy']->nested)->toBeTrue()
        ->and($context['units'])->toHaveCount(3)
        ->and(collect($context['units'])->firstWhere('name', 'Giáo họ Cũ')['deletedAt'])->not->toBeNull();
});

it('a shelf with no taxonomy configured gets the default, and another shelf\'s units never appear', function () {
    $shelves = TenantHarness::twoCollidingShelves();

    TenantHarness::actAs($shelves['a']);
    $context = app(ParishContextQuery::class)->run();

    // The harness seeds one colliding 'Giáo họ Trung Tâm' per shelf; the
    // bound shelf sees exactly its own one.
    expect($context['taxonomy']->levels)->toBe(1)
        ->and($context['taxonomy']->level1Label)->toBe('Tổ')
        ->and($context['units'])->toHaveCount(1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `make test FILTER=ParishTaxonomy && make test FILTER=ParishContext`
Expected: FAIL — classes not found.

- [ ] **Step 3: Implement**

Create `app/Support/Members/ParishTaxonomy.php`:

```php
<?php

declare(strict_types=1);

namespace App\Support\Members;

/**
 * How a parish subdivides its people, configurable per shelf (BR §5.6) —
 * the PHP form of parish-taxonomy.ts's ParishTaxonomy plus
 * parish-context.ts's defensive toTaxonomy(). The stored shape under
 * bookshelves.settings['parish_taxonomy'] is snake_case (levels, nested,
 * level1_label, level2_label); this class is the one place that spelling
 * is translated.
 */
final readonly class ParishTaxonomy
{
    public function __construct(
        public int $levels,
        public bool $nested,
        public string $level1Label,
        public string $level2Label,
    ) {}

    /** One level, "Tổ", not nested — what a brand-new shelf gets. */
    public static function default(): self
    {
        return new self(1, false, 'Tổ', 'Tổ');
    }

    /**
     * Defensive per-field fallback: settings is free-form JSON with no
     * constraint behind it, and a registration must not fail because the
     * blob is malformed (BR §5.6).
     */
    public static function fromSettings(mixed $raw): self
    {
        $fallback = self::default();

        if (! is_array($raw) && ! $raw instanceof \ArrayAccess) {
            return $fallback;
        }

        $label = function (mixed $v, string $or): string {
            return is_string($v) && trim($v) !== '' ? $v : $or;
        };

        return new self(
            ($raw['levels'] ?? null) === 2 ? 2 : 1,
            ($raw['nested'] ?? null) === true,
            $label($raw['level1_label'] ?? null, $fallback->level1Label),
            $label($raw['level2_label'] ?? null, $fallback->level2Label),
        );
    }
}
```

Create `app/Support/Members/ParishUnits.php`:

```php
<?php

declare(strict_types=1);

namespace App\Support\Members;

use Collator;

/**
 * The pure unit rules of parish-taxonomy.ts, over plain array rows:
 * array{id: string, level: int, parentId: ?string, name: string,
 * sortOrder: int, deletedAt: ?string}. Framework-free so the same logic
 * backs a picker prop and the command that must not trust the picker.
 */
final class ParishUnits
{
    /**
     * Live units of a level, ordered sortOrder then Vietnamese name —
     * never a number parsed out of the name ("Tổ 10" before "Tổ 2" is the
     * carelessness sort_order exists to prevent).
     *
     * $parentId three-state, matching the reference's undefined/null/id:
     * false (default) = no parent filter; null = parent is null; an id =
     * that unit's children.
     *
     * @param  list<array{id: string, level: int, parentId: ?string, name: string, sortOrder: int, deletedAt: ?string}>  $units
     * @return list<array{id: string, level: int, parentId: ?string, name: string, sortOrder: int, deletedAt: ?string}>
     */
    public static function options(array $units, int $level, string|null|false $parentId = false): array
    {
        $collator = new Collator('vi');

        $filtered = array_values(array_filter(
            $units,
            fn (array $u) => $u['deletedAt'] === null
                && $u['level'] === $level
                && ($parentId === false || $u['parentId'] === $parentId),
        ));

        usort($filtered, fn (array $a, array $b) => $a['sortOrder'] <=> $b['sortOrder']
            ?: ($collator->compare($a['name'], $b['name']) ?: 0));

        return $filtered;
    }

    /**
     * BR §5.6's selection rule — null when valid, else the refusal code.
     * Deleted units still count as "exists" (a membership pointing at a
     * retired unit is history); the nesting check runs only when levels===2
     * AND nested (a leftover flag on a one-level shelf is ignored).
     *
     * @param  list<array{id: string, level: int, parentId: ?string, name: string, sortOrder: int, deletedAt: ?string}>  $units
     */
    public static function validateSelection(ParishTaxonomy $taxonomy, array $units, ?string $l1, ?string $l2): ?string
    {
        $find = fn (?string $id): ?array => $id === null
            ? null
            : (collect($units)->firstWhere('id', $id) ?: null);

        if ($l1 !== null) {
            $unit = $find($l1);
            if ($unit === null || $unit['level'] !== 1) {
                return 'parish_unit_l1_not_found';
            }
        }

        if ($l2 !== null) {
            $unit = $find($l2);
            if ($unit === null || $unit['level'] !== 2) {
                return 'parish_unit_l2_not_found';
            }
        }

        if ($taxonomy->levels === 2 && $taxonomy->nested && $l1 !== null && $l2 !== null) {
            $l2Unit = $find($l2);
            if ($l2Unit !== null && $l2Unit['parentId'] !== $l1) {
                return 'parish_unit_l2_not_in_l1';
            }
        }

        return null;
    }

    /**
     * "Tổ 3 · Giáo họ Thánh Tâm", smaller unit first, "" when nothing set.
     * Looks up regardless of deletedAt; the level-2 half is suppressed when
     * the shelf runs one level (the value itself stays stored untouched).
     *
     * @param  list<array{id: string, level: int, parentId: ?string, name: string, sortOrder: int, deletedAt: ?string}>  $units
     */
    public static function describeSelection(ParishTaxonomy $taxonomy, array $units, ?string $l1, ?string $l2): string
    {
        $parts = [];

        if ($taxonomy->levels === 2 && $l2 !== null) {
            $unit = collect($units)->firstWhere('id', $l2);
            if ($unit !== null) {
                $parts[] = $unit['name'];
            }
        }

        if ($l1 !== null) {
            $unit = collect($units)->firstWhere('id', $l1);
            if ($unit !== null) {
                $parts[] = $unit['name'];
            }
        }

        return implode(' · ', $parts);
    }

    /**
     * @param  list<array{id: string, level: int, parentId: ?string, name: string, sortOrder: int, deletedAt: ?string}>  $units
     */
    public static function unitName(array $units, ?string $id): string
    {
        if ($id === null) {
            return 'Chưa có';
        }

        $unit = collect($units)->firstWhere('id', $id);

        return $unit['name'] ?? 'Chưa có';
    }

    /**
     * Whether a level-2 field should render at all — "no field, or a
     * usable one": when nested, a level-2 unit only counts under a LIVE
     * level-1 parent (a soft-deleted parent's orphaned children would
     * otherwise report a field that renders no options).
     *
     * @param  list<array{id: string, level: int, parentId: ?string, name: string, sortOrder: int, deletedAt: ?string}>  $units
     */
    public static function hasVisibleLevel2(ParishTaxonomy $taxonomy, array $units): bool
    {
        if ($taxonomy->levels !== 2) {
            return false;
        }

        if (! $taxonomy->nested) {
            return self::options($units, 2) !== [];
        }

        foreach (self::options($units, 1) as $parent) {
            if (self::options($units, 2, $parent['id']) !== []) {
                return true;
            }
        }

        return false;
    }
}
```

Create `app/Queries/ParishContextQuery.php`:

```php
<?php

namespace App\Queries;

use App\Models\ParishUnit;
use App\Support\Members\ParishTaxonomy;
use App\Support\TenantContext;
use RuntimeException;

/**
 * The bound shelf's taxonomy and its units — the Laravel form of
 * parish-context.ts's loadParishContext. Every unit travels, soft-deleted
 * ones included: validateSelection and describeSelection need the deleted
 * ones (history, not error), and filtering to what a picker may OFFER is
 * ParishUnits::options's job, at the call site.
 *
 * The reference's hard-won `where id` lesson (a permissive public-read
 * policy turned its unqualified bookshelves select into "whichever shelf
 * the planner returned first") has no analogue here: TenantContext hands
 * back the one bound Bookshelf model, and ParishUnit carries
 * BookshelfScope.
 */
final class ParishContextQuery
{
    public function __construct(private TenantContext $context) {}

    /** @return array{taxonomy: ParishTaxonomy, units: list<array{id: string, level: int, parentId: ?string, name: string, sortOrder: int, deletedAt: ?string}>} */
    public function run(): array
    {
        $shelf = $this->context->bookshelf();

        if ($shelf === null) {
            throw new RuntimeException('ParishContextQuery needs a bound tenant.');
        }

        $taxonomy = ParishTaxonomy::fromSettings($shelf->settings['parish_taxonomy'] ?? null);

        $units = ParishUnit::query()->withTrashed()
            ->orderBy('level')->orderBy('sort_order')->orderBy('name')
            ->get()
            ->map(fn (ParishUnit $u): array => [
                'id' => $u->id,
                'level' => (int) $u->level,
                'parentId' => $u->parent_id,
                'name' => $u->name,
                'sortOrder' => (int) $u->sort_order,
                'deletedAt' => $u->deleted_at?->toIso8601String(),
            ])
            ->all();

        return ['taxonomy' => $taxonomy, 'units' => $units];
    }
}
```

Create `database/factories/ParishUnitFactory.php`:

```php
<?php

namespace Database\Factories;

use App\Models\ParishUnit;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<ParishUnit> */
class ParishUnitFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        // No bookshelf_id here: BelongsToBookshelf's creating hook refuses
        // a factory that invents its own shelf — call ->for($shelf).
        return [
            'level' => 1,
            'name' => 'Tổ '.$this->faker->unique()->numberBetween(1, 99),
            'sort_order' => 0,
        ];
    }
}
```

Add `use Illuminate\Database\Eloquent\Factories\HasFactory;` + the trait to `app/Models/ParishUnit.php` (with the `@use HasFactory<ParishUnitFactory>` docblock the other models carry).

Extend `database/seeders/DemoShelfSeeder.php`: after the existing shelf/manager block, give the demo shelf a nested two-level taxonomy and units, plus five demo readers (the AGENTS.md fixture people), all guarded by `firstOrCreate` so re-seeding is idempotent:

```php
        // Phase 1b: a nested two-level taxonomy so every picker, filter and
        // parish line is exercisable in dev — Giáo họ over Tổ, the two
        // words BR §5.6 names as the only ones a real parish has been seen
        // to use.
        $settings = $shelf->settings;
        if (! isset($settings['parish_taxonomy'])) {
            $settings['parish_taxonomy'] = [
                'levels' => 2, 'nested' => true,
                'level1_label' => 'Giáo họ', 'level2_label' => 'Tổ',
            ];
            $shelf->settings = $settings;
            $shelf->save();
        }

        $units = [];
        foreach (['Giáo họ Thánh Tâm', 'Giáo họ Mân Côi'] as $i => $name) {
            $units[$name] = ParishUnit::query()->firstOrCreate(
                ['bookshelf_id' => $shelf->id, 'level' => 1, 'name' => $name],
                ['sort_order' => $i],
            );
        }
        foreach ([['Tổ 1', 'Giáo họ Thánh Tâm'], ['Tổ 2', 'Giáo họ Thánh Tâm'], ['Tổ 1', 'Giáo họ Mân Côi']] as $i => [$name, $parent]) {
            ParishUnit::query()->firstOrCreate(
                ['bookshelf_id' => $shelf->id, 'level' => 2, 'name' => $name, 'parent_id' => $units[$parent]->id],
                ['sort_order' => $i],
            );
        }

        // Five demo readers (AGENTS.md's fixture people), one pending so the
        // approval queue renders.
        $people = [
            ['Maria', 'Nguyễn Thị Lan', 'active'], ['Giuse', 'Trần Minh', 'active'],
            ['Têrêsa', 'Lê Ngọc Ánh', 'active'], ['Anna', 'Phạm Thu Hà', 'active'],
            ['Phêrô', 'Nguyễn Văn Bình', 'pending'],
        ];
        foreach ($people as [$saint, $name, $status]) {
            $person = User::query()->where('full_name', $name)->first()
                ?? User::factory()->create(['saint_name' => $saint, 'full_name' => $name, 'phone' => '0912345678', 'phone_missing_reason' => null]);
            Membership::query()->firstOrCreate(
                ['bookshelf_id' => $shelf->id, 'user_id' => $person->id],
                ['role' => 'reader', 'status' => $status, 'parish_unit_l1_id' => $units['Giáo họ Thánh Tâm']->id],
            );
        }
```

(Add the missing `use App\Models\ParishUnit;` import; keep the seeder's existing tenancy stance — it runs with no tenant bound and names `bookshelf_id` explicitly, as the trait's docblock sanctions.)

- [ ] **Step 4: Run the tests, then the seeder, to verify**

Run: `make test FILTER=Parish`
Expected: PASS.
Run: `php artisan db:seed --class=DemoShelfSeeder` (inside the compose `app` container), twice.
Expected: exits 0 both times (idempotent), `parish_units` has 5 rows for the demo shelf.

- [ ] **Step 5: Lint, analyse, commit**

```bash
git add app/Support/Members app/Queries/ParishContextQuery.php app/Models/ParishUnit.php database/factories/ParishUnitFactory.php database/seeders/DemoShelfSeeder.php tests
git commit -m "feat: parish taxonomy rules, context query and seeded demo units"
```

---

### Task 3: `users.full_name_folded` — the roster's stored search-and-sort key

**Files:**
- Create: `database/migrations/2026_08_28_000001_add_users_full_name_folded.php`
- Test: `tests/Feature/Members/FullNameFoldedTest.php`

**Interfaces:**
- Consumes: `App\Support\FoldExpression::sql(string $expression)` (Phase 0), `App\Support\Fold::fold(string)` — the treaty pair `FoldParityTest` already holds.
- Produces: a `STORED` generated column `users.full_name_folded` (`TEXT`, `utf8mb4_bin`), plus a **prefix** index `users_full_name_folded_index (full_name_folded(191))`. Task 12's `ReadersListQuery` searches and orders on it.

**Divergence 4 lands here.** The reference folded `u.full_name` at query time through `olibra_fold()`; MariaDB forbids stored functions in generated columns and has no `unaccent`, so the column is emitted from `FoldExpression` exactly the way Phase 0 froze `books.title_folded` (same DDL shape, same collation note, same no-`NOT NULL` grammar constraint that migration documents).

**Two MariaDB constraints this task must respect — both learned from Phase 0's own migrations, not assumed:**

1. **`TEXT`, not `VARCHAR(255)`. The fold can LENGTHEN a name.** `Fold::MAP` is not a pure accent-stripper: `ß → ss`, `æ → ae`, `œ → oe`, `ĳ → ij` are one-to-two expansions (`app/Support/Fold.php:67-82`, and the divergence is documented at `docs/known-gaps.md:738-744`). `users.full_name` is `VARCHAR(255)`, so the folded value can exceed 255 characters — and MariaDB's derived max-length for the nested `REPLACE` chain exceeds 255 regardless of the data. A `VARCHAR(255)` stored generated column therefore risks either a refused `ALTER` or errno **1406** (`Data too long`) on insert under strict mode. `books.title_folded` is `TEXT` for exactly this reason (`2026_08_26_000005_create_books_table.php:51`). Match it.
2. **A `TEXT` column cannot be indexed without a key length** — errno **1170**, `BLOB/TEXT column used in key specification without a key length`. This is the *fifth* MariaDB bite of this project's series and Phase 0 already paid it: `books` has a raw-SQL prefix index `CREATE INDEX books_public ON books (bookshelf_id, title(191))` (`2026_08_26_000005:78`) written that way precisely because Blueprint cannot express a prefix length. Use `(full_name_folded(191))` — 191 characters is the utf8mb4 index-prefix ceiling under the 767-byte limit and is this repo's established number.

Task 16's known-gaps entry records that the prefix makes the index a filter rather than a covering sort: MariaDB can still use it for the `LIKE '%…%'` scan's row access, but the `ORDER BY` falls back to a filesort. At BR §1's few-hundred readers per shelf that is the same trade `known-gaps.md:920-926` already accepts for `books_public`.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/Members/FullNameFoldedTest.php`:

```php
<?php

use App\Models\User;
use App\Support\Fold;
use Illuminate\Support\Facades\DB;

it('stores the fold of every name, đ included, and agrees with Fold::fold', function () {
    // Đặng is the roster's own regression: unfolded, Đ sorted after every
    // ASCII letter and every Đặng child landed on the roster's last page.
    $names = ['Đặng Văn Bút', 'Nguyễn Thị Lan', 'Trần Minh', 'D\'Artagnan Lê'];

    foreach ($names as $name) {
        $user = User::factory()->create(['full_name' => $name]);
        $stored = DB::table('users')->where('id', $user->id)->value('full_name_folded');

        expect($stored)->toBe(Fold::fold($name), $name);
    }

    expect(Fold::fold('Đặng Văn Bút'))->toBe('dang van but');
});

it('a name whose fold is LONGER than the name itself still stores whole', function () {
    // Fold::MAP expands ß→ss, æ→ae, œ→oe, ĳ→ij. A VARCHAR(255) generated
    // column would truncate or refuse this (errno 1406); TEXT does not.
    // 200 ß folds to 400 characters.
    $name = str_repeat('ß', 200);
    $user = User::factory()->create(['full_name' => $name]);

    $stored = DB::table('users')->where('id', $user->id)->value('full_name_folded');
    expect($stored)->toBe(Fold::fold($name))
        ->and(mb_strlen((string) $stored))->toBe(400);
});

it('the column is generated — writing it directly is refused by the engine', function () {
    $user = User::factory()->create();

    // errno 3105 on MySQL is 1906 on MariaDB: "The value specified for
    // generated column ... has been ignored" is sqlstate HY000 error 1906
    // in strict mode. Same pin dbgExpectViolation uses for member_key.
    expect(fn () => DB::table('users')->where('id', $user->id)->update(['full_name_folded' => 'x']))
        ->toThrow(Illuminate\Database\QueryException::class);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `make test FILTER=FullNameFolded`
Expected: FAIL — `Unknown column 'full_name_folded'`.

- [ ] **Step 3: Write the migration**

Create `database/migrations/2026_08_28_000001_add_users_full_name_folded.php`:

```php
<?php

use App\Support\FoldExpression;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // Spec §4.2 option 1, same shape 2026_08_26_000005 froze for
        // books.title_folded: the expression emitted by FoldExpression and
        // frozen as DDL at migrate time. utf8mb4_bin so the engine adds no
        // folding of its own; no NOT NULL — MariaDB's generated-column
        // grammar accepts only STORED/VIRTUAL/UNIQUE/COMMENT after the
        // expression (1064 otherwise, reproduced on 10.11.19 by that
        // migration), and full_name is NOT NULL so the fold never is.
        //
        // TEXT, not VARCHAR(255): Fold::MAP expands ß→ss, æ→ae, œ→oe, ĳ→ij,
        // so the fold of a 255-char VARCHAR name can exceed 255 characters
        // (errno 1406 on insert), and MariaDB's derived max-length for the
        // REPLACE chain exceeds it regardless. books.title_folded is TEXT
        // for the same reason.
        DB::statement(sprintf(
            'ALTER TABLE users ADD COLUMN full_name_folded TEXT
                CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
                GENERATED ALWAYS AS (%s) STORED',
            FoldExpression::sql('`full_name`'),
        ));

        // Access path for the roster; plain, not unique — two children fold
        // alike constantly (that is BR §5.3's whole premise). PREFIX(191):
        // a TEXT column in a key with no length is errno 1170, the same
        // reason books_public is written as `title(191)` in raw SQL.
        DB::statement('ALTER TABLE users ADD INDEX users_full_name_folded_index (full_name_folded(191))');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE users DROP INDEX users_full_name_folded_index');
        DB::statement('ALTER TABLE users DROP COLUMN full_name_folded');
    }
};
```

Also add `full_name_folded` to `User::$guarded`? No — `User` uses `$fillable`, which never lists it, so mass assignment cannot reach it; the direct-write refusal is the engine's (the test pins it). Change nothing on the model.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `make test FILTER=FullNameFolded`
Expected: PASS. Then run the full suite once (`make test`) — `RefreshDatabase` must replay all migrations cleanly, and `FoldParityTest` must still pass untouched.

- [ ] **Step 5: Lint, analyse, commit**

```bash
git add database/migrations/2026_08_28_000001_add_users_full_name_folded.php tests/Feature/Members/FullNameFoldedTest.php
git commit -m "feat: stored folded full-name column for the readers roster"
```

---

### Task 4: `MembershipPolicy`, the `{reader}` binding, and the `readers()` relation

**Files:**
- Create: `app/Policies/MembershipPolicy.php`
- Modify: `app/Providers/AppServiceProvider.php` (one `Gate::policy` line, after the existing two)
- Modify: `app/Models/Bookshelf.php` (add `readers()` relation)
- Test: `tests/Feature/Members/MembershipPolicyTest.php`

**Interfaces:**
- Consumes: the `act-as-manager` gate (Phase 0 Task 17 — reads `TenantContext`'s membership; `Gate::before` grants super admins every `act-as-*`).
- Produces:
  - `MembershipPolicy` with `viewAny`, `view`, `create`, `approve`, `reject`, `suspend`, `reactivate`, `markLeft`, `setCredentials`, `correct` — BR §13.2's Members permission set ("view any, view one, approve, reject, suspend, create, register on behalf, set or change credentials"), every method `Gate::forUser($user)->allows('act-as-manager')`. The §9 subject-role refinement on `correct` (a manager/admin subject is a super admin's to write) is NOT here — it needs the subject's role and lives in the Action (Task 10), exactly where the reference put it.
  - `Bookshelf::readers(): HasMany<Membership>` — exists so `scopeBindings()` can resolve the `{reader}` route parameter through the parent (`reader` → `readers()`), the same defence-in-depth layer the routes file documents for `{bookCopy}`; `BookshelfScope` on `Membership` is the layer that actually guards.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/Members/MembershipPolicyTest.php`:

```php
<?php

use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Gate;

/** @return array{Bookshelf, User, Membership} shelf, actor, a reader's membership */
function polFixture(string $role): array
{
    $shelf = Bookshelf::factory()->create(['settings' => []]);
    $actor = User::factory()->create();
    $actorMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $actor->id, 'role' => $role, 'status' => 'active',
    ]);
    $reader = Membership::factory()->for($shelf)->create(['status' => 'pending']);
    app(TenantContext::class)->set($shelf, $actorMembership);

    return [$shelf, $actor, $reader];
}

const MEMPOL_CLASS_ABILITIES = ['viewAny', 'create'];
const MEMPOL_ROW_ABILITIES = ['view', 'approve', 'reject', 'suspend', 'reactivate', 'markLeft', 'setCredentials', 'correct'];

it('a manager holds the whole members permission set', function () {
    [, $actor, $reader] = polFixture('manager');

    foreach (MEMPOL_CLASS_ABILITIES as $ability) {
        expect(Gate::forUser($actor)->allows($ability, Membership::class))->toBeTrue($ability);
    }
    foreach (MEMPOL_ROW_ABILITIES as $ability) {
        expect(Gate::forUser($actor)->allows($ability, $reader))->toBeTrue($ability);
    }
});

it('a reader holds none of it, their own membership included', function () {
    [, $actor, $reader] = polFixture('reader');

    foreach (MEMPOL_CLASS_ABILITIES as $ability) {
        expect(Gate::forUser($actor)->allows($ability, Membership::class))->toBeFalse($ability);
    }
    foreach (MEMPOL_ROW_ABILITIES as $ability) {
        expect(Gate::forUser($actor)->allows($ability, $reader))->toBeFalse($ability);
    }
});

it('a memberless super admin passes through Gate::before', function () {
    $shelf = Bookshelf::factory()->create(['settings' => []]);
    $admin = User::factory()->superAdmin()->create();
    $reader = Membership::factory()->for($shelf)->create();
    app(TenantContext::class)->set($shelf, null);

    expect(Gate::forUser($admin)->allows('approve', $reader))->toBeTrue()
        ->and(Gate::forUser($admin)->allows('viewAny', Membership::class))->toBeTrue();
});

it('a suspended manager is nobody', function () {
    $shelf = Bookshelf::factory()->create(['settings' => []]);
    $actor = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->manager()->create([
        'user_id' => $actor->id, 'status' => 'suspended',
    ]);
    app(TenantContext::class)->set($shelf, $membership);

    expect(Gate::forUser($actor)->allows('viewAny', Membership::class))->toBeFalse();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `make test FILTER=MembershipPolicy`
Expected: FAIL — no policy registered, `allows` returns false for the manager cases.

- [ ] **Step 3: Implement**

Create `app/Policies/MembershipPolicy.php`:

```php
<?php

namespace App\Policies;

use App\Models\Membership;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * BR §13.2's Members permission set: "view any, view one, approve, reject,
 * suspend, create, register on behalf, set or change credentials". Every
 * verb is a manager's; the two reader-side member verbs (propose a change,
 * approve/reject one) are Phase 3's and arrive with their own abilities.
 *
 * Like BookPolicy, every method delegates to the act-as gates — the ONE
 * place role, status and shelf-binding combine — and the $membership
 * parameter carries no shelf re-check: under a bound tenant BookshelfScope
 * means a foreign shelf's membership cannot have been resolved at all.
 *
 * The §9 subject-role refinement (a manager/admin SUBJECT may only be
 * corrected by a super admin) is deliberately NOT here: it needs the
 * subject's current role read under the command's own lock, so it lives in
 * UpdateReaderProfile (Task 10), exactly where the reference kept it.
 */
class MembershipPolicy
{
    public function viewAny(User $user): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function view(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    /** Register on behalf / manager-register — both create a membership. */
    public function create(User $user): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function approve(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function reject(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function suspend(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function reactivate(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function markLeft(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function setCredentials(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    /** UpdateReaderProfile's floor — the subject-role rule is the Action's. */
    public function correct(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }
}
```

In `app/Providers/AppServiceProvider.php`, after the two existing `Gate::policy` lines:

```php
        Gate::policy(Membership::class, MembershipPolicy::class);
```

(with `use App\Models\Membership;` and `use App\Policies\MembershipPolicy;` imports.)

In `app/Models/Bookshelf.php`, beside `memberships()`:

```php
    /**
     * The same rows as memberships(), under the name the {reader} route
     * parameter needs: scopeBindings() resolves a child binding through
     * the relation guessed from the parameter name (reader -> readers()),
     * so this is the defence-in-depth layer routes/web.php documents for
     * {bookCopy}. BookshelfScope on Membership is what actually guards.
     *
     * @return HasMany<Membership, $this>
     */
    public function readers(): HasMany
    {
        return $this->hasMany(Membership::class);
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `make test FILTER=MembershipPolicy`
Expected: PASS.

- [ ] **Step 5: Lint, analyse, commit**

```bash
git add app/Policies/MembershipPolicy.php app/Providers/AppServiceProvider.php app/Models/Bookshelf.php tests/Feature/Members/MembershipPolicyTest.php
git commit -m "feat: membership policy over the act-as gates, and the reader route binding"
```

---

### Task 5: `UniqueViolation` — errno 1062 into a named refusal

Small on purpose: Task 6's registration and Task 9's credentials both need it, and a translation helper with its own test is how the constraint-name matching stays honest.

**Files:**
- Create: `app/Support/UniqueViolation.php`
- Test: `tests/Unit/Members/UniqueViolationTest.php`

**Interfaces:**
- Consumes: `Illuminate\Database\QueryException` (`errorInfo[1]` carries the driver errno), `App\Exceptions\RuleViolated`.
- Produces: `UniqueViolation::translate(QueryException $e, array $map): never` — on errno 1062 whose message names a constraint in `$map`, throws `RuleViolated($map[$constraint])`; anything else rethrows the original exception untouched.

- [ ] **Step 1: Write the failing test**

Create `tests/Unit/Members/UniqueViolationTest.php`:

```php
<?php

use App\Exceptions\RuleViolated;
use App\Support\UniqueViolation;
use Illuminate\Database\QueryException;

// PDOException::$errorInfo is what QueryException copies; build it the way
// the driver does rather than subclassing.
function uvBuild(int $errno, string $message): QueryException
{
    $pdo = new PDOException($message);
    $pdo->errorInfo = ['23000', $errno, $message];

    return new QueryException('mariadb', 'insert into users …', [], $pdo);
}

it('translates a 1062 naming a mapped constraint into the mapped code', function () {
    $e = uvBuild(1062, "Duplicate entry 'lan' for key 'users_username_key'");

    expect(fn () => UniqueViolation::translate($e, ['users_username_key' => 'username_taken']))
        ->toThrow(RuleViolated::class, 'username_taken');
});

it('rethrows a 1062 naming an unmapped constraint, and any other errno, untouched', function () {
    $unmapped = uvBuild(1062, "Duplicate entry for key 'books_bookshelf_id_slug_key'");
    $notDup = uvBuild(1906, 'The value specified for generated column …');

    expect(fn () => UniqueViolation::translate($unmapped, ['users_username_key' => 'username_taken']))
        ->toThrow(QueryException::class)
        ->and(fn () => UniqueViolation::translate($notDup, ['users_username_key' => 'username_taken']))
        ->toThrow(QueryException::class);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `make test FILTER=UniqueViolation`
Expected: FAIL — class not found.

- [ ] **Step 3: Implement**

Create `app/Support/UniqueViolation.php`:

```php
<?php

namespace App\Support;

use App\Exceptions\RuleViolated;
use Illuminate\Database\QueryException;

/**
 * BR §2: "one of them must fail cleanly and see a plain message, never a
 * silently corrupted record." The generated-column uniques are the
 * structural half (spec §4.1); this is the sentence half — errno 1062,
 * matched BY CONSTRAINT NAME so an unrelated collision is never dressed up
 * as the wrong refusal, becomes the RuleViolated code the map names.
 *
 * The same translation 0009_invariant_constraints.sql performed for
 * Postgres's 23505, and the reference's isUniqueViolation catch blocks.
 */
final class UniqueViolation
{
    /** @param array<string, string> $map constraint name → RuleViolated code */
    public static function translate(QueryException $e, array $map): never
    {
        if (($e->errorInfo[1] ?? null) === 1062) {
            foreach ($map as $constraint => $code) {
                if (str_contains($e->getMessage(), $constraint)) {
                    throw new RuleViolated($code);
                }
            }
        }

        throw $e;
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `make test FILTER=UniqueViolation`
Expected: PASS.

- [ ] **Step 5: Lint, analyse, commit**

```bash
git add app/Support/UniqueViolation.php tests/Unit/Members/UniqueViolationTest.php
git commit -m "feat: translate errno 1062 into named refusals by constraint name"
```

---

### Task 6: `Registration` and `RegisterMembership` — the one open door

Read first, in full: `old_next/src/domain/members/registration.ts` (the shared body, the anti-probe rules, CRITICAL 1's walk-back) and `old_next/tests/domain/members/register-membership.test.ts` + `old_next/tests/domain/members/dates-are-real-dates.test.ts` — the tests below are their port.

**Files:**
- Create: `app/Actions/Members/Registration.php`
- Create: `app/Actions/Members/RegisterMembership.php`
- Test: `tests/Feature/Members/RegisterMembershipTest.php`

**Interfaces:**
- Consumes: `Clock`, `AuditRecorder`, `ParishContextQuery`, `ParishUnits`, `Phone`, `MembershipTransitions`, `UniqueViolation`, `Hash`, `MembershipStatus`.
- Produces:
  - `Registration::register(array $input, MembershipStatus $status, ?User $approver): array{userId: string, membershipId: string}` — the shared body of all three registration commands; assumes the caller holds the transaction. `$input` keys (all optional-nullable strings unless said): `username`, `password`, `password_confirmation`, `saint_name`, `full_name`, `date_of_birth` (`Y-m-d`), `father_name`, `mother_name`, `phone`, `phone_missing_reason`, `email`, `avatar_object`, `parish_unit_l1_id`, `parish_unit_l2_id`.
  - `Registration::auditAfter(array $input, array $result, MembershipStatus $status): array` — the deliberately narrow audit payload (no phone, no DOB, no parents' names — BR §5.3 makes those manager-only and `audit_log` is readable wider).
  - `RegisterMembership::execute(array $input): array{userId: string, membershipId: string}` — guest command: no gate, `pending`, null approver, audits `membership.registered` with a null actor.
- Tasks 7's two Actions reuse `Registration` unchanged.

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Members/RegisterMembershipTest.php`:

```php
<?php

use App\Actions\Members\RegisterMembership;
use App\Enums\MembershipStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\ParishUnit;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Tests\Support\TenantHarness;

/**
 * Guest fixture: a bound shelf with a nested taxonomy, NO actingAs
 * anywhere — registration is the guest path, and the SessionGuard cache
 * trap means an actingAs here would silently authenticate every "guest"
 * assertion below it.
 *
 * @return array{Bookshelf, ParishUnit, ParishUnit, ParishUnit} shelf, l1a, l1b, l2-of-l1a
 */
function regFixture(): array
{
    $shelf = Bookshelf::factory()->create([
        'slug' => 'dong-thap',
        'settings' => ['parish_taxonomy' => ['levels' => 2, 'nested' => true, 'level1_label' => 'Giáo họ', 'level2_label' => 'Tổ']],
    ]);
    $l1a = ParishUnit::factory()->for($shelf)->create(['level' => 1, 'name' => 'Giáo họ Thánh Tâm']);
    $l1b = ParishUnit::factory()->for($shelf)->create(['level' => 1, 'name' => 'Giáo họ Mân Côi']);
    $l2 = ParishUnit::factory()->for($shelf)->create(['level' => 2, 'parent_id' => $l1a->id, 'name' => 'Tổ 3']);
    TenantHarness::actAs($shelf);

    return [$shelf, $l1a, $l1b, $l2];
}

/** @return array<string, ?string> a complete, valid submission */
function regInput(array $over = []): array
{
    return array_merge([
        'saint_name' => 'Maria',
        'full_name' => 'Nguyễn Thị Lan',
        'date_of_birth' => '2015-04-02',
        'father_name' => 'Nguyễn Văn Hoà',
        'mother_name' => 'Trần Thị Mai',
        'phone' => '0912 345 678',
    ], $over);
}

it('a guest registers and gets a pending membership and a new person', function () {
    regFixture();

    $result = app(RegisterMembership::class)->execute(regInput());

    $user = User::query()->findOrFail($result['userId']);
    $membership = Membership::query()->findOrFail($result['membershipId']);

    expect($user->saint_name)->toBe('Maria')
        ->and($user->full_name)->toBe('Nguyễn Thị Lan')
        ->and($user->date_of_birth->toDateString())->toBe('2015-04-02')
        ->and($user->phone)->toBe('0912 345 678')
        ->and($user->phone_missing_reason)->toBeNull()
        ->and($user->username)->toBeNull()
        ->and($membership->status)->toBe(MembershipStatus::Pending)
        ->and($membership->role->value)->toBe('reader')
        ->and($membership->approved_by)->toBeNull()
        ->and($membership->approved_at)->toBeNull();
});

it('the audit entry has a null actor and carries no phone, no DOB, no parents', function () {
    regFixture();

    $result = app(RegisterMembership::class)->execute(regInput());

    $entry = AuditLog::query()->where('action', 'membership.registered')->firstOrFail();
    $serialized = json_encode([$entry->before, $entry->after]);

    expect($entry->actor_id)->toBeNull()
        ->and($entry->entity_type)->toBe('membership')
        ->and($entry->entity_id)->toBe($result['membershipId'])
        ->and($entry->after['fullName'])->toBe('Nguyễn Thị Lan')
        ->and($entry->after['status'])->toBe('pending')
        ->and($serialized)->not->toContain('0912')
        ->and($serialized)->not->toContain('2015-04-02')
        ->and($serialized)->not->toContain('Nguyễn Văn Hoà');
});

it('credentials are optional, and set together when supplied', function () {
    regFixture();

    $result = app(RegisterMembership::class)->execute(regInput([
        'username' => 'lan.nguyen', 'password' => 'mat-khau-123', 'password_confirmation' => 'mat-khau-123',
    ]));

    $user = User::query()->findOrFail($result['userId']);
    expect($user->username)->toBe('lan.nguyen')
        ->and(Hash::check('mat-khau-123', $user->password_hash))->toBeTrue();
});

it('the required fields are the ones the database and BR §5.3 agree on', function () {
    regFixture();

    foreach (['saint_name', 'full_name', 'date_of_birth', 'father_name', 'mother_name'] as $field) {
        expect(fn () => app(RegisterMembership::class)->execute(regInput([$field => '   '])))
            ->toThrow(RuleViolated::class, 'required_fields_missing');
    }
});

it('a blank phone with no reason is thieu-so-dien-thoai, not required_fields_missing', function () {
    regFixture();

    expect(fn () => app(RegisterMembership::class)->execute(regInput(['phone' => ''])))
        ->toThrow(RuleViolated::class, 'thieu-so-dien-thoai');
});

it('a blank phone with a typed reason registers, and the reason is stored', function () {
    regFixture();

    $result = app(RegisterMembership::class)->execute(regInput([
        'phone' => '', 'phone_missing_reason' => 'Em bé chưa có điện thoại riêng',
    ]));

    $user = User::query()->findOrFail($result['userId']);
    expect($user->phone)->toBeNull()
        ->and($user->phone_missing_reason)->toBe('Em bé chưa có điện thoại riêng');
});

it('a real phone needs no reason, and none is stored even if one was typed', function () {
    regFixture();

    $result = app(RegisterMembership::class)->execute(regInput([
        'phone_missing_reason' => 'thừa — có số rồi',
    ]));

    expect(User::query()->findOrFail($result['userId'])->phone_missing_reason)->toBeNull();
});

it('khong-phai-so in the phone box is a sentence, not a tel: link to nowhere', function () {
    regFixture();

    expect(fn () => app(RegisterMembership::class)->execute(regInput(['phone' => 'khong-phai-so'])))
        ->toThrow(RuleViolated::class, 'phone_invalid');
});

it('a short password and a mistyped confirmation each say so', function () {
    regFixture();

    expect(fn () => app(RegisterMembership::class)->execute(regInput([
        'username' => 'lan', 'password' => 'ngắn123', 'password_confirmation' => 'ngắn123',
    ])))->toThrow(RuleViolated::class, 'password_too_short')
        ->and(fn () => app(RegisterMembership::class)->execute(regInput([
            'username' => 'lan', 'password' => 'mat-khau-123', 'password_confirmation' => 'khac-mat-khau',
        ])))->toThrow(RuleViolated::class, 'passwords_dont_match');
});

it('INV-14: a username with no password, or a password with no username, is refused', function () {
    regFixture();

    expect(fn () => app(RegisterMembership::class)->execute(regInput(['username' => 'lan'])))
        ->toThrow(RuleViolated::class, 'required_fields_missing')
        ->and(fn () => app(RegisterMembership::class)->execute(regInput(['password' => 'mat-khau-123'])))
        ->toThrow(RuleViolated::class, 'required_fields_missing');
});

it('dates are real dates: Vietnamese-written, ISO-shaped-impossible and prose are all refused', function () {
    regFixture();

    // The reference measured what happens without this: 02/04/2015 stored
    // as 2015-02-03, 2015-02-30 rolled into March, 'hôm qua' a RangeError.
    foreach (['02/04/2015', '2015-02-30', 'hôm qua'] as $bad) {
        expect(fn () => app(RegisterMembership::class)->execute(regInput(['date_of_birth' => $bad])))
            ->toThrow(RuleViolated::class, 'validation_failed');
    }
});

it('a leap day is a real date and stores as the day that was typed', function () {
    regFixture();

    $result = app(RegisterMembership::class)->execute(regInput(['date_of_birth' => '2016-02-29']));

    expect(User::query()->findOrFail($result['userId'])->date_of_birth->toDateString())->toBe('2016-02-29');
});

it('the parish selection rule runs in the command, not in the picker', function () {
    [, $l1a, $l1b, $l2] = regFixture();

    // A level-2 unit under the WRONG level-1 parent.
    expect(fn () => app(RegisterMembership::class)->execute(regInput([
        'parish_unit_l1_id' => $l1b->id, 'parish_unit_l2_id' => $l2->id,
    ])))->toThrow(RuleViolated::class, 'parish_unit_l2_not_in_l1');

    // A level-2 id in the level-1 slot is not-found, not borrowed.
    expect(fn () => app(RegisterMembership::class)->execute(regInput([
        'parish_unit_l1_id' => $l2->id,
    ])))->toThrow(RuleViolated::class, 'parish_unit_l1_not_found');

    // The happy pair stores both.
    $result = app(RegisterMembership::class)->execute(regInput([
        'parish_unit_l1_id' => $l1a->id, 'parish_unit_l2_id' => $l2->id,
    ]));
    $membership = Membership::query()->findOrFail($result['membershipId']);
    expect($membership->parish_unit_l1_id)->toBe($l1a->id)
        ->and($membership->parish_unit_l2_id)->toBe($l2->id);
});

it('both parish fields stay optional, permanently', function () {
    regFixture();

    $result = app(RegisterMembership::class)->execute(regInput());

    $membership = Membership::query()->findOrFail($result['membershipId']);
    expect($membership->parish_unit_l1_id)->toBeNull()
        ->and($membership->parish_unit_l2_id)->toBeNull();
});

it('INV-10: a unit belonging to another shelf is not found, not borrowed', function () {
    regFixture();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $foreign = ParishUnit::factory()->for($other)->create(['level' => 1, 'name' => 'Giáo họ Khác']);

    expect(fn () => app(RegisterMembership::class)->execute(regInput([
        'parish_unit_l1_id' => $foreign->id,
    ])))->toThrow(RuleViolated::class, 'parish_unit_l1_not_found');
});

it('a family that moves keeps its identity and re-enters only the parish details', function () {
    [$shelf] = regFixture();
    $first = app(RegisterMembership::class)->execute(regInput([
        'username' => 'lan.nguyen', 'password' => 'mat-khau-123', 'password_confirmation' => 'mat-khau-123',
    ]));

    // The same person registers at a second shelf, by username + password.
    $second = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    TenantHarness::actAs($second);
    $result = app(RegisterMembership::class)->execute(regInput([
        'username' => 'lan.nguyen', 'password' => 'mat-khau-123', 'password_confirmation' => 'mat-khau-123',
        // A different father's name typed at the second parish must NOT
        // rewrite the verified record (INV-13: a registration form is
        // neither of the two sanctioned write paths).
        'father_name' => 'Ai Đó Khác',
    ]));

    expect($result['userId'])->toBe($first['userId'])
        ->and($result['membershipId'])->not->toBe($first['membershipId'])
        ->and(User::query()->findOrFail($result['userId'])->father_name)->toBe('Nguyễn Văn Hoà')
        ->and(Membership::query()->withoutGlobalScopes([App\Models\Scopes\BookshelfScope::class])->where('user_id', $first['userId'])->count())->toBe(2);
});

it('the no-username match is the exact triple, never a name or a phone alone', function () {
    regFixture();
    $first = app(RegisterMembership::class)->execute(regInput());
    Membership::query()->findOrFail($first['membershipId'])->delete(); // free the shelf slot

    // Same name, same phone, different DOB → a new person.
    $differentDob = app(RegisterMembership::class)->execute(regInput(['date_of_birth' => '2014-01-01']));
    expect($differentDob['userId'])->not->toBe($first['userId']);

    Membership::query()->findOrFail($differentDob['membershipId'])->delete();

    // The exact triple → the same person.
    $same = app(RegisterMembership::class)->execute(regInput());
    expect($same['userId'])->toBe($first['userId']);
});

it('a username is matched only against its own password', function () {
    regFixture();
    app(RegisterMembership::class)->execute(regInput([
        'username' => 'lan.nguyen', 'password' => 'mat-khau-123', 'password_confirmation' => 'mat-khau-123',
    ]));
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    TenantHarness::actAs($other);

    // The wrong password gets exactly what an unrelated collision gets.
    expect(fn () => app(RegisterMembership::class)->execute(regInput([
        'username' => 'LAN.NGUYEN', 'password' => 'doan-mo-12345', 'password_confirmation' => 'doan-mo-12345',
    ])))->toThrow(RuleViolated::class, 'username_taken');
});

it('an account with no password cannot be claimed by supplying one', function () {
    regFixture();
    // INV-14's valid state is both-or-neither; a user row with credentials
    // can only exist with both. The claimable-looking case is a username
    // that exists with a password the claimant does not know — covered
    // above — and a username column that is NULL matches nobody, so a new
    // person is created rather than an account hijacked.
    $existing = User::factory()->create(['full_name' => 'Nguyễn Thị Lan']);

    $result = app(RegisterMembership::class)->execute(regInput([
        'username' => 'lan.moi', 'password' => 'mat-khau-123', 'password_confirmation' => 'mat-khau-123',
    ]));

    expect($result['userId'])->not->toBe($existing->id);
});

it('IMPORTANT 5: a probe against a suspended membership leaves that row exactly as it was', function () {
    regFixture();
    $person = User::factory()->create(['full_name' => 'Nguyễn Thị Lan', 'date_of_birth' => '2015-04-02', 'phone' => '0912 345 678', 'phone_missing_reason' => null]);
    $membership = Membership::factory()->for(app(App\Support\TenantContext::class)->bookshelf())->create([
        'user_id' => $person->id, 'status' => 'suspended', 'suspension_reason' => 'Lý do thật',
    ]);

    expect(fn () => app(RegisterMembership::class)->execute(regInput()))
        ->toThrow(RuleViolated::class, 'already_registered_here');

    $fresh = $membership->fresh();
    expect($fresh->status)->toBe(MembershipStatus::Suspended)
        ->and($fresh->suspension_reason)->toBe('Lý do thật');
});

it('a rejected applicant re-applies on the same membership row, reasons cleared', function () {
    regFixture();
    $first = app(RegisterMembership::class)->execute(regInput());
    Membership::query()->findOrFail($first['membershipId'])
        ->update(['status' => 'rejected', 'rejection_reason' => 'Thiếu thông tin']);

    $again = app(RegisterMembership::class)->execute(regInput());

    $membership = Membership::query()->findOrFail($again['membershipId']);
    expect($again['membershipId'])->toBe($first['membershipId'])
        ->and($membership->status)->toBe(MembershipStatus::Pending)
        ->and($membership->rejection_reason)->toBeNull();
});

it('a member who left may come back the same way', function () {
    regFixture();
    $first = app(RegisterMembership::class)->execute(regInput());
    Membership::query()->findOrFail($first['membershipId'])->update(['status' => 'left']);

    $again = app(RegisterMembership::class)->execute(regInput());

    expect($again['membershipId'])->toBe($first['membershipId'])
        ->and(Membership::query()->findOrFail($again['membershipId'])->status)->toBe(MembershipStatus::Pending);
});

it('registering twice while already pending or active is named, not silent', function () {
    regFixture();
    app(RegisterMembership::class)->execute(regInput());

    expect(fn () => app(RegisterMembership::class)->execute(regInput()))
        ->toThrow(RuleViolated::class, 'already_registered_here');
});

it('CRITICAL 1: a suspended membership does not walk back to pending through the public form', function () {
    regFixture();
    $first = app(RegisterMembership::class)->execute(regInput());
    Membership::query()->findOrFail($first['membershipId'])->update(['status' => 'suspended']);

    expect(fn () => app(RegisterMembership::class)->execute(regInput()))
        ->toThrow(RuleViolated::class, 'already_registered_here');
});

it('a manager who left re-registers through the public form, landing pending and demoted to reader', function () {
    regFixture();
    $person = User::factory()->create(['full_name' => 'Nguyễn Thị Lan', 'date_of_birth' => '2015-04-02', 'phone' => '0912 345 678', 'phone_missing_reason' => null]);
    $membership = Membership::factory()->for(app(App\Support\TenantContext::class)->bookshelf())->manager()->create([
        'user_id' => $person->id, 'status' => 'left',
    ]);

    $result = app(RegisterMembership::class)->execute(regInput());

    $fresh = Membership::query()->findOrFail($result['membershipId']);
    expect($result['membershipId'])->toBe($membership->id)
        ->and($fresh->status)->toBe(MembershipStatus::Pending)
        ->and($fresh->role->value)->toBe('reader');
});
```

One fixture note before running: every test binds the tenant through `regFixture()` and none calls `actingAs` — keep it that way, this file IS the guest path (the SessionGuard cache trap).

- [ ] **Step 2: Run to verify failure**

Run: `make test FILTER=RegisterMembership`
Expected: FAIL — `Class "App\Actions\Members\RegisterMembership" not found`.

- [ ] **Step 3: Implement**

Create `app/Actions/Members/Registration.php`:

```php
<?php

namespace App\Actions\Members;

use App\Enums\MembershipStatus;
use App\Exceptions\RuleViolated;
use App\Models\Membership;
use App\Models\User;
use App\Queries\ParishContextQuery;
use App\Support\Clock;
use App\Support\Members\MembershipTransitions;
use App\Support\Members\ParishUnits;
use App\Support\Members\Phone;
use App\Support\UniqueViolation;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Hash;

/**
 * The shared body of the three registration commands (OPS §4.3:
 * RegisterMembership, ManagerRegisterReader, RegisterMemberOnBehalf) —
 * the port of old_next/src/domain/members/registration.ts. Only the target
 * status and who the actor is differ between the three; each caller owns
 * its DB::transaction and its audit entry.
 *
 * The anti-probe rules, kept in full (registration.ts's docstring holds
 * the argument):
 *  - a supplied username is matched only against its own password; a
 *    wrong password, or an account with no password, gets `username_taken`
 *    — exactly what an unrelated collision gives, so a stranger guessing
 *    usernames learns only "taken";
 *  - with no username, the match is the EXACT triple full_name
 *    (case-insensitively) + date_of_birth + phone. No fuzzy matching:
 *    near-matches belong on GetPendingRegistrations' similar-name warning,
 *    surfaced to a manager who knows the family.
 *
 * `users` is a global table (identity is reused across shelves, BR §5.3),
 * so the person lookup deliberately reads across every shelf; the
 * MEMBERSHIP read is scoped by BookshelfScope, which is the walk-back's
 * whole tenancy story.
 *
 * DIVERGENCE 2 (plan header): no lock. The username check and the
 * walk-back read are check-then-write, and both are backed structurally —
 * users_username_key and memberships_one_per_shelf, errno 1062, translated
 * below. The no-username triple has no structural backstop and a
 * concurrent duplicate person is accepted (the approval queue's
 * similar-name warning is the product's answer); known-gaps records it.
 */
final class Registration
{
    public function __construct(
        private Clock $clock,
        private ParishContextQuery $parish,
    ) {}

    /**
     * @param  array<string, ?string>  $input
     * @return array{userId: string, membershipId: string}
     */
    public function register(array $input, MembershipStatus $status, ?User $approver): array
    {
        foreach (['saint_name', 'full_name', 'date_of_birth', 'father_name', 'mother_name'] as $field) {
            if (self::blank($input[$field] ?? null)) {
                throw new RuleViolated('required_fields_missing');
            }
        }

        // PO round 1, Task 8: a blank phone is allowed exactly once the
        // reason says why — and it is its own code, not
        // required_fields_missing: this is not a malformed submission, it
        // is the two-question rule the interface asks. A non-blank phone
        // must have a real shape (QA T18).
        $phoneBlank = self::blank($input['phone'] ?? null);
        if ($phoneBlank && self::blank($input['phone_missing_reason'] ?? null)) {
            throw new RuleViolated('thieu-so-dien-thoai');
        }
        if (! $phoneBlank) {
            Phone::assert(trim((string) $input['phone']));
        }

        // Before the person lookup, not merely before the insert: the
        // no-username match compares date_of_birth, so a mis-shaped date
        // does not just store the wrong birthday — it asks the wrong
        // question about WHO THIS IS (registration.ts's measured cases:
        // 02/04/2015 → 2015-02-03 silently; 2015-02-30 → March).
        self::assertStorableDate(trim((string) $input['date_of_birth']));

        $credentials = $this->credentialsFrom($input);

        // OPS §4.3's named invariant: the parish rule is checked here, in
        // the same transaction as the write, not by a constraint — the
        // composite FK proves the unit is on this shelf and nothing more
        // (a level-2 id inserts cleanly into parish_unit_l1_id).
        $l1 = self::trimmed($input['parish_unit_l1_id'] ?? null);
        $l2 = self::trimmed($input['parish_unit_l2_id'] ?? null);
        if ($l1 !== null || $l2 !== null) {
            $context = $this->parish->run();
            $refusal = ParishUnits::validateSelection($context['taxonomy'], $context['units'], $l1, $l2);
            if ($refusal !== null) {
                throw new RuleViolated($refusal);
            }
        }

        $existing = $this->findExistingPerson($input, $credentials);

        try {
            $userId = $existing?->id ?? $this->createPerson($input, $credentials)->id;

            return ['userId' => $userId, 'membershipId' => $this->upsertMembership($userId, $l1, $l2, $status, $approver)];
        } catch (QueryException $e) {
            UniqueViolation::translate($e, [
                'users_username_key' => 'username_taken',
                'memberships_one_per_shelf' => 'already_registered_here',
            ]);
        }
    }

    /**
     * The deliberately narrow audit payload: no phone, no DOB, no parents'
     * names — BR §5.3 makes those manager-only fields, and audit_log is
     * readable by every manager of the shelf AND the super administrator.
     *
     * @param  array<string, ?string>  $input
     * @param  array{userId: string, membershipId: string}  $result
     * @return array<string, mixed>
     */
    public function auditAfter(array $input, array $result, MembershipStatus $status): array
    {
        return [
            'userId' => $result['userId'],
            'fullName' => trim((string) $input['full_name']),
            'status' => $status->value,
            'parishUnitL1Id' => self::trimmed($input['parish_unit_l1_id'] ?? null),
            'parishUnitL2Id' => self::trimmed($input['parish_unit_l2_id'] ?? null),
        ];
    }

    /**
     * INV-14 before anything is written: both credentials or neither. The
     * users_credentials_paired CHECK would catch it too, but as a driver
     * error rather than a sentence a child can read.
     *
     * @param  array<string, ?string>  $input
     * @return array{username: ?string, password_hash: ?string}
     */
    private function credentialsFrom(array $input): array
    {
        $username = self::trimmed($input['username'] ?? null);
        // Not trimmed: a password is bytes a person chose.
        $password = self::blank($input['password'] ?? null) ? null : (string) $input['password'];

        if ($username === null && $password === null) {
            return ['username' => null, 'password_hash' => null];
        }
        if ($username === null || $password === null) {
            throw new RuleViolated('required_fields_missing');
        }
        // Code points, not bytes: "ký tự" is characters (policy.ts).
        if (mb_strlen($password) < 8) {
            throw new RuleViolated('password_too_short');
        }
        if (array_key_exists('password_confirmation', $input) && $input['password_confirmation'] !== $password) {
            throw new RuleViolated('passwords_dont_match');
        }

        return ['username' => $username, 'password_hash' => Hash::make($password)];
    }

    /**
     * @param  array<string, ?string>  $input
     * @param  array{username: ?string, password_hash: ?string}  $credentials
     */
    private function findExistingPerson(array $input, array $credentials): ?User
    {
        if ($credentials['username'] !== null) {
            $row = User::query()
                ->whereRaw('LOWER(username) = LOWER(?)', [$credentials['username']])
                ->first();
            if ($row === null) {
                return null;
            }
            $ok = $row->password_hash !== null
                && ! self::blank($input['password'] ?? null)
                && Hash::check((string) $input['password'], $row->password_hash);
            if (! $ok) {
                throw new RuleViolated('username_taken');
            }

            return $row;
        }

        // The exact triple — and a blank phone can never be one third of
        // it (the stored value is NULL, which equals nothing), so a
        // reason-instead-of-phone registration is always a new person.
        if (self::blank($input['phone'] ?? null)) {
            return null;
        }

        return User::query()
            ->whereRaw('LOWER(full_name) = LOWER(?)', [trim((string) $input['full_name'])])
            ->whereDate('date_of_birth', trim((string) $input['date_of_birth']))
            ->where('phone', trim((string) $input['phone']))
            ->first();
    }

    /**
     * @param  array<string, ?string>  $input
     * @param  array{username: ?string, password_hash: ?string}  $credentials
     */
    private function createPerson(array $input, array $credentials): User
    {
        $phone = self::trimmed($input['phone'] ?? null);

        $user = new User([
            'saint_name' => trim((string) $input['saint_name']),
            'full_name' => trim((string) $input['full_name']),
            'date_of_birth' => trim((string) $input['date_of_birth']),
            'father_name' => trim((string) $input['father_name']),
            'mother_name' => trim((string) $input['mother_name']),
            'phone' => $phone,
            // The reason travels only when the phone does not: a present
            // number makes the reason stale from the start.
            'phone_missing_reason' => $phone === null ? self::trimmed($input['phone_missing_reason'] ?? null) : null,
            'email' => self::trimmed($input['email'] ?? null),
            'avatar_object' => self::trimmed($input['avatar_object'] ?? null),
        ]);
        // Not $fillable, on purpose (the model's own docblock): assigned
        // directly, by name, only here and in SetReaderCredentials.
        $user->username = $credentials['username'];
        $user->password_hash = $credentials['password_hash'];
        $user->save();

        return $user;
    }

    /**
     * BR §2: a rejected applicant may re-apply and a member who left may
     * come back — on the SAME row, because memberships_one_per_shelf
     * ignores status. Eligibility is the graph's decision, never a second
     * hand-maintained status list (CRITICAL 1): every walk-back is a
     * `→ pending` re-application; a manager immediately activating the
     * same reader (ManagerRegisterReader) is a further explicit promotion
     * on top of a re-application the graph already approved. `suspended`
     * has no `→ pending` edge, so it refuses like pending/active do.
     *
     * role is forced back to 'reader' on a walk-back — the reference's
     * reversed decision, in full: a non-active row's role confers nothing
     * (the membership resolution filters status = active), and refusing
     * instead left a returning ex-manager unable to re-enrol by ANY path.
     */
    private function upsertMembership(string $userId, ?string $l1, ?string $l2, MembershipStatus $status, ?User $approver): string
    {
        $existing = Membership::query()->where('user_id', $userId)->first();

        if ($existing !== null) {
            if (MembershipTransitions::check($existing->status, MembershipStatus::Pending) !== null) {
                throw new RuleViolated('already_registered_here');
            }

            $existing->update([
                'status' => $status,
                'role' => 'reader',
                'parish_unit_l1_id' => $l1,
                'parish_unit_l2_id' => $l2,
                'rejection_reason' => null,
                'suspension_reason' => null,
                'approved_by' => $status === MembershipStatus::Active ? $approver?->id : null,
                'approved_at' => $status === MembershipStatus::Active ? $this->clock->now() : null,
            ]);

            return $existing->id;
        }

        $membership = Membership::query()->create([
            'user_id' => $userId,
            'role' => 'reader',
            'status' => $status,
            'parish_unit_l1_id' => $l1,
            'parish_unit_l2_id' => $l2,
            'approved_by' => $status === MembershipStatus::Active ? $approver?->id : null,
            'approved_at' => $status === MembershipStatus::Active ? $this->clock->now() : null,
        ]);

        return $membership->id;
    }

    /** Whitespace is absence: a form posts "   " far more often than null. */
    private static function blank(?string $v): bool
    {
        return $v === null || trim($v) === '';
    }

    private static function trimmed(?string $v): ?string
    {
        return self::blank($v) ? null : trim((string) $v);
    }

    /**
     * Y-m-d and a real calendar day, nothing else — checkdate() is what
     * refuses 2015-02-30 after the regex has passed its shape.
     */
    private static function assertStorableDate(string $date): void
    {
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $m) !== 1
            || ! checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            throw new RuleViolated('validation_failed');
        }
    }
}
```

Create `app/Actions/Members/RegisterMembership.php`:

```php
<?php

namespace App\Actions\Members;

use App\Enums\MembershipStatus;
use App\Support\AuditRecorder;
use Illuminate\Support\Facades\DB;

/**
 * Public self-registration (BR §16.1) — a `pending` membership a manager
 * must approve; BR §4's assumption 3 makes that approval the consent step
 * for holding a minor's data, so it is never skipped here.
 *
 * THE CALLER IS A GUEST AND THERE IS NO GATE HERE ON PURPOSE. Every other
 * command in this slice opens with a policy check; this is the single open
 * door OPS §2 leaves in the catalogue, and adding a gate would close the
 * registration form. Rate limiting is the route's (infrastructure, not
 * domain — OPS §8; Task 13's throttle), and the structural defences are
 * users_username_key, memberships_one_per_shelf, and the anti-probe
 * matching rules in Registration.
 */
final class RegisterMembership
{
    public function __construct(
        private Registration $registration,
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array<string, ?string>  $input
     * @return array{userId: string, membershipId: string}
     */
    public function execute(array $input): array
    {
        return DB::transaction(function () use ($input): array {
            $result = $this->registration->register($input, MembershipStatus::Pending, null);

            // Actor is null — Auth::id() has nobody. The row still lands on
            // the bound shelf, which is what distinguishes it from a
            // manager-typed registration when the queue renders it.
            $this->audit->record(
                'membership.registered', 'membership', $result['membershipId'],
                null, $this->registration->auditAfter($input, $result, MembershipStatus::Pending),
            );

            return $result;
        });
    }
}
```

`Registration` needs `Clock` in its constructor — already listed. Note `register()` never opens a transaction itself: the three command Actions own it, so audit and state commit together (INV-8) without nesting.

- [ ] **Step 4: Run to verify pass**

Run: `make test FILTER=RegisterMembership`
Expected: PASS — all 24.

- [ ] **Step 5: Lint, analyse, commit**

```bash
git add app/Actions/Members tests/Feature/Members/RegisterMembershipTest.php
git commit -m "feat: the shared registration body and public self-registration"
```

---

### Task 7: `ManagerRegisterReader` and `RegisterMemberOnBehalf` — the pair that disagrees about `pending` on purpose

Read first: `old_next/src/domain/members/commands/manager-register-reader.ts`, `.../register-member-on-behalf.ts`, and `old_next/tests/domain/members/manager-registration.test.ts`.

**This task implements the open question's chosen reading** (plan header, question 1): `ManagerRegisterReader` creates an **`active`** membership — OPS §4.3's flagged inference, the reference's shipped behaviour, and the only reading under which BR §1.3's escape hatch can do its job (INV-4: a pending member cannot be lent to). `RegisterMemberOnBehalf` creates **`pending`** — BR §16.1's explicit sentence, not an inference. If the product owner rules `ManagerRegisterReader` must be pending too, the change is the `MembershipStatus::Active` argument in its `execute()` plus the first test below.

**Files:**
- Create: `app/Actions/Members/ManagerRegisterReader.php`
- Create: `app/Actions/Members/RegisterMemberOnBehalf.php`
- Test: `tests/Feature/Members/ManagerRegistrationTest.php`

**Interfaces:**
- Consumes: `Registration::register` / `auditAfter` (Task 6, exact signatures there), `MembershipPolicy::create` via `Gate::authorize('create', Membership::class)`.
- Produces: `ManagerRegisterReader::execute(User $actor, array $input): array{userId: string, membershipId: string}` and `RegisterMemberOnBehalf::execute(User $actor, array $input): array{...}` — same `$input` shape as `RegisterMembership`. Task 14's controller posts to `RegisterMemberOnBehalf`; **nothing routes `ManagerRegisterReader` this phase** (1c's quick-lend does; Task 16 pins the absence).

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Members/ManagerRegistrationTest.php`:

```php
<?php

use App\Actions\Members\ManagerRegisterReader;
use App\Actions\Members\RegisterMemberOnBehalf;
use App\Enums\MembershipStatus;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Auth\Access\AuthorizationException;

/** @return array{Bookshelf, User} shelf and its acting manager */
function obhFixture(string $role = 'manager'): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $actor = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $actor->id, 'role' => $role, 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($actor);

    return [$shelf, $actor];
}

/** @return array<string, ?string> */
function obhInput(array $over = []): array
{
    return array_merge([
        'saint_name' => 'Giuse', 'full_name' => 'Trần Minh',
        'date_of_birth' => '2014-09-01', 'father_name' => 'Trần Văn Ba',
        'mother_name' => 'Lê Thị Tư', 'phone' => '0987654321',
    ], $over);
}

it('the quick-lend escape hatch produces a member who can be lent to at once', function () {
    // THE OPEN-QUESTION DECISION, IMPLEMENTED BY NAME (plan header, Q1):
    // active, not pending — OPS §4.3's inference from BR §1.3, the
    // reference's shipped behaviour. If the product owner reverses this,
    // flip MembershipStatus::Active in ManagerRegisterReader::execute and
    // this assertion.
    [, $actor] = obhFixture();

    $result = app(ManagerRegisterReader::class)->execute($actor, obhInput());

    $membership = Membership::query()->findOrFail($result['membershipId']);
    expect($membership->status)->toBe(MembershipStatus::Active)
        // approved_by/approved_at name the manager, so an active membership
        // never looks as though it approved itself — the consent record
        // BR §4 assumption 3 wants, kept even on the one-step path.
        ->and($membership->approved_by)->toBe($actor->id)
        ->and($membership->approved_at)->not->toBeNull();
});

it('filling in the form on a child\'s behalf still needs approving', function () {
    // BR §16.1, explicit: "still creates a pending application … so the
    // approval step and its audit record are never skipped."
    [, $actor] = obhFixture();

    $result = app(RegisterMemberOnBehalf::class)->execute($actor, obhInput());

    $membership = Membership::query()->findOrFail($result['membershipId']);
    expect($membership->status)->toBe(MembershipStatus::Pending)
        ->and($membership->approved_by)->toBeNull()
        ->and($membership->approved_at)->toBeNull();
});

it('both record the manager as actor, unlike a self-registration', function () {
    [, $actor] = obhFixture();

    app(RegisterMemberOnBehalf::class)->execute($actor, obhInput());
    app(ManagerRegisterReader::class)->execute($actor, obhInput([
        'full_name' => 'Lê Ngọc Ánh', 'phone' => '0912000111',
    ]));

    $entries = AuditLog::query()->where('action', 'membership.registered')->get();
    expect($entries)->toHaveCount(2)
        ->and($entries->pluck('actor_id')->unique()->all())->toBe([$actor->id]);
});

it('a left manager walked back by managerRegisterReader lands active and demoted to reader', function () {
    [$shelf, $actor] = obhFixture();
    $person = User::factory()->create(['full_name' => 'Trần Minh', 'date_of_birth' => '2014-09-01', 'phone' => '0987654321', 'phone_missing_reason' => null]);
    $old = Membership::factory()->for($shelf)->manager()->create(['user_id' => $person->id, 'status' => 'left']);

    $result = app(ManagerRegisterReader::class)->execute($actor, obhInput());

    $fresh = Membership::query()->findOrFail($result['membershipId']);
    expect($result['membershipId'])->toBe($old->id)
        ->and($fresh->status)->toBe(MembershipStatus::Active)
        ->and($fresh->role->value)->toBe('reader');
});

it('the same person, registered actively at a second shelf, keeps one identity', function () {
    [, $actor] = obhFixture();
    $first = app(ManagerRegisterReader::class)->execute($actor, obhInput());

    $second = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $manager2 = User::factory()->create();
    $m2 = Membership::factory()->for($second)->manager()->create(['user_id' => $manager2->id, 'status' => 'active']);
    app(TenantContext::class)->set($second, $m2);
    test()->actingAs($manager2);

    $result = app(ManagerRegisterReader::class)->execute($manager2, obhInput());

    expect($result['userId'])->toBe($first['userId'])
        ->and($result['membershipId'])->not->toBe($first['membershipId']);
});

// Guest/reader refusals in their OWN it() blocks — the SessionGuard cache
// trap: never appended after an actingAs.

it('a reader cannot register anybody', function () {
    [, $actor] = obhFixture('reader');

    expect(fn () => app(RegisterMemberOnBehalf::class)->execute($actor, obhInput()))
        ->toThrow(AuthorizationException::class)
        ->and(fn () => app(ManagerRegisterReader::class)->execute($actor, obhInput()))
        ->toThrow(AuthorizationException::class);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `make test FILTER=ManagerRegistration`
Expected: FAIL — classes not found.

- [ ] **Step 3: Implement**

Create `app/Actions/Members/ManagerRegisterReader.php`:

```php
<?php

namespace App\Actions\Members;

use App\Enums\MembershipStatus;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A manager registers a reader in person — BR §16.3's quick-lend escape
 * hatch ("Đăng ký người đọc mới"). Creates an ACTIVE membership: OPS §4.3
 * infers it from BR §1.3 (a pending member cannot be lent to, INV-4, so a
 * pending result would defeat the affordance), flags the inference, and
 * the reference ships it. THE PLAN HEADER'S OPEN QUESTION 1 records the
 * product owner still owes the final word; reversing it is the ::Active
 * below plus one assertion.
 *
 * NO ROUTE THIS PHASE — 1c's quick-lend is the screen; the architecture
 * suite pins the absence (Task 16), the DeleteBook precedent.
 */
final class ManagerRegisterReader
{
    public function __construct(
        private Registration $registration,
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array<string, ?string>  $input
     * @return array{userId: string, membershipId: string}
     */
    public function execute(User $actor, array $input): array
    {
        Gate::forUser($actor)->authorize('create', Membership::class);

        return DB::transaction(function () use ($actor, $input): array {
            $result = $this->registration->register($input, MembershipStatus::Active, $actor);

            $this->audit->record(
                'membership.registered', 'membership', $result['membershipId'],
                null, $this->registration->auditAfter($input, $result, MembershipStatus::Active),
            );

            return $result;
        });
    }
}
```

Create `app/Actions/Members/RegisterMemberOnBehalf.php`:

```php
<?php

namespace App\Actions\Members;

use App\Enums\MembershipStatus;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A manager fills in the registration form for a child standing in front
 * of them (BR §16.1) — and it creates a PENDING application, unlike
 * ManagerRegisterReader, because §16.1 is explicit: "registering on behalf
 * still creates a pending application rather than an active member, so the
 * approval step and its audit record are never skipped." Filling in a form
 * is not the same act as approving it; collapsing the two would hold a
 * minor's data without the separate consent step BR §4's assumption 3
 * describes. The two commands disagree about `pending` on purpose.
 */
final class RegisterMemberOnBehalf
{
    public function __construct(
        private Registration $registration,
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array<string, ?string>  $input
     * @return array{userId: string, membershipId: string}
     */
    public function execute(User $actor, array $input): array
    {
        Gate::forUser($actor)->authorize('create', Membership::class);

        return DB::transaction(function () use ($input): array {
            $result = $this->registration->register($input, MembershipStatus::Pending, null);

            $this->audit->record(
                'membership.registered', 'membership', $result['membershipId'],
                null, $this->registration->auditAfter($input, $result, MembershipStatus::Pending),
            );

            return $result;
        });
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `make test FILTER=ManagerRegistration`
Expected: PASS — all six.

- [ ] **Step 5: Lint, analyse, commit**

```bash
git add app/Actions/Members tests/Feature/Members/ManagerRegistrationTest.php
git commit -m "feat: the two manager registration commands, disagreeing about pending on purpose"
```

---

### Task 8: The membership lifecycle — `ApproveMembership`, `RejectMembership`, `SuspendMembership`, `ReactivateMembership`, `MarkMembershipLeft`

Read first: the five command files under `old_next/src/domain/members/commands/` and `old_next/tests/domain/members/membership-lifecycle.test.ts`. Two of the five deliberately do NOT use the shared graph (`approve-membership.ts` and `reactivate-membership.ts` both document why: `to === active` is the one target two arrows share, and delegating would let Approve silently un-suspend and Reactivate silently approve — IMPORTANT 3).

**Files:**
- Create: `app/Actions/Members/ApproveMembership.php`
- Create: `app/Actions/Members/RejectMembership.php`
- Create: `app/Actions/Members/SuspendMembership.php`
- Create: `app/Actions/Members/ReactivateMembership.php`
- Create: `app/Actions/Members/MarkMembershipLeft.php`
- Test: `tests/Feature/Members/MembershipLifecycleTest.php`

**Interfaces:**
- Consumes: `MembershipTransitions` (Task 1), `Clock`, `AuditRecorder`, `MembershipPolicy` abilities `approve|reject|suspend|reactivate|markLeft`, `App\Models\Loan` + `App\Enums\LoanStatus` (Phase 0).
- Produces, all taking the route-bound model: `ApproveMembership::execute(User $actor, Membership $membership): void`; `RejectMembership::execute(User $actor, Membership $membership, string $reason): void`; `SuspendMembership::execute(User $actor, Membership $membership, ?string $reason): void`; `ReactivateMembership::execute(User $actor, Membership $membership): void`; `MarkMembershipLeft::execute(User $actor, Membership $membership): void`. Audit actions: `membership.approved|rejected|suspended|reactivated|left`, each with `before`/`after` status bags.

**Divergence 1 applies to all five:** the transaction's FIRST statement is `Membership::query()->lockForUpdate()->findOrFail($membership->id)` — the route-bound instance is a stale snapshot by the time the transaction opens (1a's `RetireCopy` reproduced the corruption live), and under REPEATABLE READ a lock taken after any read still sees the pinned snapshot. The re-read also re-applies `BookshelfScope` and the soft-delete scope, so a foreign or removed membership is `ModelNotFoundException` (a 404, the honest "no such reader" of the reference's RLS-filtered select).

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Members/MembershipLifecycleTest.php`:

```php
<?php

use App\Actions\Members\ApproveMembership;
use App\Actions\Members\MarkMembershipLeft;
use App\Actions\Members\ReactivateMembership;
use App\Actions\Members\RejectMembership;
use App\Actions\Members\SuspendMembership;
use App\Enums\MembershipStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;

afterEach(fn () => Carbon::setTestNow());

/** @return array{Bookshelf, User, Membership} shelf, manager, a membership in $status */
function lcFixture(string $status = 'pending', string $actorRole = 'manager'): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $actor = User::factory()->create();
    $actorMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $actor->id, 'role' => $actorRole, 'status' => 'active',
    ]);
    $subject = Membership::factory()->for($shelf)->create(['status' => $status]);
    app(TenantContext::class)->set($shelf, $actorMembership);
    test()->actingAs($actor);

    return [$shelf, $actor, $subject];
}

it('approving a pending application records who approved it, and when', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 03:00:00', 'UTC'));
    [, $actor, $subject] = lcFixture();

    app(ApproveMembership::class)->execute($actor, $subject);

    $fresh = $subject->fresh();
    expect($fresh->status)->toBe(MembershipStatus::Active)
        ->and($fresh->approved_by)->toBe($actor->id)
        ->and($fresh->approved_at->toDateTimeString())->toBe('2026-08-28 03:00:00');
});

it('approving clears any stale suspension_reason left on the row, defensively', function () {
    [, $actor, $subject] = lcFixture();
    $subject->update(['suspension_reason' => 'còn sót lại', 'rejection_reason' => 'cũ']);

    app(ApproveMembership::class)->execute($actor, $subject);

    $fresh = $subject->fresh();
    expect($fresh->suspension_reason)->toBeNull()
        ->and($fresh->rejection_reason)->toBeNull();
});

it('approving twice says the application was already dealt with', function () {
    [, $actor, $subject] = lcFixture();
    app(ApproveMembership::class)->execute($actor, $subject);

    expect(fn () => app(ApproveMembership::class)->execute($actor, $subject))
        ->toThrow(RuleViolated::class, 'registration_not_pending');
});

it('IMPORTANT 3: approving a suspended membership is refused, not a silent un-suspend', function () {
    [, $actor, $subject] = lcFixture('suspended');

    expect(fn () => app(ApproveMembership::class)->execute($actor, $subject))
        ->toThrow(RuleViolated::class, 'registration_not_pending');
});

it('rejecting keeps the record and its reason, so the person may re-apply', function () {
    [, $actor, $subject] = lcFixture();

    app(RejectMembership::class)->execute($actor, $subject, 'Chưa gặp được gia đình');

    $fresh = $subject->fresh();
    expect($fresh->status)->toBe(MembershipStatus::Rejected)
        ->and($fresh->rejection_reason)->toBe('Chưa gặp được gia đình')
        ->and($fresh->deleted_at)->toBeNull();
});

it('a rejection with no reason is refused before the constraint sees it', function () {
    [, $actor, $subject] = lcFixture();

    expect(fn () => app(RejectMembership::class)->execute($actor, $subject, '   '))
        ->toThrow(RuleViolated::class, 'reject_reason_required');
});

it('suspending records the reason, and only an active membership may be suspended', function () {
    [, $actor, $subject] = lcFixture('active');

    app(SuspendMembership::class)->execute($actor, $subject, 'Mượn quá lâu không trả');
    expect($subject->fresh()->status)->toBe(MembershipStatus::Suspended)
        ->and($subject->fresh()->suspension_reason)->toBe('Mượn quá lâu không trả');
});

it('a pending membership cannot be suspended', function () {
    [, $actor, $subject] = lcFixture('pending');

    expect(fn () => app(SuspendMembership::class)->execute($actor, $subject, null))
        ->toThrow(RuleViolated::class, 'not_active_cannot_suspend');
});

it('a suspension reason is optional — OPS §4.3 marks it so', function () {
    [, $actor, $subject] = lcFixture('active');

    app(SuspendMembership::class)->execute($actor, $subject, '   ');

    expect($subject->fresh()->suspension_reason)->toBeNull();
});

it('reactivating clears the suspension reason, and needs a suspended member', function () {
    [, $actor, $subject] = lcFixture('suspended');
    $subject->update(['suspension_reason' => 'Lý do cũ']);

    app(ReactivateMembership::class)->execute($actor, $subject);
    expect($subject->fresh()->status)->toBe(MembershipStatus::Active)
        ->and($subject->fresh()->suspension_reason)->toBeNull();

    expect(fn () => app(ReactivateMembership::class)->execute($actor, $subject->fresh()))
        ->toThrow(RuleViolated::class, 'not_suspended_cannot_reactivate');
});

it('a member with no books out may be marked left, from any status — twice, idempotently', function () {
    [, $actor, $subject] = lcFixture('pending');

    app(MarkMembershipLeft::class)->execute($actor, $subject);
    expect($subject->fresh()->status)->toBe(MembershipStatus::Left);

    // OPS §4.3's "Any status → left", read literally (M6): a re-click
    // changes nothing and refuses nothing.
    app(MarkMembershipLeft::class)->execute($actor, $subject->fresh());
    expect($subject->fresh()->status)->toBe(MembershipStatus::Left);
});

it('a member still holding a book cannot simply leave with it', function () {
    [$shelf, $actor, $subject] = lcFixture('active');
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn', 'slug' => 'de-men']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $subject->user_id, 'lent_by' => $actor->id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);

    expect(fn () => app(MarkMembershipLeft::class)->execute($actor, $subject))
        ->toThrow(RuleViolated::class, 'member_has_active_loans');
});

it('a returned loan does not keep a member from leaving', function () {
    [$shelf, $actor, $subject] = lcFixture('active');
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn', 'slug' => 'de-men']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $subject->user_id, 'lent_by' => $actor->id,
        'due_on' => '2026-09-11', 'status' => 'returned',
    ]);

    app(MarkMembershipLeft::class)->execute($actor, $subject);

    expect($subject->fresh()->status)->toBe(MembershipStatus::Left);
});

it('INV-8: each transition writes one audit entry naming before and after', function () {
    [, $actor, $subject] = lcFixture();

    app(ApproveMembership::class)->execute($actor, $subject);
    app(SuspendMembership::class)->execute($actor, $subject->fresh(), 'Lý do');
    app(ReactivateMembership::class)->execute($actor, $subject->fresh());
    app(MarkMembershipLeft::class)->execute($actor, $subject->fresh());

    $actions = AuditLog::query()->orderBy('occurred_at')->pluck('action')->all();
    expect($actions)->toBe(['membership.approved', 'membership.suspended', 'membership.reactivated', 'membership.left']);

    $approved = AuditLog::query()->where('action', 'membership.approved')->firstOrFail();
    expect($approved->before['status'])->toBe('pending')
        ->and($approved->after['status'])->toBe('active')
        ->and($approved->actor_id)->toBe($actor->id)
        ->and($approved->entity_id)->toBe($subject->id);
});

it('INV-10: a manager of one shelf cannot touch another shelf\'s member', function () {
    // Both shelves built BEFORE the actor binds, so the foreign membership
    // exists; the lockForUpdate re-read under the bound scope is what 404s.
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $foreign = Membership::factory()->for($other)->create(['status' => 'pending']);
    [, $actor] = lcFixture();

    expect(fn () => app(ApproveMembership::class)->execute($actor, $foreign))
        ->toThrow(ModelNotFoundException::class);
});

it('a reader cannot approve, reject, suspend, reactivate or mark left', function () {
    [, $actor, $subject] = lcFixture('pending', 'reader');

    expect(fn () => app(ApproveMembership::class)->execute($actor, $subject))
        ->toThrow(AuthorizationException::class)
        ->and(fn () => app(RejectMembership::class)->execute($actor, $subject, 'x'))
        ->toThrow(AuthorizationException::class)
        ->and(fn () => app(SuspendMembership::class)->execute($actor, $subject, null))
        ->toThrow(AuthorizationException::class)
        ->and(fn () => app(ReactivateMembership::class)->execute($actor, $subject))
        ->toThrow(AuthorizationException::class)
        ->and(fn () => app(MarkMembershipLeft::class)->execute($actor, $subject))
        ->toThrow(AuthorizationException::class);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `make test FILTER=MembershipLifecycle`
Expected: FAIL — classes not found.

- [ ] **Step 3: Implement the five Actions**

Create `app/Actions/Members/ApproveMembership.php`:

```php
<?php

namespace App\Actions\Members;

use App\Enums\MembershipStatus;
use App\Exceptions\RuleViolated;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * pending → active (BR §7.5; §16.3's review card). BR §4 assumption 3
 * makes this the consent step for holding a minor's data — which is why
 * RegisterMemberOnBehalf cannot skip it, and why the approving manager is
 * recorded on the row as well as in the audit log.
 *
 * DELIBERATELY NOT MembershipTransitions::assert (IMPORTANT 3, mirrored
 * by ReactivateMembership): suspended → active is a real edge in the
 * graph, so delegating would let this command silently un-suspend a
 * membership, leaving status = active with a live suspension_reason
 * rendered on the reader detail. Approve's own rule is narrow — only a
 * PENDING application — so it is checked directly against status.
 *
 * Clears suspension_reason as well as rejection_reason, defensively: "no
 * active row carries a live suspension reason" is this command's own
 * guarantee, not a reachability accident borrowed from upstream.
 *
 * Phase 2 must add the membership_approved notification write here, in
 * this same transaction (OPS §7) — recorded in known-gaps by Task 16.
 */
final class ApproveMembership
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    public function execute(User $actor, Membership $membership): void
    {
        Gate::forUser($actor)->authorize('approve', $membership);

        DB::transaction(function () use ($actor, $membership): void {
            // FIRST statement — divergence 1: the route-bound instance is a
            // stale snapshot; the locking re-read (scoped, soft-delete
            // aware) is what a concurrent decision serialises against.
            $membership = Membership::query()->lockForUpdate()->findOrFail($membership->id);

            if ($membership->status !== MembershipStatus::Pending) {
                throw new RuleViolated('registration_not_pending');
            }

            $before = ['status' => $membership->status->value];

            $membership->update([
                'status' => MembershipStatus::Active,
                'approved_by' => $actor->id,
                'approved_at' => $this->clock->now(),
                'rejection_reason' => null,
                'suspension_reason' => null,
            ]);

            $this->audit->record('membership.approved', 'membership', $membership->id,
                $before, ['status' => 'active']);
        });
    }
}
```

Create `app/Actions/Members/RejectMembership.php`:

```php
<?php

namespace App\Actions\Members;

use App\Enums\MembershipStatus;
use App\Exceptions\RuleViolated;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Members\MembershipTransitions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * pending → rejected, retained with a reason so the person may re-apply
 * (BR §2). Nothing is deleted. The reason is required by the database too
 * (memberships_rejected_has_reason) — checking it here first is what turns
 * a constraint error into OPS §4.3's named refusal.
 *
 * Phase 2 must add the membership_rejected notification write (with the
 * reason in its payload) here, in this transaction — known-gaps, Task 16.
 */
final class RejectMembership
{
    public function __construct(private AuditRecorder $audit) {}

    public function execute(User $actor, Membership $membership, string $reason): void
    {
        Gate::forUser($actor)->authorize('reject', $membership);

        if (trim($reason) === '') {
            throw new RuleViolated('reject_reason_required');
        }

        DB::transaction(function () use ($membership, $reason): void {
            $membership = Membership::query()->lockForUpdate()->findOrFail($membership->id);

            MembershipTransitions::assert($membership->status, MembershipStatus::Rejected);

            $before = ['status' => $membership->status->value];

            $membership->update([
                'status' => MembershipStatus::Rejected,
                'rejection_reason' => trim($reason),
            ]);

            $this->audit->record('membership.rejected', 'membership', $membership->id,
                $before, ['status' => 'rejected', 'reason' => trim($reason)]);
        });
    }
}
```

Create `app/Actions/Members/SuspendMembership.php`:

```php
<?php

namespace App\Actions\Members;

use App\Enums\MembershipStatus;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Members\MembershipTransitions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * active → suspended (BR §7.5). Flips status and nothing else: BR §3's
 * "a reader is suspended while still holding a book" is why INV-4's second
 * sentence exists — existing loans are untouched, and must be.
 *
 * The reason is optional HERE (OPS §4.3); the screen requires one
 * (SuspendMembershipRequest, Task 15) — the same screen/command split the
 * reference kept between actions.ts and the command.
 */
final class SuspendMembership
{
    public function __construct(private AuditRecorder $audit) {}

    public function execute(User $actor, Membership $membership, ?string $reason): void
    {
        Gate::forUser($actor)->authorize('suspend', $membership);

        DB::transaction(function () use ($membership, $reason): void {
            $membership = Membership::query()->lockForUpdate()->findOrFail($membership->id);

            MembershipTransitions::assert($membership->status, MembershipStatus::Suspended);

            $before = ['status' => $membership->status->value];
            $trimmed = ($reason === null || trim($reason) === '') ? null : trim($reason);

            $membership->update([
                'status' => MembershipStatus::Suspended,
                'suspension_reason' => $trimmed,
            ]);

            $this->audit->record('membership.suspended', 'membership', $membership->id,
                $before, ['status' => 'suspended']);
        });
    }
}
```

Create `app/Actions/Members/ReactivateMembership.php`:

```php
<?php

namespace App\Actions\Members;

use App\Enums\MembershipStatus;
use App\Exceptions\RuleViolated;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * suspended → active (BR §7.5's bidirectional arrow), clearing the
 * suspension reason on the way out — a stale reason would render on the
 * reader detail as though the account were still suspended for it.
 *
 * DELIBERATELY NOT MembershipTransitions::assert — the mirror image of
 * ApproveMembership's note: pending → active is a real edge too, so
 * delegating would let this command silently approve a pending
 * application. Only a SUSPENDED membership may be reactivated; checked
 * directly against status, with OPS §4.3's own sentence.
 */
final class ReactivateMembership
{
    public function __construct(private AuditRecorder $audit) {}

    public function execute(User $actor, Membership $membership): void
    {
        Gate::forUser($actor)->authorize('reactivate', $membership);

        DB::transaction(function () use ($membership): void {
            $membership = Membership::query()->lockForUpdate()->findOrFail($membership->id);

            if ($membership->status !== MembershipStatus::Suspended) {
                throw new RuleViolated('not_suspended_cannot_reactivate');
            }

            $before = ['status' => $membership->status->value];

            $membership->update([
                'status' => MembershipStatus::Active,
                'suspension_reason' => null,
            ]);

            $this->audit->record('membership.reactivated', 'membership', $membership->id,
                $before, ['status' => 'active']);
        });
    }
}
```

Create `app/Actions/Members/MarkMembershipLeft.php`:

```php
<?php

namespace App\Actions\Members;

use App\Enums\LoanStatus;
use App\Enums\MembershipStatus;
use App\Exceptions\RuleViolated;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Members\MembershipTransitions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Any status → left (OPS §4.3), including left → left — the graph's own
 * idempotent self-loop (M6: a re-clicked "Đánh dấu đã rời" is not an
 * error). BLOCKED while the reader still holds a book: OPS lists
 * has_active_loans and flags it as inferred, the plan header's open
 * question 2 records the alternative reading, and this implements OPS's —
 * a `left` membership is a person the shelf stopped tracking, and their
 * phone number is the mechanism by which books come back (BR §16.3).
 *
 * The loan read happens AFTER the lock, inside the transaction, through
 * the scoped Loan model — the count is this shelf's active loans for this
 * person, the same set the reference read through loans_current + RLS.
 */
final class MarkMembershipLeft
{
    public function __construct(private AuditRecorder $audit) {}

    public function execute(User $actor, Membership $membership): void
    {
        Gate::forUser($actor)->authorize('markLeft', $membership);

        DB::transaction(function () use ($membership): void {
            $membership = Membership::query()->lockForUpdate()->findOrFail($membership->id);

            MembershipTransitions::assert($membership->status, MembershipStatus::Left);

            $holding = Loan::query()
                ->where('borrower_id', $membership->user_id)
                ->where('status', LoanStatus::Active)
                ->exists();
            if ($holding) {
                throw new RuleViolated('member_has_active_loans');
            }

            $before = ['status' => $membership->status->value];

            $membership->update(['status' => MembershipStatus::Left]);

            $this->audit->record('membership.left', 'membership', $membership->id,
                $before, ['status' => 'left']);
        });
    }
}
```

Note on the idempotent left → left: it still writes an audit entry (`before: left, after: left`) — the same behaviour the reference's `Any status → left` walk produces, and an honest record that the button was pressed.

- [ ] **Step 4: Run to verify pass**

Run: `make test FILTER=MembershipLifecycle`
Expected: PASS — all 16.

- [ ] **Step 5: Lint, analyse, commit**

```bash
git add app/Actions/Members tests/Feature/Members/MembershipLifecycleTest.php
git commit -m "feat: the five membership lifecycle commands, locked first and audited"
```

---

### Task 9: `SetReaderCredentials` — the volunteer as the reset path

Read first: `old_next/src/domain/members/commands/set-reader-credentials.ts` (its "four things this command must get right" docstring is the specification of this task) and `old_next/tests/domain/members/credentials.test.ts` (skip its `ChangeOwnPassword` half — Phase 3's, per the scope note).

**Files:**
- Create: `app/Actions/Members/SetReaderCredentials.php`
- Test: `tests/Feature/Members/SetReaderCredentialsTest.php`

**Interfaces:**
- Consumes: `MembershipPolicy::setCredentials`, `UniqueViolation`, `Hash`, the `sessions` table (Phase 0 — plain `user_id` column; the hashed-id driver hashes the key, not this column).
- Produces: `SetReaderCredentials::execute(User $actor, Membership $membership, string $username, string $password): void`. Audit action `credentials.set`, `entity_type` `user`, **no before, no after**.

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Members/SetReaderCredentialsTest.php`:

```php
<?php

use App\Actions\Members\SetReaderCredentials;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/** @return array{Bookshelf, User, Membership, User} shelf, manager, reader membership, reader person */
function credFixture(string $actorRole = 'manager'): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $actor = User::factory()->create();
    $actorMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $actor->id, 'role' => $actorRole, 'status' => 'active',
    ]);
    $person = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create(['user_id' => $person->id, 'status' => 'active']);
    app(TenantContext::class)->set($shelf, $actorMembership);
    test()->actingAs($actor);

    return [$shelf, $actor, $membership, $person];
}

it('gives an account the ability to sign in for the first time', function () {
    [, $actor, $membership, $person] = credFixture();

    app(SetReaderCredentials::class)->execute($actor, $membership, 'lan.nguyen', 'mat-khau-123');

    $fresh = $person->fresh();
    expect($fresh->username)->toBe('lan.nguyen')
        ->and(Hash::check('mat-khau-123', $fresh->password_hash))->toBeTrue();
});

it('and gives it back to someone who forgot', function () {
    [, $actor, $membership, $person] = credFixture();
    $person->username = 'lan.nguyen';
    $person->password_hash = Hash::make('mat-khau-cu-1');
    $person->save();

    app(SetReaderCredentials::class)->execute($actor, $membership, 'lan.nguyen', 'mat-khau-moi-2');

    expect(Hash::check('mat-khau-moi-2', $person->fresh()->password_hash))->toBeTrue();
});

it('the audit entry names the manager, the reader and the time — with no before, no after, and no secret anywhere in the row', function () {
    [, $actor, $membership, $person] = credFixture();

    app(SetReaderCredentials::class)->execute($actor, $membership, 'lan.nguyen', 'mat-khau-123');

    $entry = AuditLog::query()->where('action', 'credentials.set')->firstOrFail();
    $row = json_encode($entry->getAttributes());

    expect($entry->actor_id)->toBe($actor->id)
        ->and($entry->entity_type)->toBe('user')
        ->and($entry->entity_id)->toBe($person->id)
        ->and($entry->before)->toBeNull()
        ->and($entry->after)->toBeNull()
        ->and($row)->not->toContain('mat-khau-123')
        ->and($row)->not->toContain($person->fresh()->password_hash);
});

it('setting credentials ends every session that reader already had, and nobody else\'s', function () {
    [, $actor, $membership, $person] = credFixture();
    $bystander = User::factory()->create();
    DB::table('sessions')->insert([
        ['id' => 'reader-session-1', 'user_id' => $person->id, 'payload' => '', 'last_activity' => 1],
        ['id' => 'reader-session-2', 'user_id' => $person->id, 'payload' => '', 'last_activity' => 1],
        ['id' => 'bystander-session', 'user_id' => $bystander->id, 'payload' => '', 'last_activity' => 1],
    ]);

    app(SetReaderCredentials::class)->execute($actor, $membership, 'lan.nguyen', 'mat-khau-123');

    expect(DB::table('sessions')->where('user_id', $person->id)->count())->toBe(0)
        ->and(DB::table('sessions')->where('user_id', $bystander->id)->count())->toBe(1);
});

it('a taken username is refused, case-insensitively, in the manager\'s words', function () {
    [, $actor, $membership] = credFixture();
    User::factory()->withCredentials('Lan.Nguyen')->create();

    expect(fn () => app(SetReaderCredentials::class)->execute($actor, $membership, 'lan.nguyen', 'mat-khau-123'))
        ->toThrow(RuleViolated::class, 'username_in_use');
});

it('keeping the same username while changing the password is not a collision', function () {
    [, $actor, $membership, $person] = credFixture();
    app(SetReaderCredentials::class)->execute($actor, $membership, 'lan.nguyen', 'mat-khau-123');

    app(SetReaderCredentials::class)->execute($actor, $membership, 'lan.nguyen', 'mat-khau-456');

    expect(Hash::check('mat-khau-456', $person->fresh()->password_hash))->toBeTrue();
});

it('a short password, and a blank username, are refused before any write', function () {
    [, $actor, $membership, $person] = credFixture();

    expect(fn () => app(SetReaderCredentials::class)->execute($actor, $membership, 'lan.nguyen', 'ngắn123'))
        ->toThrow(RuleViolated::class, 'password_too_short')
        ->and(fn () => app(SetReaderCredentials::class)->execute($actor, $membership, '   ', 'mat-khau-123'))
        ->toThrow(RuleViolated::class, 'required_fields_missing')
        ->and($person->fresh()->username)->toBeNull();
});

it('INV-10: a manager of one shelf cannot set credentials on another shelf\'s reader', function () {
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $foreign = Membership::factory()->for($other)->create(['status' => 'active']);
    [, $actor] = credFixture();

    expect(fn () => app(SetReaderCredentials::class)->execute($actor, $foreign, 'ai-do', 'mat-khau-123'))
        ->toThrow(ModelNotFoundException::class);
});

it('IMPORTANT 4: a soft-deleted identity cannot receive new credentials', function () {
    [, $actor, $membership, $person] = credFixture();
    $person->delete();

    expect(fn () => app(SetReaderCredentials::class)->execute($actor, $membership, 'lan.nguyen', 'mat-khau-123'))
        ->toThrow(RuleViolated::class, 'membership_not_found');
});

it('a reader cannot set anyone\'s credentials, including their own', function () {
    [, $actor, $membership] = credFixture('reader');

    expect(fn () => app(SetReaderCredentials::class)->execute($actor, $membership, 'lan.nguyen', 'mat-khau-123'))
        ->toThrow(AuthorizationException::class);
});
```

(The reference's "a command that tried to log the hash would be refused by the kernel" has no port: there is no `assertNoSecrets` kernel walker here — the no-secret rule is held by the audit-row assertions above, and Task 16's known-gaps entry names the missing walker honestly.)

- [ ] **Step 2: Run to verify failure**

Run: `make test FILTER=SetReaderCredentials`
Expected: FAIL — class not found.

- [ ] **Step 3: Implement**

Create `app/Actions/Members/SetReaderCredentials.php`:

```php
<?php

namespace App\Actions\Members;

use App\Exceptions\RuleViolated;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\UniqueViolation;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Hash;

/**
 * Sets or changes a reader's sign-in details — one command for both cases
 * because they are the same act from the volunteer's side (OPS §4.3), and
 * there is no self-service reset to compete with (BR §4 assumption 2).
 *
 * The reference's four rules, kept:
 *  1. The audit records the act, never the secret: no before, no after —
 *     not a redacted one, not { hasPassword: true }. BR §2/§14 state it
 *     twice because this is where the temptation is strongest.
 *  2. It must not be quiet: credentials.set is a stable action name the
 *     administration surface filters on by name (BR §13.2 Oversight).
 *  3. It ends that reader's existing sessions IN THIS TRANSACTION —
 *     credentials that changed while an old session kept working are not
 *     revoked. The sessions table's user_id column is plain (the hashed
 *     driver hashes the KEY); one scoped delete is exactly enough.
 *  4. The reader is reached through the shelf-scoped membership, never a
 *     caller-supplied user id — users is a global table, and the scoped
 *     lockForUpdate re-read below is the entire protection between a
 *     manager of one parish and every account in the system.
 * Plus IMPORTANT 4: a soft-deleted identity is "no such reader" too.
 */
final class SetReaderCredentials
{
    public function __construct(private AuditRecorder $audit) {}

    public function execute(User $actor, Membership $membership, string $username, string $password): void
    {
        Gate::forUser($actor)->authorize('setCredentials', $membership);

        if (trim($username) === '') {
            throw new RuleViolated('required_fields_missing');
        }
        if (mb_strlen($password) < 8) {
            throw new RuleViolated('password_too_short');
        }

        DB::transaction(function () use ($membership, $username, $password): void {
            // FIRST statement — divergence 1. Scoped + soft-delete-aware.
            $membership = Membership::query()->lockForUpdate()->findOrFail($membership->id);

            // The identity itself must not be soft-deleted (IMPORTANT 4):
            // User's SoftDeletes scope excludes trashed rows, so a deleted
            // person reads as the same "Không tìm thấy bạn đọc này." every
            // other screen already gives.
            $person = User::query()->lockForUpdate()->find($membership->user_id);
            if ($person === null) {
                throw new RuleViolated('membership_not_found');
            }

            $trimmed = trim($username);

            // Checked so a sequential caller gets the sentence rather than
            // a 1062; scoped id <> so re-setting a password under the same
            // username is not a collision with oneself. A CONCURRENT caller
            // can still lose the race to users_username_key — translated
            // below, same code.
            $clash = User::query()
                ->whereRaw('LOWER(username) = LOWER(?)', [$trimmed])
                ->where('id', '<>', $person->id)
                ->exists();
            if ($clash) {
                throw new RuleViolated('username_in_use');
            }

            try {
                // INV-14: both columns in one statement, so the pairing
                // cannot break even momentarily. Not $fillable, on purpose.
                $person->username = $trimmed;
                $person->password_hash = Hash::make($password);
                $person->save();
            } catch (QueryException $e) {
                UniqueViolation::translate($e, ['users_username_key' => 'username_in_use']);
            }

            // Rule 3: same transaction as the credential change.
            DB::table('sessions')->where('user_id', $person->id)->delete();

            // Rule 1: no before, no after. This is the requirement, not an
            // omission somebody can helpfully fill in later.
            $this->audit->record('credentials.set', 'user', $person->id, null, null);
        });
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `make test FILTER=SetReaderCredentials`
Expected: PASS — all 10.

- [ ] **Step 5: Lint, analyse, commit**

```bash
git add app/Actions/Members/SetReaderCredentials.php tests/Feature/Members/SetReaderCredentialsTest.php
git commit -m "feat: set reader credentials — paired columns, revoked sessions, secret-free audit"
```

---

### Task 10: `ProfileFields` and `UpdateReaderProfile` — the second sanctioned write path

Read first: `old_next/src/domain/members/profile-fields.ts` (the allowlist argument), `old_next/src/domain/members/commands/update-reader-profile.ts` (all six numbered rules), and `old_next/tests/domain/members/update-reader-profile.test.ts` + `update-reader-profile-routing.test.ts`.

**Files:**
- Create: `app/Support/Members/ProfileFields.php`
- Create: `app/Actions/Members/UpdateReaderProfile.php`
- Test: `tests/Unit/Members/ProfileFieldsTest.php`
- Test: `tests/Feature/Members/UpdateReaderProfileTest.php`

**Interfaces:**
- Consumes: `Phone`, `MembershipPolicy::correct`, `MembershipRole::atLeast` (Phase 0), `AuditRecorder`.
- Produces:
  - `ProfileFields::FIELDS` — the nine columns, spelled as the database spells them: `saint_name, full_name, date_of_birth, father_name, mother_name, phone, phone_missing_reason, email, avatar_object`. `ProfileFields::REQUIRED` — the four `NOT NULL` ones (`saint_name, full_name, father_name, mother_name`).
  - `ProfileFields::normalisePatch(array $fields): array` — keeps only allowlisted keys, folds blank→null, refuses a blanked required field (`required_fields_missing`), a malformed date (`validation_failed`) and a malformed phone (`phone_invalid`). Trims everything else.
  - `ProfileFields::diff(array $before, array $after): array{before: array, after: array, changed: list<string>}` — only the keys that actually changed.
  - `UpdateReaderProfile::execute(User $actor, Membership $membership, array $fields): void` — audit `profile.corrected`, entity `user`, before/after carrying **only the changed fields**. In Phase 3, `ApproveProfileChange` becomes the second caller of `ProfileFields` — the allowlist exists so the two paths cannot drift.

**Where the reference's `ScopedUserId` brand went.** The TypeScript brand existed because any command could hand `applyProfileFields` a caller-supplied user id, skipping the shelf-scoped join. Here the compile-time seam is different: `execute` takes a route-bound `Membership` (there is no `userId` parameter to get wrong), the person is reached only via the locked, scoped membership re-read, and `ProfileFields` is pure — it writes nothing. Task 16's architecture test adds the textual half (no `User::query()->update` / `DB::table('users')` writes outside the two sanctioned Actions).

- [ ] **Step 1: Write the failing tests**

Create `tests/Unit/Members/ProfileFieldsTest.php`:

```php
<?php

use App\Exceptions\RuleViolated;
use App\Support\Members\ProfileFields;

it('keeps only the nine known fields and folds blank to null', function () {
    $patch = ProfileFields::normalisePatch([
        'phone' => '  0912345678 ', 'email' => '   ',
        'is_super_admin' => '1', 'username' => 'hacker', 'role' => 'admin',
    ]);

    expect($patch)->toBe(['phone' => '0912345678', 'email' => null]);
});

it('refuses blanking a required field by name, not by constraint', function () {
    foreach (ProfileFields::REQUIRED as $field) {
        expect(fn () => ProfileFields::normalisePatch([$field => '  ']))
            ->toThrow(RuleViolated::class, 'required_fields_missing');
    }
    expect(ProfileFields::REQUIRED)->toBe(['saint_name', 'full_name', 'father_name', 'mother_name']);
});

it('refuses a malformed or impossible date, allows clearing it', function () {
    expect(fn () => ProfileFields::normalisePatch(['date_of_birth' => '02/04/2015']))
        ->toThrow(RuleViolated::class, 'validation_failed')
        ->and(fn () => ProfileFields::normalisePatch(['date_of_birth' => '2015-02-30']))
        ->toThrow(RuleViolated::class, 'validation_failed')
        ->and(ProfileFields::normalisePatch(['date_of_birth' => '  ']))->toBe(['date_of_birth' => null])
        ->and(ProfileFields::normalisePatch(['date_of_birth' => '2016-02-29']))->toBe(['date_of_birth' => '2016-02-29']);
});

it('refuses a malformed phone, allows clearing it', function () {
    expect(fn () => ProfileFields::normalisePatch(['phone' => 'khong-phai-so']))
        ->toThrow(RuleViolated::class, 'phone_invalid')
        ->and(ProfileFields::normalisePatch(['phone' => ' ']))->toBe(['phone' => null]);
});

it('diff reports only what changed, absent keys untouched', function () {
    $result = ProfileFields::diff(
        ['phone' => '0911111111', 'email' => null, 'full_name' => 'Nguyễn Thị Lan'],
        ['phone' => '0922222222', 'email' => null, 'full_name' => 'Nguyễn Thị Lan'],
    );

    expect($result['changed'])->toBe(['phone'])
        ->and($result['before'])->toBe(['phone' => '0911111111'])
        ->and($result['after'])->toBe(['phone' => '0922222222']);
});
```

Create `tests/Feature/Members/UpdateReaderProfileTest.php`:

```php
<?php

use App\Actions\Members\UpdateReaderProfile;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;

/** @return array{Bookshelf, User, Membership, User} */
function corrFixture(string $actorRole = 'manager', string $subjectRole = 'reader'): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $actor = User::factory()->create();
    $actorMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $actor->id, 'role' => $actorRole, 'status' => 'active',
    ]);
    $person = User::factory()->create([
        'saint_name' => 'Maria', 'full_name' => 'Nguyễn Thị Lan',
        'father_name' => 'Nguyễn Văn Hoà', 'mother_name' => 'Trần Thị Mai',
        'phone' => '0911111111', 'phone_missing_reason' => null,
    ]);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $person->id, 'role' => $subjectRole, 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $actorMembership);
    test()->actingAs($actor);

    return [$shelf, $actor, $membership, $person];
}

it('a manager corrects a phone number, and the audit names who, when, and only what changed', function () {
    [, $actor, $membership, $person] = corrFixture();

    app(UpdateReaderProfile::class)->execute($actor, $membership, ['phone' => '0922222222']);

    expect($person->fresh()->phone)->toBe('0922222222');

    $entry = AuditLog::query()->where('action', 'profile.corrected')->firstOrFail();
    expect($entry->actor_id)->toBe($actor->id)
        ->and($entry->entity_type)->toBe('user')
        ->and($entry->entity_id)->toBe($person->id)
        ->and($entry->before)->toBe(['phone' => '0911111111'])
        ->and($entry->after)->toBe(['phone' => '0922222222'])
        // Only the fields that changed — an entry listing all nine says "a
        // manager rewrote this person" when a manager fixed a phone number.
        ->and(array_keys($entry->before))->toBe(['phone']);
});

it('two fields at once, including one cleared to null', function () {
    [, $actor, $membership, $person] = corrFixture();

    app(UpdateReaderProfile::class)->execute($actor, $membership, [
        'email' => 'lan@example.com', 'date_of_birth' => '',
    ]);

    $fresh = $person->fresh();
    expect($fresh->email)->toBe('lan@example.com')
        ->and($fresh->date_of_birth)->toBeNull();
});

it('a field this call never named survives untouched', function () {
    [, $actor, $membership, $person] = corrFixture();

    app(UpdateReaderProfile::class)->execute($actor, $membership, ['phone' => '0922222222']);

    expect($person->fresh()->father_name)->toBe('Nguyễn Văn Hoà');
});

it('naming no fields at all is refused, and writes nothing', function () {
    [, $actor, $membership] = corrFixture();

    expect(fn () => app(UpdateReaderProfile::class)->execute($actor, $membership, []))
        ->toThrow(RuleViolated::class, 'empty_proposal')
        ->and(AuditLog::query()->where('action', 'profile.corrected')->count())->toBe(0);
});

it('naming fields that all match the current values is refused, and moves nothing', function () {
    [, $actor, $membership, $person] = corrFixture();
    $updatedAt = $person->fresh()->updated_at;

    expect(fn () => app(UpdateReaderProfile::class)->execute($actor, $membership, [
        'phone' => '0911111111', 'full_name' => 'Nguyễn Thị Lan',
    ]))->toThrow(RuleViolated::class, 'empty_proposal');

    // The part a pre-check would leave true by accident: the row itself
    // did not move (the no-op write rolled back with the refusal).
    expect($person->fresh()->updated_at->toDateTimeString('microsecond'))
        ->toBe($updatedAt->toDateTimeString('microsecond'));
});

it('blanking a not-null field is a sentence, not a constraint error', function () {
    [, $actor, $membership] = corrFixture();

    expect(fn () => app(UpdateReaderProfile::class)->execute($actor, $membership, ['mother_name' => ' ']))
        ->toThrow(RuleViolated::class, 'required_fields_missing');
});

it('clearing the phone without a reason on file is thieu-so-dien-thoai', function () {
    [, $actor, $membership] = corrFixture();

    expect(fn () => app(UpdateReaderProfile::class)->execute($actor, $membership, ['phone' => '']))
        ->toThrow(RuleViolated::class, 'thieu-so-dien-thoai');
});

it('clearing the phone WITH a typed reason is allowed, and a reason already on file answers too', function () {
    [, $actor, $membership, $person] = corrFixture();

    app(UpdateReaderProfile::class)->execute($actor, $membership, [
        'phone' => '', 'phone_missing_reason' => 'Gia đình đổi số, sẽ bổ sung',
    ]);

    expect($person->fresh()->phone)->toBeNull()
        ->and($person->fresh()->phone_missing_reason)->toBe('Gia đình đổi số, sẽ bổ sung');
});

it('supplying a phone clears a stale missing-reason automatically', function () {
    [, $actor, $membership, $person] = corrFixture();
    $person->update(['phone' => null, 'phone_missing_reason' => 'chưa có']);

    app(UpdateReaderProfile::class)->execute($actor, $membership, ['phone' => '0933333333']);

    expect($person->fresh()->phone_missing_reason)->toBeNull();
});

it('§9 routing: a manager-subject record is a super admin\'s to write, not a colleague\'s', function () {
    [, $actor, $membership] = corrFixture('manager', 'manager');

    expect(fn () => app(UpdateReaderProfile::class)->execute($actor, $membership, ['phone' => '0922222222']))
        ->toThrow(RuleViolated::class, 'not_permitted');
});

it('§9 routing: a super admin may correct a manager\'s record', function () {
    [$shelf, , $membership] = corrFixture('manager', 'manager');
    $admin = User::factory()->superAdmin()->create();
    app(TenantContext::class)->set($shelf, null);
    test()->actingAs($admin);

    app(UpdateReaderProfile::class)->execute($admin, $membership, ['phone' => '0922222222']);

    expect(User::query()->findOrFail($membership->user_id)->phone)->toBe('0922222222');
});

it('INV-10: a manager of one shelf cannot correct another shelf\'s reader', function () {
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $foreign = Membership::factory()->for($other)->create(['status' => 'active']);
    [, $actor] = corrFixture();

    expect(fn () => app(UpdateReaderProfile::class)->execute($actor, $foreign, ['phone' => '0922222222']))
        ->toThrow(ModelNotFoundException::class);
});

it('a soft-deleted identity cannot be corrected', function () {
    [, $actor, $membership, $person] = corrFixture();
    $person->delete();

    expect(fn () => app(UpdateReaderProfile::class)->execute($actor, $membership, ['phone' => '0922222222']))
        ->toThrow(RuleViolated::class, 'membership_not_found');
});

it('no correction can reach a credential column', function () {
    [, $actor, $membership, $person] = corrFixture();

    expect(fn () => app(UpdateReaderProfile::class)->execute($actor, $membership, [
        'username' => 'ke-xau', 'password_hash' => 'x', 'is_super_admin' => '1',
    ]))->toThrow(RuleViolated::class, 'empty_proposal')
        ->and($person->fresh()->username)->toBeNull();
});

it('a reader cannot correct anyone\'s details, including their own', function () {
    [, $actor, $membership] = corrFixture('reader');

    expect(fn () => app(UpdateReaderProfile::class)->execute($actor, $membership, ['phone' => '0922222222']))
        ->toThrow(AuthorizationException::class);
});
```

(The reference's `systemContext`-refusal test does not port: there is no `systemContext` here — `execute` takes a concrete authenticated `User`, and a console caller with no user fails the Gate. The concurrency variant `"a field this call never named survives a concurrent correction"` does not port either — under `RefreshDatabase` a second connection cannot see uncommitted fixtures, 1a divergence 2's reasoning; the per-key patch write below is the mechanism, and known-gaps records the untestable half.)

- [ ] **Step 2: Run to verify failure**

Run: `make test FILTER=ProfileFields && make test FILTER=UpdateReaderProfile`
Expected: FAIL — classes not found.

- [ ] **Step 3: Implement**

Create `app/Support/Members/ProfileFields.php`:

```php
<?php

declare(strict_types=1);

namespace App\Support\Members;

use App\Exceptions\RuleViolated;

/**
 * INV-13's application half: the ONE list of a person's verified details,
 * so the two sanctioned write paths — UpdateReaderProfile now, Phase 3's
 * ApproveProfileChange later — can never disagree about which fields
 * exist. Data, not a chain of ifs (profile-fields.ts's argument, kept).
 *
 * NOT in the list, deliberately: username/password_hash (INV-14's pair,
 * SetReaderCredentials' own act with its own audit rules), is_super_admin
 * (a grant, not a fact about a person), display_name/locale (written by
 * nothing in the domain).
 */
final class ProfileFields
{
    /** @var list<string> the nine columns, spelled as the database spells them */
    public const array FIELDS = [
        'saint_name', 'full_name', 'date_of_birth', 'father_name',
        'mother_name', 'phone', 'phone_missing_reason', 'email', 'avatar_object',
    ];

    /** @var list<string> the four NOT NULL columns — blanking one is a named refusal, not a driver error */
    public const array REQUIRED = ['saint_name', 'full_name', 'father_name', 'mother_name'];

    /**
     * Exactly the allowlisted keys a caller named, blank folded to null,
     * with the three shape rules enforced: a required field cannot blank,
     * a date must be a real Y-m-d day, a non-blank phone must have QA
     * T18's shape.
     *
     * @param  array<string, mixed>  $fields
     * @return array<string, ?string>
     */
    public static function normalisePatch(array $fields): array
    {
        $patch = [];

        foreach (self::FIELDS as $field) {
            if (! array_key_exists($field, $fields)) {
                continue;
            }

            $value = $fields[$field];
            $value = is_string($value) && trim($value) !== '' ? trim($value) : null;

            if ($value === null && in_array($field, self::REQUIRED, true)) {
                throw new RuleViolated('required_fields_missing');
            }

            if ($field === 'date_of_birth' && $value !== null) {
                if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m) !== 1
                    || ! checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
                    throw new RuleViolated('validation_failed');
                }
            }

            if ($field === 'phone' && $value !== null) {
                Phone::assert($value);
            }

            $patch[$field] = $value;
        }

        return $patch;
    }

    /**
     * Only the keys whose values actually differ — an audit entry is a
     * claim about what changed, and six identical fields on both sides
     * would make it a lie of emphasis.
     *
     * @param  array<string, ?string>  $before
     * @param  array<string, ?string>  $after
     * @return array{before: array<string, ?string>, after: array<string, ?string>, changed: list<string>}
     */
    public static function diff(array $before, array $after): array
    {
        $changed = [];

        foreach ($after as $field => $value) {
            if (($before[$field] ?? null) !== $value) {
                $changed[] = $field;
            }
        }

        return [
            'before' => array_intersect_key($before, array_flip($changed)),
            'after' => array_intersect_key($after, array_flip($changed)),
            'changed' => $changed,
        ];
    }
}
```

Create `app/Actions/Members/UpdateReaderProfile.php`:

```php
<?php

namespace App\Actions\Members;

use App\Enums\MembershipRole;
use App\Exceptions\RuleViolated;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Members\ProfileFields;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A manager corrects a reader's personal details directly, with no
 * approval step — OPS §4.3's UpdateReaderProfile, the product owner's
 * answer to "most readers are children who never sign in, and the phone
 * number is how books come back" (BR §2). Not a weakening of INV-13:
 * whoever can set a reader's password can already act as that reader, and
 * a direct edit naming the manager is the more truthful record. What
 * INV-13 protects is that details never change SILENTLY — hence the
 * before/after audit carrying exactly the changed fields.
 *
 * The reference's rules, kept:
 *  - the reader is reached through the shelf-scoped membership, never a
 *    caller-supplied user id (users is global);
 *  - §9 routing: a manager/admin SUBJECT may only be corrected by a super
 *    admin, derived fresh from the subject's current role under the lock —
 *    which also refuses a manager editing their own record, since their
 *    own role is exactly `manager`;
 *  - an edit that changes nothing writes nothing (empty_proposal, and the
 *    transaction rolls back the no-op);
 *  - the resulting record must not go silent on the phone: blank phone
 *    with no reason (typed now or already on file) is thieu-so-dien-thoai,
 *    and a supplied phone clears a stale reason;
 *  - profile.corrected, not membership.updated — the name a super admin
 *    filters for is exactly "a manager changed someone's details without
 *    an approval step" (BR §13.2, the same oversight as credentials.set).
 */
final class UpdateReaderProfile
{
    public function __construct(private AuditRecorder $audit) {}

    /** @param  array<string, mixed>  $fields */
    public function execute(User $actor, Membership $membership, array $fields): void
    {
        Gate::forUser($actor)->authorize('correct', $membership);

        // Before any database round trip: shape refusals cost nothing.
        $patch = ProfileFields::normalisePatch($fields);

        if ($patch === []) {
            throw new RuleViolated('empty_proposal');
        }

        DB::transaction(function () use ($actor, $membership, $patch): void {
            // FIRST statement — divergence 1; also re-reads role fresh for
            // the §9 routing check below.
            $membership = Membership::query()->lockForUpdate()->findOrFail($membership->id);

            // §9: a manager/admin subject is a super admin's to write. A
            // manager's own record fails here too — their role IS manager.
            if ($membership->role->atLeast(MembershipRole::Manager) && ! $actor->is_super_admin) {
                throw new RuleViolated('not_permitted');
            }

            $person = User::query()->lockForUpdate()->find($membership->user_id);
            if ($person === null) {
                throw new RuleViolated('membership_not_found');
            }

            $before = [];
            foreach (ProfileFields::FIELDS as $field) {
                $raw = $person->getAttributes()[$field] ?? null;
                // date_of_birth is stored DATETIME-ish by the cast; compare
                // and audit the plain Y-m-d string everywhere.
                $before[$field] = $field === 'date_of_birth'
                    ? $person->date_of_birth?->toDateString()
                    : $raw;
            }

            $after = array_merge($before, $patch);

            // A present number makes a stale reason wrong; a cleared one
            // must not leave the record silent (typed now or already on
            // file both answer).
            if (($after['phone'] ?? null) !== null) {
                $after['phone_missing_reason'] = $patch['phone_missing_reason'] ?? null;
            }
            if (($after['phone'] ?? null) === null && ($after['phone_missing_reason'] ?? null) === null) {
                throw new RuleViolated('thieu-so-dien-thoai');
            }

            $diff = ProfileFields::diff($before, $after);
            if ($diff['changed'] === []) {
                // Rolls the transaction back, no-op UPDATE included; no
                // audit entry claims a change that did not happen.
                throw new RuleViolated('empty_proposal');
            }

            foreach ($diff['changed'] as $field) {
                $person->{$field} = $after[$field];
            }
            $person->save();

            $this->audit->record('profile.corrected', 'user', $person->id,
                $diff['before'], $diff['after']);
        });
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `make test FILTER=ProfileFields && make test FILTER=UpdateReaderProfile`
Expected: PASS — 5 + 15.

- [ ] **Step 5: Lint, analyse, commit**

```bash
git add app/Support/Members/ProfileFields.php app/Actions/Members/UpdateReaderProfile.php tests
git commit -m "feat: the profile-field allowlist and the manager's audited direct correction"
```

---

### Task 11: `NameSimilarity` and `PendingRegistrationsQuery` — the approval queue's shape

Read first: `old_next/src/domain/members/queries/get-pending-registrations.ts` (the SQL comment records pg_trgm's verified numbers) and the queue half of `old_next/tests/domain/members/manager-queries.test.ts`.

**Files:**
- Create: `app/Support/Members/NameSimilarity.php`
- Create: `app/Queries/PendingRegistrationsQuery.php`
- Test: `tests/Unit/Members/NameSimilarityTest.php`
- Test: `tests/Feature/Members/PendingRegistrationsQueryTest.php`

**Interfaces:**
- Consumes: `Fold::fold`, `ParishContextQuery`, `ParishUnits::describeSelection`, `MembershipStatus`.
- Produces:
  - `NameSimilarity::similarity(string $a, string $b): float` — pg_trgm's measure over folded names; `NameSimilarity::THRESHOLD = 0.6`.
  - `PendingRegistrationsQuery::run(): list<array{membershipId: string, userId: string, fullName: string, saintName: ?string, dateOfBirth: ?string, fatherName: string, motherName: string, phone: ?string, phoneMissingReason: ?string, parishLine: string, requestedAt: string, similarTo: ?array{membershipId: string, fullName: string, similarity: float}}>` — every `pending` application on the bound shelf, oldest first, each with BR §16.3's similar-name warning against **active** members only. This row carries the manager-only fields because the review card renders exactly them (BR §16.3: "laying out exactly the fields the manager must verify in person").

**Divergence 3 lands here** (the header holds the full argument): the similarity math is pure PHP, the query loads the active roster's names once and computes per pending row.

- [ ] **Step 1: Write the failing tests**

Create `tests/Unit/Members/NameSimilarityTest.php`:

```php
<?php

use App\Support\Members\NameSimilarity;

it('reproduces pg_trgm\'s measured value for the reference\'s own example', function () {
    // get-pending-registrations.ts's comment: similarity('tran minh',
    // 'tran minh duc') -> 0.714, verified live against pg_trgm 1.6.
    // The trigram sets: 10 shared, 14 in the union → 10/14.
    expect(NameSimilarity::similarity('Trần Minh', 'Trần Minh Đức'))
        ->toEqualWithDelta(10 / 14, 0.0001);
});

it('folds before comparing, so diacritics never separate two spellings', function () {
    expect(NameSimilarity::similarity('Trần Minh', 'Tran Minh'))->toBe(1.0);
});

it('is symmetric, 1.0 for identical, low for unrelated', function () {
    $a = NameSimilarity::similarity('Nguyễn Thị Lan', 'Nguyen Thi Lan Anh');

    expect($a)->toBe(NameSimilarity::similarity('Nguyen Thi Lan Anh', 'Nguyễn Thị Lan'))
        ->and(NameSimilarity::similarity('Nguyễn Thị Lan', 'Nguyễn Thị Lan'))->toBe(1.0)
        ->and(NameSimilarity::similarity('Nguyễn Thị Lan', 'Phêrô Hoàng Bách'))->toBeLessThan(NameSimilarity::THRESHOLD);
});

it('empty or symbol-only input scores zero rather than dividing by nothing', function () {
    expect(NameSimilarity::similarity('', 'Trần Minh'))->toBe(0.0)
        ->and(NameSimilarity::similarity('***', '///'))->toBe(0.0);
});
```

Create `tests/Feature/Members/PendingRegistrationsQueryTest.php`:

```php
<?php

use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Queries\PendingRegistrationsQuery;
use Tests\Support\TenantHarness;

/** @return Bookshelf a bound shelf */
function pregFixture(): Bookshelf
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    TenantHarness::actAs($shelf);

    return $shelf;
}

function pregMember(Bookshelf $shelf, string $name, string $status, array $userOver = []): Membership
{
    $person = User::factory()->create(array_merge(['full_name' => $name], $userOver));

    return Membership::factory()->for($shelf)->create(['user_id' => $person->id, 'status' => $status]);
}

it('lists only pending applications, oldest first, with the review card\'s fields', function () {
    $shelf = pregFixture();
    pregMember($shelf, 'Đã Duyệt Rồi', 'active');
    pregMember($shelf, 'Đã Từ Chối', 'rejected', []);
    $older = pregMember($shelf, 'Trần Văn Cũ', 'pending', [
        'saint_name' => 'Giuse', 'date_of_birth' => '2014-01-01',
        'father_name' => 'Cha Cũ', 'mother_name' => 'Mẹ Cũ',
        'phone' => '0911111111', 'phone_missing_reason' => null,
    ]);
    $newer = pregMember($shelf, 'Lê Thị Mới', 'pending');

    $rows = app(PendingRegistrationsQuery::class)->run();

    expect(array_column($rows, 'membershipId'))->toBe([$older->id, $newer->id])
        ->and($rows[0]['fullName'])->toBe('Trần Văn Cũ')
        ->and($rows[0]['saintName'])->toBe('Giuse')
        ->and($rows[0]['dateOfBirth'])->toBe('2014-01-01')
        ->and($rows[0]['fatherName'])->toBe('Cha Cũ')
        ->and($rows[0]['phone'])->toBe('0911111111')
        ->and($rows[0]['requestedAt'])->not->toBe('');
});

it('a near-duplicate ACTIVE name is flagged for the manager, and never acted on', function () {
    $shelf = pregFixture();
    $existing = pregMember($shelf, 'Trần Minh', 'active');
    $applicant = pregMember($shelf, 'Tran Minh Duc', 'pending');

    $rows = app(PendingRegistrationsQuery::class)->run();

    $row = collect($rows)->firstWhere('membershipId', $applicant->id);
    expect($row['similarTo'])->not->toBeNull()
        ->and($row['similarTo']['membershipId'])->toBe($existing->id)
        ->and($row['similarTo']['fullName'])->toBe('Trần Minh')
        ->and($row['similarTo']['similarity'])->toEqualWithDelta(10 / 14, 0.0001)
        // Nothing merged, nothing rejected — a warning to a human only.
        ->and($applicant->fresh()->status->value)->toBe('pending');
});

it('an unrelated name gets no warning, and a pending near-name is not a duplicate risk', function () {
    $shelf = pregFixture();
    pregMember($shelf, 'Hoàng Bách', 'pending');       // pending, near nothing
    pregMember($shelf, 'Hoang Bach Khoa', 'pending');  // near the OTHER PENDING one only

    $rows = app(PendingRegistrationsQuery::class)->run();

    // Compared against ACTIVE members only — two pending near-names do not
    // flag each other (the reference's explicit rule).
    foreach ($rows as $row) {
        expect($row['similarTo'])->toBeNull();
    }
});

it('INV-10: another shelf\'s pending applications never appear', function () {
    $shelves = TenantHarness::twoCollidingShelves();
    $b = $shelves['b'];
    $foreignPerson = User::factory()->create(['full_name' => 'Người Xứ Khác']);
    Membership::factory()->for($b)->create(['user_id' => $foreignPerson->id, 'status' => 'pending']);

    TenantHarness::actAs($shelves['a']);
    $rows = app(PendingRegistrationsQuery::class)->run();

    expect(collect($rows)->pluck('fullName')->all())->not->toContain('Người Xứ Khác');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `make test FILTER=NameSimilarity && make test FILTER=PendingRegistrations`
Expected: FAIL — classes not found.

- [ ] **Step 3: Implement**

Create `app/Support/Members/NameSimilarity.php`:

```php
<?php

declare(strict_types=1);

namespace App\Support\Members;

use App\Support\Fold;

/**
 * pg_trgm's similarity(), reimplemented over folded names — divergence 3:
 * MariaDB has no trigram extension, and the reference computed
 * similarity(olibra_fold(a), olibra_fold(b)) in SQL. Same measure, same
 * padding, so the 0.6 threshold keeps its calibration: each word is
 * padded with two leading spaces and one trailing space, split into
 * 3-grams, deduplicated across the whole string; similarity is
 * |intersection| / |union|. Pinned against pg_trgm's own measured value
 * in the unit test (0.714… for the reference's example).
 *
 * Fold::fold first, so "Trần Minh" and "Tran Minh" are identical before
 * any trigram exists — BR §16.3's duplicate catch is precisely about a
 * volunteer typing without diacritics. A warning to a human, never an
 * action: nothing merges, rejects or links on its strength.
 */
final class NameSimilarity
{
    public const float THRESHOLD = 0.6;

    public static function similarity(string $a, string $b): float
    {
        $ta = self::trigrams($a);
        $tb = self::trigrams($b);

        if ($ta === [] || $tb === []) {
            return 0.0;
        }

        $shared = count(array_intersect_key($ta, $tb));
        $union = count($ta + $tb);

        return $shared / $union;
    }

    /** @return array<string, true> */
    private static function trigrams(string $name): array
    {
        $out = [];

        // Fold::fold yields lowercase ASCII [a-z0-9 ] — single-byte, so
        // substr() below counts characters correctly.
        foreach (explode(' ', Fold::fold($name)) as $word) {
            if ($word === '') {
                continue;
            }

            $padded = '  '.$word.' ';
            $len = strlen($padded);
            for ($i = 0; $i + 3 <= $len; $i++) {
                $out[substr($padded, $i, 3)] = true;
            }
        }

        return $out;
    }
}
```

Create `app/Queries/PendingRegistrationsQuery.php`:

```php
<?php

namespace App\Queries;

use App\Enums\MembershipStatus;
use App\Models\Membership;
use App\Support\Members\NameSimilarity;
use App\Support\Members\ParishUnits;

/**
 * GetPendingRegistrations (OPS §3.3): every pending application on the
 * bound shelf, the fields BR §16.3's review card verifies in person —
 * this row shape is the ONE place outside the reader detail that carries
 * DOB, parents and phone, because the card renders exactly them — plus
 * the similar-name warning against ACTIVE members only (a pending
 * applicant is not yet a duplicate risk against another pending one).
 *
 * Oldest first (created_at, id tiebreak). The similarity pass loads the
 * active roster's names once and compares in PHP — divergence 3; at BR
 * §1's few hundred readers this is microseconds, and the day a shelf
 * outgrows it the fix is a folded-trigram table, not a stored counter.
 */
final class PendingRegistrationsQuery
{
    public function __construct(private ParishContextQuery $parish) {}

    /** @return list<array<string, mixed>> */
    public function run(): array
    {
        $context = $this->parish->run();

        $pending = Membership::query()->with('user')
            ->where('status', MembershipStatus::Pending)
            ->whereHas('user')   // a soft-deleted identity is no applicant
            ->orderBy('created_at')->orderBy('id')
            ->get();

        $active = Membership::query()->with('user')
            ->where('status', MembershipStatus::Active)
            ->whereHas('user')
            ->get();

        return $pending->map(function (Membership $m) use ($active, $context): array {
            $best = null;
            foreach ($active as $candidate) {
                if ($candidate->id === $m->id) {
                    continue;
                }
                $score = NameSimilarity::similarity($candidate->user->full_name, $m->user->full_name);
                if ($score >= NameSimilarity::THRESHOLD && ($best === null || $score > $best['similarity'])) {
                    $best = [
                        'membershipId' => $candidate->id,
                        'fullName' => $candidate->user->full_name,
                        'similarity' => $score,
                    ];
                }
            }

            return [
                'membershipId' => $m->id,
                'userId' => $m->user_id,
                'fullName' => $m->user->full_name,
                'saintName' => $m->user->saint_name,
                'dateOfBirth' => $m->user->date_of_birth?->toDateString(),
                'fatherName' => $m->user->father_name,
                'motherName' => $m->user->mother_name,
                'phone' => $m->user->phone,
                'phoneMissingReason' => $m->user->phone_missing_reason,
                'parishLine' => ParishUnits::describeSelection(
                    $context['taxonomy'], $context['units'],
                    $m->parish_unit_l1_id, $m->parish_unit_l2_id,
                ),
                'requestedAt' => $m->created_at->toIso8601String(),
                'similarTo' => $best,
            ];
        })->all();
    }
}
```

`Membership` needs no new relation — `user()` exists. Note `whereHas('user')`: `User` soft-deletes, so the relation's implicit scope is the same `deleted_at is null` join predicate the reference wrote by hand.

- [ ] **Step 4: Run to verify pass**

Run: `make test FILTER=NameSimilarity && make test FILTER=PendingRegistrations`
Expected: PASS — 4 + 4.

- [ ] **Step 5: Lint, analyse, commit**

```bash
git add app/Support/Members/NameSimilarity.php app/Queries/PendingRegistrationsQuery.php tests
git commit -m "feat: trigram similar-name warning and the pending registrations queue shape"
```

---

### Task 12: `ReadersListQuery` and `ReaderDetailQuery` — the roster and the full profile

Read first: `old_next/src/domain/members/queries/get-readers-list.ts` (the two-defect ordering docstring), `get-reader-detail.ts`, and the roster/detail halves of `old_next/tests/domain/members/manager-queries.test.ts`.

**Files:**
- Create: `app/Queries/ReadersListQuery.php`
- Create: `app/Queries/ReaderDetailQuery.php`
- Test: `tests/Feature/Members/ReaderQueriesTest.php`

**Interfaces:**
- Consumes: `full_name_folded` (Task 3), `Fold::fold`, `ParishContextQuery`, `ParishUnits`, `Clock`, `Loan`/`Book`/`BookCopy` models, `ProfileChangeRequest` model (Phase 0 — read-only here; its lifecycle is Phase 3's).
- Produces:
  - `ReadersListQuery::run(array $input): array{rows: list<array{membershipId: string, userId: string, fullName: string, saintName: ?string, status: string, role: string, parishLine: string, holdingCount: int}>, page: int, pageCount: int, total: int, taxonomy: array{levels: int, nested: bool, level1Label: string, level2Label: string}}` — `$input` keys `q?`, `status?`, `role?`, `parishUnitId?`, `page?` (pageSize fixed 24). **Deliberately narrow rows** (Global Constraints: a page never receives a field it does not render): no DOB, no parents, no phone on the roster.
  - `ReaderDetailQuery::run(Membership $membership): array` — the full BR §5.3 manager view: person fields incl. `phoneMissingReason`, `hasCredentials` + `username` (never the hash), membership fields (`managerNotes`, `rejectionReason`, `suspensionReason`, `approvedAt`), `parishLine` + unit names + unit ids (the edit form needs the ids), `currentLoans` (title, copy code, dueOn, isOverdue, daysRemaining — derived via `Clock`, BR §8), `holdingCount`, `pendingProfileChange` (`{id, requestedAt} | null` — display-only until Phase 3).

**Note on the loans read.** The reference read `loans_current` (RLS-scoped). Here `Loan` carries `BookshelfScope`, so `Loan::query()->where('borrower_id', …)` is already this shelf's loans only — no bookshelf join, no hand-written filter. `days_remaining`/`is_overdue` become PHP derivation from `Clock::today()` — spec §4's own row says the views "encode read shapes, not invariants" and land in `app/Queries`; 1c will centralise due-date math in `app/Support/Circulation/` and this query switches to it then (Task 16 records the hand-off in known-gaps).

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Members/ReaderQueriesTest.php`:

```php
<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\ParishUnit;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Queries\ReaderDetailQuery;
use App\Queries\ReadersListQuery;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\Support\TenantHarness;

afterEach(fn () => Carbon::setTestNow());

/** @return array{Bookshelf, ParishUnit, ParishUnit} shelf, l1, l2-under-l1 */
function rosterFixture(): array
{
    $shelf = Bookshelf::factory()->create([
        'slug' => 'dong-thap',
        'settings' => ['parish_taxonomy' => ['levels' => 2, 'nested' => true, 'level1_label' => 'Giáo họ', 'level2_label' => 'Tổ']],
    ]);
    $l1 = ParishUnit::factory()->for($shelf)->create(['level' => 1, 'name' => 'Giáo họ Thánh Tâm']);
    $l2 = ParishUnit::factory()->for($shelf)->create(['level' => 2, 'parent_id' => $l1->id, 'name' => 'Tổ 3']);
    TenantHarness::actAs($shelf);

    return [$shelf, $l1, $l2];
}

function rosterMember(Bookshelf $shelf, string $name, array $memberOver = [], array $userOver = []): Membership
{
    $person = User::factory()->create(array_merge(['full_name' => $name], $userOver));

    return Membership::factory()->for($shelf)->create(array_merge(['user_id' => $person->id, 'status' => 'active'], $memberOver));
}

it('a reader\'s parish line uses the shelf\'s own labels and units, never a hard-coded word', function () {
    [$shelf, $l1, $l2] = rosterFixture();
    rosterMember($shelf, 'Nguyễn Thị Lan', ['parish_unit_l1_id' => $l1->id, 'parish_unit_l2_id' => $l2->id]);

    $page = app(ReadersListQuery::class)->run([]);

    expect($page['rows'][0]['parishLine'])->toBe('Tổ 3 · Giáo họ Thánh Tâm')
        ->and($page['taxonomy']['level1Label'])->toBe('Giáo họ');
});

it('the roster rows carry no DOB, no parents, no phone — the list renders none of them', function () {
    [$shelf] = rosterFixture();
    rosterMember($shelf, 'Nguyễn Thị Lan');

    $row = app(ReadersListQuery::class)->run([])['rows'][0];

    // ONE key per assertion, deliberately: `->not->toHaveKeys([a, b, c])`
    // negates "has ALL of them", so it passes when only ONE is missing —
    // a leaked `phone` beside an absent `dateOfBirth` would go green.
    foreach (['dateOfBirth', 'fatherName', 'motherName', 'phone', 'phoneMissingReason',
        'email', 'managerNotes', 'username', 'passwordHash'] as $forbidden) {
        expect($row)->not->toHaveKey($forbidden, "roster row leaked {$forbidden}");
    }

    // And the whole page, not just row 0 — a serialised sweep catches a
    // field smuggled in under a name this list does not know.
    $serialized = json_encode(app(ReadersListQuery::class)->run([]));
    expect($serialized)->not->toContain('Trẻ em chưa có điện thoại')  // the factory's phoneMissingReason
        ->and($serialized)->not->toContain('Chưa có');                // the factory's father/mother names
});

it('with role reader, the roster excludes managers and admins; unfiltered, it lists them', function () {
    [$shelf] = rosterFixture();
    rosterMember($shelf, 'Bạn Đọc Thường');
    rosterMember($shelf, 'Chị Quản Lý', ['role' => 'manager']);

    $readerOnly = app(ReadersListQuery::class)->run(['role' => 'reader']);
    $all = app(ReadersListQuery::class)->run([]);

    expect(collect($readerOnly['rows'])->pluck('fullName')->all())->toBe(['Bạn Đọc Thường'])
        ->and($all['total'])->toBe(2);
});

it('the status filter narrows, and rejected members are reachable (BR §2 keeps the row)', function () {
    [$shelf] = rosterFixture();
    rosterMember($shelf, 'Đang Hoạt Động');
    rosterMember($shelf, 'Bị Từ Chối', ['status' => 'rejected', 'rejection_reason' => 'lý do']);

    $rejected = app(ReadersListQuery::class)->run(['status' => 'rejected']);

    expect(collect($rejected['rows'])->pluck('fullName')->all())->toBe(['Bị Từ Chối']);
});

it('the parish-unit filter narrows at either level', function () {
    [$shelf, $l1, $l2] = rosterFixture();
    rosterMember($shelf, 'Trong Giáo Họ', ['parish_unit_l1_id' => $l1->id]);
    rosterMember($shelf, 'Trong Tổ', ['parish_unit_l1_id' => $l1->id, 'parish_unit_l2_id' => $l2->id]);
    rosterMember($shelf, 'Chưa Xếp');

    expect(app(ReadersListQuery::class)->run(['parishUnitId' => $l1->id])['total'])->toBe(2)
        ->and(app(ReadersListQuery::class)->run(['parishUnitId' => $l2->id])['total'])->toBe(1);
});

it('the name filter is diacritic-insensitive and a garbage query matches nothing', function () {
    [$shelf] = rosterFixture();
    rosterMember($shelf, 'Trần Minh');
    rosterMember($shelf, 'Lê Ngọc Ánh');

    expect(collect(app(ReadersListQuery::class)->run(['q' => 'tran minh'])['rows'])->pluck('fullName')->all())
        ->toBe(['Trần Minh'])
        // M7's guard: pure punctuation folds to '' and must match nothing,
        // not everything.
        ->and(app(ReadersListQuery::class)->run(['q' => '%%%'])['total'])->toBe(0);
});

it('the roster sorts by folded name, not byte order — seeded in the wrong order on purpose', function () {
    [$shelf] = rosterFixture();
    // Creation order is Vũ, Đặng, An — folded order is An, Đặng(dang), Vũ.
    // Under UUIDv7 an unordered scan returns creation order, so this
    // assertion is falsifiable exactly because the two orders differ
    // (the known-gaps trap this plan's Global Constraints restate).
    rosterMember($shelf, 'Vũ Văn Xuân');
    rosterMember($shelf, 'Đặng Văn Bút');
    rosterMember($shelf, 'An Nguyễn');

    $names = collect(app(ReadersListQuery::class)->run([])['rows'])->pluck('fullName')->all();

    expect($names)->toBe(['An Nguyễn', 'Đặng Văn Bút', 'Vũ Văn Xuân']);
});

it('paging never loses a reader, however alike the names, and pins the id tiebreak mechanism', function () {
    [$shelf] = rosterFixture();
    foreach (range(1, 30) as $i) {
        rosterMember($shelf, 'Nguyễn Văn An');   // 30 identical fold keys
    }

    $seen = [];
    foreach ([1, 2] as $pageNo) {
        $page = app(ReadersListQuery::class)->run(['page' => $pageNo]);
        foreach ($page['rows'] as $row) {
            $seen[] = $row['membershipId'];
        }
    }

    // 24 + 6, no duplicates, none lost.
    expect($seen)->toHaveCount(30)
        ->and(array_unique($seen))->toHaveCount(30);

    // The v7-id tiebreak ALWAYS equals creation order, so no data
    // assertion can falsify its absence (Global Constraints) — pin the
    // mechanism instead: the generated SQL must order by the folded name
    // and THEN the membership id.
    //
    // Capture ONE query, not a concatenation of every query the run emits:
    // a `$sql .= …` accumulator lets `.*full_name_folded.*…id` match across
    // a query boundary (the holding-count query's `borrower_id` satisfies
    // the tail), so the regex would pass with the tiebreak deleted. Isolate
    // the roster SELECT, then match its ORDER BY tail exactly.
    $captured = [];
    DB::listen(function ($query) use (&$captured) { $captured[] = $query->sql; });
    app(ReadersListQuery::class)->run([]);

    $roster = collect($captured)->first(
        fn (string $sql) => str_contains($sql, 'from `memberships`') && str_contains($sql, 'order by'),
    );

    expect($roster)->not->toBeNull('no roster SELECT was captured')
        // Both keys, in this order, and nothing else after them but paging.
        ->and($roster)->toMatch('/order by\s+`users`\.`full_name_folded`\s+asc,\s*`memberships`\.`id`\s+asc\s+limit/i');
});

it('holdingCount is derived on read, and moves with no member command in between', function () {
    [$shelf] = rosterFixture();
    $member = rosterMember($shelf, 'Nguyễn Thị Lan');
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn', 'slug' => 'de-men']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001']);

    expect(app(ReadersListQuery::class)->run([])['rows'][0]['holdingCount'])->toBe(0);

    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $member->user_id, 'lent_by' => $member->user_id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    expect(app(ReadersListQuery::class)->run([])['rows'][0]['holdingCount'])->toBe(1);

    $loan->update(['status' => 'returned']);
    expect(app(ReadersListQuery::class)->run([])['rows'][0]['holdingCount'])->toBe(0);
});

it('the detail carries the manager-only fields BR §5.3 names, and never a password hash', function () {
    [$shelf, $l1] = rosterFixture();
    $member = rosterMember($shelf, 'Nguyễn Thị Lan',
        ['parish_unit_l1_id' => $l1->id, 'manager_notes' => 'Nhà gần nhà xứ'],
        ['date_of_birth' => '2015-04-02', 'phone' => '0912345678', 'phone_missing_reason' => null],
    );
    $person = User::query()->findOrFail($member->user_id);
    $person->username = 'lan.nguyen';
    $person->password_hash = Illuminate\Support\Facades\Hash::make('mat-khau-123');
    $person->save();

    $detail = app(ReaderDetailQuery::class)->run($member);

    expect($detail['dateOfBirth'])->toBe('2015-04-02')
        ->and($detail['fatherName'])->not->toBe('')
        ->and($detail['phone'])->toBe('0912345678')
        ->and($detail['managerNotes'])->toBe('Nhà gần nhà xứ')
        ->and($detail['parishUnitL1Id'])->toBe($l1->id)
        ->and($detail['hasCredentials'])->toBeTrue()
        ->and($detail['username'])->toBe('lan.nguyen')
        ->and(json_encode($detail))->not->toContain($person->fresh()->password_hash);
});

it('a current loan names the book and the copy, with days remaining from the clock', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 03:00:00', 'UTC'));
    [$shelf] = rosterFixture();
    $member = rosterMember($shelf, 'Nguyễn Thị Lan');
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $member->user_id, 'lent_by' => $member->user_id,
        'due_on' => '2026-08-31', 'status' => 'active',
    ]);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $member->user_id, 'lent_by' => $member->user_id,
        'due_on' => '2026-08-20', 'status' => 'returned',
    ]);

    $detail = app(ReaderDetailQuery::class)->run($member);

    expect($detail['currentLoans'])->toHaveCount(1)
        ->and($detail['currentLoans'][0]['title'])->toBe('Dế Mèn Phiêu Lưu Ký')
        ->and($detail['currentLoans'][0]['copyCode'])->toBe('DT-0001')
        ->and($detail['currentLoans'][0]['dueOn'])->toBe('2026-08-31')
        ->and($detail['currentLoans'][0]['isOverdue'])->toBeFalse()
        // 28th in Asia/Ho_Chi_Minh (10:00 local) to the 31st: 3 days.
        ->and($detail['currentLoans'][0]['daysRemaining'])->toBe(3)
        ->and($detail['holdingCount'])->toBe(1);
});

it('an overdue loan is overdue by the parish\'s calendar, not the server\'s', function () {
    // 18:30 UTC on the 30th is already 01:30 on the 31st in Hồ Chí Minh:
    // a loan due on the 30th is overdue THERE and not in UTC.
    Carbon::setTestNow(Carbon::parse('2026-08-30 18:30:00', 'UTC'));
    [$shelf] = rosterFixture();
    $member = rosterMember($shelf, 'Nguyễn Thị Lan');
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn', 'slug' => 'de-men']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $member->user_id, 'lent_by' => $member->user_id,
        'due_on' => '2026-08-30', 'status' => 'active',
    ]);

    $detail = app(ReaderDetailQuery::class)->run($member);

    expect($detail['currentLoans'][0]['isOverdue'])->toBeTrue()
        ->and($detail['currentLoans'][0]['daysRemaining'])->toBe(-1);
});

it('a soft-deleted book or copy still leaves the loan on the reader\'s list', function () {
    [$shelf] = rosterFixture();
    $member = rosterMember($shelf, 'Nguyễn Thị Lan');
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn', 'slug' => 'de-men']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $member->user_id, 'lent_by' => $member->user_id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    $book->delete();
    $copy->delete();

    $detail = app(ReaderDetailQuery::class)->run($member);

    expect($detail['currentLoans'])->toHaveCount(1)
        ->and($detail['currentLoans'][0]['title'])->toBe('Dế Mèn');
});

it('a pending profile change shows as a display-only stub', function () {
    [$shelf] = rosterFixture();
    $member = rosterMember($shelf, 'Nguyễn Thị Lan');
    $request = ProfileChangeRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $member->user_id,
        'proposed_values' => ['phone' => '0999999999'], 'previous_values' => [],
        'status' => 'pending',
    ]);

    $detail = app(ReaderDetailQuery::class)->run($member);

    expect($detail['pendingProfileChange'])->not->toBeNull()
        ->and($detail['pendingProfileChange']['id'])->toBe($request->id);
});

it('INV-10: another shelf\'s readers never appear in the roster', function () {
    $shelves = TenantHarness::twoCollidingShelves();

    TenantHarness::actAs($shelves['a']);
    $page = app(ReadersListQuery::class)->run([]);

    // The harness seeds one identical-named member per shelf; the bound
    // shelf sees exactly one row, not two.
    expect($page['total'])->toBe(1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `make test FILTER=ReaderQueries`
Expected: FAIL — classes not found.

- [ ] **Step 3: Implement**

Create `app/Queries/ReadersListQuery.php`:

```php
<?php

namespace App\Queries;

use App\Models\Loan;
use App\Models\Membership;
use App\Support\Fold;
use App\Support\Members\ParishUnits;

/**
 * GetReadersList (OPS §3.3): the manager's roster — the shelf's own
 * parish line, the live holding count, and the name/status/role/unit
 * filters. Deliberately narrow rows: BR §5.3's manager-only fields (DOB,
 * parents, phone) belong to the DETAIL, and a page must never receive a
 * field it does not render.
 *
 * Ordering is full_name_folded then memberships.id — both halves are the
 * reference's own corrections (U3 wave 1): unfolded, every Đặng sorted
 * after every Vũ; untie-broken, a paged walk lost readers between pages.
 *
 * The holding count is a second, grouped query over the SCOPED Loan model
 * — never a join that would need a hand-written tenant predicate, and
 * never a stored counter (BR §8).
 */
final class ReadersListQuery
{
    private const int PAGE_SIZE = 24;

    public function __construct(private ParishContextQuery $parish) {}

    /**
     * @param  array{q?: ?string, status?: ?string, role?: ?string, parishUnitId?: ?string, page?: int}  $input
     * @return array{rows: list<array<string, mixed>>, page: int, pageCount: int, total: int, taxonomy: array<string, mixed>}
     */
    public function run(array $input): array
    {
        $context = $this->parish->run();
        $page = max(1, (int) ($input['page'] ?? 1));

        $base = Membership::query()
            ->join('users', 'users.id', '=', 'memberships.user_id')
            ->whereNull('users.deleted_at');

        if (($input['role'] ?? null) !== null && $input['role'] !== '') {
            $base->where('memberships.role', $input['role']);
        }
        if (($input['status'] ?? null) !== null && $input['status'] !== '') {
            $base->where('memberships.status', $input['status']);
        }
        if (($input['parishUnitId'] ?? null) !== null && $input['parishUnitId'] !== '') {
            $unit = (string) $input['parishUnitId'];
            $base->where(fn ($w) => $w
                ->where('memberships.parish_unit_l1_id', $unit)
                ->orWhere('memberships.parish_unit_l2_id', $unit));
        }

        $q = trim((string) ($input['q'] ?? ''));
        if ($q !== '') {
            $folded = Fold::fold($q);
            if ($folded === '') {
                // M7: a garbage query behaves like a blank pattern would —
                // by matching NOTHING, not everything.
                $base->whereRaw('1 = 0');
            } else {
                // The fold strips % and _ to spaces, so no LIKE escape is
                // needed — same property SearchQuery relies on.
                $base->where('users.full_name_folded', 'like', '%'.$folded.'%');
            }
        }

        $total = (clone $base)->count();

        $rows = $base
            ->select('memberships.*', 'users.full_name', 'users.saint_name')
            ->orderBy('users.full_name_folded')->orderBy('memberships.id')
            ->forPage($page, self::PAGE_SIZE)
            ->get();

        // The live holding counts, one grouped query over the scoped model.
        $counts = Loan::query()
            ->whereIn('borrower_id', $rows->pluck('user_id'))
            ->where('status', 'active')
            ->selectRaw('borrower_id, count(*) as holding')
            ->groupBy('borrower_id')
            ->pluck('holding', 'borrower_id');

        return [
            'rows' => $rows->map(fn (Membership $m): array => [
                'membershipId' => $m->id,
                'userId' => $m->user_id,
                'fullName' => (string) $m->getAttribute('full_name'),
                'saintName' => $m->getAttribute('saint_name'),
                'status' => $m->status->value,
                'role' => $m->role->value,
                'parishLine' => ParishUnits::describeSelection(
                    $context['taxonomy'], $context['units'],
                    $m->parish_unit_l1_id, $m->parish_unit_l2_id,
                ),
                'holdingCount' => (int) ($counts[$m->user_id] ?? 0),
            ])->all(),
            'page' => $page,
            'pageCount' => max(1, (int) ceil($total / self::PAGE_SIZE)),
            'total' => $total,
            'taxonomy' => [
                'levels' => $context['taxonomy']->levels,
                'nested' => $context['taxonomy']->nested,
                'level1Label' => $context['taxonomy']->level1Label,
                'level2Label' => $context['taxonomy']->level2Label,
            ],
        ];
    }
}
```

Create `app/Queries/ReaderDetailQuery.php`:

```php
<?php

namespace App\Queries;

use App\Enums\LoanStatus;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Support\Clock;
use App\Support\Members\ParishUnits;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\ModelNotFoundException;

/**
 * GetReaderDetail (OPS §3.3): the full BR §5.3 manager view — the
 * manager-only person fields, credentials as a boolean plus the username
 * (never the hash: the username travels only so "Đặt lại mật khẩu" can
 * resubmit it unchanged in a hidden field), the membership's own facts,
 * the loans currently out, and the pending profile change as a
 * display-only stub (its lifecycle is Phase 3's).
 *
 * days-remaining / overdue are derived from Clock::today() at read time
 * (BR §8). 1c will centralise this math in app/Support/Circulation and
 * this query switches to it then — known-gaps carries the hand-off.
 */
final class ReaderDetailQuery
{
    public function __construct(
        private Clock $clock,
        private ParishContextQuery $parish,
    ) {}

    /** @return array<string, mixed> */
    public function run(Membership $membership): array
    {
        $person = User::query()->find($membership->user_id);
        if ($person === null) {
            throw new ModelNotFoundException;   // a soft-deleted identity is no reader
        }

        $context = $this->parish->run();
        $today = CarbonImmutable::parse($this->clock->today());

        $loans = Loan::query()
            ->where('borrower_id', $person->id)
            ->where('status', LoanStatus::Active)
            ->orderBy('due_on')->orderBy('id')
            ->get();

        // withTrashed: a soft-deleted book or copy still leaves the loan
        // on the reader's list — the loan is a fact about the world.
        $books = Book::query()->withTrashed()->whereIn('id', $loans->pluck('book_id'))->get()->keyBy('id');
        $copies = BookCopy::query()->withTrashed()->whereIn('id', $loans->pluck('copy_id'))->get()->keyBy('id');

        $currentLoans = $loans->map(function (Loan $loan) use ($books, $copies, $today): array {
            $due = CarbonImmutable::parse((string) $loan->due_on);

            return [
                'loanId' => $loan->id,
                'bookId' => $loan->book_id,
                'title' => $books[$loan->book_id]->title ?? '',
                'coverUrl' => $books[$loan->book_id]->cover_url ?? null,
                'copyCode' => $copies[$loan->copy_id]->code ?? '',
                'dueOn' => $due->toDateString(),
                'isOverdue' => $due->lessThan($today),
                'daysRemaining' => (int) $today->diffInDays($due, false),
            ];
        })->all();

        $pending = ProfileChangeRequest::query()
            ->where('user_id', $person->id)
            ->where('status', 'pending')
            ->first();

        return [
            'membershipId' => $membership->id,
            'userId' => $person->id,
            'fullName' => $person->full_name,
            'saintName' => $person->saint_name,
            'status' => $membership->status->value,
            'role' => $membership->role->value,
            'dateOfBirth' => $person->date_of_birth?->toDateString(),
            'fatherName' => $person->father_name,
            'motherName' => $person->mother_name,
            'phone' => $person->phone,
            'phoneMissingReason' => $person->phone_missing_reason,
            'email' => $person->email,
            'avatarObject' => $person->avatar_object,
            'hasCredentials' => $person->username !== null,
            'username' => $person->username,
            'managerNotes' => $membership->manager_notes,
            'rejectionReason' => $membership->rejection_reason,
            'suspensionReason' => $membership->suspension_reason,
            'approvedAt' => $membership->approved_at?->toIso8601String(),
            'parishUnitL1Id' => $membership->parish_unit_l1_id,
            'parishUnitL2Id' => $membership->parish_unit_l2_id,
            'parishLine' => ParishUnits::describeSelection(
                $context['taxonomy'], $context['units'],
                $membership->parish_unit_l1_id, $membership->parish_unit_l2_id,
            ),
            'parishUnitL1Name' => ParishUnits::unitName($context['units'], $membership->parish_unit_l1_id),
            'parishUnitL2Name' => ParishUnits::unitName($context['units'], $membership->parish_unit_l2_id),
            'holdingCount' => count($currentLoans),
            'currentLoans' => $currentLoans,
            'pendingProfileChange' => $pending === null
                ? null
                : ['id' => $pending->id, 'requestedAt' => $pending->created_at->toIso8601String()],
        ];
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `make test FILTER=ReaderQueries`
Expected: PASS — all 15. If the `daysRemaining` assertions disagree by sign or one, fix the derivation, not the test — the semantics are the reference's: due minus today in whole days, negative when overdue.

- [ ] **Step 5: Lint, analyse, commit**

```bash
git add app/Queries tests/Feature/Members/ReaderQueriesTest.php
git commit -m "feat: readers roster and reader detail read shapes"
```

---

### Task 13: The public registration screen — the first guest-reachable write path

Read first: `old_next/src/app/dang-ky/page.tsx` and `old_next/src/app/dang-ky/actions.ts` — the form groupings, the Vietnamese copy, the no-shelf chooser, and the phone-confirmation behaviour all come from there.

**Files:**
- Modify: `routes/web.php` (replace the `register` under-construction line; add the POST)
- Modify: `app/Providers/AppServiceProvider.php` (the `register` rate limiter)
- Create: `app/Http/Controllers/RegistrationController.php`
- Create: `app/Http/Requests/Members/RegisterMembershipRequest.php`
- Create: `resources/js/components/parish-unit-fields.tsx`
- Create: `resources/js/components/registration-person-fields.tsx`
- Create: `resources/js/pages/register.tsx`
- Modify: `resources/js/lib/copy.ts` (the `register` block)
- Test: `tests/Feature/Members/RegistrationScreenTest.php`

**Interfaces:**
- Consumes: `RegisterMembership::execute` (Task 6), `ParishContextQuery`, `ParishUnits::options`, `Phone::PATTERN`, `TenantContext::set` (guest binding: membership `null`), `QueryParam::first` (1a).
- Produces:
  - `GET /register` (name `register`) — no `?shelf=`: the chooser (`shelf: null`); with a known active slug: the form props `{shelf: {slug, name}, taxonomy: {levels, nested, level1Label, level2Label}, units: [{id, level, parentId, name}], sent: bool}` — **live units only**, via `ParishUnits::options` (offering is the picker's rule; validating deleted ones is the command's).
  - `POST /register` (name `register.store`, `throttle:register` — open question 3's limiter) — on success redirects to `/register?shelf={slug}&sent=1`, signed in as nobody (the membership is pending; auto-signing-in would loop on the reader gate, the reference's own reasoning).
  - `parish-unit-fields.tsx` — the zero/one/two pickers, labelled with the shelf's OWN level names; Task 14's create form reuses it.
  - `registration-person-fields.tsx` — the *Bản thân* / *Gia đình* field groups both registration forms share (the public form adds the *Đăng nhập* group; the manager form does not — the reference dropped credentials there, `SetReaderCredentials` is that job).

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Members/RegistrationScreenTest.php`:

```php
<?php

use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\ParishUnit;
use App\Models\Scopes\BookshelfScope;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Inertia\Testing\AssertableInertia as Assert;

// The named rate limiter counts EVERY attempt against this suite's one IP,
// and the array cache store survives across tests in one process — without
// this reset, earlier tests' posts would bleed into the throttle test (or
// worse, trip 429s in unrelated tests that run after it).
beforeEach(fn () => Cache::flush());

/** @return Bookshelf a registrable shelf with one live and one deleted unit */
function pubregShelf(): Bookshelf
{
    $shelf = Bookshelf::factory()->create([
        'slug' => 'dong-thap', 'name' => 'Tủ sách Đồng Tháp',
        'settings' => ['parish_taxonomy' => ['levels' => 1, 'nested' => false, 'level1_label' => 'Giáo họ', 'level2_label' => 'Tổ']],
    ]);
    ParishUnit::factory()->for($shelf)->create(['level' => 1, 'name' => 'Giáo họ Thánh Tâm']);
    ParishUnit::factory()->for($shelf)->create(['level' => 1, 'name' => 'Giáo họ Cũ'])->delete();

    return $shelf;
}

/** @return array<string, string> a complete valid POST body */
function pubregBody(array $over = []): array
{
    return array_merge([
        'shelf' => 'dong-thap',
        'saint_name' => 'Maria', 'full_name' => 'Nguyễn Thị Lan',
        'date_of_birth' => '2015-04-02', 'father_name' => 'Nguyễn Văn Hoà',
        'mother_name' => 'Trần Thị Mai', 'phone' => '0912345678',
    ], $over);
}

it('with no shelf named, renders the chooser rather than a form that cannot submit', function () {
    $this->get('/register')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('register')
            ->where('shelf', null));
});

it('with a shelf named, renders the form with that shelf\'s own labels and only its live units', function () {
    pubregShelf();

    $this->get('/register?shelf=dong-thap')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('register')
            ->where('shelf.name', 'Tủ sách Đồng Tháp')
            ->where('taxonomy.level1Label', 'Giáo họ')
            ->has('units', 1)
            ->where('units.0.name', 'Giáo họ Thánh Tâm'));
});

it('an unknown or archived slug gets the chooser, not an existence oracle', function () {
    $archived = Bookshelf::factory()->create(['slug' => 'da-luu-tru', 'status' => 'archived', 'settings' => []]);

    $this->get('/register?shelf=khong-ton-tai')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('shelf', null));

    $this->get('/register?shelf=da-luu-tru')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('shelf', null));
});

it('a guest submits and lands on the sent acknowledgement, with a pending membership behind it', function () {
    $shelf = pubregShelf();

    $this->post('/register', pubregBody())
        ->assertRedirect('/register?shelf=dong-thap&sent=1');

    $membership = Membership::query()->withoutGlobalScope(BookshelfScope::class)
        ->where('bookshelf_id', $shelf->id)->firstOrFail();
    expect($membership->status->value)->toBe('pending')
        ->and($this->app['auth']->guard()->check())->toBeFalse();
});

it('a refusal comes back as the rule sentence, and nothing typed enters the URL', function () {
    pubregShelf();

    $response = $this->from('/register?shelf=dong-thap')
        ->post('/register', pubregBody(['phone' => '']));

    $response->assertRedirect('/register?shelf=dong-thap')
        ->assertSessionHasErrors(['rule' => __('rules.thieu-so-dien-thoai')]);
    expect($response->headers->get('Location'))->not->toContain('Lan');
});

it('a mistyped password confirmation is a field error in Vietnamese', function () {
    pubregShelf();

    $this->post('/register', pubregBody([
        'username' => 'lan', 'password' => 'mat-khau-123', 'password_confirmation' => 'khac-di',
    ]))->assertSessionHasErrors('password');
});

it('an unknown shelf slug on POST is a named refusal', function () {
    $this->post('/register', pubregBody(['shelf' => 'khong-ton-tai']))
        ->assertSessionHasErrors(['rule' => __('rules.shelf_not_found')]);
});

it('a family registering three children in a row is never throttled', function () {
    // The test the per-IP-only design would have failed. Same connection,
    // same phone number, three children, seconds apart — BR §16.1's actual
    // scenario, and it must simply work.
    pubregShelf();

    foreach (['Nguyễn Thị Lan', 'Nguyễn Văn Bình', 'Nguyễn Ngọc Ánh'] as $i => $child) {
        $this->post('/register', pubregBody([
            'full_name' => $child, 'date_of_birth' => '201'.(4 + $i).'-04-02',
        ]))->assertRedirect('/register?shelf=dong-thap&sent=1');
    }

    expect(Membership::query()->withoutGlobalScope(BookshelfScope::class)->count())->toBe(3);
});

it('the register limiter throttles a burst from one host', function () {
    pubregShelf();

    // 30 per minute per IP (open question 3): the 31st is 429. Distinct
    // phones per attempt so the DAY limit (20 per hashed phone) is not what
    // fires — this test is about the burst key, and the assertion would be
    // a lie about which limit caught it.
    foreach (range(1, 30) as $i) {
        $this->post('/register', pubregBody([
            'full_name' => 'Người Số '.$i,
            'phone' => '09'.str_pad((string) $i, 8, '0', STR_PAD_LEFT),
        ]));
    }

    $this->post('/register', pubregBody(['full_name' => 'Người Số 31', 'phone' => '0999999999']))
        ->assertStatus(429);
});

// A signed-in visitor may still open the form (no guest middleware — a
// parent signed in at one shelf registers a child at another). Own it()
// block: the ONLY actingAs in this file, nothing after it.
it('a signed-in visitor may still open the registration form', function () {
    pubregShelf();
    $user = User::factory()->withCredentials('phu-huynh')->create();

    $this->actingAs($user)->get('/register?shelf=dong-thap')->assertOk();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `make test FILTER=RegistrationScreen`
Expected: FAIL — the GET renders `under-construction`, the POST 405s.

- [ ] **Step 3: Implement the server side**

In `routes/web.php`, replace the `register` line in the Public block:

```php
Route::get('/register', [RegistrationController::class, 'create'])->name('register');
Route::post('/register', [RegistrationController::class, 'store'])
    ->middleware('throttle:register')->name('register.store');
```

(import `App\Http\Controllers\RegistrationController`.)

In `app/Providers/AppServiceProvider.php` `boot()`, beside the session extend:

```php
        // Open question 3 (plan header): OPS §8 records RegisterMembership
        // rate limiting as unaddressed in both source documents. This is
        // the infrastructure-level answer, at the edge of the route, not a
        // domain rule. Known-gaps records the decision, and both numbers,
        // as taken on the product owner's behalf.
        //
        // TWO keys on purpose. Per-IP ALONE is wrong here: BR §16.1's
        // scenario is a room of people on one parish connection, so a tight
        // per-IP minute budget throttles the legitimate event and stops no
        // script (addresses rotate; a parish's does not). The day budget is
        // keyed on a HASHED phone number, the shape OPS §8 already specifies
        // for the other guest-open write (SubmitFeedback: 3 per phone per
        // day, hashed, §5.4), falling back to the IP when the phone is blank
        // so the phone-missing-reason route is not an open bypass.
        RateLimiter::for('register', fn (Request $request) => [
            Limit::perMinute(30)->by('ip:'.($request->ip() ?? 'unknown')),
            Limit::perDay(20)->by('reg:'.hash('sha256', (string) (
                $request->string('phone')->trim()->value() ?: 'ip:'.($request->ip() ?? 'unknown')
            ))),
        ]);
```

(imports: `Illuminate\Cache\RateLimiting\Limit`, `Illuminate\Http\Request`, `Illuminate\Support\Facades\RateLimiter`.)

Create `app/Http/Requests/Members/RegisterMembershipRequest.php`:

```php
<?php

namespace App\Http\Requests\Members;

use Illuminate\Foundation\Http\FormRequest;

/**
 * The public form's shape rules. authorize() is true — this is the one
 * open door (the Action's own docstring), and the throttle is the gate.
 * The business rules (phone-or-reason, INV-14's pairing, the parish
 * selection, identity reuse) stay in Registration, which refuses them by
 * OPS §4.3's own codes — this request only keeps garbage shapes out.
 */
class RegisterMembershipRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'shelf' => ['required', 'string', 'max:255'],
            'username' => ['nullable', 'string', 'max:255'],
            'password' => ['nullable', 'string', 'min:8', 'confirmed'],
            'saint_name' => ['required', 'string', 'max:255'],
            'full_name' => ['required', 'string', 'max:255'],
            'date_of_birth' => ['required', 'date_format:Y-m-d'],
            'father_name' => ['required', 'string', 'max:255'],
            'mother_name' => ['required', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:32'],
            'phone_missing_reason' => ['nullable', 'string', 'max:1000'],
            'email' => ['nullable', 'email', 'max:255'],
            'parish_unit_l1_id' => ['nullable', 'string', 'max:36'],
            'parish_unit_l2_id' => ['nullable', 'string', 'max:36'],
        ];
    }
}
```

Create `app/Http/Controllers/RegistrationController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Actions\Members\RegisterMembership;
use App\Exceptions\RuleViolated;
use App\Http\Requests\Members\RegisterMembershipRequest;
use App\Models\Bookshelf;
use App\Queries\ParishContextQuery;
use App\Support\Members\ParishUnits;
use App\Support\QueryParam;
use App\Support\TenantContext;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * The registration surface — /register?shelf={slug}, the shelf chosen at
 * the portal and carried in the query string because this route has no
 * shelf in its path. The tenant is bound HERE, by hand, with a null
 * membership: the guest reading of contextFor, and what lets
 * BookshelfScope, ParishContextQuery and AuditRecorder work on a route
 * outside the shelves/{shelf} group.
 *
 * A stranger naming a different parish's slug registers for that parish
 * and waits for ITS manager — that is what choosing a parish means; an
 * unknown or archived slug is the chooser on GET and shelf_not_found on
 * POST, never an existence oracle.
 */
class RegistrationController extends Controller
{
    public function create(Request $request, TenantContext $context, ParishContextQuery $parish): Response
    {
        $shelf = $this->resolveShelf(QueryParam::first($request, 'shelf'));

        if ($shelf === null) {
            return Inertia::render('register', [
                'shelf' => null, 'taxonomy' => null, 'units' => [], 'sent' => false,
            ]);
        }

        $context->set($shelf, null);
        $parishContext = $parish->run();

        // Live units only: OFFERING is the picker's rule (deleted units
        // stay valid history, but must not be offered — design §7).
        $units = collect([
            ...ParishUnits::options($parishContext['units'], 1),
            ...ParishUnits::options($parishContext['units'], 2),
        ])->map(fn (array $u) => [
            'id' => $u['id'], 'level' => $u['level'],
            'parentId' => $u['parentId'], 'name' => $u['name'],
        ])->values()->all();

        return Inertia::render('register', [
            'shelf' => ['slug' => $shelf->slug, 'name' => $shelf->name],
            'taxonomy' => [
                'levels' => $parishContext['taxonomy']->levels,
                'nested' => $parishContext['taxonomy']->nested,
                'level1Label' => $parishContext['taxonomy']->level1Label,
                'level2Label' => $parishContext['taxonomy']->level2Label,
            ],
            'units' => $units,
            'sent' => QueryParam::first($request, 'sent') === '1',
        ]);
    }

    public function store(RegisterMembershipRequest $request, TenantContext $context, RegisterMembership $register): RedirectResponse
    {
        /** @var array<string, ?string> $validated */
        $validated = $request->validated();

        $shelf = $this->resolveShelf($validated['shelf'] ?? null);
        if ($shelf === null) {
            throw new RuleViolated('shelf_not_found');
        }

        $context->set($shelf, null);
        $register->execute($validated);

        // Not signed in, not to the shelf: the membership is pending and
        // every shelf page would refuse it — a loop on the one journey
        // this form exists to start. ?sent=1 is the acknowledgement.
        return redirect()->route('register', ['shelf' => $shelf->slug, 'sent' => 1]);
    }

    private function resolveShelf(?string $slug): ?Bookshelf
    {
        if ($slug === null || $slug === '') {
            return null;
        }

        return Bookshelf::query()
            ->where('slug', $slug)
            ->where('status', 'active')
            ->first();
    }
}
```

- [ ] **Step 4: Run the server-side tests**

Run: `make test FILTER=RegistrationScreen`
Expected: PASS (the Inertia component `register` does not need to exist for `assertInertia` — the page module is Step 5's).

- [ ] **Step 5: The client side**

Append to `resources/js/lib/copy.ts` (inside the `copy` object — Vietnamese verbatim from `old_next/src/app/dang-ky/page.tsx`, English keys):

```ts
    register: {
        title: "Đăng ký làm bạn đọc",
        lead: "Điền giúp mình vài thông tin. Quản lý tủ sách sẽ gặp và duyệt tài khoản sau lễ Chúa nhật.",
        chooseFirst: "Trước hết, bạn chọn tủ sách của giáo xứ mình nhé.",
        chooseShelf: "Xem danh sách tủ sách",
        forShelf: "Đăng ký cho tủ sách",
        changeShelf: "Chọn tủ sách khác",
        sent: "Đã gửi đăng ký. Quản lý sẽ gặp bạn ở nhà xứ để xác nhận.",
        groupCredentials: "Đăng nhập",
        credentialsNote:
            "Để trống cũng được — bạn chỉ cần tên đăng nhập nếu muốn tự xem sách ở nhà. Quản lý có thể tạo sau.",
        username: "Tên đăng nhập",
        usernameHint: "Dùng để đăng nhập, nên chọn tên dễ nhớ.",
        password: "Mật khẩu",
        passwordHint: "Ít nhất 8 ký tự. Nếu quên, quản lý sẽ đặt lại giúp.",
        passwordConfirm: "Nhập lại mật khẩu",
        groupPerson: "Bản thân",
        saintName: "Tên thánh",
        saintNameHint: "Theo sổ giáo xứ, để quản lý dễ nhận ra bạn.",
        fullName: "Họ và tên",
        fullNameHint: "Ghi đầy đủ như trong sổ giáo xứ.",
        dateOfBirth: "Ngày sinh",
        dateOfBirthHint: "Để tủ sách gợi ý sách hợp tuổi.",
        groupFamily: "Gia đình",
        fatherName: "Tên cha",
        motherName: "Tên mẹ",
        parentHint: "Giúp quản lý phân biệt các bạn đọc trùng tên.",
        phone: "Số điện thoại liên hệ",
        phoneHint: "Số của cha mẹ cũng được. Để trống thì cần cho biết lý do bên dưới.",
        phoneMissingReason: "Lý do chưa có số điện thoại",
        phoneMissingHint: "Ví dụ: em bé chưa có điện thoại riêng, sẽ bổ sung sau.",
        phoneDialogTitle: "Chưa có số điện thoại?",
        phoneDialogBody:
            "Số điện thoại là cách quản lý liên hệ khi sách đến hạn. Nếu chưa có, bạn cho biết lý do nhé.",
        phoneDialogConfirm: "Gửi với lý do này",
        phoneDialogCancel: "Quay lại nhập số",
        groupParish: "Giáo xứ",
        parishNote: "Không bắt buộc. Chưa biết cũng cứ gửi đăng ký — quản lý bổ sung giúp sau khi gặp bạn.",
        noUnit: "— Không chọn —",
        afterTitle: "Sau khi gửi thì sao?",
        afterBody: "Tài khoản chưa dùng được ngay. Quản lý sẽ gặp bạn ở nhà xứ để xác nhận, thường trong vòng một tuần.",
        submit: "Gửi đăng ký",
        haveAccount: "Đã có tài khoản? Đăng nhập",
        required: "Bắt buộc",
    },
```

Create `resources/js/components/parish-unit-fields.tsx`:

```tsx
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/copy";

export interface ParishTaxonomyProp {
    levels: number;
    nested: boolean;
    level1Label: string;
    level2Label: string;
}

export interface ParishUnitProp {
    id: string;
    level: number;
    parentId: string | null;
    name: string;
}

interface Props {
    taxonomy: ParishTaxonomyProp;
    units: ParishUnitProp[];
    l1: string;
    l2: string;
    onChange: (l1: string, l2: string) => void;
}

/**
 * BR §16.1's "zero, one or two pickers depending on what the shelf has
 * configured, each labelled with that shelf's own name for the level" —
 * never the words Tổ or Giáo họ written into the screen. A level with no
 * live units renders no field (no empty select offering only "không
 * chọn"). When nested, the level-2 options follow the chosen parent and
 * a parent change clears a child that no longer belongs.
 */
export default function ParishUnitFields({ taxonomy, units, l1, l2, onChange }: Props) {
    const level1 = units.filter((u) => u.level === 1);
    const level2All = units.filter((u) => u.level === 2);
    const level2 = taxonomy.nested ? level2All.filter((u) => u.parentId === l1) : level2All;
    const showLevel2 = taxonomy.levels === 2 && level2All.length > 0;

    if (level1.length === 0 && !showLevel2) return null;

    const selectClass =
        "h-11 w-full rounded-md border border-input bg-background px-3 text-[15px]";

    return (
        <div className="space-y-6">
            {level1.length > 0 && (
                <div className="space-y-2">
                    <Label htmlFor="parish-l1">{taxonomy.level1Label}</Label>
                    <select
                        id="parish-l1"
                        name="parish_unit_l1_id"
                        className={selectClass}
                        value={l1}
                        onChange={(e) => {
                            const next = e.target.value;
                            const keepChild =
                                !taxonomy.nested ||
                                level2All.some((u) => u.parentId === next && u.id === l2);
                            onChange(next, keepChild ? l2 : "");
                        }}
                    >
                        <option value="">{copy.register.noUnit}</option>
                        {level1.map((u) => (
                            <option key={u.id} value={u.id}>
                                {u.name}
                            </option>
                        ))}
                    </select>
                </div>
            )}
            {showLevel2 && (
                <div className="space-y-2">
                    <Label htmlFor="parish-l2">{taxonomy.level2Label}</Label>
                    <select
                        id="parish-l2"
                        name="parish_unit_l2_id"
                        className={selectClass}
                        value={l2}
                        onChange={(e) => onChange(l1, e.target.value)}
                    >
                        <option value="">{copy.register.noUnit}</option>
                        {level2.map((u) => (
                            <option key={u.id} value={u.id}>
                                {u.name}
                            </option>
                        ))}
                    </select>
                </div>
            )}
        </div>
    );
}
```

Create `resources/js/components/registration-person-fields.tsx`:

```tsx
import InputError from "@/components/input-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/copy";

export interface PersonFieldValues {
    saint_name: string;
    full_name: string;
    date_of_birth: string;
    father_name: string;
    mother_name: string;
    phone: string;
    phone_missing_reason: string;
    email: string;
}

interface Props {
    data: PersonFieldValues;
    errors: Partial<Record<keyof PersonFieldValues, string>>;
    showPhoneReason: boolean;
    setField: (field: keyof PersonFieldValues, value: string) => void;
}

const PHONE_PATTERN = "[+0-9][0-9 .-]{7,13}";

function FieldBlock({
    id, label, hint, required, error, children,
}: {
    id: string;
    label: string;
    hint?: string;
    required?: boolean;
    error?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="space-y-2">
            <Label htmlFor={id}>
                {label}
                {required ? (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {copy.register.required}
                    </span>
                ) : null}
            </Label>
            {children}
            {hint ? <p className="text-[13px] text-muted-foreground">{hint}</p> : null}
            <InputError message={error} />
        </div>
    );
}

/** The Bản thân / Gia đình groups both registration forms share (BR §16.1). */
export default function RegistrationPersonFields({ data, errors, showPhoneReason, setField }: Props) {
    return (
        <>
            <section className="space-y-6">
                <h2 className="border-b pb-3 text-xl font-semibold">{copy.register.groupPerson}</h2>
                <FieldBlock id="saint_name" label={copy.register.saintName} hint={copy.register.saintNameHint} required error={errors.saint_name}>
                    <Input id="saint_name" value={data.saint_name} onChange={(e) => setField("saint_name", e.target.value)} />
                </FieldBlock>
                <FieldBlock id="full_name" label={copy.register.fullName} hint={copy.register.fullNameHint} required error={errors.full_name}>
                    <Input id="full_name" value={data.full_name} onChange={(e) => setField("full_name", e.target.value)} />
                </FieldBlock>
                <FieldBlock id="date_of_birth" label={copy.register.dateOfBirth} hint={copy.register.dateOfBirthHint} required error={errors.date_of_birth}>
                    <Input id="date_of_birth" type="date" value={data.date_of_birth} onChange={(e) => setField("date_of_birth", e.target.value)} />
                </FieldBlock>
            </section>

            <section className="space-y-6">
                <h2 className="border-b pb-3 text-xl font-semibold">{copy.register.groupFamily}</h2>
                <FieldBlock id="father_name" label={copy.register.fatherName} hint={copy.register.parentHint} required error={errors.father_name}>
                    <Input id="father_name" value={data.father_name} onChange={(e) => setField("father_name", e.target.value)} />
                </FieldBlock>
                <FieldBlock id="mother_name" label={copy.register.motherName} hint={copy.register.parentHint} required error={errors.mother_name}>
                    <Input id="mother_name" value={data.mother_name} onChange={(e) => setField("mother_name", e.target.value)} />
                </FieldBlock>
                <FieldBlock id="phone" label={copy.register.phone} hint={copy.register.phoneHint} required error={errors.phone}>
                    <Input id="phone" type="tel" inputMode="numeric" pattern={PHONE_PATTERN} value={data.phone} onChange={(e) => setField("phone", e.target.value)} />
                </FieldBlock>
                {showPhoneReason ? (
                    <FieldBlock id="phone_missing_reason" label={copy.register.phoneMissingReason} hint={copy.register.phoneMissingHint} required error={errors.phone_missing_reason}>
                        <textarea
                            id="phone_missing_reason"
                            rows={3}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-[15px]"
                            value={data.phone_missing_reason}
                            onChange={(e) => setField("phone_missing_reason", e.target.value)}
                        />
                    </FieldBlock>
                ) : null}
            </section>
        </>
    );
}
```

Create `resources/js/pages/register.tsx`:

```tsx
import { Head, Link, useForm, usePage } from "@inertiajs/react";
import { type FormEvent, useState } from "react";
import { route } from "ziggy-js";
import ParishUnitFields, {
    type ParishTaxonomyProp,
    type ParishUnitProp,
} from "@/components/parish-unit-fields";
import RegistrationPersonFields, {
    type PersonFieldValues,
} from "@/components/registration-person-fields";
import InputError from "@/components/input-error";
import { Button } from "@/components/ui/button";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/copy";
import type { SharedData } from "@/types";

interface PageProps extends SharedData {
    shelf: { slug: string; name: string } | null;
    taxonomy: ParishTaxonomyProp | null;
    units: ParishUnitProp[];
    sent: boolean;
}

type RegisterFormValues = PersonFieldValues & {
    shelf: string;
    username: string;
    password: string;
    password_confirmation: string;
    parish_unit_l1_id: string;
    parish_unit_l2_id: string;
};

export default function Register() {
    const { shelf, taxonomy, units, sent, errors } = usePage<PageProps>().props;
    const [confirming, setConfirming] = useState(false);

    const form = useForm<RegisterFormValues>({
        shelf: shelf?.slug ?? "",
        username: "", password: "", password_confirmation: "",
        saint_name: "", full_name: "", date_of_birth: "",
        father_name: "", mother_name: "",
        phone: "", phone_missing_reason: "", email: "",
        parish_unit_l1_id: "", parish_unit_l2_id: "",
    });

    if (!shelf || !taxonomy) {
        return (
            <main className="mx-auto max-w-xl px-6 py-16">
                <Head title={copy.register.title} />
                <h1 className="text-[28px] font-semibold">{copy.register.title}</h1>
                <p className="mt-1.5 text-muted-foreground">{copy.register.chooseFirst}</p>
                <Link href={route("shelves.index")} className="mt-6 inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline">
                    {copy.register.chooseShelf}
                </Link>
            </main>
        );
    }

    const post = () =>
        form.post(route("register.store"), { preserveScroll: true });

    const submit = (event: FormEvent) => {
        event.preventDefault();
        // BR §16.1's danger confirmation: an empty phone needs a typed
        // reason before the form will go. With JS unavailable this handler
        // never runs, the server refuses thieu-so-dien-thoai, and the
        // reason field renders inline — nothing lives only in the dialog.
        if (form.data.phone.trim() === "" && form.data.phone_missing_reason.trim() === "") {
            setConfirming(true);
            return;
        }
        post();
    };

    const ruleError = (errors as Record<string, string>).rule;
    const showPhoneReason =
        form.data.phone.trim() === "" &&
        (form.data.phone_missing_reason !== "" || Boolean(ruleError));

    return (
        <main className="mx-auto max-w-xl px-6 py-16">
            <Head title={copy.register.title} />
            <h1 className="text-[28px] font-semibold">{copy.register.title}</h1>
            <p className="mt-1.5 text-muted-foreground">{copy.register.lead}</p>

            {sent ? (
                <p className="mt-6 rounded-md border bg-muted px-4 py-3 text-[15px]">{copy.register.sent}</p>
            ) : null}
            {ruleError ? (
                <p className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-[15px]">{ruleError}</p>
            ) : null}

            <form onSubmit={submit} className="mt-10 space-y-10" noValidate>
                <section className="space-y-3">
                    <div className="space-y-2">
                        <Label>{copy.register.forShelf}</Label>
                        <p className="rounded-md border bg-muted px-3 py-2 text-[15px]">{shelf.name}</p>
                    </div>
                    <Link href={route("shelves.index")} className="inline-flex min-h-11 items-center text-[14px] underline-offset-4 hover:underline">
                        {copy.register.changeShelf}
                    </Link>
                </section>

                <section className="space-y-6">
                    <h2 className="border-b pb-3 text-xl font-semibold">{copy.register.groupCredentials}</h2>
                    <p className="text-[14px] text-muted-foreground">{copy.register.credentialsNote}</p>
                    <div className="space-y-2">
                        <Label htmlFor="username">{copy.register.username}</Label>
                        <Input id="username" autoComplete="username" value={form.data.username} onChange={(e) => form.setData("username", e.target.value)} />
                        <p className="text-[13px] text-muted-foreground">{copy.register.usernameHint}</p>
                        <InputError message={form.errors.username} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="password">{copy.register.password}</Label>
                        <Input id="password" type="password" autoComplete="new-password" value={form.data.password} onChange={(e) => form.setData("password", e.target.value)} />
                        <p className="text-[13px] text-muted-foreground">{copy.register.passwordHint}</p>
                        <InputError message={form.errors.password} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="password_confirmation">{copy.register.passwordConfirm}</Label>
                        <Input id="password_confirmation" type="password" autoComplete="new-password" value={form.data.password_confirmation} onChange={(e) => form.setData("password_confirmation", e.target.value)} />
                    </div>
                </section>

                <RegistrationPersonFields
                    data={form.data}
                    errors={form.errors}
                    showPhoneReason={showPhoneReason}
                    setField={(field, value) => form.setData(field, value)}
                />

                <section className="space-y-6">
                    <h2 className="border-b pb-3 text-xl font-semibold">{copy.register.groupParish}</h2>
                    <p className="text-[14px] text-muted-foreground">{copy.register.parishNote}</p>
                    <ParishUnitFields
                        taxonomy={taxonomy}
                        units={units}
                        l1={form.data.parish_unit_l1_id}
                        l2={form.data.parish_unit_l2_id}
                        onChange={(l1, l2) => {
                            form.setData("parish_unit_l1_id", l1);
                            form.setData("parish_unit_l2_id", l2);
                        }}
                    />
                </section>

                <div className="rounded-md border bg-muted p-5">
                    <p className="font-semibold">{copy.register.afterTitle}</p>
                    <p className="mt-1.5 text-[15px] text-muted-foreground">{copy.register.afterBody}</p>
                </div>

                <Button type="submit" size="lg" className="w-full" disabled={form.processing}>
                    {copy.register.submit}
                </Button>

                <p className="text-center text-[15px]">
                    <Link href={route("login")} className="font-medium underline-offset-4 hover:underline">
                        {copy.register.haveAccount}
                    </Link>
                </p>
            </form>

            <Dialog open={confirming} onOpenChange={setConfirming}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{copy.register.phoneDialogTitle}</DialogTitle>
                        <DialogDescription>{copy.register.phoneDialogBody}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="dialog-reason">{copy.register.phoneMissingReason}</Label>
                        <textarea
                            id="dialog-reason"
                            rows={3}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-[15px]"
                            value={form.data.phone_missing_reason}
                            onChange={(e) => form.setData("phone_missing_reason", e.target.value)}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirming(false)}>
                            {copy.register.phoneDialogCancel}
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={form.data.phone_missing_reason.trim() === ""}
                            onClick={() => {
                                setConfirming(false);
                                post();
                            }}
                        >
                            {copy.register.phoneDialogConfirm}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </main>
    );
}
```

- [ ] **Step 6: Verify — tests, lint, build**

Run: `make test FILTER=RegistrationScreen` — PASS.
Run: `bun run build` — the page compiles; Biome (`bun run lint`) — no `noJsxLiterals` errors.

- [ ] **Step 7: Commit**

```bash
git add routes/web.php app/Providers/AppServiceProvider.php app/Http tests resources/js
git commit -m "feat: public registration screen with parish pickers and the phone-reason confirmation"
```

---

### Task 14: The manager's roster, the on-behalf form, and the approval queue

Read first: `old_next/src/app/tu-sach/[shelf]/quan-ly/nguoi-doc/page.tsx` (the filter-chip decisions: no invented counts, the `rejected` chip, GET-form controls), `.../nguoi-doc/moi/page.tsx` (why the on-behalf form has no credential and no photograph section), `.../dang-ky-cho-duyet/page.tsx`, and the queue actions in `.../quan-ly/actions.ts:490-535`.

**Files:**
- Modify: `routes/web.php` (replace the `readers.index`, `readers.create`, `registrations` under-construction lines; add `readers.store`, `registrations.approve`, `registrations.reject`)
- Create: `app/Http/Controllers/Manage/ReaderController.php` (this task: `index`, `create`, `store`; Task 15 adds `show`, `updateProfile`)
- Create: `app/Http/Controllers/Manage/RegistrationQueueController.php`
- Create: `app/Http/Requests/Members/RegisterReaderOnBehalfRequest.php`
- Create: `app/Http/Requests/Members/RejectMembershipRequest.php`
- Create: `resources/js/pages/manage/readers/index.tsx`
- Create: `resources/js/pages/manage/readers/create.tsx`
- Create: `resources/js/pages/manage/registrations/index.tsx`
- Modify: `resources/js/lib/copy.ts` (`membershipStatus`, `manageReaders`, `registrationQueue` blocks)
- Test: `tests/Feature/Members/ManageReaderScreensTest.php`
- Test: `tests/Feature/Members/RegistrationQueueScreenTest.php`

**Interfaces:**
- Consumes: `ReadersListQuery`, `PendingRegistrationsQuery`, `ParishContextQuery`, `RegisterMemberOnBehalf`, `ApproveMembership`, `RejectMembership`, `QueryParam::first`, the `['auth', 'role:manager']` route group (guests redirect to login; signed-in non-members 404 — `EnsureShelfRole`'s established behaviour).
- Produces: routes `shelves.manage.readers.index|create|store`, `shelves.manage.registrations|registrations.approve|registrations.reject`; Inertia pages `manage/readers/index`, `manage/readers/create`, `manage/registrations/index`. `store` redirects to `shelves.manage.readers.show` (the new pending reader's detail — Task 15 fills the page; the route name exists since Phase 0).

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Members/ManageReaderScreensTest.php`:

```php
<?php

use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\ParishUnit;
use App\Models\Scopes\BookshelfScope;
use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

/** @return array{Bookshelf, User} */
function mrsFixture(): array
{
    $shelf = Bookshelf::factory()->create([
        'slug' => 'dong-thap',
        'settings' => ['parish_taxonomy' => ['levels' => 1, 'nested' => false, 'level1_label' => 'Giáo họ', 'level2_label' => 'Tổ']],
    ]);
    ParishUnit::factory()->for($shelf)->create(['level' => 1, 'name' => 'Giáo họ Thánh Tâm']);
    $manager = User::factory()->create();
    Membership::factory()->for($shelf)->manager()->create(['user_id' => $manager->id, 'status' => 'active']);

    return [$shelf, $manager];
}

function mrsReader(Bookshelf $shelf, string $name, string $status = 'active'): Membership
{
    $person = User::factory()->create(['full_name' => $name]);

    return Membership::factory()->for($shelf)->create(['user_id' => $person->id, 'status' => $status]);
}

it('renders the roster with rows, the taxonomy labels, and the unit filter options', function () {
    [$shelf, $manager] = mrsFixture();
    mrsReader($shelf, 'Nguyễn Thị Lan');

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/readers")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/readers/index')
            ->has('readers.rows', 1)
            ->where('readers.rows.0.fullName', 'Nguyễn Thị Lan')
            ->where('readers.taxonomy.level1Label', 'Giáo họ')
            ->has('units', 1)
            ->where('filters.status', null));
});

it('filters travel as English query params and repeated keys take their first value', function () {
    [$shelf, $manager] = mrsFixture();
    mrsReader($shelf, 'Đang Hoạt Động');
    mrsReader($shelf, 'Chờ Duyệt', 'pending');

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/readers?status=pending&status[]=active")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->has('readers.rows', 1)
            ->where('readers.rows.0.fullName', 'Chờ Duyệt'));

    // The 1a QueryParam lesson, re-applied: ?status[]=a&status[]=b must
    // degrade to the first value, never 500.
    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/readers?status[]=pending&status[]=active")
        ->assertOk();
});

it('the roster screen is titled Người đọc and shows readers only', function () {
    [$shelf, $manager] = mrsFixture();
    mrsReader($shelf, 'Bạn Đọc Thường');

    // The manager's own membership must not appear in a list built to
    // edit reader profiles directly (post-review fix wave item 1).
    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/readers")
        ->assertInertia(fn (Assert $page) => $page->has('readers.rows', 1));
});

it('the create form carries the shelf\'s pickers and no credential section props', function () {
    [$shelf, $manager] = mrsFixture();

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/readers/create")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/readers/create')
            ->has('units', 1)
            ->where('taxonomy.level1Label', 'Giáo họ'));
});

it('storing on behalf creates a PENDING member and lands on their detail page', function () {
    [$shelf, $manager] = mrsFixture();

    $response = $this->actingAs($manager)->post("/shelves/{$shelf->slug}/manage/readers", [
        'saint_name' => 'Giuse', 'full_name' => 'Trần Minh',
        'date_of_birth' => '2014-09-01', 'father_name' => 'Trần Văn Ba',
        'mother_name' => 'Lê Thị Tư', 'phone' => '0987654321',
    ]);

    $membership = Membership::query()->withoutGlobalScope(BookshelfScope::class)
        ->where('bookshelf_id', $shelf->id)->where('role', 'reader')->firstOrFail();
    expect($membership->status->value)->toBe('pending');
    $response->assertRedirect("/shelves/{$shelf->slug}/manage/readers/{$membership->id}");
});

it('a guest is redirected to login', function () {
    [$shelf] = mrsFixture();

    $this->get("/shelves/{$shelf->slug}/manage/readers")->assertRedirect('/login');
});

it('a signed-in reader 404s on every manager readers route', function () {
    [$shelf] = mrsFixture();
    $reader = mrsReader($shelf, 'Chỉ Là Bạn Đọc');
    $person = User::query()->findOrFail($reader->user_id);

    $this->actingAs($person)->get("/shelves/{$shelf->slug}/manage/readers")->assertNotFound();
});
```

Create `tests/Feature/Members/RegistrationQueueScreenTest.php`:

```php
<?php

use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

/** @return array{Bookshelf, User, Membership} shelf, manager, pending application */
function rqFixture(): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $manager = User::factory()->create();
    Membership::factory()->for($shelf)->manager()->create(['user_id' => $manager->id, 'status' => 'active']);
    $applicant = User::factory()->create([
        'full_name' => 'Trần Minh Đức', 'date_of_birth' => '2014-09-01',
        'father_name' => 'Trần Văn Ba', 'mother_name' => 'Lê Thị Tư',
        'phone' => '0987654321', 'phone_missing_reason' => null,
    ]);
    $pending = Membership::factory()->for($shelf)->create(['user_id' => $applicant->id, 'status' => 'pending']);

    return [$shelf, $manager, $pending];
}

it('renders one review card per pending application, with the fields the manager verifies in person', function () {
    [$shelf, $manager] = rqFixture();

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/registrations")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/registrations/index')
            ->has('applications', 1)
            ->where('applications.0.fullName', 'Trần Minh Đức')
            ->where('applications.0.fatherName', 'Trần Văn Ba')
            ->where('applications.0.phone', '0987654321'));
});

it('the similar-name warning rides the card when an active member is close', function () {
    [$shelf, $manager] = rqFixture();
    $existing = User::factory()->create(['full_name' => 'Tran Minh']);
    Membership::factory()->for($shelf)->create(['user_id' => $existing->id, 'status' => 'active']);

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/registrations")
        ->assertInertia(fn (Assert $page) => $page
            ->where('applications.0.similarTo.fullName', 'Tran Minh'));
});

it('approve moves the application to active and returns to the queue', function () {
    [$shelf, $manager, $pending] = rqFixture();

    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/registrations/{$pending->id}/approve")
        ->assertRedirect();

    expect($pending->fresh()->status->value)->toBe('active')
        ->and($pending->fresh()->approved_by)->toBe($manager->id);
});

it('reject requires a reason, in OPS\'s own sentence, and stores it', function () {
    [$shelf, $manager, $pending] = rqFixture();

    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/registrations/{$pending->id}/reject", ['reason' => ''])
        ->assertSessionHasErrors(['reason' => __('rules.reject_reason_required')]);

    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/registrations/{$pending->id}/reject", ['reason' => 'Chưa gặp được gia đình'])
        ->assertRedirect();

    expect($pending->fresh()->status->value)->toBe('rejected')
        ->and($pending->fresh()->rejection_reason)->toBe('Chưa gặp được gia đình');
});

it('a decided application posted again gets the already-processed sentence', function () {
    [$shelf, $manager, $pending] = rqFixture();
    $pending->update(['status' => 'active']);

    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/registrations/{$pending->id}/approve")
        ->assertSessionHasErrors(['rule' => __('rules.registration_not_pending')]);
});

it('a foreign shelf\'s application 404s by binding, not 403', function () {
    [, $manager, ] = rqFixture();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $foreign = Membership::factory()->for($other)->create(['status' => 'pending']);
    $shelfSlug = 'dong-thap';

    $this->actingAs($manager)
        ->post("/shelves/{$shelfSlug}/manage/registrations/{$foreign->id}/approve")
        ->assertNotFound();
});

it('a guest is redirected to login', function () {
    [$shelf] = rqFixture();

    $this->get("/shelves/{$shelf->slug}/manage/registrations")->assertRedirect('/login');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `make test FILTER=ManageReaderScreens && make test FILTER=RegistrationQueue`
Expected: FAIL — the routes render `under-construction` / 405.

- [ ] **Step 3: Implement the server side**

In `routes/web.php`, inside the manage group, replace the three under-construction lines:

```php
        // ORDER IS LOAD-BEARING (spec §6): create BEFORE {reader}, or
        // Laravel binds "create" as a membership id. RouteOrderTest pins it.
        Route::get('/readers', [ReaderController::class, 'index'])->name('readers.index');
        Route::get('/readers/create', [ReaderController::class, 'create'])->name('readers.create');
        Route::post('/readers', [ReaderController::class, 'store'])->name('readers.store');
        Route::get('/readers/{reader}', [ReaderController::class, 'show'])->name('readers.show');

        Route::get('/registrations', [RegistrationQueueController::class, 'index'])->name('registrations');
        Route::post('/registrations/{reader}/approve', [RegistrationQueueController::class, 'approve'])->name('registrations.approve');
        Route::post('/registrations/{reader}/reject', [RegistrationQueueController::class, 'reject'])->name('registrations.reject');
```

(`ReaderController::show` stays pointing at a method that this task implements as a thin `under-construction` render; Task 15 replaces its body. Import both controllers; `{reader}` resolves to `Membership` via `Bookshelf::readers()` — Task 4.)

Create `app/Http/Requests/Members/RegisterReaderOnBehalfRequest.php`:

```php
<?php

namespace App\Http\Requests\Members;

use App\Models\Membership;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The on-behalf form's shape. No username/password fields AT ALL — the
 * reference's own decision: credentials are SetReaderCredentials' job on
 * the reader detail, and a manager typing a child's registration is not
 * the moment to invent a password nobody will type.
 */
class RegisterReaderOnBehalfRequest extends FormRequest
{
    public function authorize(): bool
    {
        return Gate::allows('create', Membership::class);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'saint_name' => ['required', 'string', 'max:255'],
            'full_name' => ['required', 'string', 'max:255'],
            'date_of_birth' => ['required', 'date_format:Y-m-d'],
            'father_name' => ['required', 'string', 'max:255'],
            'mother_name' => ['required', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:32'],
            'phone_missing_reason' => ['nullable', 'string', 'max:1000'],
            'email' => ['nullable', 'email', 'max:255'],
            'parish_unit_l1_id' => ['nullable', 'string', 'max:36'],
            'parish_unit_l2_id' => ['nullable', 'string', 'max:36'],
        ];
    }
}
```

Create `app/Http/Requests/Members/RejectMembershipRequest.php`:

```php
<?php

namespace App\Http\Requests\Members;

use App\Models\Membership;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class RejectMembershipRequest extends FormRequest
{
    public function authorize(): bool
    {
        $membership = $this->route('reader');

        return $membership instanceof Membership && Gate::allows('reject', $membership);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['reason' => ['required', 'string', 'max:1000']];
    }

    /** @return array<string, string> OPS §4.3's own sentence, not validation.php's generic one */
    public function messages(): array
    {
        return ['reason.required' => __('rules.reject_reason_required')];
    }
}
```

Create `app/Http/Controllers/Manage/ReaderController.php` (this task's three methods plus a stub `show`):

```php
<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Members\RegisterMemberOnBehalf;
use App\Http\Controllers\Controller;
use App\Http\Requests\Members\RegisterReaderOnBehalfRequest;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Queries\ParishContextQuery;
use App\Queries\ReadersListQuery;
use App\Support\Members\ParishUnits;
use App\Support\QueryParam;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

class ReaderController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, ReadersListQuery $list, ParishContextQuery $parish): Response
    {
        Gate::authorize('viewAny', Membership::class);

        $status = QueryParam::first($request, 'status');
        $unit = QueryParam::first($request, 'unit');
        $q = QueryParam::first($request, 'q') ?? '';

        $context = $parish->run();

        return Inertia::render('manage/readers/index', [
            'readers' => $list->run([
                'q' => $q,
                'status' => $status,
                // This screen is "Người đọc" — readers. A shelf's own
                // managers and admins never appear in a roster built to
                // edit reader records (post-review fix wave item 1). The
                // 1c donor picker calls the query WITHOUT this filter.
                'role' => 'reader',
                'parishUnitId' => $unit,
                'page' => (int) (QueryParam::first($request, 'page', '1') ?? '1'),
            ]),
            'units' => collect([
                ...ParishUnits::options($context['units'], 1),
                ...ParishUnits::options($context['units'], 2),
            ])->map(fn (array $u) => ['id' => $u['id'], 'level' => $u['level'], 'name' => $u['name']])->values()->all(),
            'filters' => ['q' => $q, 'status' => $status, 'unit' => $unit],
        ]);
    }

    public function create(Bookshelf $shelf, ParishContextQuery $parish): Response
    {
        Gate::authorize('create', Membership::class);

        $context = $parish->run();

        return Inertia::render('manage/readers/create', [
            'taxonomy' => [
                'levels' => $context['taxonomy']->levels,
                'nested' => $context['taxonomy']->nested,
                'level1Label' => $context['taxonomy']->level1Label,
                'level2Label' => $context['taxonomy']->level2Label,
            ],
            'units' => collect([
                ...ParishUnits::options($context['units'], 1),
                ...ParishUnits::options($context['units'], 2),
            ])->map(fn (array $u) => [
                'id' => $u['id'], 'level' => $u['level'],
                'parentId' => $u['parentId'], 'name' => $u['name'],
            ])->values()->all(),
        ]);
    }

    public function store(RegisterReaderOnBehalfRequest $request, Bookshelf $shelf, RegisterMemberOnBehalf $register): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        /** @var array<string, ?string> $validated */
        $validated = $request->validated();

        $result = $register->execute($user, $validated);

        return redirect()->route('shelves.manage.readers.show', [
            'shelf' => $shelf->slug, 'reader' => $result['membershipId'],
        ]);
    }

    /** Task 15 replaces this body with the real detail render. */
    public function show(Bookshelf $shelf, Membership $reader): Response
    {
        return Inertia::render('under-construction');
    }
}
```

Create `app/Http/Controllers/Manage/RegistrationQueueController.php`:

```php
<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Members\ApproveMembership;
use App\Actions\Members\RejectMembership;
use App\Http\Controllers\Controller;
use App\Http\Requests\Members\RejectMembershipRequest;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Queries\PendingRegistrationsQuery;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

class RegistrationQueueController extends Controller
{
    public function index(Bookshelf $shelf, PendingRegistrationsQuery $queue): Response
    {
        Gate::authorize('viewAny', Membership::class);

        return Inertia::render('manage/registrations/index', [
            'applications' => $queue->run(),
        ]);
    }

    public function approve(Request $request, Bookshelf $shelf, Membership $reader, ApproveMembership $approve): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $approve->execute($user, $reader);

        return redirect()->route('shelves.manage.registrations', ['shelf' => $shelf->slug]);
    }

    public function reject(RejectMembershipRequest $request, Bookshelf $shelf, Membership $reader, RejectMembership $rejectAction): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        /** @var array{reason: string} $validated */
        $validated = $request->validated();

        $rejectAction->execute($user, $reader, $validated['reason']);

        return redirect()->route('shelves.manage.registrations', ['shelf' => $shelf->slug]);
    }
}
```

- [ ] **Step 4: Run the server-side tests**

Run: `make test FILTER=ManageReaderScreens && make test FILTER=RegistrationQueue`
Expected: PASS.

- [ ] **Step 5: The client side**

Append to `resources/js/lib/copy.ts`:

```ts
    membershipStatus: {
        pending: "Chờ duyệt",
        active: "Đang hoạt động",
        suspended: "Tạm khoá",
        left: "Đã rời",
        rejected: "Đã từ chối",
    },
    manageReaders: {
        title: "Người đọc",
        addReader: "Đăng ký người đọc mới",
        searchPlaceholder: "Tìm theo tên…",
        search: "Tìm",
        statusAll: "Tất cả",
        unitAll: "Mọi đơn vị",
        holding: "Đang mượn {count}",
        totalCount: "{count} bạn đọc",
        empty: "Chưa có bạn đọc nào khớp bộ lọc.",
        pagePrev: "Trang trước",
        pageNext: "Trang sau",
        pageOf: "Trang {page}/{pageCount}",
        createTitle: "Đăng ký người đọc mới",
        createLead:
            "Điền thay cho bạn đọc đang đứng trước mặt. Hồ sơ vẫn chờ duyệt để bước xác nhận không bị bỏ qua.",
        createSubmit: "Tạo hồ sơ chờ duyệt",
    },
    registrationQueue: {
        title: "Đăng ký chờ duyệt",
        empty: "Không có đơn đăng ký nào đang chờ.",
        requestedAt: "Gửi lúc {time}",
        dateOfBirth: "Ngày sinh",
        father: "Tên cha",
        mother: "Tên mẹ",
        phone: "Số điện thoại",
        phoneMissing: "Chưa có số — lý do: {reason}",
        parish: "Đơn vị",
        similar: "Gần trùng tên với {name} ({percent}%) — kiểm tra xem có phải đăng ký hai lần.",
        approve: "Duyệt đăng ký",
        reject: "Từ chối",
        rejectReason: "Lý do từ chối",
    },
```

Create `resources/js/pages/manage/registrations/index.tsx`:

```tsx
import { Head, router, usePage } from "@inertiajs/react";
import { useState } from "react";
import { route } from "ziggy-js";
import InputError from "@/components/input-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

interface ApplicationRow {
    membershipId: string;
    fullName: string;
    saintName: string | null;
    dateOfBirth: string | null;
    fatherName: string;
    motherName: string;
    phone: string | null;
    phoneMissingReason: string | null;
    parishLine: string;
    requestedAt: string;
    similarTo: { membershipId: string; fullName: string; similarity: number } | null;
}

interface PageProps extends SharedData {
    applications: ApplicationRow[];
}

function ReviewCard({ application, shelfSlug }: { application: ApplicationRow; shelfSlug: string }) {
    const [reason, setReason] = useState("");
    const { errors } = usePage<PageProps>().props;

    const act = (action: "approve" | "reject") =>
        router.post(
            route(`shelves.manage.registrations.${action}`, { shelf: shelfSlug, reader: application.membershipId }),
            action === "reject" ? { reason } : {},
            { preserveScroll: true },
        );

    const rows: [string, string][] = [
        [copy.registrationQueue.dateOfBirth, application.dateOfBirth ?? "—"],
        [copy.registrationQueue.father, application.fatherName],
        [copy.registrationQueue.mother, application.motherName],
        [
            copy.registrationQueue.phone,
            application.phone ??
                t(copy.registrationQueue.phoneMissing, { reason: application.phoneMissingReason ?? "—" }),
        ],
        [copy.registrationQueue.parish, application.parishLine || "—"],
    ];

    return (
        <article className="rounded-md border p-5">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold">
                    {application.saintName ? `${application.saintName} ${application.fullName}` : application.fullName}
                </h2>
                <span className="text-[13px] text-muted-foreground">
                    {t(copy.registrationQueue.requestedAt, { time: new Date(application.requestedAt).toLocaleDateString("vi-VN") })}
                </span>
            </header>

            {application.similarTo ? (
                <p className="mt-3 rounded-md border border-amber-400/50 bg-amber-50 px-3 py-2 text-[14px] dark:bg-amber-950/30">
                    {t(copy.registrationQueue.similar, {
                        name: application.similarTo.fullName,
                        percent: Math.round(application.similarTo.similarity * 100),
                    })}
                </p>
            ) : null}

            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {rows.map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-4 border-b py-1.5 text-[15px]">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="text-right">{value}</dd>
                    </div>
                ))}
            </dl>

            <div className="mt-5 space-y-3">
                <Button size="lg" className="w-full" onClick={() => act("approve")}>
                    {copy.registrationQueue.approve}
                </Button>
                <div className="space-y-2">
                    <Label htmlFor={`reason-${application.membershipId}`}>{copy.registrationQueue.rejectReason}</Label>
                    <div className="flex gap-2">
                        <Input
                            id={`reason-${application.membershipId}`}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                        />
                        <Button variant="outline" onClick={() => act("reject")}>
                            {copy.registrationQueue.reject}
                        </Button>
                    </div>
                    <InputError message={errors.reason} />
                </div>
            </div>
        </article>
    );
}

export default function RegistrationQueue() {
    const { shelf, applications, errors } = usePage<PageProps>().props;
    if (!shelf) return null;
    const ruleError = (errors as Record<string, string>).rule;

    return (
        <ManageLayout>
            <Head title={copy.registrationQueue.title} />
            <h1 className="mb-4 text-2xl font-semibold">{copy.registrationQueue.title}</h1>
            {ruleError ? (
                <p className="mb-4 rounded-md border px-4 py-3 text-[15px]">{ruleError}</p>
            ) : null}
            {applications.length === 0 ? (
                <p className="text-muted-foreground">{copy.registrationQueue.empty}</p>
            ) : (
                <div className="space-y-4">
                    {applications.map((application) => (
                        <ReviewCard key={application.membershipId} application={application} shelfSlug={shelf.slug} />
                    ))}
                </div>
            )}
        </ManageLayout>
    );
}
```

Create `resources/js/pages/manage/readers/index.tsx`:

```tsx
import { Head, Link, router, usePage } from "@inertiajs/react";
import { type FormEvent, useState } from "react";
import { route } from "ziggy-js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

interface ReaderRow {
    membershipId: string;
    fullName: string;
    saintName: string | null;
    status: keyof typeof copy.membershipStatus;
    parishLine: string;
    holdingCount: number;
}

interface PageProps extends SharedData {
    readers: {
        rows: ReaderRow[]; page: number; pageCount: number; total: number;
        taxonomy: { level1Label: string; level2Label: string };
    };
    units: { id: string; level: number; name: string }[];
    filters: { q: string; status: string | null; unit: string | null };
}

const STATUSES = ["pending", "active", "suspended", "left", "rejected"] as const;

export default function ManageReadersIndex() {
    const { shelf, readers, units, filters } = usePage<PageProps>().props;
    const [q, setQ] = useState(filters.q);
    if (!shelf) return null;

    const indexRoute = (over: Record<string, string | number | null>) =>
        route("shelves.manage.readers.index", {
            shelf: shelf.slug,
            q: filters.q || undefined,
            status: filters.status ?? undefined,
            unit: filters.unit ?? undefined,
            ...over,
        });

    const submitSearch = (event: FormEvent) => {
        event.preventDefault();
        router.get(indexRoute({ q: q || null, page: null }), {}, { preserveState: true });
    };

    return (
        <ManageLayout>
            <Head title={copy.manageReaders.title} />
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-semibold">{copy.manageReaders.title}</h1>
                <Button asChild>
                    <Link href={route("shelves.manage.readers.create", { shelf: shelf.slug })}>
                        {copy.manageReaders.addReader}
                    </Link>
                </Button>
            </div>

            <form onSubmit={submitSearch} className="mb-3 flex flex-wrap gap-2">
                <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={copy.manageReaders.searchPlaceholder}
                    className="max-w-xs"
                />
                <Button type="submit" variant="outline">{copy.manageReaders.search}</Button>
                <select
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={filters.unit ?? ""}
                    onChange={(e) => router.get(indexRoute({ unit: e.target.value || null, page: null }))}
                >
                    <option value="">{copy.manageReaders.unitAll}</option>
                    {units.map((u) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                </select>
            </form>

            {/* No counts on the chips — the reference's own decision: the
                query measures the one filter in force, and an invented
                number mixed into real data is indistinguishable from data. */}
            <div className="mb-4 flex flex-wrap gap-2">
                <Link
                    href={indexRoute({ status: null, page: null })}
                    aria-current={filters.status === null ? "page" : undefined}
                    className={`rounded-full border px-3 py-1 text-sm ${filters.status === null ? "bg-foreground text-background" : ""}`}
                >
                    {copy.manageReaders.statusAll}
                </Link>
                {STATUSES.map((status) => (
                    <Link
                        key={status}
                        href={indexRoute({ status, page: null })}
                        aria-current={filters.status === status ? "page" : undefined}
                        className={`rounded-full border px-3 py-1 text-sm ${filters.status === status ? "bg-foreground text-background" : ""}`}
                    >
                        {copy.membershipStatus[status]}
                    </Link>
                ))}
            </div>

            <p className="mb-3 text-sm text-muted-foreground">
                {t(copy.manageReaders.totalCount, { count: readers.total })}
            </p>

            {readers.rows.length === 0 ? (
                <p className="text-muted-foreground">{copy.manageReaders.empty}</p>
            ) : (
                <ul className="divide-y rounded-md border">
                    {readers.rows.map((row) => (
                        <li key={row.membershipId}>
                            <Link
                                href={route("shelves.manage.readers.show", { shelf: shelf.slug, reader: row.membershipId })}
                                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/50"
                            >
                                <span>
                                    <span className="font-medium">
                                        {row.saintName ? `${row.saintName} ${row.fullName}` : row.fullName}
                                    </span>
                                    {row.parishLine ? (
                                        <span className="ml-2 text-sm text-muted-foreground">{row.parishLine}</span>
                                    ) : null}
                                </span>
                                <span className="flex items-center gap-3 text-sm">
                                    <span>{t(copy.manageReaders.holding, { count: row.holdingCount })}</span>
                                    <Badge variant="outline">{copy.membershipStatus[row.status]}</Badge>
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}

            {readers.pageCount > 1 ? (
                <div className="mt-4 flex items-center gap-3">
                    {readers.page > 1 ? (
                        <Link href={indexRoute({ page: readers.page - 1 })} className="underline-offset-4 hover:underline">
                            {copy.manageReaders.pagePrev}
                        </Link>
                    ) : null}
                    <span className="text-sm text-muted-foreground">
                        {t(copy.manageReaders.pageOf, { page: readers.page, pageCount: readers.pageCount })}
                    </span>
                    {readers.page < readers.pageCount ? (
                        <Link href={indexRoute({ page: readers.page + 1 })} className="underline-offset-4 hover:underline">
                            {copy.manageReaders.pageNext}
                        </Link>
                    ) : null}
                </div>
            ) : null}
        </ManageLayout>
    );
}
```

Create `resources/js/pages/manage/readers/create.tsx`:

```tsx
import { Head, useForm, usePage } from "@inertiajs/react";
import type { FormEvent } from "react";
import { route } from "ziggy-js";
import ParishUnitFields, {
    type ParishTaxonomyProp, type ParishUnitProp,
} from "@/components/parish-unit-fields";
import RegistrationPersonFields, {
    type PersonFieldValues,
} from "@/components/registration-person-fields";
import { Button } from "@/components/ui/button";
import ManageLayout from "@/layouts/manage-layout";
import { copy } from "@/lib/copy";
import type { SharedData } from "@/types";

interface PageProps extends SharedData {
    taxonomy: ParishTaxonomyProp;
    units: ParishUnitProp[];
}

type CreateReaderValues = PersonFieldValues & {
    parish_unit_l1_id: string;
    parish_unit_l2_id: string;
};

export default function CreateReader() {
    const { shelf, taxonomy, units, errors } = usePage<PageProps>().props;

    const form = useForm<CreateReaderValues>({
        saint_name: "", full_name: "", date_of_birth: "",
        father_name: "", mother_name: "",
        phone: "", phone_missing_reason: "", email: "",
        parish_unit_l1_id: "", parish_unit_l2_id: "",
    });

    if (!shelf) return null;
    const ruleError = (errors as Record<string, string>).rule;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(route("shelves.manage.readers.store", { shelf: shelf.slug }));
    };

    // The manager form always shows the phone-reason box once the phone is
    // blank — the volunteer typing IS the person the dialog would ask.
    const showPhoneReason = form.data.phone.trim() === "";

    return (
        <ManageLayout>
            <Head title={copy.manageReaders.createTitle} />
            <h1 className="text-2xl font-semibold">{copy.manageReaders.createTitle}</h1>
            <p className="mt-1.5 max-w-xl text-muted-foreground">{copy.manageReaders.createLead}</p>
            {ruleError ? (
                <p className="mt-4 max-w-xl rounded-md border px-4 py-3 text-[15px]">{ruleError}</p>
            ) : null}

            <form onSubmit={submit} className="mt-8 max-w-xl space-y-10" noValidate>
                <RegistrationPersonFields
                    data={form.data}
                    errors={form.errors}
                    showPhoneReason={showPhoneReason}
                    setField={(field, value) => form.setData(field, value)}
                />
                <section className="space-y-6">
                    <h2 className="border-b pb-3 text-xl font-semibold">{copy.register.groupParish}</h2>
                    <ParishUnitFields
                        taxonomy={taxonomy}
                        units={units}
                        l1={form.data.parish_unit_l1_id}
                        l2={form.data.parish_unit_l2_id}
                        onChange={(l1, l2) => {
                            form.setData("parish_unit_l1_id", l1);
                            form.setData("parish_unit_l2_id", l2);
                        }}
                    />
                </section>
                <Button type="submit" size="lg" className="w-full" disabled={form.processing}>
                    {copy.manageReaders.createSubmit}
                </Button>
            </form>
        </ManageLayout>
    );
}
```

- [ ] **Step 6: Verify — tests, lint, build**

Run: `make test FILTER=ManageReaderScreens && make test FILTER=RegistrationQueue` — PASS.
Run: `bun run build && bun run lint` — clean.

- [ ] **Step 7: Commit**

```bash
git add routes/web.php app/Http resources/js tests
git commit -m "feat: readers roster, on-behalf registration form, and the approval queue screens"
```

---

### Task 15: The reader detail — full profile, administrative actions, credentials, correction

Read first: `old_next/src/app/tu-sach/[shelf]/quan-ly/nguoi-doc/[id]/page.tsx` (the disclosure blocks and which action shows for which status) and the five member action handlers in `.../quan-ly/actions.ts:1340-1520`.

**Files:**
- Modify: `routes/web.php` (the four lifecycle POSTs + the profile PATCH, after `readers.show`)
- Modify: `app/Http/Controllers/Manage/ReaderController.php` (real `show`, add `updateProfile`)
- Create: `app/Http/Controllers/Manage/ReaderLifecycleController.php`
- Create: `app/Http/Requests/Members/SetReaderCredentialsRequest.php`
- Create: `app/Http/Requests/Members/SuspendMembershipRequest.php`
- Create: `app/Http/Requests/Members/UpdateReaderProfileRequest.php`
- Create: `resources/js/pages/manage/readers/show.tsx`
- Modify: `resources/js/lib/copy.ts` (`readerDetail` block)
- Test: `tests/Feature/Members/ReaderDetailScreenTest.php`

**Interfaces:**
- Consumes: `ReaderDetailQuery::run(Membership)` (Task 12's full shape), `SetReaderCredentials`, `SuspendMembership`, `ReactivateMembership`, `MarkMembershipLeft`, `UpdateReaderProfile`, `ParishContextQuery` (the edit form's unit pickers).
- Produces: routes `shelves.manage.readers.credentials|suspend|reactivate|mark-left` (POST) and `shelves.manage.readers.profile.update` (PATCH); page `manage/readers/show` with props `{reader: <ReaderDetailQuery shape>, taxonomy, units}`.

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/Members/ReaderDetailScreenTest.php`:

```php
<?php

use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Inertia\Testing\AssertableInertia as Assert;

/** @return array{Bookshelf, User, Membership, User} shelf, manager, reader membership, reader person */
function rdFixture(string $status = 'active'): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $manager = User::factory()->create();
    Membership::factory()->for($shelf)->manager()->create(['user_id' => $manager->id, 'status' => 'active']);
    $person = User::factory()->create([
        'full_name' => 'Nguyễn Thị Lan', 'date_of_birth' => '2015-04-02',
        'phone' => '0911111111', 'phone_missing_reason' => null,
    ]);
    $membership = Membership::factory()->for($shelf)->create(['user_id' => $person->id, 'status' => $status]);

    return [$shelf, $manager, $membership, $person];
}

it('renders the full profile with manager-only fields and no hash', function () {
    [$shelf, $manager, $membership, $person] = rdFixture();
    $person->username = 'lan.nguyen';
    $person->password_hash = Hash::make('mat-khau-123');
    $person->save();

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/readers/{$membership->id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/readers/show')
            ->where('reader.fullName', 'Nguyễn Thị Lan')
            ->where('reader.dateOfBirth', '2015-04-02')
            ->where('reader.phone', '0911111111')
            ->where('reader.hasCredentials', true)
            ->where('reader.username', 'lan.nguyen')
            ->missing('reader.passwordHash'));
});

it('sets credentials from the detail page', function () {
    [$shelf, $manager, $membership, $person] = rdFixture();

    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/readers/{$membership->id}/credentials", [
            'username' => 'lan.nguyen', 'password' => 'mat-khau-123',
        ])->assertRedirect("/shelves/{$shelf->slug}/manage/readers/{$membership->id}");

    expect($person->fresh()->username)->toBe('lan.nguyen');
});

it('suspend REQUIRES a reason at the screen even though the command\'s is optional', function () {
    [$shelf, $manager, $membership] = rdFixture();

    // The reference's NO_SUSPENSION_REASON: a suspension with no
    // explanation is a decision nobody at the shelf next month can act on
    // — the screen asks before the command ever sees the request, in its
    // own sentence, distinct from reject's.
    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/readers/{$membership->id}/suspend", ['reason' => ''])
        ->assertSessionHasErrors(['reason' => __('rules.suspension_reason_required')]);

    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/readers/{$membership->id}/suspend", ['reason' => 'Mượn quá lâu'])
        ->assertRedirect();

    expect($membership->fresh()->status->value)->toBe('suspended');
});

it('reactivate and mark-left round-trip from the detail page', function () {
    [$shelf, $manager, $membership] = rdFixture('suspended');

    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/readers/{$membership->id}/reactivate")
        ->assertRedirect();
    expect($membership->fresh()->status->value)->toBe('active');

    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/readers/{$membership->id}/mark-left")
        ->assertRedirect();
    expect($membership->fresh()->status->value)->toBe('left');
});

it('corrects the profile with a PATCH, and a stale-state refusal reads as the rule sentence', function () {
    [$shelf, $manager, $membership, $person] = rdFixture();

    $this->actingAs($manager)
        ->patch("/shelves/{$shelf->slug}/manage/readers/{$membership->id}/profile", [
            'saint_name' => 'Maria', 'full_name' => 'Nguyễn Thị Lan',
            'father_name' => $person->father_name, 'mother_name' => $person->mother_name,
            'phone' => '0922222222', 'phone_missing_reason' => '', 'email' => '', 'date_of_birth' => '2015-04-02',
        ])->assertRedirect();
    expect($person->fresh()->phone)->toBe('0922222222');

    // The unchanged resubmission: empty_proposal, as the rule error.
    $this->actingAs($manager)
        ->patch("/shelves/{$shelf->slug}/manage/readers/{$membership->id}/profile", [
            'saint_name' => 'Maria', 'full_name' => 'Nguyễn Thị Lan',
            'father_name' => $person->father_name, 'mother_name' => $person->mother_name,
            'phone' => '0922222222', 'phone_missing_reason' => '', 'email' => '', 'date_of_birth' => '2015-04-02',
        ])->assertSessionHasErrors(['rule' => __('rules.empty_proposal')]);
});

it('a foreign shelf\'s reader detail 404s', function () {
    [, $manager] = rdFixture();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $foreign = Membership::factory()->for($other)->create(['status' => 'active']);

    $this->actingAs($manager)
        ->get('/shelves/dong-thap/manage/readers/'.$foreign->id)
        ->assertNotFound();
});

it('a guest is redirected to login on the detail and every action', function () {
    [$shelf, , $membership] = rdFixture();

    $this->get("/shelves/{$shelf->slug}/manage/readers/{$membership->id}")->assertRedirect('/login');
    $this->post("/shelves/{$shelf->slug}/manage/readers/{$membership->id}/suspend", ['reason' => 'x'])->assertRedirect('/login');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `make test FILTER=ReaderDetailScreen`
Expected: FAIL — `show` renders `under-construction`; the POST routes 404.

- [ ] **Step 3: Implement the server side**

In `routes/web.php`, directly after the `readers.show` line:

```php
        Route::patch('/readers/{reader}/profile', [ReaderController::class, 'updateProfile'])->name('readers.profile.update');
        Route::post('/readers/{reader}/credentials', [ReaderLifecycleController::class, 'setCredentials'])->name('readers.credentials');
        Route::post('/readers/{reader}/suspend', [ReaderLifecycleController::class, 'suspend'])->name('readers.suspend');
        Route::post('/readers/{reader}/reactivate', [ReaderLifecycleController::class, 'reactivate'])->name('readers.reactivate');
        Route::post('/readers/{reader}/mark-left', [ReaderLifecycleController::class, 'markLeft'])->name('readers.mark-left');
```

Create the three Form Requests:

`app/Http/Requests/Members/SetReaderCredentialsRequest.php`:

```php
<?php

namespace App\Http\Requests\Members;

use App\Models\Membership;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class SetReaderCredentialsRequest extends FormRequest
{
    public function authorize(): bool
    {
        $membership = $this->route('reader');

        return $membership instanceof Membership && Gate::allows('setCredentials', $membership);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        // min:8 counts multibyte characters (Laravel measures strings with
        // mb_strlen) — the same code-point rule the Action re-asserts.
        return [
            'username' => ['required', 'string', 'max:255'],
            'password' => ['required', 'string', 'min:8'],
        ];
    }
}
```

`app/Http/Requests/Members/SuspendMembershipRequest.php`:

```php
<?php

namespace App\Http\Requests\Members;

use App\Models\Membership;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The SCREEN requires a reason (the reference's NO_SUSPENSION_REASON);
 * the command's stays optional per OPS §4.3. Divergence 6's split.
 */
class SuspendMembershipRequest extends FormRequest
{
    public function authorize(): bool
    {
        $membership = $this->route('reader');

        return $membership instanceof Membership && Gate::allows('suspend', $membership);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['reason' => ['required', 'string', 'max:1000']];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return ['reason.required' => __('rules.suspension_reason_required')];
    }
}
```

`app/Http/Requests/Members/UpdateReaderProfileRequest.php`:

```php
<?php

namespace App\Http\Requests\Members;

use App\Models\Membership;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * Every field is always sent (the reference's rule): the command decides
 * what counts as a change, so an unedited submission comes back as
 * empty_proposal — the sentence a manager who changed nothing should
 * read. Shape-only here; the named refusals are the Action's.
 */
class UpdateReaderProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        $membership = $this->route('reader');

        return $membership instanceof Membership && Gate::allows('correct', $membership);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'saint_name' => ['nullable', 'string', 'max:255'],
            'full_name' => ['nullable', 'string', 'max:255'],
            'date_of_birth' => ['nullable', 'string', 'max:10'],
            'father_name' => ['nullable', 'string', 'max:255'],
            'mother_name' => ['nullable', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:32'],
            'phone_missing_reason' => ['nullable', 'string', 'max:1000'],
            'email' => ['nullable', 'email', 'max:255'],
        ];
    }
}
```

In `app/Http/Controllers/Manage/ReaderController.php`, replace the stub `show` and add `updateProfile`:

```php
    public function show(Bookshelf $shelf, Membership $reader, ReaderDetailQuery $detail, ParishContextQuery $parish): Response
    {
        Gate::authorize('view', $reader);

        $context = $parish->run();

        return Inertia::render('manage/readers/show', [
            'reader' => $detail->run($reader),
            'taxonomy' => [
                'levels' => $context['taxonomy']->levels,
                'nested' => $context['taxonomy']->nested,
                'level1Label' => $context['taxonomy']->level1Label,
                'level2Label' => $context['taxonomy']->level2Label,
            ],
            'units' => collect([
                ...ParishUnits::options($context['units'], 1),
                ...ParishUnits::options($context['units'], 2),
            ])->map(fn (array $u) => [
                'id' => $u['id'], 'level' => $u['level'],
                'parentId' => $u['parentId'], 'name' => $u['name'],
            ])->values()->all(),
        ]);
    }

    public function updateProfile(UpdateReaderProfileRequest $request, Bookshelf $shelf, Membership $reader, UpdateReaderProfile $update): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $update->execute($user, $reader, $request->validated());

        return redirect()->route('shelves.manage.readers.show', ['shelf' => $shelf->slug, 'reader' => $reader->id]);
    }
```

(add the imports: `App\Actions\Members\UpdateReaderProfile`, `App\Http\Requests\Members\UpdateReaderProfileRequest`, `App\Queries\ReaderDetailQuery`.)

Create `app/Http/Controllers/Manage/ReaderLifecycleController.php`:

```php
<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Members\MarkMembershipLeft;
use App\Actions\Members\ReactivateMembership;
use App\Actions\Members\SetReaderCredentials;
use App\Actions\Members\SuspendMembership;
use App\Http\Controllers\Controller;
use App\Http\Requests\Members\SetReaderCredentialsRequest;
use App\Http\Requests\Members\SuspendMembershipRequest;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;

/**
 * The reader detail's administrative actions — each one Action, one
 * redirect back to the detail (the reference's backToReader).
 */
class ReaderLifecycleController extends Controller
{
    public function setCredentials(SetReaderCredentialsRequest $request, Bookshelf $shelf, Membership $reader, SetReaderCredentials $set): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        /** @var array{username: string, password: string} $validated */
        $validated = $request->validated();

        $set->execute($user, $reader, $validated['username'], $validated['password']);

        return $this->backToReader($shelf, $reader);
    }

    public function suspend(SuspendMembershipRequest $request, Bookshelf $shelf, Membership $reader, SuspendMembership $suspend): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        /** @var array{reason: string} $validated */
        $validated = $request->validated();

        $suspend->execute($user, $reader, $validated['reason']);

        return $this->backToReader($shelf, $reader);
    }

    public function reactivate(Request $request, Bookshelf $shelf, Membership $reader, ReactivateMembership $reactivate): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $reactivate->execute($user, $reader);

        return $this->backToReader($shelf, $reader);
    }

    public function markLeft(Request $request, Bookshelf $shelf, Membership $reader, MarkMembershipLeft $markLeft): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $markLeft->execute($user, $reader);

        return $this->backToReader($shelf, $reader);
    }

    private function backToReader(Bookshelf $shelf, Membership $reader): RedirectResponse
    {
        return redirect()->route('shelves.manage.readers.show', [
            'shelf' => $shelf->slug, 'reader' => $reader->id,
        ]);
    }
}
```

- [ ] **Step 4: Run the server-side tests**

Run: `make test FILTER=ReaderDetailScreen`
Expected: PASS except the `component('manage/readers/show')` assertion until Step 5's page exists — Inertia asserts the component string, not the file, so this passes now too. All green.

- [ ] **Step 5: The client side**

Append to `resources/js/lib/copy.ts`:

```ts
    readerDetail: {
        title: "Hồ sơ bạn đọc",
        holding: "Đang mượn",
        loanDue: "Hạn {date}",
        loanOverdue: "Quá hạn {days} ngày",
        loanDays: "Còn {days} ngày",
        noLoans: "Không mượn cuốn nào.",
        fields: {
            saintName: "Tên thánh",
            fullName: "Họ và tên",
            dateOfBirth: "Ngày sinh",
            fatherName: "Tên cha",
            motherName: "Tên mẹ",
            phone: "Số điện thoại",
            phoneMissingReason: "Lý do chưa có số điện thoại",
            email: "Email",
            parish: "Đơn vị",
        },
        managerNotes: "Ghi chú của quản lý",
        suspensionReason: "Lý do tạm khoá",
        rejectionReason: "Lý do từ chối",
        editProfile: "Sửa hồ sơ",
        editSave: "Lưu thay đổi",
        credentialsTitleNew: "Cấp tài khoản đăng nhập",
        credentialsTitleReset: "Đặt lại mật khẩu",
        credentialsUsername: "Tên đăng nhập",
        credentialsPassword: "Mật khẩu mới",
        credentialsSubmit: "Lưu tài khoản",
        suspend: "Tạm khoá tài khoản",
        suspendNote:
            "Tạm khoá chặn dùng cả tủ sách, không chỉ mượn mới — người đọc vẫn đăng nhập được nhưng không vào được trang nào. Sách đang mượn vẫn giữ nguyên trong hệ thống.",
        suspendReason: "Lý do tạm khoá",
        suspendSubmit: "Tạm khoá",
        reactivate: "Mở khoá lại",
        markLeft: "Đánh dấu đã rời",
    },
```

Create `resources/js/pages/manage/readers/show.tsx`:

```tsx
import { Head, router, useForm, usePage } from "@inertiajs/react";
import { type FormEvent, useState } from "react";
import { route } from "ziggy-js";
import type {
    ParishTaxonomyProp, ParishUnitProp,
} from "@/components/parish-unit-fields";
import InputError from "@/components/input-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

interface CurrentLoan {
    loanId: string;
    title: string;
    copyCode: string;
    dueOn: string;
    isOverdue: boolean;
    daysRemaining: number;
}

interface ReaderDetail {
    membershipId: string;
    fullName: string;
    saintName: string | null;
    status: keyof typeof copy.membershipStatus;
    dateOfBirth: string | null;
    fatherName: string;
    motherName: string;
    phone: string | null;
    phoneMissingReason: string | null;
    email: string | null;
    hasCredentials: boolean;
    username: string | null;
    managerNotes: string | null;
    rejectionReason: string | null;
    suspensionReason: string | null;
    parishLine: string;
    parishUnitL1Id: string | null;
    parishUnitL2Id: string | null;
    holdingCount: number;
    currentLoans: CurrentLoan[];
}

interface PageProps extends SharedData {
    reader: ReaderDetail;
    taxonomy: ParishTaxonomyProp;
    units: ParishUnitProp[];
}

function ValueRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between gap-4 border-b py-1.5 text-[15px]">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right">{value}</dd>
        </div>
    );
}

export default function ReaderShow() {
    const { shelf, reader, errors } = usePage<PageProps>().props;
    const [editing, setEditing] = useState(false);
    if (!shelf) return null;
    const ruleError = (errors as Record<string, string>).rule;

    const act = (name: string, body: Record<string, string> = {}) =>
        router.post(
            route(`shelves.manage.readers.${name}`, { shelf: shelf.slug, reader: reader.membershipId }),
            body,
            { preserveScroll: true },
        );

    const f = copy.readerDetail.fields;

    return (
        <ManageLayout>
            <Head title={copy.readerDetail.title} />
            <div className="mb-1 flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-semibold">
                    {reader.saintName ? `${reader.saintName} ${reader.fullName}` : reader.fullName}
                </h1>
                <Badge variant="outline">{copy.membershipStatus[reader.status]}</Badge>
            </div>
            {reader.parishLine ? <p className="text-muted-foreground">{reader.parishLine}</p> : null}
            {ruleError ? (
                <p className="mt-4 max-w-2xl rounded-md border px-4 py-3 text-[15px]">{ruleError}</p>
            ) : null}
            {reader.suspensionReason ? (
                <p className="mt-4 max-w-2xl rounded-md border border-amber-400/50 bg-amber-50 px-4 py-3 text-[15px] dark:bg-amber-950/30">
                    {copy.readerDetail.suspensionReason}: {reader.suspensionReason}
                </p>
            ) : null}
            {reader.rejectionReason ? (
                <p className="mt-4 max-w-2xl rounded-md border px-4 py-3 text-[15px]">
                    {copy.readerDetail.rejectionReason}: {reader.rejectionReason}
                </p>
            ) : null}

            <div className="mt-8 grid max-w-5xl gap-8 lg:grid-cols-2">
                <section>
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold">{copy.readerDetail.title}</h2>
                        <Button variant="outline" onClick={() => setEditing((v) => !v)}>
                            {copy.readerDetail.editProfile}
                        </Button>
                    </div>
                    {editing ? (
                        <EditProfileForm />
                    ) : (
                        <dl className="mt-4">
                            <ValueRow label={f.saintName} value={reader.saintName ?? "—"} />
                            <ValueRow label={f.fullName} value={reader.fullName} />
                            <ValueRow label={f.dateOfBirth} value={reader.dateOfBirth ?? "—"} />
                            <ValueRow label={f.fatherName} value={reader.fatherName} />
                            <ValueRow label={f.motherName} value={reader.motherName} />
                            <ValueRow label={f.phone} value={reader.phone ?? "—"} />
                            {reader.phone === null && reader.phoneMissingReason ? (
                                <ValueRow label={f.phoneMissingReason} value={reader.phoneMissingReason} />
                            ) : null}
                            <ValueRow label={f.email} value={reader.email ?? "—"} />
                            <ValueRow label={f.parish} value={reader.parishLine || "—"} />
                            {reader.managerNotes ? (
                                <ValueRow label={copy.readerDetail.managerNotes} value={reader.managerNotes} />
                            ) : null}
                        </dl>
                    )}
                </section>

                <section className="space-y-8">
                    <div>
                        <h2 className="text-lg font-semibold">{copy.readerDetail.holding}</h2>
                        {reader.currentLoans.length === 0 ? (
                            <p className="mt-2 text-muted-foreground">{copy.readerDetail.noLoans}</p>
                        ) : (
                            <ul className="mt-2 divide-y rounded-md border">
                                {reader.currentLoans.map((loan) => (
                                    <li key={loan.loanId} className="flex justify-between gap-3 px-4 py-2.5 text-[15px]">
                                        <span>
                                            {loan.title}
                                            <span className="ml-2 text-muted-foreground">{loan.copyCode}</span>
                                        </span>
                                        <span className={loan.isOverdue ? "text-destructive" : "text-muted-foreground"}>
                                            {loan.isOverdue
                                                ? t(copy.readerDetail.loanOverdue, { days: Math.abs(loan.daysRemaining) })
                                                : t(copy.readerDetail.loanDays, { days: loan.daysRemaining })}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <CredentialsForm />

                    <div className="space-y-3">
                        {reader.status === "active" ? <SuspendForm /> : null}
                        {reader.status === "suspended" ? (
                            <Button variant="outline" onClick={() => act("reactivate")}>
                                {copy.readerDetail.reactivate}
                            </Button>
                        ) : null}
                        {reader.status !== "left" ? (
                            <Button variant="outline" onClick={() => act("mark-left")}>
                                {copy.readerDetail.markLeft}
                            </Button>
                        ) : null}
                    </div>
                </section>
            </div>
        </ManageLayout>
    );
}

function EditProfileForm() {
    const { shelf, reader } = usePage<PageProps>().props;
    const form = useForm({
        saint_name: reader.saintName ?? "",
        full_name: reader.fullName,
        date_of_birth: reader.dateOfBirth ?? "",
        father_name: reader.fatherName,
        mother_name: reader.motherName,
        phone: reader.phone ?? "",
        // Pre-filled with what is on file, so resubmitting unchanged
        // preserves an existing reason rather than silently clearing it.
        phone_missing_reason: reader.phoneMissingReason ?? "",
        email: reader.email ?? "",
    });
    if (!shelf) return null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.patch(route("shelves.manage.readers.profile.update", { shelf: shelf.slug, reader: reader.membershipId }), {
            preserveScroll: true,
        });
    };

    const field = (name: keyof typeof form.data, label: string, type = "text") => (
        <div className="space-y-1.5">
            <Label htmlFor={`edit-${name}`}>{label}</Label>
            <Input id={`edit-${name}`} type={type} value={form.data[name]} onChange={(e) => form.setData(name, e.target.value)} />
            <InputError message={form.errors[name]} />
        </div>
    );

    const f = copy.readerDetail.fields;

    return (
        <form onSubmit={submit} className="mt-4 space-y-4">
            {field("saint_name", f.saintName)}
            {field("full_name", f.fullName)}
            {field("date_of_birth", f.dateOfBirth, "date")}
            {field("father_name", f.fatherName)}
            {field("mother_name", f.motherName)}
            {field("phone", f.phone)}
            {form.data.phone.trim() === "" ? field("phone_missing_reason", f.phoneMissingReason) : null}
            {field("email", f.email)}
            <Button type="submit" disabled={form.processing}>{copy.readerDetail.editSave}</Button>
        </form>
    );
}

function CredentialsForm() {
    const { shelf, reader } = usePage<PageProps>().props;
    const form = useForm({
        // The reset form posts the username too, invisibly: the command
        // always writes the pair (INV-14) — there is no password-only
        // variant — so an account that has a username resubmits it from
        // here rather than offering a rename beside a reset.
        username: reader.username ?? "",
        password: "",
    });
    if (!shelf) return null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(route("shelves.manage.readers.credentials", { shelf: shelf.slug, reader: reader.membershipId }), {
            preserveScroll: true,
            onSuccess: () => form.reset("password"),
        });
    };

    return (
        <form onSubmit={submit} className="space-y-3 rounded-md border p-4">
            <h2 className="text-lg font-semibold">
                {reader.hasCredentials ? copy.readerDetail.credentialsTitleReset : copy.readerDetail.credentialsTitleNew}
            </h2>
            {reader.hasCredentials ? (
                <input type="hidden" name="username" value={form.data.username} />
            ) : (
                <div className="space-y-1.5">
                    <Label htmlFor="cred-username">{copy.readerDetail.credentialsUsername}</Label>
                    <Input id="cred-username" value={form.data.username} onChange={(e) => form.setData("username", e.target.value)} />
                </div>
            )}
            <div className="space-y-1.5">
                <Label htmlFor="cred-password">{copy.readerDetail.credentialsPassword}</Label>
                <Input id="cred-password" type="password" autoComplete="new-password" value={form.data.password} onChange={(e) => form.setData("password", e.target.value)} />
            </div>
            <InputError message={form.errors.username ?? form.errors.password} />
            <Button type="submit" variant="outline" disabled={form.processing}>
                {copy.readerDetail.credentialsSubmit}
            </Button>
        </form>
    );
}

function SuspendForm() {
    const { shelf, reader } = usePage<PageProps>().props;
    const form = useForm({ reason: "" });
    if (!shelf) return null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(route("shelves.manage.readers.suspend", { shelf: shelf.slug, reader: reader.membershipId }), {
            preserveScroll: true,
        });
    };

    return (
        <form onSubmit={submit} className="space-y-3 rounded-md border p-4">
            <h2 className="text-lg font-semibold">{copy.readerDetail.suspend}</h2>
            <p className="text-[14px] text-muted-foreground">{copy.readerDetail.suspendNote}</p>
            <div className="space-y-1.5">
                <Label htmlFor="suspend-reason">{copy.readerDetail.suspendReason}</Label>
                <Input id="suspend-reason" value={form.data.reason} onChange={(e) => form.setData("reason", e.target.value)} />
                <InputError message={form.errors.reason} />
            </div>
            <Button type="submit" variant="destructive" disabled={form.processing}>
                {copy.readerDetail.suspendSubmit}
            </Button>
        </form>
    );
}
```

(The `EditProfileForm` does not offer the parish-unit pickers in this pass: the reference's edit disclosure carries the same eight person fields — parish placement changes ride `ApproveProfileChange`'s Phase 3 inputs or the on-behalf form. The `taxonomy`/`units` props stay on the page because the parish LINE renders from them; if the product owner wants placement editable here, `ParishUnitFields` drops in with a two-field addition to `UpdateReaderProfileRequest` — noted in known-gaps.)

- [ ] **Step 6: Verify — tests, lint, build**

Run: `make test FILTER=ReaderDetailScreen` — PASS. `bun run build && bun run lint` — clean.

- [ ] **Step 7: Commit**

```bash
git add routes/web.php app/Http resources/js tests
git commit -m "feat: reader detail screen with credentials, lifecycle actions and profile correction"
```

---

### Task 16: The guarantee sweep — architecture pins, the OPS walk, known-gaps

The 1a Task 14 pattern: after the features land, pin the properties that are decisions rather than code, and write the durable record.

**Files:**
- Create: `tests/Feature/Architecture/MembersArchitectureTest.php`
- Modify: `docs/known-gaps.md` (a `## Phase 1b — Members` section)

**Interfaces:**
- Consumes: everything this plan built.
- Produces: the phase's durable record; 1c reads it before wiring `ManagerRegisterReader`.

- [ ] **Step 1: Write the architecture tests**

Create `tests/Feature/Architecture/MembersArchitectureTest.php`:

```php
<?php

use App\Actions\Members\ManagerRegisterReader;
use Illuminate\Support\Facades\Route;

it('ManagerRegisterReader is wired to NO route — 1c\'s quick-lend is its screen', function () {
    // The DeleteBook precedent: implemented and tested, and adding the
    // route is a DECISION (with the plan-header open question 1 attached),
    // not an accident. No controller may reference the Action at all —
    // stronger than walking the route table, which only sees wired methods.
    $hits = [];
    foreach (glob(app_path('Http/Controllers/{,*/}*.php'), GLOB_BRACE) ?: [] as $file) {
        if (str_contains((string) file_get_contents($file), 'ManagerRegisterReader')) {
            $hits[] = $file;
        }
    }

    expect($hits)->toBe([])
        ->and(class_exists(ManagerRegisterReader::class))->toBeTrue();
});

it('readers/create is declared before readers/{reader}, or "create" binds as an id', function () {
    // Spec §6's route-order rule, the readers half. Matching the literal
    // path must select the create route, not the binding.
    $request = Illuminate\Http\Request::create('/shelves/dong-thap/manage/readers/create', 'GET');
    $route = Route::getRoutes()->match($request);

    expect($route->getName())->toBe('shelves.manage.readers.create');
});

it('only the three sanctioned Actions write a credential or profile column on users', function () {
    // The Laravel form of the reference's INV-13 source walk: profile and
    // credential writes are named, enumerated, and anything new must join
    // this list deliberately.
    $sanctioned = [
        app_path('Actions/Members/Registration.php'),
        app_path('Actions/Members/SetReaderCredentials.php'),
        app_path('Actions/Members/UpdateReaderProfile.php'),
    ];

    $writers = [];
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(app_path()));
    foreach ($files as $file) {
        if (! $file->isFile() || $file->getExtension() !== 'php') {
            continue;
        }
        $source = (string) file_get_contents($file->getPathname());
        // Three write shapes, because the slice uses all three and a
        // regex that only knows the literal-property one would (a) miss
        // UpdateReaderProfile, whose write is `$person->{$field} = …`,
        // and (b) be trivially bypassed by anything spelling it
        // dynamically. Named columns, dynamic properties, and any
        // query-builder update against `users`.
        $writes = preg_match('/->\s*(password_hash|username)\s*=[^=]/', $source) === 1
            || preg_match('/->\s*\{\s*\$\w+\s*\}\s*=[^=]/', $source) === 1
            || preg_match("/DB::table\(\s*'users'\s*\)|User::query\(\)[^;]*->\s*update\(/s", $source) === 1;

        if ($writes) {
            $writers[] = $file->getPathname();
        }
    }

    sort($writers);
    sort($sanctioned);
    expect($writers)->toBe($sanctioned);
});

it('every RuleViolated code thrown by the members slice has a Vietnamese sentence', function () {
    $codes = [];
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(app_path()));
    foreach ($files as $file) {
        if (! $file->isFile() || $file->getExtension() !== 'php') {
            continue;
        }
        if (! str_contains($file->getPathname(), 'Members')) {
            continue;
        }
        preg_match_all("/RuleViolated\\('([a-z0-9_\\-]+)'\\)/", (string) file_get_contents($file->getPathname()), $m);
        foreach ($m[1] as $code) {
            $codes[$code] = true;
        }
    }

    // Plus the codes returned as data rather than thrown directly.
    foreach (['not_active_cannot_suspend', 'not_suspended_cannot_reactivate', 'registration_not_pending',
        'parish_unit_l1_not_found', 'parish_unit_l2_not_found', 'parish_unit_l2_not_in_l1'] as $code) {
        $codes[$code] = true;
    }

    expect($codes)->not->toBe([]);
    foreach (array_keys($codes) as $code) {
        expect(__('rules.'.$code))->not->toBe('rules.'.$code, $code);
    }
});

it('the ten OPS §4.3 commands of this phase exist as final Action classes', function () {
    // The census, pinned: OPS §4.3 has 17 entries — 16 live, 1 retired.
    // These ten are 1b's; the six others are Phase 3's (five
    // profile-change lifecycle + ChangeOwnPassword with the profile page),
    // and UpdateOwnProfile is retired with nothing to port.
    $commands = [
        'RegisterMembership', 'ManagerRegisterReader', 'RegisterMemberOnBehalf',
        'ApproveMembership', 'RejectMembership', 'SuspendMembership',
        'ReactivateMembership', 'MarkMembershipLeft', 'SetReaderCredentials',
        'UpdateReaderProfile',
    ];

    foreach ($commands as $command) {
        $class = 'App\\Actions\\Members\\'.$command;
        expect(class_exists($class))->toBeTrue($command)
            ->and(new ReflectionClass($class)->isFinal())->toBeTrue($command);
    }
});
```

- [ ] **Step 2: Run — fix anything the pins catch**

Run: `make test FILTER=MembersArchitecture`
Expected: PASS. If the credential-writer walk finds an unexpected file, that file is the bug, not the test.

- [ ] **Step 3: Run the FULL suite, lint, analyse, build**

Run: `make test && make lint && make analyse && bun run build && bun run lint`
Expected: everything green — including 1a's suites (nothing here may have disturbed them).

**One required change, not a conditional one.** `tests/Feature/Tenancy/RouteIsolationTest.php` does **not** walk the route table: its cross-shelf 404 test iterates a hard-coded path list — `['manage', 'manage/books', 'manage/lend', 'manage/settings']`. Living inside the guarded manage group therefore buys the new screens **no** isolation coverage. Add both new paths to that list so a manager of shelf A is proved to 404 on shelf B's roster and queue:

```php
    foreach (['manage', 'manage/books', 'manage/lend', 'manage/settings',
        'manage/readers', 'manage/registrations'] as $path) {
```

(The by-id routes — `manage/readers/{reader}` and the four lifecycle POSTs — are covered by the per-Action `INV-10` tests in Tasks 8–10 and Task 15's `a foreign shelf's reader detail 404s`.)

- [ ] **Step 4: Write the durable record**

Append to `docs/known-gaps.md`:

```markdown
## Phase 1b — Members

The durable record of `docs/superpowers/plans/2026-08-28-laravel-phase-1b-members.md`
(registration, approval, reader administration). Written by Task 16 after
the full suite ran green.

- **The no-username identity match has no structural backstop, by design.**
  Two concurrent registrations of the same child (same name/DOB/phone, no
  username) can create two `users` rows: the triple-match in
  `app/Actions/Members/Registration.php` is a plain read with no unique
  index behind it, exactly as the reference shipped. The product's answer
  to duplicate PEOPLE is BR §3's similar-name warning on the approval
  queue, decided by a human who knows the family. The username and
  membership collisions ARE structural (`users_username_key`,
  `memberships_one_per_shelf`, errno 1062 translated by
  `App\Support\UniqueViolation`).
- **`ManagerRegisterReader` is implemented, tested, and reachable from no
  screen.** `MembersArchitectureTest` pins the absence. 1c's quick-lend
  escape hatch is the intended surface — and the plan-header's open
  question 1 (active vs pending) should be re-confirmed with the product
  owner before 1c wires it.
- **`ApproveMembership`/`RejectMembership` write NO notification rows yet.**
  The reference writes `membership_approved`/`membership_rejected` inside
  the command transaction (OPS §7). Phase 2 must add both writes when the
  notification system lands — the Actions carry the same note.
- **`POST /register` is throttled on two keys, both numbers invented here**
  — 30/minute per IP (burst) and 20/day per SHA-256 of the submitted phone,
  falling back to the IP when the phone is blank. A decision taken on the
  product owner's behalf: OPS §8 (:1158) lists `RegisterMembership` rate
  limiting as unaddressed in both source documents. The per-day/hashed key
  is modelled on OPS §8's only stated limit (`SubmitFeedback`, 3 per phone
  per day, hashed); a per-IP-only limiter was rejected because BR §16.1's
  scenario is a room of people behind one parish connection. The limiter is
  named `register` in `AppServiceProvider`; loosening the burst limit is the
  first thing to try if a real registration event trips it.
- **`already_registered_here` is an existence oracle on the public form.**
  A stranger who knows a child's exact name, date of birth and phone learns
  whether that child is registered at this shelf. It reveals membership but
  never status (suspended, pending and active all answer identically — a
  consequence of CRITICAL 1's walk-back fix). Inherited from the reference,
  which addresses the *username* probe channel only. Closing it would mean
  dropping the no-username triple-match, which is how BR §5.3's cross-shelf
  identity reuse works for the majority of readers who have no username.
- **Public registration answers `GetParishUnits` to guests**, a query OPS
  §3.2 lists as `reader`-gated and flags with its own open question (:75).
  Live units only, and a parish's list of `Giáo họ` is not personal data —
  but it is a documented gate this plan chose to open.
- **`ReactivateMembership` has a button that the reference never had**
  (OPS:443: "no visible 'Kích hoạt lại' button anywhere in the 47 screens").
  Added on the reader detail because BR §7.5 draws the suspend arrow both
  ways and a suspension with no way back is a trap.
- **`member_has_active_loans`' Vietnamese sentence is authored by this
  plan.** OPS:453 names the code in prose and supplies no sentence, and
  `has_active_loans` was unavailable — 1a already holds that key for a
  sentence about a book. Five other refusal codes follow the reference's
  `errors.ts` spelling rather than OPS §4.3's abbreviations; the mapping
  table is in the plan header's divergence 6.
- **The reader profile page, `GetMyProfile` and `ChangeOwnPassword` are
  deferred to Phase 3 whole**, with the profile-change lifecycle they
  share a screen with (the 1a GetShelfHome precedent). A reader's only
  password path until then is the volunteer (`SetReaderCredentials`),
  which is BR §2's model anyway.
- **`ReaderDetailQuery` derives days-remaining/overdue locally.** 1c must
  move the due-date math to `app/Support/Circulation/` and point this
  query at it — two definitions of "overdue" is the drift BR §8 exists to
  prevent, and this one is temporary by declared intent.
- **There is no `assertNoSecrets` audit walker.** The reference's kernel
  walked every audit bag for hash-shaped values; here the no-secret rule
  is held by `SetReaderCredentialsTest`'s row assertions only. If a later
  phase adds an audit helper, port the walker there.
- **The reader-detail edit form does not offer parish-unit placement.**
  OPS §4.3's UpdateReaderProfile inputs are person fields only; placement
  is set at registration (on-behalf form) and by Phase 3's
  ApproveProfileChange (which carries the two unit ids for exactly this).
  If the product owner wants direct placement editing, it is a two-field
  addition to `UpdateReaderProfileRequest` + `ParishUnitFields` on the
  form — but it would need its own OPS entry, since no command currently
  sanctions it.
- **The concurrency variants of the reference's tests did not port**
  (two-connection probes cannot see `RefreshDatabase` fixtures — 1a
  divergence 2's reasoning). The mechanism is pinned instead: every
  lifecycle command's first statement is `lockForUpdate()` on the
  membership row (divergence 1), and `ReaderQueriesTest` pins the roster's
  ORDER BY clause because the UUIDv7 id tiebreak cannot be falsified by
  data seeded in creation order.
```

- [ ] **Step 5: Commit**

```bash
git add tests/Feature/Architecture/MembersArchitectureTest.php docs/known-gaps.md
git commit -m "test: members architecture pins and the phase 1b durable record"
```

---

## Self-review (performed while writing; recorded so the executor can re-check)

1. **Spec coverage.** OPS §4.3's ten in-scope commands ↔ Tasks 6–10 (census pinned by Task 16); OPS §3.3's three in-scope queries ↔ Tasks 11–12; BR §16.1 registration ↔ Task 13; BR §16.3 Readers/Pending-registrations ↔ Tasks 14–15; BR §5.6 taxonomy reads ↔ Task 2; BR §12 folding for the roster ↔ Task 3; BR §13.2 Members permission set ↔ Task 4; spec §5's three tenancy layers ↔ scoped models + `MembershipPolicy` + the composite FKs already in place (Phase 0); spec §7 copy conventions ↔ every screen task. Deliberate exclusions are censused in the header with owning phases.
2. **Placeholder scan.** No TBDs; every step carries literal code or an exact command. The one generated artifact a step does not inline is the folded-column DDL, which the migration emits from `FoldExpression::sql()` at migrate time — the same mechanism Phase 0's books migration froze, not a placeholder.
3. **Type consistency.** `Registration::register(array, MembershipStatus, ?User): array{userId, membershipId}` is consumed with that exact shape in Tasks 6, 7; `MembershipTransitions::check/assert` as declared in Task 1 is used in Tasks 6, 8; `ParishUnits::validateSelection(ParishTaxonomy, array, ?string, ?string): ?string` consistent across Tasks 2, 6; `ReaderDetailQuery::run(Membership): array` matches Task 15's controller; policy ability names (`viewAny/view/create/approve/reject/suspend/reactivate/markLeft/setCredentials/correct`) match every `Gate::authorize`/`Gate::allows` call site and the Form Requests.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-28-laravel-phase-1b-members.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks (superpowers:subagent-driven-development).

**2. Inline Execution** — execute tasks in one session with checkpoints (superpowers:executing-plans).

