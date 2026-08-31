# Phase 3b-i — bookshelves and managers

Status: draft for review
Date: 2026-08-31
Branch: `feat/phase-3b-shelf-administration`, cut from `main` at `213d04f`

## 1. Context

OLibra is a Vietnamese parish lending-library system being ported from Next.js
to Laravel + Inertia + React. `old_next/` is a **read-only** behavioural
reference. Phases 0–3a shipped the schema, the catalogue, members, circulation,
community features, statistics, QR labels, and — in 3a — the cross-shelf
capability, the public portal and the super-admin dashboard. A design-system
port then brought the reference's typography and palette across.

Phase 3 is *the network*: what a person who runs several bookshelves needs. The
product owner decomposed it on 2026-08-31:

- **3a** — the network foundation. Shipped.
- **3b** — shelf administration.
- **3c** — oversight and feedback.

3b as ruled covers seven screens. That is roughly twice 3a, and this project's
cross-seam defects are caught by the whole-branch review, which gets less
reliable as a branch grows — so 3b is split, and **this spec is 3b-i**.

## 2. Problem statement

The super-admin area exists but is mostly scaffolding. `routes/web.php:521-535`
registers seven admin routes, and **six of them point at
`ShellController::underConstruction`**. Only the dashboard (3a) is real.

So today a super administrator can *see* that a bookshelf needs attention and
cannot *do* anything about it. There is no way, anywhere in the running
application, to:

- create a bookshelf, or edit one's name, address or lending policy;
- record who to phone about a shelf;
- appoint a manager, or take the role away.

Every shelf and every manager in the database got there by seeder or by hand.
An installation cannot be operated.

**3b-i closes the two routes that block operation** — `/admin/shelves` and
`/admin/managers` — and settles one decision Phase 3a deliberately handed over.
`/admin/settings`, `/admin/categories`, the public `/contact`, and the
shelf-level `manage/units` and `manage/settings` are **3b-ii**.

## 3. Scope

In: `/admin/shelves` (list, create, edit), `/admin/contacts` as part of the shelf
editor, `/admin/managers` (assign, revoke, promote), a `BookshelfPolicy`, six
new audit actions, and the `ResolveTenant` archived-shelf filter.

Out: everything listed as 3b-ii above; the whole of 3c (audit browser,
per-manager activity, cross-shelf profile-change queue, feedback inbox).

## 4. Decisions

### D1 — The slug is fixed after creation

BR §16.4: *"The slug is fixed after creation, since it appears in shared links."*
A parish puts `/shelves/dong-thap` on a printed notice; changing it silently
breaks every such link and every QR label already stuck inside a book cover.

So `slug` is an input on create and is **rendered read-only on edit**. This is
enforced server-side, not merely omitted from the form: the update path ignores
a submitted `slug` entirely rather than validating it, so a hand-crafted request
cannot move a shelf's URL.

The database already carries `bookshelves.slug_active`, a generated column that
makes uniqueness-while-alive an index rather than a check, so create validates
against that.

### D2 — Profile and policy save separately

The reference splits the shelf editor into `updateBookshelfProfileAction` and
`updateBookshelfPolicyAction` (`old_next/src/app/quan-tri/admin-actions.ts:225,263`),
and we keep that seam. They are different kinds of edit: the profile is what the
shelf *is* (name, location, address, description, established date), the policy
is twelve numeric and boolean settings from BR §5.5 that change how lending
behaves. Saving them together would mean a typo in `loan_days` blocks correcting
an address.

Each form reports its own success and its own refusal, beside itself. The
reference records why at length: a single `?saved=1` marker on a page with two
independently-submittable forms cannot say *which* form saved, and a refusal
rendered in one banner above both leaves the reader guessing.

### D3 — Contacts: one required, two conditional, none public

BR §189 and §16.4. Up to three contacts per shelf, `position` 1–3 unique per
shelf — the schema already enforces uniqueness through `bookshelf_contacts.position_key`.

- **Position 1 is required by the interface, not by the column.** A shelf
  onboarded before this table existed may have no contacts at all, and is
  flagged incomplete on the admin list rather than assigned an invented
  volunteer. 3a's dashboard already flags exactly this.
- **Positions 2 and 3 are saved only when a name is given.** A blank name means
  the row is absent, not an empty row.
- `role_label` is free text: a parish names its own volunteers' jobs
  (*Người giữ chìa khoá*, *Quản lý tủ sách*). We ship no enum.
- **No caller without a membership on the shelf may read this table.** BR §189
  draws this boundary explicitly, and 3a's portal decision (D2) already refused
  to show contacts publicly. The admin screens read them as super admin; nothing
  in this phase exposes them to a public route.

### D4 — An archived shelf serves its managers, not its readers

Ruled by the product owner on 2026-08-31, closing what 3a left open.

`ResolveTenant` has no status filter today, so an archived shelf serves every
tenant-bound route exactly as a live one does. 3a declined to change it in a fix
wave, correctly: it alters the entry condition of every tenant-bound route at
once, and *what an archived shelf may still serve* is a decision rather than a
bug.

The decision: **a manager or shelf admin of an archived shelf keeps access; a
reader or the public gets 404.** Archiving is not deletion — a shelf may be
archived with books still on loan, and the people who have to settle those loans,
export the register, or un-archive the shelf are exactly its managers. Readers
have no such errand.

404, never 403, matching the project's existing convention (`EnsureSuperAdmin`
already 404s, and §5.4 of the migration spec makes not-found the tenancy answer
throughout): a reader learning that a shelf *exists but is archived* is a
disclosure they have no membership to justify.

Concretely, for shelf `dong-thap` with `status = 'archived'`:

