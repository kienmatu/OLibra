# Phase 3c-i — the profile-change lifecycle

Status: draft for review
Date: 2026-09-01
Branch: `feat/phase-3c-oversight-and-feedback`, cut from `main` at `b0a0d2c`

## 1. Context

OLibra is a Vietnamese parish lending-library system being ported from Next.js
to Laravel + Inertia + React. `old_next/` is a **read-only** behavioural
reference. Phases 0–3b shipped the schema, catalogue, members, circulation,
community features, statistics, QR labels, the portal, the admin dashboard,
shelf and manager administration, system settings, taxonomy and the public
contact page.

Phase 3c is the last of Phase 3: oversight and feedback. It was split by
subject matter on 2026-09-01, because research put eight items in it — more than
3b carried when *it* was split. **This spec is 3c-i, the profile-change
lifecycle.** 3c-ii takes the audit browser, per-manager activity, the feedback
inbox, the reader's *Góp ý* and the public contact form 3b-ii deferred.

## 2. Problem statement

**A reader cannot see their own record, and cannot ask for it to be corrected.**

`routes/web.php:236` — the reader's own profile page is `underConstruction`. Its
four siblings under `shelves/{shelf}/profile/*` are real (history, notifications,
donations, overview), so a reader can see what they have borrowed and what they
have been told, but not who the parish thinks they are.

That matters more than a missing page usually would, because of how this system
treats identity. BR §83: *"Changing your own details is a request, not an edit."*
A reader may **propose** a change; it takes effect only when a manager approves
it. Until then the existing values stand — including the phone number, so a
manager never loses the means of contacting a family mid-change. The whole
mechanism exists because the manager personally knows each family, and their
approval is what makes the record trustworthy.

None of that mechanism is built. `ProfileChangeRequest` has a model, a table and
an enum; **nothing reads or writes it** except `ReaderDetailQuery`, which only
displays a pending one. There is no propose, no approve, no reject, no cancel,
and neither queue exists: `routes/web.php:512` (the shelf's own) and `:756` (the
cross-shelf one) are both placeholders.

`known-gaps.md:1175` records the deferral and its reason: the reader profile page,
`GetMyProfile` and `ChangeOwnPassword` were held for "Phase 3 whole" precisely
because they share a screen with the profile-change lifecycle. This is that
phase.

**A reader also has no password path of their own.** Until now the only way is a
volunteer setting one (`SetReaderCredentials`) — which is BR §2's trust model and
not wrong, but it means a reader who wants to change their own password must ask
somebody to do it for them.

## 3. Scope

**In:** the reader profile page (`shelves/{shelf}/profile`); a reader proposing a
change to their own details; changing their own password; the shelf-level
decision queue (`manage/profile-changes`); the cross-shelf decision queue
(`/admin/profile-changes`); cancel; five new audit actions.

**Out:** everything in 3c-ii — the audit browser, per-manager activity, the
feedback inbox, the reader's *Góp ý*, the public contact form. Also out: the
archived-shelf resolver filter and its export, still deferred and still blocked
on export being scoped.

## 4. Decisions

### D1 — INV-13 is a database constraint, not application care

At most one pending request per person. This is **already enforced by the
schema**: `profile_change_requests.pending_user_id` is a generated column
(`user_id` when the row is pending, null otherwise) carrying a UNIQUE constraint
(`..._create_profile_change_requests_table.php:45,51`).

So a second proposal from the same reader is a raw duplicate-key error unless
the command catches it. It must be caught and re-raised as a refusal with its own
Vietnamese sentence — the same shape 3b-ii's Task 5 needed for duplicate unit
names, and Task 3 for duplicate categories, both of which shipped 500s in draft.

The application still checks first, for the message; the constraint is what makes
the check true under concurrency.

### D2 — Who may decide is derived from the **subject's** role, not the viewer's

BR INV-13, and it is the subtlest rule in this phase:

> who may decide a pending proposal is derived from the **subject's** membership
> role at decision time — a manager or shelf admin of the subject's own shelf for
> a reader subject, a super administrator only for a manager or admin subject —
> and nobody may decide their own proposal, at any rank.

The reference implements exactly that (`approve-profile-change.ts:165-175`):

```ts
const subjectIsManager = atLeast(request.subject_role, "manager");
if (subjectIsManager && ctx.actor.role !== "super_admin") throw new RuleViolated("not_permitted");
if (subject.userId === ctx.actor.userId) throw new RuleViolated("not_permitted");
```

Three things to carry precisely:

1. **The subject's role is read at decision time**, not at proposal time. A
   reader who is promoted while their proposal is pending becomes a subject only
   a super administrator may decide.
2. **Self-decision is refused at every rank, super administrator included.** The
   reference's comment: *"Rank is not the question; being both parties to the
   decision is."*
3. **The comparison is on `user_id`, not membership id.** A person with
   memberships on two shelves is one person; comparing memberships would let them
   decide their own proposal from their other shelf.

This is why two queues exist rather than one filtered view: a manager's queue can
never contain a manager's own proposal, and the super administrator's queue
contains nothing else.

### D3 — Proposing changes nothing until it is approved

BR §83. The pending request holds `proposed_values`; the user row is untouched
until approval. `previous_values` is captured **at decision time**, not at
proposal time, so the audit record says what actually changed rather than what
was true when the reader typed.

A reader may cancel their own pending proposal. Cancelling is not a decision —
it needs none of D2's rules, because the only person it concerns is the one
asking.

