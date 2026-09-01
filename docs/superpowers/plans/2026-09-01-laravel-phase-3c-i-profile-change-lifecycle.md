# Implementation plan: Phase 3c-i — the profile-change lifecycle

Spec: `docs/superpowers/specs/2026-09-01-laravel-phase-3c-i-profile-change-lifecycle-design.md`
Branch: `feat/phase-3c-oversight-and-feedback`, cut from `main` at `b0a0d2c`

## Context for whoever picks this up

OLibra is a Vietnamese parish lending-library system being ported from Next.js to
Laravel + Inertia + React. `old_next/` is a **read-only** behavioural reference —
never write to it. Phases 0–3b shipped everything up to shelf administration,
system settings and the public contact page.

This phase builds the **profile-change lifecycle**: a reader can finally see
their own record and ask for it to be corrected. BR:83 — *"Changing your own
details is a request, not an edit."* A proposal changes nothing until a manager
approves it, and the phone in particular keeps working mid-change so a manager
never loses the means of contacting a family.

**Read the spec.** Thirteen decisions, and three of them reversed during review
because the obvious reading was wrong:

- **Proposing again MERGES into the pending request** — it is not refused, and
  not a wholesale replace. BR's own wording says "replaces"; the shipped
  behaviour is a field-wise merge, a deliberate product reading. D1.
- **Cancelling IS governed by the decision rule.** Any manager or above may
  cancel any request and the subject-role rule then applies; only the *self* case
  is exempt. The reference records fixing the opposite as a defect. D4.
- **`previous_values` is captured at PROPOSAL time.** The column is NOT NULL, so
  a row cannot be inserted otherwise. D3.

### The six Action classes this phase adds

`MembersArchitectureTest:157-160`'s comment fixes this phase's contribution at
six, so name them rather than inventing them:

| class | task |
|---|---|
| `app/Actions/Admin/ProposeProfileChange.php` | 2 |
| `app/Actions/Admin/ApproveProfileChange.php` | 3 |
| `app/Actions/Admin/RejectProfileChange.php` | 3 |
| `app/Actions/Admin/CancelProfileChange.php` | 4 |
| `app/Actions/Admin/ChangeOwnPassword.php` | 7 |
| `app/Actions/Admin/ProposeAvatarChange.php` | 8 |

They live in `app/Actions/Admin/` because spec D10 forces it — not because they
are administrative.

### Locking: `lockForUpdate()` on the subject's **users** row, first

The spec writes `FOR NO KEY UPDATE`, which is **Postgres**. This port is MariaDB
10.11; the idiom is `->lockForUpdate()`.

And "match `UpdateReaderProfile`'s lock position" means *match the discipline*,
not the target: that test
(`tests/Feature/Members/UpdateReaderProfileTest.php:181-192`) asserts its first
query is on `memberships`. **These commands lock the subject's `users` row
first**, before any read of `profile_change_requests`.

### The rule this phase exists to get right

Who may decide is derived from the **subject's** role, not the viewer's, and it
has three independent ways to be subtly wrong (D2):

1. The subject's role is read **at decision time**, not proposal time.
2. Self-decision is refused **at every rank, super administrator included**.
3. The decide comparison is on **`user_id`**, not membership id — a person on two
   shelves is one person. (Cancel differs: its self-check compares membership id.)

Half of it already exists: `UpdateReaderProfile.php:64-67` carries the
subject-role half. What is new is point 3 — that check does not stop a *reader*
deciding their own proposal, because a reader's role is not `manager`.

### Environment, and the six gates

`AGENTS.md` has the detail. Short version: never run `pint` or `php` on the host;
`npm run build` builds the read-only `old_next` (use `npm run laravel:build`); and
**run all six gates CI runs before claiming done** — `pint --test`,
`phpstan analyse`, `npm run laravel:lint` (Biome, the one people forget),
`laravel:typecheck`, `laravel:build`, `php artisan test`.

### Pins this phase will hit

Spec §6 lists ten. The two that will bite hardest:

