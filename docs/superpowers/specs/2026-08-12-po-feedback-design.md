# Product owner feedback, round one — design

**Date:** 2026-08-12
**Status:** awaiting approval

Thirteen items from a product owner's walkthrough of the running application.
They are specified together rather than as thirteen tickets because they land on
a small number of shared surfaces: five of them touch
`src/components/shell/public-header.tsx`, four touch the shelf's identity
(`src/lib/shelf.ts` and the columns behind it), and three change who may approve
what. Splitting them across specs would mean three or four passes over the same
files and the same migration.

Three of the items contradict requirements that are written down and shipped.
Those are called out where they appear, and `docs/BUSINESS-REQUIREMENTS.md` is
updated as part of the work — code and requirements disagreeing silently is the
worse outcome.

**This spec assumes a development database that will be dropped and reseeded.**
The migration takes no backfill step for `users.saint_name`; it sets the
constraint and expects `bun run db:seed` to supply conforming rows. That is the
product owner's explicit instruction and it is recorded here because it is the
one decision in this document that cannot be taken again once a parish has real
data in the table.

---

## 1. Shelf contacts — one mandatory person, two optional

### What is wrong

A shelf has exactly one contact, stored as two nullable columns on
`bookshelves` — `keeper_name` and `keeper_phone` (`src/db/migrations/0003_identity.sql:47`).
A parish that runs its shelf with three volunteers has no way to say so, and the
one name it can record is labelled *Người giữ chìa khoá* whether or not that is
what the person does.

### What we build

A new table.

```sql
create table bookshelf_contacts (
  id            uuid primary key default gen_random_uuid(),
  bookshelf_id  uuid not null references bookshelves(id) on delete restrict,
  position      smallint not null check (position between 1 and 3),
  name          text not null,
  phone         text,
  role_label    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create unique index bookshelf_contacts_position
  on bookshelf_contacts (bookshelf_id, position)
  where deleted_at is null;
```

`position` carries the ordering rather than a `sort_order` free-for-all: the
product decision is *one mandatory contact and two optional ones*, and a column
constrained to 1–3 says that in the schema instead of leaving it to a form.
Position 1 is the mandatory one.

`role_label` is free text — *Người giữ chìa khoá*, *Quản lý tủ sách*, *Phụ
trách thiếu nhi*. A parish names its own volunteers' jobs; an enum here would be
a guess about parish structure that this project has no basis for.

**RLS and grants.** Reads are scoped to members of the shelf, exactly as
`readShelfIdentity` gates `keeper_name`/`keeper_phone` behind `requireReader`
today. Writes are super admin only (§2 below). **This table is deliberately
absent from the public-read grant.** BR §16.1 — *"a person with no membership
has no business knowing them"* — is the rule, and
`tests/architecture/the-front-door-shows-no-keeper-contact.test.ts` and
`tests/db/bookshelves-public-columns.test.ts` are the two checks that must keep
passing unchanged. A new table that leaked contacts to the portal would satisfy
neither.

**Migration path.** Insert `position = 1` from `keeper_name`/`keeper_phone` for
every shelf that has a `keeper_name`, then drop both columns. A shelf with no
keeper today gets no row and is flagged as incomplete in `/quan-tri/tu-sach`
(§2). The mandatory-ness of position 1 is enforced in the domain, not by a
database constraint — a `not null` guarantee cannot be added to shelves that
already exist without inventing a volunteer.

### Who may edit them

**Super admin only, at `/quan-tri/tu-sach`.** This is unchanged from how the
shelf profile works today: `/tu-sach/[shelf]/quan-ly/cai-dat` renders the
profile through read-only `InfoRow`s and offers no form
(`src/app/tu-sach/[shelf]/quan-ly/cai-dat/page.tsx:167`). Contacts join the same
fields under the same owner. `cai-dat` shows all three contacts, read-only, so a
manager can see what readers see.

The create-shelf and edit-shelf forms at `/quan-tri/tu-sach` grow three contact
blocks, single-column and stacked as AGENTS.md rule 6 requires. Block 1 is
marked *Bắt buộc*; blocks 2 and 3 carry no marking and are saved only when a
name is present. A block with a phone and no name is a validation failure, not a
silently dropped row.

