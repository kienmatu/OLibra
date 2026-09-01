# Phase 3c-ii — oversight and feedback

Status: draft for review
Date: 2026-09-01
Branch: `feat/phase-3c-ii-oversight-and-feedback`, cut from `main` at `0993a90`

## 1. Context

OLibra is a Vietnamese parish lending-library system being ported from Next.js to
Laravel + Inertia + React. `old_next/` is a **read-only** behavioural reference.
Phases 0–3c-i shipped everything up to the profile-change lifecycle.

**This is the last phase before cutover.** Phase 4 deletes the Next.js tree,
rewrites the architecture documents against the shipped stack, and tags
`v0.2.0`. After this spec there is nothing left of Phase 3.

## 2. Problem statement

Three placeholders remain, and one deferred feature. They share a subject:
**everything that lets a person outside the loop reach someone inside it, and
everything that lets an administrator see what was done.**

- `routes/web.php:220` — the reader's *Góp ý*.
- `:828` — `/admin/audit`, the cross-shelf audit browser.
- `:829` — `/admin/feedback`, the inbox.
- **The public contact form**, deferred by 3b-ii explicitly *to land with the
  inbox that reads it* — a form whose messages nobody can read promises a reply
  that cannot come.
- **Per-manager activity** (BR:608), which has no route at all.

**The feedback slice has no writer anywhere in the application.** `Feedback` has
a model, a table and an enum; the only reference to it in `app/` is a `hasMany`
on `Bookshelf`. Phase 2b deferred the slice **whole** — form and inbox — to
Phase 3. So today a reader who wants to say something to their parish, and a
parish with no shelf that wants to reach the administration, both have nowhere
to go.

**The audit log is shelf-scoped and cannot see the rows this port already
writes.** `AuditLogQuery` carries what its own docblock calls *"THE one
hand-written `bookshelf_id` filter outside `BookshelfScope`"*, and `AuditLog` is
deliberately exempt from `BelongsToBookshelf` because **global rows exist**.
Phase 3b-ii wrote five of them (`system_settings.updated`,
`site_contact.updated`, three `category.*`) and recorded that they *"land where
no screen can read them"*. This phase is the screen.

## 3. Scope

**In:** the reader's *Góp ý*; the public contact form; `/admin/feedback`;
`/admin/audit`; per-manager activity; the first feedback writer and its rate
limit; three new audit actions.

**Out:** Phase 4's cutover work. Also still out: the archived-shelf resolver
filter and its export, deferred since 3b-i and still blocked on export being
scoped — **this is the last phase that could have scoped it, so it now
definitively belongs to Phase 4 or later.**

## 4. Decisions

### D1 — One feedback writer, three surfaces

The reader's *Góp ý*, the public contact form and (later) any other entry point
are three routes into **one** `SubmitFeedback` Action. They differ in what they
know about the sender, not in what they do:

| surface | `bookshelf_id` | sender |
|---|---|---|
| reader's *Góp ý* | the bound shelf | `member_id` |
| public contact form | **null** — site-wide | `guest_name` / `guest_contact` |

The table already models both: `member_id` and the `guest_*` trio are
alternatives, and `bookshelf_id` is nullable for exactly the site-wide case.

`Feedback` is deliberately **not** `BelongsToBookshelf` — which is what makes
the public path safe. The contact page must touch no shelf-scoped model, or
`BookshelfScope` throws for precisely the visitor it exists for.

### D2 — The rate limit is 3 per day, keyed on a hashed phone, and the hash is not for anonymity

`DAILY_LIMIT = 3`, keyed on SHA-256 of the whitespace-stripped phone. **Copy the
reference's reasoning, because it is easy to get wrong in the flattering
direction:**

> SHA-256 with no salt, deliberately: the point is not to make the number
> unrecoverable by an attacker who already has the table — a phone number has
> far too little entropy for any hash to achieve that — it is that the column is
> not itself a directory. A per-row salt would break the lookup this exists to
> perform; a fixed pepper would be one more secret to lose.

The column is `feedback.guest_hash`. It exists so the table does not accumulate
every number anybody ever typed, including people who never registered.

**This port already has the shape.** `AppServiceProvider`'s `register` limiter
carries a long comment settling the same question for the other guest-open
write, and its reasoning binds here: **per-IP alone is wrong**, because BR §16.1's
scenario is a room of people on one parish connection — a tight per-IP budget
throttles the legitimate event and stops no script, since addresses rotate and a
parish's does not. The day budget is keyed on the hash, **falling back to the IP
when the phone is blank so the phone-missing route is not an open bypass.**

### D3 — The audit browser is where the global rows finally become readable

`AuditLogQuery` filters `bookshelf_id` by hand and therefore **excludes every
global row**. Phase 3b-ii wrote five and recorded the consequence; 3c-i noted the
same for `user.promoted_super_admin`.

So `/admin/audit` needs its own cross-shelf query in `app/Queries/Admin/`, and it
**must include rows with a null `bookshelf_id`** — that is the whole point.
Filters per BR:606: shelf, actor, action type, date range. The shelf filter's
"all shelves" case is what surfaces the global rows; naming a shelf hides them,
which is correct.