- **`MembersArchitectureTest:74`** — *"only the three sanctioned Actions write a
  credential or profile column on users"*, an exact list. `ApproveProfileChange`
  writes profile columns and `ChangeOwnPassword` writes a credential, so **that
  list must be amended deliberately** in the task that adds each.
- **`RuleViolatedCodesHaveSentencesTest`** globs the whole of `app/` and asserts
  set-equality, so every new refusal code needs its `lang/vi/rules.php` sentence
  **and** its list entry in the same commit.

**The refusal census is blind to a ternary.**
`RuleViolatedCodesHaveSentencesTest:55` matches
`/new RuleViolated\(\s*['"]([a-z0-9_-]+)['"]\s*[,)]/` — a first argument that is
an expression is invisible, so `new RuleViolated($tooBig ? 'a' : 'b')` registers
neither code. Write two literal throws. 3b-ii hit this exact shape.

**Which censuses strip comments, precisely:** `AuditActionCensusTest` runs
`token_get_all`/`stripCommentTokens` and is comment-safe.
`WideningArchitectureTest` and `MembersArchitectureTest` read **raw** source and
are not. So the two fences that read raw file contents have **no comment
stripping** — do not spell
`->forShelf(`, `->global(`, a where-shaped call, or `new RuleViolated('code')`
inside a comment. 3b-ii turned a docblock example into a censused code that way.

### Audit actions land with their writers

Five new, **58 → 63**, all in the existing `readers` group — no new group. Each
lands in the same task as the code that writes it; the census asserts
set-equality **both ways**, so a registered action with no writer is red. The
count pin is `tests/Unit/Audit/AuditSentencesTest.php:435`; the group partition
is `:427-434`. `AuditActionCensusTest` has the set-equality and the
computed-name ban but **no count**. `AuditSentences::phrase()` is private —
assert through the public `sentence()`.

### House rule: mandatory falsification

Every test is **watched failing before it is accepted** — mutate what it
protects, see red, restore, confirm `git status --porcelain` is clean. **Restore
by targeted edit, never `git checkout -- <file>`.** And Pest's `toContain` takes
no message argument (`AGENTS.md`) — `->not->toContain($x, $msg)` passes
unconditionally.

---

## Task 1 — The reader can see their own record

Spec D7, D11. No audit actions.

1. **A self-view ability.** `MembershipPolicy`'s docblock (`:20-30`) is a standing
   instruction to this phase: *"DO NOT wire `view()` above to a reader's own
   profile page… That self-view ability is Phase 3's."* Add the ability it
   describes, gated `requireSelfOrManager`-style. `PolicyRegistrationTest`
   requires every policy to resolve to a model.
2. **`GetMyProfile`** (`OPERATIONS.md:67`) and **`GetMyProfileChangeRequest`**
   (`:68`) — two named OPS operations. Note `MembershipPolicy`'s own docblock
   cites `:69` for the first; **that citation is stale** (`:69` is
   `GetMyNotifications`). Trust these numbers, not the docblock's.
3. **The page** at `routes/web.php:236`, replacing `underConstruction`.

**Two rendering contracts, both required:**

- **The most recent request of ANY status**, not pending-only.
  `ReaderDetailQuery.php:98-100` filters `status = 'pending'`; that shape is
  wrong here, because this page is where a reader learns they were **rejected**
  and reads the reason.
- **Units render through the shelf's own labels** — `level1_label` /
  `level2_label` from `ParishTaxonomy`, never the words `Tổ` or `Giáo họ`
  (BR:247, BR:578). This is the first reader-side consumer of the shape 3b-ii
  made editable.
- **BR:544** — show *"the current value with the pending one beside it, and say
  plainly that it is waiting."* A page showing only one side satisfies the query
  and fails the requirement.

**Tests:** a reader sees their own and not another's; a rejected request and its
reason are visible; units carry the shelf's labels; pending renders beside
current.

**Falsify:** filter the query to pending-only and watch the rejected-request test
go red.

---

## Task 2 — Proposing

Spec D1, D5. Adds `profile_change.proposed` (58 → 59).