| caller | `/shelves/dong-thap/catalogue` | `/shelves/dong-thap/manage/books` |
|---|---|---|
| its manager | 200 | 200 |
| its reader | 404 | 404 |
| a stranger | 404 | 404 |
| super admin | 200 (via the admin area) | 200 |

### D5 — Revoking is demotion to reader, and there is no super-admin demotion

The reference's `revokeManager` sets `role = 'reader'` and leaves the membership
row standing (`old_next/src/domain/admin/commands/managers.ts:107`). That is what
BR §16.4's *"states plainly that history is retained"* means concretely: the
person keeps their membership, their registration, their loan history and their
audit trail; only the grant goes. Revoking a membership that is already `reader`
is refused as `not_permitted`.

**There is deliberately no demotion from super admin.** The reference's own
docstring is the reasoning, and it is sound:

> Removing the last administrator's own grant would lock the installation out of
> its own administration surface, and nothing in the requirements says what
> should happen instead.

We port that omission as an omission, and record it in `docs/known-gaps.md`
rather than inventing a rule the requirements do not contain. `promoteSuperAdmin`
refuses when the target is already a super admin.

### D6 — Revoking a shelf's last manager is permitted, and flagged

This is the decision in this spec most likely to be wrong, so it is stated
plainly rather than buried.

The reference permits it: `revokeManager` checks only that the target is not
already a reader. Nothing counts the shelf's remaining managers. So a super
administrator can leave a shelf with no manager at all — its readers can still
borrow nothing, no one can approve a registration, and only the admin area can
repair it.

We **port the behaviour faithfully and do not add a guard**, for two reasons.
First, a super administrator is the person who would fix it, and they are the
only one who can reach the screen — the failure is visible and recoverable from
the same place it is caused. Second, inventing a refusal here means inventing its
wording, its edge cases (what about a shelf whose only manager is suspended?),
and a rule the requirements never state; 3a's dashboard already flags shelves
needing attention, which is where a zero-manager shelf belongs.

It is recorded in `docs/known-gaps.md` as a deliberate port of a sharp edge, with
this reasoning, so that a future phase adding the guard knows it is closing a
known hole rather than discovering a bug.

### D7 — The taxonomy editor lands in 3b-ii, on this same screen

BR §16.4 places the parish-taxonomy editor (level count, level labels, nesting,
and the unit lists) inside the Bookshelves screen. The split in §1 puts taxonomy
in 3b-ii — so 3b-i builds the shelf editor with its profile, policy and contacts
sections, and **3b-ii adds a taxonomy section to the same screen** rather than
either phase building that screen twice.

3b-i therefore must leave the editor's layout able to take another section
without restructuring. Nothing more; no placeholder tab, no dead markup.

### D8 — A `BookshelfPolicy`, and 404 rather than 403

The eight existing policies cover per-shelf resources. Administration is
different: it is not scoped to a tenant at all, and its gate is
`users.is_super_admin`.

`EnsureSuperAdmin` already guards the route group and aborts **404**. The policy
exists for the object-level questions the middleware cannot answer — may this
shelf be archived, may this membership be revoked — and returns the same 404
shape via `Response::denyAsNotFound()` so a refusal is indistinguishable from a
row that does not exist.

### D9 — Six new audit actions, each with a sentence

`AuditActionCensusTest` asserts exact correspondence between actions recorded in
code and sentences declared in `AuditSentences::ACTIONS` (115 today), and bans
computed action names. Administration is BR §458's own list:

| action | when |
|---|---|
| `bookshelf.created` | a shelf is created |
| `bookshelf.updated` | profile or policy saved |
| `bookshelf.archived` | a shelf is archived |
| `bookshelf.unarchived` | a shelf is restored |
| `membership.role_assigned` | a reader is made manager or shelf admin |
| `membership.role_revoked` | a manager or shelf admin is demoted to reader |
| `user.promoted_super_admin` | a person is granted the global role |

That is seven, not six: `bookshelf.unarchived` is ours rather than BR §458's,
because D4 makes un-archiving the documented repair path for an archived shelf
and an unaudited un-archive would be the one administration action with no
record. `membership.role_revoked` matches the reference's existing name.

## 5. Testing

The risks here are authorisation and tenancy, so the guards are about who may
reach what, not about markup.

1. **Slug immutability** — an update carrying a changed `slug` leaves the stored
   slug untouched. Not "the field is disabled"; the request is what is tested.
2. **The archived-shelf matrix** — the full D4 table as a test: manager 200,
   reader 404, stranger 404, on both a reader route and a manage route. This is
   the one that guards a middleware change touching every tenant-bound route.
3. **Contacts are not public** — a request without a membership cannot read
   `bookshelf_contacts` through any route this phase adds.
4. **Position 2 and 3 are conditional** — a blank name saves no row; a named one
   saves exactly one, at the right position.
5. **Revoke is demotion** — the membership row survives with `role = 'reader'`,
   its `id` unchanged, and its loans and audit rows still resolve.
6. **Revoking a reader is refused**, and **promoting an existing super admin is
   refused**.
7. **The census still passes** with the seven new actions, each having a
   sentence.

Per project practice, **every test is watched failing before it is accepted** —
mutate what it protects, see red, restore, confirm `git status --porcelain` is
clean.

## 6. Risks

- **`ResolveTenant` is the blast radius.** D4 changes the entry condition of
  every tenant-bound route in the application. Test 2 exists for this, and the
  change should be its own task, reviewed alone.
- **A shelf can be left with no manager** (D6), by decision.
- **No super-admin demotion** (D5), by decision, ported as an omission.
- **The shelf editor will be reopened in 3b-ii** for taxonomy (D7). If 3b-i's
  layout hard-codes three sections, that becomes a rewrite rather than an
  addition.