### How readers see them

An accordion, built on `<details>`/`<summary>` — the same no-JavaScript
mechanism `MobileMenu` already uses (`public-header.tsx:26`). Contact 1 is
always visible: name, role label, and the phone through `PhoneLink`. Contacts 2
and 3 sit behind a summary reading **Xem thêm 2 người liên hệ** (or *1 người*),
and the summary is absent entirely when there is only one contact — a disclosure
control over nothing is worse than no control.

---

## 2. Shelf home page — the identity block shrinks

### What is wrong

The first card on `/tu-sach/[shelf]` is a 30px shelf name over a definition list
of location, address, opening hours and keeper
(`src/app/tu-sach/[shelf]/(doc-gia)/page.tsx:158`). The shelf name is already in
the topbar directly above it, three lines higher. The card fills most of a phone
viewport with information a member of that shelf learned once and never needs
again, and it pushes everything the page is actually for below the fold.

### What we build

The card becomes a **contact strip**:

- **No shelf name** — the topbar carries it, and repeating it is the defect.
- **No opening hours** — the field is gone entirely (§3).
- **No address or location rows** — a member of this parish knows where their
  own parish hall is. The two columns stay on `bookshelves` and stay visible in
  `/quan-ly/cai-dat` and `/quan-tri/tu-sach`, because the portal directory and
  the admin screens both have a use for them; the shelf's own home page does
  not.
- **The contacts accordion from §1**, and nothing else.

What fills the space it frees, in order down the page:

1. **The pinned announcement** (§9), or the most recent published one when
   nothing is pinned, as a single card. Absent entirely when the shelf has
   published none — an empty "no announcements" panel is a row of chrome saying
   nothing.
2. **One link to the catalogue**, `Xem toàn bộ tủ sách`, with the title count
   beside it. This replaces the two `BigActionLink`s that both pointed at
   `/danh-muc` differing only by a query parameter (§5).
3. **Tặng sách** and **Góp ý** cards, secondary emphasis, side by side above
   768px and stacked below. Both routes exist and are wired
   (`src/app/tu-sach/[shelf]/(doc-gia)/tang-sach/`, `.../gop-y/`); the shelf
   home has had no link to either since the fixture-era links were pulled.
4. **The *Mới thêm* cover row**, unchanged. It was not named in the feedback and
   it is the one thing on the page that changes week to week.

One primary action on the screen (AGENTS.md rule 3): the catalogue link. The two
cards below it are outline, and the announcement card is not an action at all.

---

## 3. Opening hours

Removed. `bookshelves.opening_hours` is dropped, along with its field on both
`/quan-tri/tu-sach` forms, its `InfoRow` on `/quan-ly/cai-dat`, its row on the
shelf home, and `openingHours` on `ShelfIdentity` (`src/lib/shelf.ts:170`),
`BookshelfProfile` and the admin command input.

This contradicts BR:179, which lists it as a shelf field, and the seed data
carries a value for it. Both are updated.

---

## 4. Search box in the mobile topbar

### What is wrong

`/tim-kiem` is reachable from the desktop nav and from inside the mobile
hamburger menu — two taps and a menu that hides the rest of the page. Search is
the most-used thing on a catalogue and it is the least reachable thing on a
phone.

### What we build

A `<form method="get" action="/tu-sach/[shelf]/tim-kiem">` in `ShelfHeader`,
rendered below `md` only, on **its own full-width row beneath the title row**.
The alternative — an input beside the shelf name — leaves roughly 120px for the
field at 375px once the home mark, the truncated shelf name and the avatar have
taken their 44px targets, which is a box nobody can read what they typed into.

The desktop nav keeps its **Tìm kiếm** link unchanged; there is room for the
link and no case for two search affordances at that width.

The input is `name="q"`, which is what `/tim-kiem` already reads
(`tim-kiem/page.tsx:104`) — the form submits into the existing page, and no new
query parameter or domain query is introduced.

---

## 5. The catalogue leaves the topbar

### What is wrong

*Danh mục* is the first item in the reader nav and the destination of both large
buttons on the shelf home, which differ only by `?loc=tat-ca`. The page is
reachable three ways from two screens.

### What we build