**Proposing again merges into the pending row** — same request id, field-wise.
`mergeProposal` snapshots `previous` only for the **incoming** fields and does
not re-snapshot fields already pending, "because that is the moment its
`previous` describes".

**`previous_values` is written at proposal time.** The column is NOT NULL.

**The unique constraint is not the second-proposal guard.**
`pending_user_id` is generated (`IF(status = 'pending', user_id, NULL)`) with a
UNIQUE index. It guards the case the tenant-scoped SELECT cannot see: **a person
with memberships at two shelves**. Its refusal is `change_already_pending`.

**Proposing is not reader-only** — any manager or above may propose on another's
behalf (`requireSelfOrManager`).

**Pin `avatar_object` OUT of this task's FormRequest.** It is already one of
`ProfileFields`' nine (`ProfileFields.php:25`), normalised as a plain trimmed
string with no validation — so piping the request body through `normalisePatch`
would let a reader point their avatar at **any storage key**.
`RegistrationController.php:94` records the same rule for guests. Task 8 sets
that column through its own path and never revisits this request class, so the
guard has to be here.

**And the read side needs its own guard, which Task 1 found.** `avatar_object`
being one of the nine means a proposal may name it, and a generic
`{label}: {value}` row would print a **storage key** on the reader's own page.
Task 1 renders a bare label for that field instead. Any screen this task or a
later one adds that lists proposed fields must do the same until Task 8 replaces
the label with the two photographs.

**Saint name is mandatory** (BR:87); `ProfileFields::normalisePatch` already
raises `required_fields_missing` for a blank one (`:59-61`). **The phone/reason
pair** already exists inline at `UpdateReaderProfile.php:88-94` — auto-clear at
`:89-91`, refusal `thieu-so-dien-thoai` at `:92-94`. There is **no
`assertPhoneOrReason` helper**; do not go looking for one.

**Tests:** a second proposal merges rather than refusing; `previous` is untouched
for fields already pending; a person on two shelves gets `change_already_pending`
from the second; a blank saint name is refused.

**Falsify:** make the second proposal insert instead of update, and watch the
merge test go red on the request id.

---

## Task 3 — Deciding: approve and reject

Spec D2, D3. Adds `profile_change.approved` and `.rejected` (59 → 61). The
correctness core of the phase.

**D2's rule, all three parts**, and note point 3 is the genuinely new one.

**Everything D3 lists is load-bearing:**

- **Lock the subject's `users` row FIRST**, before touching
  `profile_change_requests`. Reversed, approve racing cancel deadlocked **3/3 in
  both directions** and the loser shipped a 500. `UpdateReaderProfile` already
  pins its own lock position by test — match it.
- **Re-read under the lock**, yielding `profile_change_not_pending` rather than a
  not-found.
- **Approve carries optional parish-unit ids** and validates the **resulting**
  pair, not the supplied half.
- **Re-validate the stored JSON at approval** — the column has no check
  constraint, so a legacy row can fail `required_fields_missing` *at approval*.
  Surfaces must catch it.
- **Reject's reason at three layers**: blank is `reject_reason_required`; written
  in **one statement** with the status because of the
  `profile_change_requests_rejected_has_reason` constraint; and repeated into the
  audit `after`, because the column is overwritable while the audit row is not.
- **Audit entity types differ**: approve audits `user` against the subject's user
  id; the others audit `profile_change_request` against the request id.

**`MembersArchitectureTest:74` must be amended here** — `ApproveProfileChange`
writes profile columns and that list is exact.

**Tests:** a manager cannot decide a manager's proposal, a super administrator
can; nobody decides their own at any of the three ranks; nor from their other
shelf; the subject's role is read at decision time (promote mid-flight); approve
validates the resulting unit pair; a blank reject reason is refused and the
reason reaches the audit row.

**Falsify:** compare membership ids instead of user ids and watch the
other-shelf test go red.

---

## Task 4 — Cancelling

Spec D4. Adds `profile_change.cancelled` (61 → 62).

