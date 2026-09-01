# Phase 3b-ii — settings, taxonomy and the public contact page

Status: draft for review
Date: 2026-09-01
Branch: `feat/phase-3b-ii-settings-and-taxonomy`, cut from `main` at `5cf8b9c`

## 1. Context

OLibra is a Vietnamese parish lending-library system being ported from Next.js
to Laravel + Inertia + React. `old_next/` is a **read-only** behavioural
reference. Phases 0–3a shipped the schema, catalogue, members, circulation,
community features, statistics, QR labels, the public portal and the super-admin
dashboard; a design-system port then brought the reference's palette and
typography across; and 3b-i made an installation **operable** — bookshelves and
managers can now be created, edited, appointed and revoked.

Phase 3b was split because as ruled it covered seven screens, roughly twice 3a,
and this project's cross-seam defects are caught by a whole-branch review that
gets less reliable as a branch grows. 3b-i took the two screens that blocked
operation. **This spec is 3b-ii, the other five.**

## 2. Problem statement

Five `underConstruction` placeholders remain from 3b's original scope, and they
share a theme: **everything an installation configures, rather than operates.**

- `routes/web.php:616` `/admin/settings` — the six defaults applied to new
  shelves, and the administration's own contact details.
- `routes/web.php:44` `/contact` — the public page those details feed. **This is
  the only route to a human that a parish with no bookshelf has**, since such a
  person holds no membership anywhere.
- `routes/web.php:617` `/admin/categories` — the book genres every shelf's
  catalogue draws on.
- `routes/web.php:498` `shelves/{shelf}/manage/units` — a shelf's parish unit
  lists.
- `routes/web.php:508` `shelves/{shelf}/manage/settings` — a shelf's own
  settings, edited by its manager rather than by the super administrator.

Two consequences today. The public contact page shows nothing, so **a parish
that has not yet joined cannot reach anybody** — BR §504 calls this out
explicitly and says a change of administrator "must not require a deploy."
And a manager cannot adjust their own shelf's lending policy at all; only a
super administrator can, through the screen 3b-i built.

**Not in this phase, by the product owner's decision on 2026-09-01:** the
archived-shelf `ResolveTenant` filter and the export it depends on. 3b-i
recorded that the filter must not land until export is scoped, or archiving
becomes a way to make a parish's own records unreachable. Both move to a phase
where they can be designed together. Archived shelves keep serving their routes,
exactly as today — an unclosed gap, not a regression.

## 3. Scope

**In:** the five routes above, the parish-taxonomy editor promised to this phase
by 3b-i's D8, and the new-shelf defaults of D7 below.

**Out:** the resolver filter and export (above); the whole of 3c (audit browser,
per-manager activity, cross-shelf profile-change queue, feedback inbox).

## 4. Decisions

### D1 — `/admin/settings` edits one row, and contact comes first

`system_settings` is a single-row table (`id` is a `tinyint` and the migration
seeds row 1). It carries two unrelated groups:

| group | columns |
|---|---|
| the administration's identity | `contact_name`, `contact_phone`, `contact_hours` |
| defaults for new shelves | `default_loan_days`, `default_max_concurrent_loans`, `default_hold_days`, `default_max_renewals`, `default_renewal_days`, `default_due_soon_days` |

BR §16.4 puts contact **first on the page**, and gives the reason: it is the only
setting a member of the public can see. We keep that order.

Two forms, two submits, two refusals — the same rule 3b-i's D2 established for
the shelf editor and for the same reason: a typo in `default_loan_days` must not
block correcting the administrator's phone number.

`App\Models\SystemSetting` already exists with `SystemSetting::sole()` and has no
callers; this phase is its first.

### D2 — The public contact page reads the row, and renders nothing invented

BR §504: *"The three details are configuration, edited by the super
administrator — never written into the page, or changing who runs OLibra means a
deploy."*

So `/contact` reads `contact_name`, `contact_phone` and `contact_hours` and
renders exactly what is stored. **It is public**, deliberately — no membership,
no shelf, no tenant. It must therefore not touch any shelf-scoped model, or
`BookshelfScope` will throw for precisely the visitor the page exists for.

If a detail is blank the page omits that line rather than showing a placeholder
or a stale default. A parish reading "Liên hệ: —" learns nothing; a parish
reading an invented name is misled.

### D3 — `/admin/categories` needs no widening, because categories are not shelf-scoped

`Category` does **not** use `BelongsToBookshelf` and the `categories` table has
no `bookshelf_id`: genres are system-wide, shared by every shelf's catalogue.

So unlike everything in 3b-i, these writes need neither `systemWide()` nor
`app/Actions/Admin/`. Stating it here because the shape of 3b-i makes the
opposite the natural assumption, and an unnecessary widening would be a real
loosening — it is fenced by test precisely so it stays rare.

Create, rename and archive, matching the reference's three commands. Archiving
is a soft delete; the `categories` table has `deleted_at`, and books already
categorised keep their reference.

### D4 — The shelf settings screen reuses 3b-i's Action; it does not copy it

This is the decision most likely to be got wrong by building the obvious thing.