**Remove *Danh mục* from `ShelfHeader`'s links.** The catalogue is reached from
the shelf home's single link (§2). The page itself is unchanged — the
available/all segmented control, the category and sort chips, and pagination all
stay as they are. Its `active` key stays in the union, because the page still
highlights nothing else, and removing it from the nav does not remove it from
the app.

Nav after this change: **Bản tin · Trang của tôi · Thông báo · Tìm kiếm**, plus
the management links from §6.

---

## 6. Getting to the management pages

### What is wrong

Two dead ends, both found by walking the app as a real actor:

- A manager or shelf admin reading a shelf page as a reader has **no link into
  `/tu-sach/[shelf]/quan-ly`**. They type the URL.
- A super admin who opens any shelf page loses the **`/quan-tri`** link
  entirely — it exists only on `FrontDoorHeader`
  (`public-header.tsx:398`), and shelf pages render `ShelfHeader`.

### What we build

`ShelfHeader` takes the viewer's role and renders, after the reader links and
before the identity cluster:

- **Quản lý tủ sách** → `/tu-sach/[shelf]/quan-ly`, when the role is `manager`
  or above.
- **Quản trị hệ thống** → `/quan-tri`, when the viewer is a super admin.

Both appear in the desktop nav and inside the mobile panel (§7). Plain nav
links, not `ButtonLink`s — `FrontDoorHeader`'s own docstring already argues that
a second terracotta accent in the chrome competes with the page's primary
action, and that reasoning applies here unchanged.

**The role reaches the header through the existing `Viewer` seam.** `ShelfHeader`
must not import `@/lib/page-data`:
`tests/architecture/pages-reading-the-database-are-dynamic.test.ts` walks import
specifiers as text, and that import would make every page rendering any header —
`/dang-nhap` and `/loi` included — count as reaching Postgres. So the role
arrives as two plain props, `canManage: boolean` and `isSuperAdmin: boolean`,
resolved by each page from the `Viewer` it already has. This is the same
constraint and the same solution the file's existing `viewerName: string | null`
records.

---

## 7. The mobile menu becomes a profile panel

### What is wrong

The mobile toggle is a hamburger. The reader's name and avatar appear only on
desktop (`SignedInIdentity`, rendered inside the `hidden md:flex` nav), so on a
phone there is nothing that says who is signed in, and reaching *Trang của tôi*
means opening a menu and finding it among five text links.

### What we build

The `<summary>` becomes the **avatar** — the same initial-in-a-circle
`SignedInIdentity` draws, at 44px. Tapping it opens the panel, which is headed
by a block carrying the avatar, the reader's name, and the words **Trang của
tôi**, the whole block being a link to `/ho-so/tong-quan`. Below it, a hairline,
then the nav links, then the management links from §6, then sign out.

Tapping the avatar therefore opens the panel rather than navigating — one tap to
see who you are and where you can go, two taps to the profile page. The
alternative the product owner raised, an avatar that navigates directly, needs a
separate hamburger beside it, which is a third 44px target in a 375px header
that already carries the home mark, the shelf name and a search row.

---

## 8. Saint name and phone

### What is wrong

`saint_name` and `phone` are both nullable on `users`
(`0003_identity.sql:15,20`), and every form treats them as optional
(`optional(form, "ten-thanh")`, `src/app/dang-ky/actions.ts:68`). A parish
register with no saint name is not a parish register, and a reader with no phone
is a child a manager cannot reach.

### What we build

**Saint name becomes mandatory, in the form and in the column.**
`alter table users alter column saint_name set not null`, with **no backfill
step** — the development database is dropped and reseeded (see the note at the
top of this document). Every write path requires it: self-registration,
manager-creates-reader, manager-edits-reader, and a reader's own change
proposal. `REQUIRED_PROFILE_FIELDS` (`src/domain/members/profile-fields.ts:87`)
gains `saint_name`, so the domain refuses with `required_fields_missing` rather
than the driver raising `23502` — OPS §2 forbids a bare 500. `phone` does
**not** join that list: the column stays nullable and its requirement lives in
the interface, per the confirmation below.

