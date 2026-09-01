# Phase 3c-i — the profile-change lifecycle

Status: draft, revised after review
Date: 2026-09-01
Branch: `feat/phase-3c-oversight-and-feedback`, cut from `main` at `b0a0d2c`

## 1. Context

OLibra is a Vietnamese parish lending-library system being ported from Next.js to
Laravel + Inertia + React. `old_next/` is a **read-only** behavioural reference.
Phases 0–3b shipped the schema, catalogue, members, circulation, community
features, statistics, QR labels, the portal, the admin dashboard, shelf and
manager administration, system settings, taxonomy and the public contact page.

Phase 3c is the last of Phase 3. It was split by subject matter on 2026-09-01,
because research put eight items in it — more than 3b carried when *it* was
split. **This spec is 3c-i, the profile-change lifecycle.** 3c-ii takes the audit
browser, per-manager activity, the feedback inbox, the reader's *Góp ý* and the
public contact form 3b-ii deferred.

## 2. Problem statement

**A reader cannot see their own record, and cannot ask for it to be corrected.**

`routes/web.php:236` — the reader's own profile page is `underConstruction`. Its
four siblings under `shelves/{shelf}/profile/*` are real (`:237` history, `:242`
notifications, `:254` donations, `:255` overview), so a reader can see what they
have borrowed and what they have been told, but not who the parish thinks they
are.

That matters more than a missing page usually would, because of how this system
treats identity. `BUSINESS-REQUIREMENTS.md:83` (§2): *"Changing your own details
is a request, not an edit."* A reader may **propose** a change; it takes effect
only when a manager approves it. Until then the existing values stand —
including the phone number, so a manager never loses the means of contacting a
family mid-change.

None of that mechanism is built. `ProfileChangeRequest` has a model, a table and
an enum; the only production reader is `ReaderDetailQuery`, which displays a
pending one. There is no propose, no approve, no reject, no cancel, and neither
queue exists: `routes/web.php:512` (the shelf's own) and `:756` (the cross-shelf
one) are both placeholders.

`known-gaps.md:1175` records the deferral and its reason: the reader profile
page, `GetMyProfile` and `ChangeOwnPassword` were held for "Phase 3 whole"
precisely because they share a screen with the profile-change lifecycle.
`MembershipPolicy`'s docblock (`:20-26`) leaves a standing instruction for
whoever arrives here, naming `GetMyProfile`, BR:544 and the OPS row by hand (that row is `OPERATIONS.md:67`; `:69` is `GetMyNotifications`). This is
that phase.

## 3. Scope

**In:** the reader profile page; proposing a change to a person's details;
**proposing an avatar**, with the upload path that requires; changing one's own
password; the shelf-level decision queue (`manage/profile-changes`); the
cross-shelf queue (`/admin/profile-changes`); cancel; the nav entries and count
badges BR §16.3 asks for; five new audit actions.

**Out:** everything in 3c-ii. Also out: the archived-shelf resolver filter and
its export, still deferred and still blocked on export being scoped.

**A note on size.** The avatar was brought in by the product owner on
2026-09-01, over a recommendation to defer it. It is not a fifth bullet: the port
has **no avatar upload path at all** — `avatar_object` is a profile column
nothing writes — so this phase also builds storage wiring, a size and format
gate, and post-commit image deletion. §7 records the risk that follows.

## 4. Decisions

### D1 — Proposing again **merges into** the pending request; it is not refused

**Reversed after review.** The first draft treated a second proposal as a
duplicate-key error to be caught and refused. The requirement is the opposite.
The reference calls it *"normal rather than a failure"*
(`propose-profile-change.ts:33-43`).

**And the authority here is the reference's reading, not the requirement's
words.** `BUSINESS-REQUIREMENTS.md:343` says a new proposal *"replaces"* an
outstanding one — the literal reading. `profile-proposals.ts:45-86` records that
the shipped behaviour is a **merge**, that this is a deliberate product reading
*"isolated so it can be reversed in one line"*, and that **the product owner may
prefer the literal one**: B2b's plan flags it as the one question answered on a
reading rather than on a source. An earlier draft of this spec cited BR:344 as
*proving* the merge, which inverts its own source.

