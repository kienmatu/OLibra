# Phase 3c-ii — oversight and feedback

Status: draft, revised after review
Date: 2026-09-01
Branch: `feat/phase-3c-ii-oversight-and-feedback`, cut from `main` at `0993a90`

## 1. Context

OLibra is a Vietnamese parish lending-library system being ported from Next.js to
Laravel + Inertia + React. `old_next/` is a **read-only** behavioural reference.
Phases 0–3c-i shipped everything up to the profile-change lifecycle.

**This is the last phase before cutover.** Phase 4 deletes the Next.js tree,
rewrites the architecture documents against the shipped stack and tags `v0.2.0`.
Anything deferred here has no later phase inside Phase 3 to absorb it.

## 2. Problem statement

Three placeholders remain (`routes/web.php:220` the reader's *Góp ý*, `:828`
`/admin/audit`, `:829` `/admin/feedback`), plus the public contact form 3b-ii
deferred *to land with the inbox that reads it*.

**The feedback slice has no writer.** `Feedback` has a model, a table and an
enum. `app/` references it in six places — the model, the enum,
`Bookshelf::feedback()`, `AppServiceProvider:100` (which already commits this
port to *"3 per phone per day, hashed, §5.4"*), `HandleInertiaRequests:83-86`,
and `ContactController:44-51` — and **not one of them writes a row**. Phase 2b
deferred the slice whole. So a reader with something to say, and a parish with no
shelf trying to reach the administration, both have nowhere to go.

**The audit log cannot show the rows this port already writes.**
`AuditLogQuery` carries what its own docblock calls *"THE one hand-written
`bookshelf_id` filter outside `BookshelfScope`"*, and `AuditLog` is deliberately
exempt from `BelongsToBookshelf` because global rows exist. **Six administration
actions write them** — 3b-ii's five (`system_settings.updated`,
`site_contact.updated`, three `category.*`) and 3b-i's
`user.promoted_super_admin` — and every one is invisible today. `known-gaps.md`
records both, and 3b-i's entry adds that if the archived-shelf resolver filter
ever lands, `bookshelf.created`/`archived`/`unarchived` become unreachable from
the shelf's own log too — *"that argues for an admin-side audit view."* This
phase is that view, which is why the two are connected rather than merely
adjacent.

## 3. Scope

**In:** the reader's *Góp ý*; the public contact form; `/admin/feedback` with
its list-and-detail, filters and unread badge; `/admin/audit` with BR:606's four
filters; per-manager activity as D4 defines it; the first feedback writer with
its in-command rate limit; three new audit actions.

**Out:** Phase 4's cutover. The archived-shelf resolver filter and its export —
**and this is the last phase that could have scoped them, so they now belong to
Phase 4 or later, not to "a later phase of 3".**

## 4. Decisions

### D1 — One writer, and the guest fields are written on **every** submission

The reader's *Góp ý* and the public contact form are two routes into one
`SubmitFeedback`. They differ in what they know about the sender.