**Any manager or above may cancel any request**, and D2's subject-role rule then
applies — a manager-subject's request is cancellable only by a super
administrator. The reference records the opposite shipping as a defect: *"a
manager could cancel a peer manager's own pending change, cutting §9's routing
rule off at the knees."*

**Only the self case is exempt**, and **its check compares membership id**, not
user id. That asymmetry with Task 3 is real; do not unify them.

Lock ordering as Task 3. Re-read yields `profile_change_not_pending`.
`not_own_request` already has a sentence (`lang/vi/rules.php:87`).

**Tests:** a manager cancels a reader's; only a super administrator cancels a
manager's; anyone cancels their own.

**Falsify:** drop the subject-role check and watch the manager-subject case go
red.

---

## Task 5 — The two queues, their predicates, and their badges

Spec D9, D10. No new audit actions.

- **`manage/profile-changes`** (`routes/web.php:512`) — proposals **whose subject
  is a reader of this shelf** (BR:580). A manager's own proposal is deliberately
  absent: *"nobody present may decide it."*
- **`/admin/profile-changes`** (`:756`) — proposals **whose subject is a manager
  or shelf admin anywhere** (BR:602), the shelf named on each card.

Together they partition the pending set by the subject's role — the same axis
Task 3 decides on.

**The count badges must share these predicates**, not approximate them. This is
the defect 3a already fixed once (commit `8e81c82`, *"match the admin dashboard's
predicates to the shelf's own queues"*). `HandleInertiaRequests.php:132`'s
`pendingDonations` is the shape to follow — it shares
`DonationQueueQuery::countPending()` with the list it links to.

`manage-layout.tsx:25-36` records the missing nav entry and hands it here by
name; the admin shell needs the cross-shelf equivalent, and new
`resources/js/lib/copy.ts` keys in the `copy.manage.donationsWithCount` shape
(`manage-layout.tsx:55-57`).

**The cross-shelf count widens, so it is a query object in `app/Queries/Admin/`**
— resolved inside the closure. `WideningArchitectureTest:76-98`'s comment is
explicit that *"a controller still never calls `systemWide()` itself"*, and a
middleware is no more sanctioned than a controller.

**Where the Actions live is forced** (spec D10): `ProfileChangeRequest` uses
`BelongsToBookshelf` so `BookshelfScope` throws for the unbound admin caller, and
the audit configurator is fenced to `app/Actions/Admin/`. Nothing fences
*callers*, so the manager's tenant-bound controller reaches them cleanly.
**Derive the shelf from the request row on both paths**, never from the request
body — a `systemWide()` inside a shared Action disables isolation for the
manager's path too.

**Tests:** the shelf queue holds only reader subjects and the cross-shelf queue
only manager/admin subjects, asserted from both sides so a request cannot appear
in both or neither; each badge equals its own queue's length — **on a non-empty
fixture for both queues**, since `0 == 0` passes on an empty one.

**Falsify:** drop the role predicate from the shelf queue and watch a
manager-subject request appear in it.

---

## Task 6 — The two notifications BR §15 requires

Spec D8. No new audit actions.

`BUSINESS-REQUIREMENTS.md:490` names both — *"profile change approved, profile
change rejected (carrying the manager's reason)"* — and `:492` gives the reason:
*"without them a reader would have to keep revisiting the page to find out
whether their new phone number took effect."*

`NotificationKind.php:20-23` books the work here by name: *"The profile-change
pair BR §15 names has no reference implementation and is Phase 3's to decide."*

So: two `NotificationKind` cases, two `NotificationSentences` entries (**its match
is exhaustive — Larastan errors on a missing arm**), and the `notify()` calls in
Approve and Reject.

**`NotificationsAreReaderFacingTest` is a census, not a coverage test**, and this
is the pin that will stop the task. It asserts `$writers` equals a hand-written
`OPS_SECTION_7` const (`:113`) and that the const's keys canonically equal every
enum case (`:117-120`). That const (`:48-70`) is a **hand transcription of
`docs/OPERATIONS.md` §7's table** (`:1137-1146`), which has no profile-change
rows, and its docblock claims "SEVEN of §7's eight table rows".

So this task edits **four** places in one commit: `OPERATIONS.md` §7's table, the
`OPS_SECTION_7` const, the docblock's re-derived count, and the enum. Its own
docblock says so: *"each task that adds a kind adds its writer AND its row here
in the same commit."* **The
rejection notification carries the manager's reason.**

**Tests:** approving notifies the subject; rejecting notifies them with the
reason; both are reader-facing.

**Falsify:** drop the reason from the rejection notification and watch it go red.

---

## Task 7 — `ChangeOwnPassword`

Spec D12. Adds `user.password_changed` (62 → 63).

**It deletes the subject's sessions in the same transaction** — a password change
is a revocation.

Refusals are `current_password_incorrect` and `new_password_too_short`;
`lang/vi/rules.php` has only `password_too_short` today, so both need sentences
and census entries. It takes a membership under `requireSelfOrManager`, so it is
not strictly the reader's own path. **Its audit row carries no before/after at
all**, deliberately.

`SetReaderCredentials` stays and is untouched. BR:79 — a volunteer setting a
password is inherent to the trust model, and the mitigation is to make every use
**visible**, not to restrict it. The reader supplies their current password; the
volunteer does not. That asymmetry is why the two keep separate audit actions.

**`MembersArchitectureTest:74` must be amended again here** — this writes a
credential column.

**Also wire `CancelProfileChange`, which Task 4 built and nothing reaches.**
Task 5 measured it: the Action exists, is tested, and has **no HTTP caller** —
no route from the reader's page or from either queue. BR:580/602 list only
approve and reject on the queue cards, so the queues were right not to wire it;
the reader's own page is its home, and this task already reopens that page for
the password form.

A reader withdrawing their own pending proposal is the whole self-exemption in
D4. Shipping the Action without a caller would leave the phase with a capability
nobody can use — the same shape as the dead Promote control 3b-i's whole-branch
review found.

**Test:** a reader cancels their own from their own page, and the pending card
goes away.

**Tests:** the current password is required; sessions are revoked; the volunteer
path still audits `credentials.set`.

**The session test is easy to write vacuously.** `phpunit.xml:72` forces
`SESSION_DRIVER=array` (`force="true"`), so nothing writes session rows during
tests and any `assertGuest()`-shaped assertion is meaningless. The `sessions`
table does exist (`0001_01_01_000000_create_users_table.php:63-75`, indexed on
`user_id`) — **seed it and assert on the rows directly.**

**Falsify:** skip the current-password check and watch it go red.

---

## Task 8 — The avatar

Spec D6. Adds no new audit action — it shares `profile_change.proposed`.

**Sequenced last deliberately**, so the lifecycle is green before storage lands.
**It reopens three earlier tasks**: the deletion ordering below lives in Tasks 3
and 4's Actions, and the avatar grafts onto Task 2's merge (which is what D1's
coupling warning is about). Task 1's page is likewise reopened here, and by
Tasks 2 and 7 — it ships a view, not a finished screen.
Ruled into this phase by the product owner over a recommendation to defer.

The port has **no upload path at all**: `config/filesystems.php` is stock, there
is no `Storage::` or `UploadedFile` anywhere in `app/`, and `avatar_object` is
only a column read and a guest-write guard. So this task builds a disk, the
write, and **an image pipeline — not merely a gate.**

Three of the pipeline's jobs are requirements, not optimisations:

- **Centre-crop and re-encode to 512×512 WebP, EXIF-rotated first.** The crop is
  *how* OPS §4.3's "square" is satisfied — a content-type allow-list cannot
  produce a square photograph.
- **Strip metadata**, as a **child-safety control**: the bucket is public-read and
  a phone photo carries the GPS of the house.
- **`invalid_image` is a decode failure**, raised from the encoder's own catch —
  not a content-type mismatch. A pixel bound is what stops a decompression bomb
  once the byte cap is 5 MiB.

Limits: 5 MiB; jpeg, png, webp, avif. **HEIC stays out of the `accept` list** so
iOS Safari transcodes to JPEG; adding it ships a broken iPhone path. Its refusal
is `heic_not_supported`.

**The host survey is answered** (2026-09-01, `HOSTING.md` rows 3 and 6):

- `gd` is present, **`imagick` is ABSENT** → Intervention Image on the **`gd`
  driver**. Do not write an imagick-preferred path; there is nothing to prefer.
- **`exif` is present on the host** — which is what makes the EXIF-rotate and the
  GPS test possible at all. But `docker/php/Dockerfile:3` and **both** CI
  workflows (`laravel.yml:34`, `deploy-laravel.yml:30`) install `gd` without
  `exif`. **Add `exif` to all three in this task**, or the code works in
  production and fails in CI.
- **`symlink()` is allowed** and `disable_functions` does not list it, so
  `artisan storage:link` genuinely works. **But confirm the shim docroot serves
  it** before relying on it: `HOSTING.md:233-234` records that the shim leaves
  `public/` and `public_html/` as separate directories, so a symlink under
  `public/` is only reachable if the shim reaches it. If it does not, use a
  `FILESYSTEM_DISK` path inside the served docroot — row 6's own fallback.

**One capability is still unconfirmed: whether the host's `gd` was compiled with
WebP encode support.** `gd_info()['WebP Support']` answers it. **Check it at
runtime and fall back to JPEG** rather than assuming — a gd built without WebP
would otherwise fail only in production, which is precisely the shape this survey
exists to prevent.

**Image deletion is ordered AFTER the commit, and which image dies depends on the
decision**: approve discards the **superseded** image; reject and cancel discard
the **proposed** one. Deleting inside the transaction would destroy an image a
rollback then restores a reference to. A crash between commit and delete orphans
an image — the reference chose that over the alternative, and so do we.

A guest may never *name* a storage key (`RegistrationController.php:94`); the
same rule binds here.

**Tests:** an avatar proposal stores the image; rejecting deletes the proposed
one and approving the superseded one; oversize and wrong-format uploads are
refused by their own codes; **a forced rollback leaves the image intact and the
row absent** (the test the ordering exists for — a successful reject passes under
either ordering, so it cannot be the one that pins it); and a stripped image
carries no GPS.

**The GPS test cannot be written the obvious way.** There are no image fixtures
in the repo, and `exif_read_data()` returns `false` both when metadata is absent
**and** when it cannot parse the format — so `expect($exif)->toBeFalse()` passes
on an unstripped file too, and passes on any WebP output regardless. To be
red-capable it must: build a GPS-bearing JPEG in the test, **assert the GPS is
present in that input**, run the pipeline, then assert its absence in the output.
Without the present-then-absent pair it is a guard that cannot fail.

**Falsify:** delete inside the transaction, force a rollback, and watch the
forced-rollback test go red.

---

## Task 9 — Record what this phase leaves open

`docs/known-gaps.md`, a `## Phase 3c-i` section after the last `##`, in the
file's convention. Record:

- **The merge-vs-replace question is open.** BR:343 says a new proposal
  *"replaces"* an outstanding one; the shipped behaviour is a field-wise merge,
  a deliberate product reading isolated so it can be reversed in one line. **The
  product owner may prefer the literal reading.** Carry the coupling hazard too:
  reversing it now also requires restoring an `avatar_object` graft, or a
  phone-only proposal drops a pending photograph's key and orphans the image.
- **Post-commit image deletion is not transactional** — a crash between commit
  and delete orphans an image. The alternative deletes one a rollback still
  references.
- **`OPERATIONS.md:587` is stale** — it asserts BR §15 lists no profile-change
  notification. BR:490 names two, and this phase built them.
- **The archived-shelf resolver filter and export remain deferred**, per 3b-i,
  export still unscheduled and still a precondition.

---

## Definition of done

- **All six CI gates green**, run in the container where they belong.
- Every test watched failing and restored; `git status --porcelain` clean.
- Audit count at 63, census green both directions, partition at `readers`.
- Screenshots of the reader profile page and both queues, in both modes.
- No task left the suite red across a boundary.