**Phone becomes mandatory in the interface and stays nullable in the column.**
The column cannot honestly be `not null`: some readers are children with no
phone of their own, and a placeholder number is a tap that dials a stranger.
Instead, submitting a form with an empty phone raises a **danger confirmation
with a required reason**.

### The empty-phone confirmation

A client `<dialog>`, danger-styled, raised on submit at three points: reader
self-registration, a manager creating a reader, and a manager approving a
registration or a profile change whose phone is empty. It states plainly that
the shelf will have no way to reach this person, and requires a typed reason
before its confirm button enables.

The reason is stored — `users.phone_missing_reason text`, nullable, written
alongside the row and cleared the moment a phone is filled in. It renders on the
reader's manager-facing detail page beside the empty phone, so the next
volunteer to open the record reads *why* rather than assuming an oversight. The
write is audited like any other profile field.

**It degrades to a server refusal.** This is the first client-side form dialog
in the codebase, and the pages around it are server components with no
JavaScript. With JavaScript unavailable, the form submits, and the server action
refuses with `?loi=thieu-so-dien-thoai`, which renders the same warning and the
same reason field as an ordinary page. Nothing is only reachable through the
dialog.

---

## 9. Approval routing

### What is wrong

`approveProfileChange` calls `requireManager` and nothing else
(`src/domain/members/commands/approve-profile-change.ts:92`). A manager's own
proposed change is approved by a manager — including, in a one-manager parish,
by themselves.

### What we build

Two rules, both derived from the subject's membership role at approval time, so
**no schema change**:

| Subject of the change | Who approves | Where |
|---|---|---|
| `reader` | any `manager` or `admin` of that shelf | `/tu-sach/[shelf]/quan-ly/doi-thong-tin`, as today |
| `manager` or `admin` | `super_admin` only | **new** `/quan-tri/doi-thong-tin` |

Plus: **nobody approves their own proposal**, at any rank. A super admin
proposing a change to their own record is refused the same way, and the refusal
is a domain rule (`RuleViolated`), not a hidden button.

The shelf-level queue at `/quan-ly/doi-thong-tin` filters to reader subjects, so
a manager's pending change does not sit in a queue where nobody present can
decide it. The new admin queue is cross-shelf, listing every pending
manager-subject change in the system with the shelf named on each card, and
reuses the card layout and the approve/reject-with-reason pair the shelf queue
already renders.

Shelf `admin` holds every permission `manager` holds — that is already true of
`atLeast` and `ROLE_RANK`, and nothing here narrows it.

---

## 10. Copy counts on both book pages

### What is wrong

The reader's book page shows *"Có 3 trên 5 bản đang ở trong tủ"* and only when
`copiesTotal > 1` (`sach/[slug]/page.tsx:290`), which is why a single-copy book
appears to show nothing. Neither page says how many are out on loan, though
`getBookDetail` already returns `copiesAvailable`, `onLoan` and `copiesTotal`
(`get-book-detail.ts:162`).

### What we build

One line, the same wording on both pages:

> **3 bản có sẵn · 2 đang cho mượn · 5 bản trong tủ**

On the reader's page it sits in the availability panel, **shown at every count
including one**. On the manager's page it sits above *Các bản sách (5)* as a
summary of the table beneath it. No new query — both pages already have the
three numbers.

`onLoan` and `copiesAvailable` need not sum to `copiesTotal`: a lost or retired
copy is in neither. That is correct and it is why the third number is labelled
*bản trong tủ* rather than presented as a total the first two add up to.

---

## 11. The keeper line is hidden from managers

The reader's book page ends every availability state with *"Liên hệ {tên} ·
{số} để nhận sách."* (BR:511). A manager reading that page is the person being
named, or one of their colleagues. The line is hidden when the viewer's role is
`manager` or above.

This narrows BR:511, which says the line appears in every state. The requirement
is updated to say *for readers*.

---

## 12. Pinned announcements

`announcements.is_pinned` exists in the schema
(`src/db/migrations/0006_community.sql:36`), defaults to false, and **nothing
reads or writes it**.

### What we build

- A **pin/unpin control** on the Bản tin list and on each announcement's detail
  page, rendered only for `manager` and above. A form posting to a server
  action, not a link — `tests/architecture/no-button-without-a-form.test.ts` is
  the rule.