We port the merge, because it is what the reference does and what this port's
users have had. **The open question travels with it** into
`docs/known-gaps.md`, along with the coupling `profile-proposals.ts:66-79`
warns about: flipping the constant back to `"replace"` now also requires
restoring an `avatar_object` graft, or a phone-only proposal drops a pending
photograph's key and orphans the image forever. A pending row is **UPDATEd in place**,
keyed by its existing id, and the same request id comes back
(`pending-proposal.ts:169-177`).

The merge is field-wise and deliberately partial: `mergeProposal`
(`profile-proposals.ts:115-133`) snapshots `previous` only for the **incoming**
fields, and does *not* re-snapshot fields already pending, "because that is the
moment its `previous` describes" (`profile-proposals.ts:100-101`).

**`profile_change_requests.pending_user_id`** is a generated column
(`IF(status = 'pending', user_id, NULL)`) with a UNIQUE constraint
(`..._create_profile_change_requests_table.php:45,51`). That constraint is **not**
the guard against a second proposal — the merge above means there is never a
second row. It guards the case the tenant-scoped SELECT cannot see: **a person
with memberships at two shelves**, where the blocking row belongs to the other
shelf. The generated column is global across shelves, so that case survives the
port, and its refusal is `change_already_pending`
(`pending-proposal.ts:197-202`).

### D2 — Who may decide is derived from the **subject's** role, not the viewer's

`BUSINESS-REQUIREMENTS.md:273` (INV-13) states the rule; the reference
implements it at `approve-profile-change.ts:165-175`. Three things to carry
precisely:

1. **The subject's role is read at decision time**, not at proposal time. A
   reader promoted while their proposal is pending becomes a subject only a
   super administrator may decide.
2. **Self-decision is refused at every rank, super administrator included.** The
   reference's comment: *"Rank is not the question; being both parties to the
   decision is."*
3. **The decide comparison is on `user_id`, not membership id.** A person with
   memberships on two shelves is one person; comparing memberships would let them
   decide their own proposal from the other shelf. (Cancel differs — see D4.)

**Half of this rule already exists in Laravel.** `UpdateReaderProfile.php:64-67`
carries the subject-role half verbatim, with its own comment noting a manager's
own record fails there too. What is genuinely new is point 3: that check does
**not** stop a reader deciding their own proposal, because a reader's role is not
`manager`.

**The port's `atLeast` is narrower than the reference's.**
`app/Enums/MembershipRole.php` has **Reader 1, Manager 2, Admin 3** and nothing
else; its docblock says why — *"guest (0) is the absence of a membership and
super_admin (4) is the global `users.is_super_admin` flag; neither is a
membership role, so neither is a case here."* So the check is
`$membership->role->atLeast(MembershipRole::Manager) && ! $actor->is_super_admin`,
exactly as `UpdateReaderProfile.php:65` already writes it. There is no
`MembershipRole::SuperAdmin` to reach for. Shelf admins are covered by
"manager or above".

### D3 — The decide commands do more than decide

The first draft named the authorization rule and nothing else. Each of these is
load-bearing and none is optional:

- **Lock ordering.** Every command takes `lockPerson` — the subject's `users` row,
  `FOR NO KEY UPDATE` — **before** touching `profile_change_requests`
  (`approve:117`, `reject:72`, `cancel:127`). Reversed, approve racing cancel
  deadlocked **3/3 in both directions** and the loser's error shipped as a 500
  (`cancel-profile-change.ts:70-74`). `UpdateReaderProfile` already pins its own
  lock position by test; match it.
- **Re-read under the lock**, yielding a distinct refusal
  `profile_change_not_pending` (`approve:148`, `reject:97`, `cancel:147`) rather
  than a not-found. This code has no `lang/vi/rules.php` line yet.