**Do not widen `AuditLogQuery` itself.** Its hand-written filter is allow-listed
by `TenancyArchitectureTest` on the strength of being shelf-scoped; making it
cross-shelf would change what that allow-list entry means.

### D4 — Per-manager activity is a port with no source

BR:608: *"Everything one manager has done, grouped by type — books added, loans
made, returns received, conditions assessed, registrations approved."*

**The reference has no implementation.** There is no `getManagerActivity`, no
route, no screen. So this is the one screen in the entire migration written from
the requirement alone, and the spec should say so rather than implying a port.

It reads the audit log grouped by action, filtered to one actor, across shelves —
so it shares D3's query object rather than growing a second cross-shelf reader.
The five groupings BR names map onto existing audit actions; **the mapping is
work, not a lookup**, and it must be stated in the plan rather than guessed at
during implementation.

Reachable from `/admin/managers`, which 3b-i built and which already lists every
manager with a `lastActiveAt` read from the audit log — so the row is already
there to link from.

### D5 — Three new audit actions, 63 → 66

| action | when |
|---|---|
| `feedback.submitted` | a message is sent, from either surface |
| `feedback.read` | an administrator marks it read |
| `feedback.resolved` | an administrator marks it resolved |

Matching the reference. `feedback.submitted` from the **public** surface has no
shelf, so it needs the `global()` configurator; from the reader's surface it has
one. That is the same fluent shape 3b-i built for `AuditRecorder` and 3c-i
extended to `Notifier`, and it is fenced to `app/Actions/Admin/`.

Group: `community`, where the other reader-voice actions sit. **No new group.**

### D6 — Marking read and resolved is a status move, not a deletion

`feedback.status` is `new` / `read` / `resolved`, with `handled_by` and
`handled_at`. BR:610 asks only that messages be *"markable read and resolved"*.
Nothing is deleted and nothing is edited: a message a parishioner sent is a
record, and the inbox is a queue over it.

## 5. Testing

1. **The public contact form submits for a caller with no membership and no
   shelf** — the case the page exists for, and the one that throws if any
   shelf-scoped model is touched. It writes a null `bookshelf_id`.
2. **The reader's *Góp ý* writes the bound shelf and `member_id`**, not the guest
   fields.
3. **The fourth message in a day from one phone is refused**, and **a blank phone
   falls back to the IP** so the phone-missing route is not a bypass.
4. **The hash is of the whitespace-stripped number**, so `09 11 111 111` and
   `0911111111` are one sender.
5. **The audit browser shows global rows** when no shelf is named, and hides them
   when one is — the behaviour that makes 3b-ii's five rows readable at last.
6. **Each of BR:606's four filters narrows**, and they compose.
7. **Per-manager activity groups one actor's rows by type**, and shows nothing
   for a manager who has done nothing.
8. **Marking read then resolved moves the status and stamps the handler**, and
   neither deletes nor edits the message.
9. **The census passes at 66**, both directions, partition at `community`.

Per project practice, **every test is watched failing before it is accepted**.

## 6. Architecture pins this phase will hit

- **`TenancyArchitectureTest`** — `AuditLogQuery`'s hand-written `bookshelf_id`
  filter is allow-listed; a **new** cross-shelf query must not add a second
  hand-written filter outside the allow-list. Reach through relations, or take
  an allow-list entry deliberately.
- **`WideningArchitectureTest`** — `systemWide()` to the two admin directories;
  the audit and notifier configurators to `app/Actions/Admin/` alone.
- **`AuditActionCensusTest`** (set-equality both ways, computed names banned) and
  **`AuditSentencesTest`**'s group partition and count, 63 → 66.
- **`RuleViolatedCodesHaveSentencesTest`** — globs all of `app/`, asserts
  set-equality, is blind to a ternary first argument, and **reads raw source, so
  an example in a comment mints a code**. That bit two phases running.
- **`FreeTextEncodingGuardTest`** — the feedback form is almost entirely free
  text: `guest_name`, `guest_contact`, `subject`, `body`.
- **`NotificationsAreReaderFacingTest`** — a census over `OPERATIONS.md` §7's
  table. If any part of this phase notifies, it edits four places in one commit.
- **`RouteOrderTest`** — tenant middleware on `{shelf}`, super-admin on `admin/`,
  and **no Vietnamese path segments** (the reference's routes are `/gop-y`,
  `/nhat-ky`, `/lien-he`; none of those names carries across).

## 7. Risks

- **The feedback slice is the largest untouched surface left**, deferred whole
  since 2b, and this phase builds writer, limiter and three readers at once.
- **Per-manager activity has no reference** (D4). Everything about it is a
  reading of one sentence, so it is the most likely thing in this phase to be
  built wrong and the least likely to be caught by comparison.
- **The audit browser changes what "the audit log" means** — global rows become
  visible for the first time. Anything that assumed the log was shelf-scoped
  should be re-checked.
- **After this, only cutover remains.** Anything deferred here has no later phase
  inside Phase 3 to absorb it.