- **Pinned announcements sort first** on the list, above the newest unpinned
  one, and carry a `Pill` reading **Ghim** with its icon. Within the pinned set,
  newest first.
- The shelf home's announcement card (§2) shows the pinned one, falling back to
  the most recent published announcement.

Pinning is editorial, not personal: it applies to the shelf's Bản tin, never to
a reader's own notification list at `/ho-so/thong-bao`, whose rows are
per-reader records rather than posts a manager writes.

---

## 13. The leaderboard shows everyone

### What is wrong

`memberships.leaderboard_opt_in` gates who appears in *Bạn đọc chăm nhất* on
`/quan-ly/thong-ke`. The product owner wants the list to show the top readers
with no acknowledgement step.

### What we build

- **Drop the column.** `alter table memberships drop column leaderboard_opt_in`.
- Remove `and m.leaderboard_opt_in` from `get-statistics.ts:184`.
- Remove the toggle from the reader's own profile page and
  `leaderboardOptIn` from `updateOwnProfile`, `getMyProfile`,
  `getReaderDetail`, and the audit-action formatter
  (`src/domain/kernel/audit-actions.ts:446`).
- Remove the footnote on the statistics page explaining who is missing.

**This reverses a shipped privacy promise.** BR §5.4 and §16.2 make the
leaderboard opt-in per membership, and `get-statistics.ts:160` carries a
docstring arguing the case at length — *"The child was told their name would not
appear in this list. It does not."* The screen stays manager-facing, which is
the mitigation: managers can already see every loan through the lending screens
and the audit log, so nothing is disclosed to anyone who could not already
reach it. Were the list to become reader-facing, this decision would need
taking again. BR §5.4 and §16.2 are updated to record the change and its date.

---

## What this touches

**Migration** — one file, in order: create `bookshelf_contacts` with its RLS
policies and grants; backfill position 1; drop `keeper_name`, `keeper_phone`,
`opening_hours`; drop `memberships.leaderboard_opt_in`; `set not null` on
`users.saint_name`; add `users.phone_missing_reason`.

**Domain** — `src/lib/shelf.ts` (contacts replace two columns on
`ShelfIdentity`); `admin/commands/bookshelves.ts` (contact writes, opening hours
gone); `members/profile-fields.ts` (saint name required, phone reason);
`members/commands/approve-profile-change.ts` and `propose-profile-change.ts`
(routing, self-approval); a new admin query for the cross-shelf change queue;
`community/commands/announcements.ts` (pin/unpin); `shelf/queries/get-statistics.ts`;
`members/commands/update-own-profile.ts` and the two member queries.

**Pages** — `public-header.tsx` (search row, avatar panel, management links,
`Danh mục` removed, two new props); the shelf home; the reader book page; the
manager book page; `/quan-tri/tu-sach`; `/quan-ly/cai-dat`; the Bản tin list and
detail; the reader profile page; `/dang-ky`; `/quan-ly/nguoi-doc/moi` and
`/[id]`; `/quan-ly/doi-thong-tin`; new `/quan-tri/doi-thong-tin`.

**Requirements** — `docs/BUSINESS-REQUIREMENTS.md` §5.4, §16.2 (leaderboard),
§16.1 and BR:511 (keeper line), BR:179 (opening hours), plus the contacts model
and the approval routing table. `docs/DATABASE.md` for the schema changes.

**Tests** — `tests/domain/shelf/statistics.test.ts`,
`tests/domain/members/own-profile-and-queue.test.ts`,
`tests/components/public-header.test.tsx`,
`tests/db/schema.test.ts`, `tests/db/seed.test.ts`, and the seed itself. The two
disclosure guards —
`tests/architecture/the-front-door-shows-no-keeper-contact.test.ts` and
`tests/db/bookshelves-public-columns.test.ts` — must pass **unchanged**; if
either needs editing, the contacts table has been exposed somewhere it should
not be.

## Deliberately not in scope

- A reader-facing leaderboard. §13 keeps it on the manager's statistics screen.
- Merging `/danh-muc` and `/tim-kiem`. §5 removes the nav entry only.
- Any change to the reader's personal notification list beyond §12's boundary.
- More than three contacts per shelf.