- **Approve carries optional parish-unit ids** and validates the **resulting**
  pair, not the supplied half (`approve:17-22,177-196`). `known-gaps.md` already
  promises this ("Phase 3's ApproveProfileChange, which carries the two unit ids
  for exactly this").
- **Re-validate the stored JSON at approval** (`approve:203-205`) — the column
  has no check constraint, so a legacy row can fail `required_fields_missing`
  *at approval*. Surfaces must catch it.
- **Reject requires a reason at three layers**: a blank one is
  `reject_reason_required` (`reject:59-61`); it is written in **one statement**
  with the status because of the `profile_change_requests_rejected_has_reason`
  constraint (migration `:36-39`); and it is repeated into the audit `after`,
  because the column is overwritable while the audit row is permanent.
- **The audit entity type differs by action.** Approve audits `user` against the
  subject's user id (`approve:251-252`); propose, reject and cancel audit
  `profile_change_request` against the request id.

**`previous_values` is captured at proposal time, not decision time.** The first
draft had this backwards. The column is `$table->json('previous_values')` — **NOT
NULL, no default** (`..._create_profile_change_requests_table.php:17`) — so the
row cannot even be inserted without it, and `BUSINESS-REQUIREMENTS.md:205` names
it "the values at the time of proposing".

### D4 — Cancelling **is** governed by D2's rule, except for the self case

**Reversed after review.** The first draft said cancelling "needs none of D2's
rules, because the only person it concerns is the one asking." The reference says
the opposite, and records it as a defect it had to fix
(`cancel-profile-change.ts:38-47,157-163`):

> a manager could cancel a peer manager's own pending change, cutting §9's
> routing rule off at the knees

So: **any manager or above may cancel any request**, and D2's subject-role rule
then applies — a manager-subject's request is cancellable only by a super
administrator. Only the **self** case is inverted: a person may always cancel
their own, at every rank.

And note the asymmetry with D2 point 3: **the self-check here compares membership
id**, not user id. The `user_id`-not-membership-id rule is about *deciding*, not
about the whole lifecycle.

### D5 — Proposing is not reader-only

`requireSelfOrManager` (`policy.ts:214-223`) lets any manager or above propose on
another person's behalf. The first draft scoped this as "a reader proposing",
which would have shipped a narrower capability than the reference.

**Saint name is mandatory** (`BUSINESS-REQUIREMENTS.md:87`: *"a parish register
with no saint name is not a parish register"*) on every write path.
`ProfileFields::normalisePatch` already raises `required_fields_missing` for a
blanked saint name (`ProfileFields.php:59-61`). **A phone is required by the
interface, not the column** — a genuinely absent phone needs a typed reason,
cleared automatically once a phone is supplied; `UpdateReaderProfile.php:88-94`
already implements the pair — the auto-clear at `:89-91` and the refusal at
`:92-94`. **The port has no `assertPhoneOrReason` helper**; it is that inline
pair, and its code is the Vietnamese slug `thieu-so-dien-thoai`
(`lang/vi/rules.php:45`), not one of §6's new codes. The rule is checked against
the **resulting** record, at propose *and* at approve.

### D6 — The avatar shares the lifecycle, and its image deletion is post-commit

Ruled in by the product owner on 2026-09-01. `OPERATIONS.md:538`: *"The avatar
requires approval too. It was queried and the product owner confirmed **every**
field, naming the photograph explicitly."*

`ProposeAvatarChange` is the fifth command. It shares the pending row, the merge
of D1 and the audit action `profile_change.proposed`.

**The port has no upload path at all** — `config/filesystems.php` is stock
Laravel, there is no `Storage::` or `UploadedFile` anywhere in `app/`, and
`avatar_object` appears only as a column read and a guest-write guard
(`RegistrationController.php:93-98`). So this phase builds a storage disk, the
write to `avatar_object`, and **an image pipeline — not merely a gate.**

The reference's `avatar-image.ts` is the part an earlier draft of this spec
missed, and three of its four jobs are requirements rather than optimisations:

- **Every upload is EXIF-rotated, centre-cropped and re-encoded to a 512×512
  WebP** (`:79-85`). The crop is *how OPS §4.3's "square" is satisfied* (`:25-30`)
  — a content-type allow-list cannot produce a square photograph.
- **Metadata is stripped** (`:32-38`), argued as a **child-safety control**: the
  bucket is public-read and a phone photo carries the GPS of the house.
- **`invalid_image` is a decode failure** raised from the encoder's own catch
  (`:40-47,86-94`), not a content-type mismatch — `avatar.ts:123` records that
  the content-type-only version was the earlier, weaker design. A pixel bound is
  what stops a decompression bomb once the byte cap is 5 MB.
- **HEIC stays out of the `accept` list** (`avatar-limits.ts:43-47`) so iOS
  Safari transcodes to JPEG; adding it ships a broken iPhone path. Its refusal is
  `heic_not_supported`.

Limits are 5 MiB and jpeg/png/webp/avif (`avatar-limits.ts:29,53-58`). **No PHP
image library is chosen yet** — picking one is part of this work.

A guest may never *name* a storage key (`RegistrationController.php:94`); the
same rule binds here.

**Image deletion is ordered after the commit, and which image dies depends on the
decision** (`avatar.ts:255-262`): approve discards the **superseded** image;
reject and cancel discard the **proposed** one. `OPERATIONS.md:540` requires it —
"a rejected or cancelled proposal's image is deleted rather than left orphaned in
storage." Deleting inside the transaction would destroy an image a rollback then
restores a reference to.

### D7 — The reader's page reads the most recent request of **any** status

`ReaderDetailQuery.php:98-100` filters `status = 'pending'`. That shape is wrong
for this page. The reference reads the most recent request whatever its status
(`get-my-profile-change-request.ts`, `order by requested_at desc limit 1`),
because the page is where a reader learns they were **rejected** — it shows the
rejection reason (`ho-so/page.tsx:304-306`) and a "last decided on…" footer
(`:545-549`).

Building the page on the pending-only shape would ship a screen that silently
forgets the answer.

**An earlier draft justified this by claiming no notification exists for a
profile-change decision. That is false**, and the false claim came from
`OPERATIONS.md:587`, an open-question note asserting §15 lists none — stale
against the requirement itself. `BUSINESS-REQUIREMENTS.md:490` (§15) names both:
*"profile change approved, profile change rejected (carrying the manager's
reason)"*, and `:492` gives the reason — *"without them a reader would have to
keep revisiting the page to find out whether their new phone number took
effect."* D7 stands on OPS:68 and the reference; its stated justification did
not.

### D8 — The two notifications BR §15 requires, which this phase owns

The port has already booked this work here.
`app/Support/Notifications/NotificationKind.php:20-23`: *"The profile-change pair
BR §15 names has no reference implementation and is Phase 3's to decide."* The
enum has seven cases and neither.

So this phase adds: two `NotificationKind` cases, two `NotificationSentences`
entries (its match is exhaustive — Larastan errors on a missing arm), the
`notify()` calls in Approve and Reject, and `NotificationsAreReaderFacingTest`
coverage. The rejection notification **carries the manager's reason**, per BR:490.

They are reader-facing by construction, which is the property that test exists to
hold.

### D9 — Each queue has a predicate, and they must not overlap

Neither queue is "all pending requests filtered by what I can see". BR states
each one's subject:

- **`manage/profile-changes`** — `BUSINESS-REQUIREMENTS.md:580`: *"One card per
  proposed change **whose subject is a reader** of this shelf"*, and it says why:
  a manager's or shelf admin's own proposed change *"no longer sits in this
  queue, where nobody present may decide it"*.
- **`/admin/profile-changes`** — `:602`: *"every pending profile-change proposal
  **whose subject is a manager or shelf admin** anywhere in the system, the shelf
  named on each card."*

Together they partition the pending set by the subject's role — the same axis D2
decides on, which is why neither can contain a request nobody present may decide.

**The count badges must share these predicates**, not approximate them. This is
the defect 3a already had to fix once: commit `8e81c82`, *"match the admin
dashboard's predicates to the shelf's own queues"*. The existing counts channel
does it correctly — `HandleInertiaRequests.php:132`'s `pendingDonations` shares
`DonationQueueQuery::countPending()` with the list it links to. Follow that
shape rather than writing a second predicate.

### D10 — One set of Actions, in `app/Actions/Admin/`, with the shelf from the row

Both queues decide the same way, so the decide/reject/cancel Actions are shared —
and the reference agrees, importing the same modules from its admin surface and
saying so: *"nothing here is a second implementation of the decision, only of how
this surface reaches it."*

This is safe where 3b-ii's D4 was not, because that Action authorized internally
as super admin; this rule reads the **subject**.

**Where they live is forced.** `ProfileChangeRequest` uses `BelongsToBookshelf`
(`:12`), so `BookshelfScope` **throws** under the unbound admin caller; and the
audit configurator is fenced to `app/Actions/Admin/`
(`WideningArchitectureTest:122`). Both push the shared Actions into
`app/Actions/Admin/`. Nothing fences *callers* of that directory, so the
manager's tenant-bound controller reaches it cleanly.

**The hazard is the reverse of the one the first draft feared.** A `systemWide()`
inside a shared Action disables tenant isolation for the *manager's* path too. So
**the shelf is derived from the request row on both paths**, never from the
request body. The reference learned this the hard way: a hidden shelf field once
let "a mismatched post" file an approval "against the wrong parish", and
`subjectOfProfileChange` needed `m.bookshelf_id = r.bookshelf_id` added because a
subject with manager memberships at two parishes let the query pick an arbitrary
one, so the subject's role could come from the wrong shelf.

### D11 — `GetMyProfile` renders units by the shelf's own label, and shows pending beside current

Two contracts the first draft left implicit, both required for this page.

**`OPERATIONS.md:67`'s `GetMyProfile`** returns the reader's parish-unit
selections **rendered read-only through the shelf's own labels**, never the words
`Tổ` or `Giáo họ` (`BUSINESS-REQUIREMENTS.md:247`, and `:578` makes it a
cross-screen rule). The labels come from `ParishTaxonomy`'s `level1_label` /
`level2_label`, which 3b-ii made editable — so this page is the first reader-side
consumer of that shape.

**`BUSINESS-REQUIREMENTS.md:544`** requires the page to show *"the current value
with the pending one beside it, and says plainly that it is waiting."* That is a
rendering contract, not a data one: a page that shows only the proposed values,
or only the current ones, satisfies the query and fails the requirement.

### D12 — `ChangeOwnPassword` revokes sessions, and is not reader-only either

It deletes the subject's sessions in the same transaction
(`change-own-password.ts:69`) — a password change is a revocation. Its refusals
are `current_password_incorrect` and `new_password_too_short`; `lang/vi/rules.php`
has only `password_too_short` today. It takes a membership under
`requireSelfOrManager`, and its audit row carries **no before/after** at all,
deliberately.

The existing `SetReaderCredentials` stays. `BUSINESS-REQUIREMENTS.md:79` says a
volunteer setting a password is inherent to the trust model and the mitigation is
to make every use **visible**, not to restrict it. The reader supplies their
current password; the volunteer does not. That asymmetry is why the two keep
separate audit actions rather than sharing one.

### D13 — Five new audit actions, 58 → 63, and two nav badges

| action | group | when |
|---|---|---|
| `profile_change.proposed` | `readers` | a proposal is made or replaced |
| `profile_change.approved` | `readers` | a decision approves |
| `profile_change.rejected` | `readers` | a decision rejects, with reason |
| `profile_change.cancelled` | `readers` | the request is withdrawn |
| `user.password_changed` | `readers` | someone changes their own |

`profile.corrected` and `credentials.set` already exist, both in `readers`
(`AuditSentences.php:66-67`). **No new group** — unlike 3b-i, which had to create
`administration`. The count pin is at `tests/Unit/Audit/AuditSentencesTest.php:435`,
with the group partition at `:427-434`; `AuditActionCensusTest` carries the
set-equality and the computed-name ban but **no count**.

**Both queues need a nav entry with a count badge.**
`manage-layout.tsx:25-36` records the gap and hands it to this phase by name —
BR §16.3 wants *Đổi thông tin* in the sidebar with a count. The counts channel
already exists (`HandleInertiaRequests.php:132`, the `pendingDonations` shape);
the admin shell needs the cross-shelf equivalent.

## 5. Testing

1. **Proposing again replaces** the pending row — same request id, merged
   fields, `previous` untouched for fields already pending.
2. **A person with memberships at two shelves** hits `change_already_pending`
   from the second shelf — the case the unique constraint exists for.
3. **A manager cannot decide a manager's proposal**; a super administrator can.
4. **Nobody decides their own**, at reader, manager and super-administrator rank
   — the third is the one a rank-based reading would miss.
5. **Nor from their other shelf** — the `user_id`-not-membership-id rule.
6. **The subject's role is read at decision time** — promote the subject mid-flight
   and the manager's decision is refused.
7. **A manager may cancel a reader's request; only a super administrator may
   cancel a manager's; anyone may cancel their own** — D4, all three.
8. **Approve validates the resulting unit pair**, not the supplied half.
9. **Reject with a blank reason is refused**, and the reason reaches the audit row.
10. **Proposing changes nothing** until approval; the phone in particular still
    reaches the manager mid-change.
11. **An avatar proposal stores the image**; rejecting deletes the proposed one
    and approving deletes the superseded one, **after commit**.
12. **Oversize and wrong-format uploads are refused** by their own codes.
13. **The reader's page shows a rejected request and its reason** — D7's whole
    reason for existing.
14. **A password change revokes sessions** and requires the current password.
15. **The census passes at 63**, both directions, with the partition at `readers`.
16. **Approving notifies the subject; rejecting notifies them with the reason** —
    BR:490's pair, and reader-facing by construction.
17. **The shelf queue contains only reader subjects, and the cross-shelf queue
    only manager and admin subjects** — D9's partition, asserted from both sides
    so a request cannot appear in both or neither.
18. **Each count badge equals its own queue's length** — the predicate-drift
    defect 3a already had to fix once.
19. **The reader's page renders units by the shelf's own labels**, and shows the
    pending value beside the current one while it waits.

Per project practice, **every test is watched failing before it is accepted**.

## 6. Architecture pins this phase will hit

- **`MembersArchitectureTest:74`** — *"only the three sanctioned Actions write a
  credential or profile column on users"*, an exact list of
  `Registration`, `SetReaderCredentials`, `UpdateReaderProfile`.
  `ApproveProfileChange` writes profile columns and `ChangeOwnPassword` writes a
  credential, so **this list must be amended deliberately**. This is the closest
  analogue to the census pin 3b-i got wrong.
- **`MembersArchitectureTest:156`** — the OPS §4.3 Action census. Its assertion
  covers only 1b's ten, but its comment fixes this phase's contribution at six
  classes (five lifecycle + `ChangeOwnPassword`). With the avatar in scope that
  comment becomes true; without it, it would have been stale.
- **`PolicyRegistrationTest`** — a self-view ability is needed, and most likely a
  `ProfileChangeRequestPolicy`; every policy must resolve to a model and every
  registered model needs its policy.
- **`AuditActionCensusTest`** (set-equality both ways, computed names banned) and
  **`AuditSentencesTest:427-435`** (group partition and count).
- **`RuleViolatedCodesHaveSentencesTest`** — globs the whole of `app/`. New codes
  with no sentence today: `change_already_pending`, `profile_change_not_pending`,
  `current_password_incorrect`, `new_password_too_short`, `file_too_large`,
  `invalid_image`, `heic_not_supported`. Already present and reused:
  `not_own_request` (`lang/vi/rules.php:87`), `reject_reason_required` (`:38`),
  `required_fields_missing`, `not_permitted`, `thieu-so-dien-thoai` (`:45`).
- **`FreeTextEncodingGuardTest`** — the proposal form is almost all free text:
  `saint_name`, `full_name`, `father_name`, `mother_name`, `email`,
  `phone_missing_reason`, plus reject's `reason`.
- **`WideningArchitectureTest`** — `systemWide()` to the two admin directories,
  the audit configurator to `app/Actions/Admin/` alone.
- **`TenancyArchitectureTest`** — hand-written `bookshelf_id` filters outside its
  allow-list.
- **`RouteOrderTest`** — tenant middleware on `{shelf}`, super-admin on `admin/`,
  no Vietnamese path segments.
- **Comment-blind greps.** Two fences read raw file contents. Do not spell
  `->forShelf(`, `->global(`, a where-shaped call, or `new RuleViolated('code')`
  inside a comment; 3b-ii turned a docblock example into a censused code that way.

## 7. Risks

- **This phase is now the largest in Phase 3.** The avatar brought an upload
  path, a storage disk, a format gate and post-commit deletion ordering into a
  phase already carrying the reader page, two queues, five commands and the
  decision rule. Splitting was recommended and declined; the plan should
  sequence the avatar last so the lifecycle is green before storage lands.
- **D2 has three independent ways to be subtly wrong** and §5 tests each
  separately.
- **D10's shared Actions widen.** A `systemWide()` there disables isolation for
  the manager's path too, which is why the shelf comes from the request row on
  both paths. This is the phase's sharpest edge.
- **Post-commit image deletion is not transactional.** A crash between commit and
  delete orphans an image; the reverse order would delete one a rollback still
  references. The reference chose the orphan, and so do we.