`shelves/{shelf}/manage/settings` lets a **manager** edit their own shelf's
lending policy. 3b-i already built `UpdateBookshelfPolicy` for the **super
administrator** to edit the same eight keys through `/admin/shelves/{bookshelf}`.
Same columns, same validation bounds, same audit action.

**One Action, two authorizations.** The manager's screen calls the same
`app/Actions/Admin/UpdateBookshelfPolicy`, authorized by the shelf's own
`act-as-manager` gate rather than by `is_super_admin`. Two copies would drift —
and drift here means two screens that disagree about what a legal `loan_days`
is, with the audit log unable to say which one wrote a row.

Note the Action lives under `app/Actions/Admin/` and is fenced there by
`WideningArchitectureTest`. It does not call `systemWide()` (it never needed
to — `Bookshelf` is not shelf-scoped), so a manager-side caller trips nothing.
**If it did widen, this decision would be wrong** and the manager's path would
need its own narrower Action; the review should confirm it does not.

### D5 — The parish-taxonomy editor lands on the admin shelf editor, as promised

3b-i's D8 deferred this here and left the editor able to take another section:
profile, policy and contacts are three independent forms, so taxonomy is a
fourth, not a restructure.

Per BR §5.6 and §16.4 it edits: the level count, each level's label, whether
level 2 nests under level 1, and the unit lists themselves — with a level-2 unit
edited under its parent.

`parish_taxonomy` is a single JSON key inside `bookshelves.settings`. **It must
be merged, not assigned** — 3b-i's `UpdateBookshelfPolicy` learned this the hard
way: that bag also holds the eight policy keys and the two public-display
settings, and a wholesale write drops whatever it does not name.

**The level labels ship no built-in unit list.** BR §247 is explicit: a list of
units baked into the product would be exactly right for whichever parish it was
copied from and wrong for every other one. The level-1 label defaults to `Tổ`
as a plausible starting guess; the hint text names `Tổ` and `Giáo họ` as
examples of what to type, because those are the only two words the requirements
have ever seen a parish actually use.

### D6 — `manage/units` is shelf-scoped, and is the reader-facing half of D5

`parish_units` **is** shelf-scoped (`bookshelf_id`, plus `level`, `parent_id`,
`sort_order`). The manager's screen edits their own shelf's units under the
tenant middleware, so no widening and no relation gymnastics — the ordinary
scoped path every `manage/*` screen already uses.

The relationship to D5 is that the super administrator configures the *shape*
(how many levels, what they are called, whether they nest) from the admin
editor, and the manager fills in the *units* from their own screen. Both write
the same table for units; only the shape lives in `settings`.

### D7 — A new shelf now copies the system defaults, closing 3b-i's open reasoning

3b-i's `CreateBookshelf` writes `settings => []` and its docblock argues: the
`system_settings` table exists but nothing reads it, its six values are
character-for-character what `LendingSettings::fromShelf()` already coalesces
to, so copying would change nothing while turning "never had a policy" into
"chose these numbers."

**D1 makes that reasoning obsolete**, because the six defaults become editable.
Once an administrator has set `default_loan_days` to 21, a shelf created
afterwards that silently uses 14 is wrong.

So `CreateBookshelf` copies the six `default_*` values into the new shelf's
`settings` at creation, and its docblock is rewritten to say why the earlier
reasoning no longer holds. This is a change to a 3b-i file and is in scope
deliberately: leaving it would make D1 half-effective in a way nothing would
report.

## 5. Testing

1. **The public contact page renders for a caller with no membership and no
   shelf** — the case the page exists for, and the one that would throw if any
   shelf-scoped model were touched.
2. **A blank contact detail omits its line**, rather than rendering a placeholder
   or a default.
3. **Changing the contact details changes the public page** with no deploy —
   BR §504's actual requirement, tested end to end rather than by asserting the
   column.
4. **The two settings forms refuse independently** — an invalid default does not
   block a contact edit.
5. **`parish_taxonomy` merges** — saving it leaves the eight policy keys and the
   two public-display settings intact. This is 3b-i's data-loss test, applied to
   the new writer.
6. **A manager can edit their own shelf's policy and cannot edit another's** —
   the D4 authorization split, both directions.
7. **The manager's screen and the admin's screen write the same audit action and
   the same columns** — the anti-drift assertion D4 exists for.
8. **A shelf created after a default changes carries the new value** (D7), and
   one created before is untouched.
9. **Category archive is soft** — an archived genre disappears from the picker
   while books already carrying it keep their reference.

Per project practice, **every test is watched failing before it is accepted** —
mutate what it protects, see red, restore, confirm `git status --porcelain` is
clean.

## 6. Risks

- **D4's shared Action is the phase's main structural bet.** If review finds
  `UpdateBookshelfPolicy` widens, or that the manager's screen needs different
  validation, the decision inverts and the manager gets its own Action.
- **D7 edits a 3b-i file**, so 3b-i's own test for "a new shelf behaves like a
  seeded one" may need to change with it. That is expected, not a regression.
- **The taxonomy editor is the largest single screen in the phase** and lands on
  a screen three other forms already share.
- **The contact page is the app's only fully public authenticated-nothing
  surface** besides the portal, so it is the one place where a shelf-scoped
  model reached by accident throws for a real visitor rather than in a test.