**They are not "member_id or the guest trio".** The first draft said that and it
is wrong: the reference's insert names `bookshelf_id, member_id, guest_name,
guest_contact, guest_hash` together, writing the **form's** name and contact
every time and `member_id` as *additional* attribution. The reference records the
live incident from conflating them
(`old_next/src/domain/admin/queries/get-feedback-inbox.ts:38-47`): a signed-in
reader typing *"Chị Hạnh"* was displayed as *"Quản trị viên"*, and the
administrator rang the wrong person.

So the inbox shows the name the sender typed, and the account they were signed
into as a separate fact, never one standing in for the other.

**The shelf surface is guest-reachable too.** `routes/web.php:220` sits
deliberately outside the `role:reader` group, recorded at
`RouteOrderTest:101,117` — though note that is an **exemption, not a pin**:
`$excludedSegments = ['manage', 'feedback']` *removes* the route from the
role-gate assertion, so adding `role:reader` to it would leave the suite green.
`HandleInertiaRequests:83-86` carries the same intent. So `member_id` is not guaranteed even there.

`Feedback` is deliberately not `BelongsToBookshelf`, which is what lets the
public path work at all: the contact page must touch no shelf-scoped model or
`BookshelfScope` throws for the visitor it exists for.

### D2 — The limit lives in the command, over a rolling 24 hours, and hashes a **normalised** phone

Two corrections to the first draft, both of which would have shipped a defect
this port has already paid for once.

**Hash `Phone::normalise()`, not the whitespace-stripped string.**
`AppServiceProvider:123-131` records the Task 13 fix: *"`0912345678` /
`0912 345 678` / `0912.345.678` / `0912-345-678` / `+84912345678` — five
spellings of the identical phone, every one accepted by `Phone::isValid()` —
each got its own 20/day bucket."* Whitespace-stripping alone buys a spammer fifteen
messages a day instead of three.

**The limit is a domain rule, not route middleware.** The reference counts
`feedback` rows over a **rolling 24-hour window** off an injected clock and
raises `RuleViolated("rate_limited")`. That differs from a Laravel `RateLimiter`
in store (table vs cache), window (rolling vs calendar day) and outcome (a
rendered Vietnamese refusal vs a 429). We port the domain rule.

`rate_limited` has **no `lang/vi/rules.php` entry today**, so it must be minted
with its census entry. So must `feedback_fields_required`. And the phone is
validated with `assertPhone` — the reference's own QA round found
`khong-phai-so` accepted and stored on the one form a shelf-less parish has.

**Two deliberate divergences from the reference, both stated rather than
smuggled:**

1. **Hashing `Phone::normalise()` is a deviation, not a correction.** The
   reference really does strip whitespace only. Normalising also folds `.`, `-`
   and `+84`→`0`, so this port's key is stricter — and a test written against it
   would fail against the reference. This port already made that choice once for
   the register limiter and it is the right one; it is a divergence all the same.
2. **The 24-hour count is genuinely global here.** The reference's count is
   RLS-blind across shelves and documented as a known gap. This port has no RLS
   and `Feedback` is not `BelongsToBookshelf`, so a plain
   `where('guest_hash', …)` count spans every shelf — silently closing the
   reference's gap. Note `feedback.guest_hash` carries **no index**, so the
   plan should decide whether to add one.

`DAILY_LIMIT = 3`. The hash is SHA-256 with no salt, and the reasoning is worth
carrying verbatim because the flattering misreading is easy:

> the point is not to make the number unrecoverable by an attacker who already
> has the table — a phone number has far too little entropy for any hash to
> achieve that — it is that the column is not itself a directory. A per-row salt
> would break the lookup this exists to perform; a fixed pepper would be one more
> secret to lose.

### D3 — The inbox is super-admin only, and it is a queue with a shape

Ruled by the product owner on 2026-09-01. The reference gates every feedback **read**, and both handling writes, on
`requireSuperAdmin` — `submitFeedback` itself has no floor at all, being *"the
one command in the catalogue with no floor"*, which is what D1 is about. BR §13.2 files "view feedback, resolve
feedback" under Community with no role restriction, and this port built
`Bookshelf::feedback()` for shelf-scoped reads — so **that relation becomes
unused**, kept rather than deleted because the archived-shelf export will want
it. Recorded in `known-gaps.md`, not left to be discovered.

Behaviour the first draft omitted, all of it from the reference:

- **List, detail and the unread count resolve in ONE read.** The reference's
  docstring is about that, not about marking: *"Resolved inside the same
  callback, so the whole page is one read-only transaction and one instant. Two
  calls would have been two transactions… a list and a detail pane disagreeing
  about what is unread."*
- **Opening a message does NOT mark it read.** Marking is an explicit
  administrator act — a form button (*"Đánh dấu đã đọc"*) calling its own
  command. An earlier draft of this spec had the read happen in the same
  transaction as the open, which would have made that button meaningless and
  written a `feedback.read` audit row every time anybody looked at anything.
  D8's own table already said otherwise; the two contradicted each other.
- **An unknown filter value means "no filter"**, never an empty list. The
  reference: *"an empty inbox that reads as 'no messages' is the shape of a bug
  this project has already shipped twice."*
- **`guest_contact` appears in the detail only, never the list**, and
  `guest_hash` in neither.
- **Unread first, then newest.**
- **An unread badge** in the admin shell, sharing the inbox's own predicate — the
  `pendingDonations` shape, which 3b-i and 3c-i both used and which 3a had to fix
  once for drift.
- **A null shelf renders as "Toàn hệ thống"**, not as blank.

### D4 — Per-manager activity **is** the actor filter on the audit browser

**Reversed after review, and this was the first draft's worst error.** It claimed
the reference has no implementation of BR:608 and that this would be the one
screen in the migration written from a requirement alone.

The reference ships it: `quan-tri/quan-ly-vien/page.tsx:263` links
`` `/quan-tri/nhat-ky?nguoi=${m.userId}` ``, and the audit page's docstring says
so — *"Filtering by actor is the way through today — a manager belongs to one
shelf — and the managers list links here with the actor already set."*

BR:608's *"grouped by type"* is answered by the audit browser's **group chips**
(the reference's `AUDIT_GROUPS`, six there and five here), not by the five phrases BR happens to list. The first
draft proposed mapping those five phrases onto actions, which is a task the
reference deliberately declined — and the mapping does not partition a manager's
log anyway: `request.*`, `announcement.*`, `comment.*`, `membership.suspended`
and the `profile_change.*` family all sit in it and belong to none of the five.

So there is **no separate screen**. `/admin/managers` gains a link per row,
carrying the actor. That is the whole of BR:608.

### D5 — BR:606's shelf filter and date range are new work, and the query needs an allow-list entry

The reference's audit page has **two** filters — group chips and actor — plus
pagination, and **no shelf filter and no date range**. It names the gap itself:
*"Which shelf an entry belongs to is not shown, and that is a gap worth naming."*

**But only ONE of BR:606's four filters is new here, not two.**
`AuditLogQuery::run(?actorId, ?group, ?from, ?to, int $page)` (`:56`) already
implements the date range, including the Asia/Ho_Chi_Minh civil-day boundary and
the inclusive upper bound (`:76-84`), and `Manage\AuditLogController:46-47`
already parses `?from=`/`?to=`. An earlier draft called the date range new work,
which would have had a task re-deriving a timezone boundary this repo has
already paid for. **The shelf filter is the only new one.**

**Reuse versus a second query.** The reference runs the *same* `getAuditLog`
under an admin scope, and argues the case: *"A second query would have been a
second definition of what an audit entry is … and the two would come to disagree
about a sentence the day one of them grew a case."* `AuditLogQuery` here is ~200
lines of joins, collation guards (this repo's *"six-times-paid live 500"*),
sentence rendering and ordering. The first draft asserted "do not widen it"
without weighing that.

**The decision: a new class in `app/Queries/Admin/`, composing rather than
duplicating.**

Be precise about what is shared, because an earlier draft was not. **Sentence
rendering is already shared and is not in `AuditLogQuery` to move** — it calls
the static `AuditSentences::groupOf/sentence/payloadRows` (`:161-165`). What
would genuinely be duplicated is the **join and select block** (`:88-146`): two
`leftJoin`s carrying the `CONVERT(… USING ascii) COLLATE ascii_bin` guards, the
four-way `coalesce`, the page size and the `occurred_at desc, id desc` total
order.

The two classes differ in exactly **one private method** — `scoped()`
(`:207-221`). So the honest options are *extract the builder* or *make the scope
injectable*, and the plan picks one. Duplicating the joins is what the reference
warns against; reusing the shelf-scoped class outright would change what its
`TenancyArchitectureTest` allow-list entry means.

**The all-shelves case needs no filter at all** — `AuditLog` carries no global
scope, so global rows come for free, and the first draft's *"it must include rows
with a null bookshelf_id, that is the whole point"* was a non-problem. **BR:606's
shelf filter is the real one**: it needs a literal `bookshelf_id` predicate, and
`whereHas('bookshelf', …)` cannot express "site-wide only". `TenancyArchitectureTest`'s
allow-list is whole-file and its pattern matches `whereNull('bookshelf_id')` too,
so **the new file takes an allow-list entry, deliberately**, the way
`AuditLogQuery` already does.

Also carried from the reference: pagination (25 a page, already in
`AuditLogQuery`), the `<details>` before/after diff (BR §14's own placement for
raw values), and a neutral rendering for an action with no sentence.

### D6 — The audit row's shelf comes from the **message**, not from the caller

`auditScopeFor`, dropped whole by the first draft. In the reference the shelf on
a feedback audit row is decided by the message, and a caller scoped to a
disagreeing shelf is refused `not_permitted`. Both silent failure modes shipped
once: resolving one parish's message under another's scope wrote the sentence
into the wrong parish's log.

So: `forShelf($message->bookshelf_id)` when the message names a shelf, `global()`
when it does not — and the command's API accepts a null shelf from a
scoped caller, which is what `auditScopeFor` refuses. Note the shipped reference
produces that case **only** from `/lien-he`: the shelf form omits the field
deliberately. An earlier draft claimed a reader's *Góp ý* can be site-wide,
which is true of the API and not of any surface. Mark-read and resolve run from
`/admin` with no tenant bound, so they configure explicitly or the recorder
throws.

### D7 — The audit configurator's fence, and where `SubmitFeedback` lives

The first draft stated two facts in one paragraph without noticing they collide:
`feedback.submitted` from the public form needs `global()`, and the configurator
is fenced by `WideningArchitectureTest:122-126` to `app/Actions/Admin/` — but
`SubmitFeedback` is a guest-open community write, not an administration action.

**The decision: `SubmitFeedback` lives in `app/Actions/Community/`, and the
audit-configurator fence takes a ONE-FILE allow-list entry.**

An earlier draft proposed widening the fence to the whole
`app/Actions/Community/` directory and called that "the smallest honest grant".
It is not, and the file itself shows why: `offendersFor($pattern, $allowed)`
takes a **path-suffix allow-list**, and the audit-configurator block passes `[]`
(`WideningArchitectureTest:125`). The `systemWide` block right above it already
allow-lists three individual files by name. So the narrow exit is one entry —
`app/Actions/Community/SubmitFeedback.php` — granting the capability to exactly
the file that needs it.

Directory-widening would have opened `global()` **and** `forShelf()` to every
present and future file in `app/Actions/Community/`, which already holds
`CreateAnnouncement`, the pin/unpin pair and the comment and donation actions —
precisely the shelf-scoped commands the fence exists to stop opting out of
tenancy.

**And the grant is smaller still than that, because only the public surface
needs it.** `AuditRecorder::record()` throws only when **no tenant is bound**
(`:91-107`), so the shelf's *Góp ý* — which runs under a bound tenant — audits
normally with no configurator at all. In the reference the shelf form never
submits site-wide: it omits `bookshelfId` on purpose and the page docstring says
*"The shelf is not named in the form."* Only `/lien-he` passes null. So the
fence is touched for **one call site on one route**.

Mark-read and resolve stay in `app/Actions/Admin/` — they are administration.

### D8 — Three new audit actions, 63 → 66, and `feedback.archived` is not ported

| action | when |
|---|---|
| `feedback.submitted` | a message is sent, from either surface |
| `feedback.read` | an administrator marks it read |
| `feedback.resolved` | an administrator marks it resolved |

Group `community`, where `comment.*`, `announcement.*` and `donation.*` sit. No
new group.

**`feedback.archived` is deliberately not ported.** `OPERATIONS.md:723-731` lists
`ArchiveFeedback` provisionally, with its own audit action and an open question
about an inert "Lưu trữ" button. BR:610 asks only that messages be *"markable
read and resolved"*. Porting a provisional operation to satisfy a count would be
inventing a feature; the count is 66 **because** it stays out, and OPS's entry is
annotated rather than silently ignored.

### D9 — Marking read and resolved is a status move

`new` / `read` / `resolved`, with `handled_by` and `handled_at`. Nothing is
deleted and nothing is edited: a message a parishioner sent is a record.

## 5. Testing

1. **The public form submits with no membership and no shelf**, writing a null
   `bookshelf_id` — and touches no shelf-scoped model.
2. **The guest name and contact are written on every submission**, including a
   signed-in reader's, with `member_id` alongside rather than instead — the
   wrong-person defect the reference recorded.
3. **The inbox shows the typed name and the account as separate facts.**
4. **Five spellings of one phone are one sender** — the `Phone::normalise()`
   fix, not whitespace-stripping.
5. **The fourth message in a rolling 24 hours is refused** with a rendered
   Vietnamese sentence, not a 429.
6. **An invalid phone is refused** on the one form a shelf-less parish has.
7. **An unknown filter value shows everything**, never an empty inbox.
8. **`guest_contact` is absent from the list payload** and present in the detail.
9. **List, detail and the unread count resolve in ONE read**, so the panes
   cannot disagree about what is unread — and **opening a message does NOT mark
   it read** (D3). An earlier draft of this line said the opposite and would
   have had every glance write a `feedback.read` audit row.
10. **The audit browser shows global rows** when no shelf is named and hides them
    when one is — the six actions invisible until now.
11. **Each of BR:606's four filters narrows, and they compose.**
12. **`/admin/managers` links to the audit browser with the actor set** — the
    whole of BR:608.
13. **A feedback audit row carries the message's shelf**, and a caller scoped to
    a different one is refused.
14. **The census passes at 66**, both directions, partition at `community`.

Per project practice, **every test is watched failing before it is accepted**.

## 6. Architecture pins this phase will hit

- **`TenancyArchitectureTest`** — whole-file allow-list, pattern matches
  `whereNull('bookshelf_id')` too. D5's new query takes an entry deliberately.
- **`WideningArchitectureTest`** — two separate fences. `systemWide()` stays
  confined to the two admin directories; the audit configurator's fence takes a
  **one-file** allow-list entry per D7 — `app/Actions/Community/SubmitFeedback.php`,
  not the directory. An earlier draft of this line said the directory, which D7
  argues against at length.
- **`AuditActionCensusTest`** (set-equality both ways, computed names banned) and
  **`AuditSentencesTest`**'s group partition and count, 63 → 66.
- **`RuleViolatedCodesHaveSentencesTest`** — globs all of `app/`, blind to a
  ternary first argument, and **reads raw source so an example in a comment mints
  a code**. New codes here: `rate_limited`, `feedback_fields_required`.
- **`FreeTextEncodingGuardTest`** — `guest_name`, `guest_contact`, `subject`,
  `body`.
- **`RouteOrderTest`** — `:101,117` *exempt* the shelf feedback route from the
  role-gate assertion rather than pinning it; super-admin on `admin/`; tenant on `{shelf}`; **no Vietnamese path
  segments** (the reference's are `/gop-y`, `/nhat-ky`, `/lien-he`).
- **`NotificationsAreReaderFacingTest`** — if anything here notifies, four places
  change in one commit.

## 7. Risks

- **The feedback slice is the largest untouched surface left**, deferred since
  2b, and this phase builds a writer, a limiter and three readers at once.
- **D7 widens an architecture fence.** It is the narrower of the two and the
  grant is argued, but it is still a fence moving to accommodate code.
- **The audit browser changes what "the audit log" means** — six actions become
  visible for the first time. Anything assuming the log was shelf-scoped should
  be re-checked.
- **After this, only cutover remains.**