**Saint name is mandatory** (BR §87: *"a parish register with no saint name is
not a parish register"*), on every write path including a reader's own proposal.
**A phone is required by the interface, not the column** — some readers are
children with no phone of their own, so a genuinely absent phone requires a typed
reason, recorded and cleared automatically once a phone is supplied.

### D4 — A reader changes their own password; a volunteer still can too

`ChangeOwnPassword` is new. The existing `SetReaderCredentials` stays: BR §79
says a volunteer setting a password is inherent to the trust model, and the
mitigation is not to restrict it but to make every use **visible**. Both write
audit records; `credentials.set` already exists for the volunteer path and
`user.password_changed` is added for the reader's own.

A reader changing their own password supplies their current one. A volunteer
does not — that asymmetry is the trust model, not an oversight, and it is why the
two actions stay distinct in the audit log rather than sharing one.

### D5 — Two queues, two authorizations, one Action

`manage/profile-changes` (the shelf's own readers) and `/admin/profile-changes`
(managers and shelf admins, cross-shelf). They differ in **which requests they
list**, not in what deciding means.

So the decide/reject Actions are shared and D2's rule is what each caller must
satisfy — the rule is in the Action, not in the controller, so neither queue can
drift from it. This is the opposite of 3b-ii's D4, where sharing was wrong
because the Action authorized as super admin internally; here the rule is
genuinely the same rule and is *about* the subject rather than about the caller.

The cross-shelf queue reads across shelves, so its query lives in
`app/Queries/Admin/` and widens; the shelf queue binds a tenant and does not.
The Actions must therefore reach the subject **without** assuming a bound
tenant — the cross-shelf caller has none.

### D6 — Five new audit actions, 58 → 63

| action | when |
|---|---|
| `profile_change.proposed` | a reader proposes |
| `profile_change.approved` | a decision approves |
| `profile_change.rejected` | a decision rejects, with reason |
| `profile_change.cancelled` | the proposer withdraws |
| `user.password_changed` | a reader changes their own |

`profile.corrected` (a manager's direct edit) and `credentials.set` (a volunteer
setting a password) already exist and are untouched.

Each needs an `ACTIONS` entry, a `phrase()` arm, a `lang/vi/audit.php` line, and
the partition count moved. Per practice each lands in the same task as its
writer, so the census's two-way set-equality holds at every task boundary.
`AuditSentences::phrase()` is private — assert through the public `sentence()`.

Group: the four `profile_change.*` belong to `readers`, which is where the
existing `profile.corrected` sits; `user.password_changed` goes there too. **No
new group** — unlike 3b-i, which had to create `administration`.

## 5. Testing

1. **A second pending proposal is refused, not a 500** — the D1 constraint,
   exercised through the real route.
2. **A manager cannot decide a manager's proposal**; a super administrator can.
3. **Nobody decides their own proposal**, tested at reader, manager and super
   administrator rank — the third is the one a rank-based reading would miss.
4. **A person with memberships on two shelves cannot decide their own proposal
   from the other shelf** — the `user_id`-not-membership-id rule.
5. **The subject's role is read at decision time** — promote the subject while
   the request is pending and the manager's decision is refused.
6. **Proposing changes nothing** until approval; the phone in particular still
   reaches the manager mid-change.
7. **A reader can cancel their own** and cannot cancel another's.
8. **Saint name is mandatory** on the reader's own proposal path.
9. **An absent phone requires a typed reason**, and supplying a phone clears it.
10. **A reader changing their own password must supply the current one**; a
    volunteer's path is unchanged and still audits `credentials.set`.
11. **The census passes at 63**, both directions.

Per project practice, **every test is watched failing before it is accepted**.

## 6. Architecture pins this phase will hit

- **`WideningArchitectureTest`** — the cross-shelf queue widens and must live in
  `app/Queries/Admin/`; the audit configurator is fenced to `app/Actions/Admin/`.
  But the decide Actions are shared with a tenant-bound caller, so **where they
  live is a real decision**: if they need `->forShelf()` they are forced into
  `app/Actions/Admin/`, which the manager's path may then reach. Resolve this in
  the plan, not during implementation.
- **`AuditActionCensusTest`** — set-equality both directions, computed names
  banned; plus the partition count.
- **`RuleViolatedCodesHaveSentencesTest`** — globs the whole of `app/`, so every
  new refusal code needs its sentence and its list entry. Expect several here.
- **`FreeTextEncodingGuardTest`** — the proposal form is almost entirely free
  text (`saint_name`, `full_name`, `father_name`, `mother_name`,
  `phone_missing_reason`).
- **`RouteOrderTest`** — tenant middleware on `{shelf}` routes, super-admin on
  `admin/`, and no Vietnamese path segments.
- **Comment-blind greps** — two fences read raw file contents; do not spell
  `->forShelf(`, `->global(`, a where-shaped call, or `new RuleViolated('code')`
  inside a comment. 3b-ii's Task 5 turned a docblock example into a censused
  code this way.

## 7. Risks

- **D2 is the phase's correctness core** and has three independent ways to be
  subtly wrong (role read at the wrong time, self-check by membership rather than
  person, self-check skipped for super administrators). §5 tests each separately.
- **The proposal form touches the person record**, the most trust-bearing data in
  the system. Everything it writes is a proposal, never a direct edit — but a bug
  that wrote directly would be a silent violation of BR §83.
- **Two callers share the decide Actions** (D5). The reason it is safe here is
  precisely the reason it was unsafe in 3b-ii; if review finds the rule differs
  by caller after all, they split.
