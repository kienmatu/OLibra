# Phase 3b-ii — settings, taxonomy and the public contact page

Status: draft, revised after review
Date: 2026-09-01
Branch: `feat/phase-3b-ii-settings-and-taxonomy`, cut from `main` at `5cf8b9c`

## 1. Context

OLibra is a Vietnamese parish lending-library system being ported from Next.js
to Laravel + Inertia + React. `old_next/` is a **read-only** behavioural
reference. Phases 0–3a shipped the schema, catalogue, members, circulation,
community features, statistics, QR labels, the public portal and the super-admin
dashboard; a design-system port brought the reference's palette and typography
across; and 3b-i made an installation **operable** — bookshelves and managers can
be created, edited, appointed and revoked.

Phase 3b was split because as ruled it covered seven screens. 3b-i took the two
that blocked operation. **This spec is 3b-ii, the other five.**

## 2. Problem statement

Five `underConstruction` placeholders remain, and they share a theme:
**everything an installation configures, rather than operates.**

- `routes/web.php:617` `/admin/settings` — the six defaults applied to new
  shelves, and the administration's own contact details.
- `routes/web.php:44` `/contact` — the public page those details feed. **This is
  the only route to a human that a parish with no bookshelf has**, since such a
  person holds no membership anywhere.
- `routes/web.php:616` `/admin/categories` — the book genres every catalogue
  draws on.
- `routes/web.php:498` `shelves/{shelf}/manage/units` — a shelf's parish units.
- `routes/web.php:508` `shelves/{shelf}/manage/settings` — a shelf's settings as
  its manager sees them.

Two consequences today. The public contact page shows nothing, so **a parish that
has not yet joined cannot reach anybody** — `BUSINESS-REQUIREMENTS.md:598`
(§16.4) requires that changing administrator not need a deploy. And a manager
has no view of their own shelf's configuration at all.

**Not in this phase, by the product owner's decision on 2026-09-01:** the
archived-shelf `ResolveTenant` filter and the export it depends on. 3b-i recorded
that the filter must not land until export is scoped, or archiving becomes a way
to make a parish's own records unreachable. Both move to a phase where they can
be designed together. Archived shelves keep serving their routes — an unclosed
gap, not a regression.

## 3. Scope

**In:** the five routes above; the parish-taxonomy editor **and unit CRUD**,
both on the admin shelf editor (D5); ten new audit actions (D8); the new-shelf
defaults of D9.

**Out:** the resolver filter and export; the whole of 3c.

## 4. Decisions

### D1 — `/admin/settings`: two forms, contact first, and a read-only environment block

`system_settings` is single-row (`id` is a `tinyint`, the migration seeds row 1)
and carries **eleven** columns in three groups:

| group | columns |
|---|---|
| the administration's identity | `contact_name`, `contact_phone`, `contact_hours` |
| defaults for new shelves | `default_loan_days`, `default_max_concurrent_loans`, `default_hold_days`, `default_max_renewals`, `default_renewal_days`, `default_due_soon_days` |
| provenance | `changed_by`, `changed_at` |

`BUSINESS-REQUIREMENTS.md:598` (§16.4) puts contact **first on the page**,
because it is the only setting a member of the public can see. We keep that
order, and split the page into **two forms with two submits and two refusals** —
the rule 3b-i's D2 established, for the same reason: a typo in a default must
not block correcting the administrator's phone number.

**`changed_by` and `changed_at` are written explicitly.** The model sets
`$timestamps = false`, so nothing fills them automatically; both writers set
them or the provenance columns stay null forever.

**Locale and timezone ship as a read-only block, not a control.** §16.4 lists
them, and the reference renders them as fixed text (`cai-dat/page.tsx:243-257`,
*"Hệ thống hiện chỉ hỗ trợ tiếng Việt và múi giờ Việt Nam"*) rather than a
`<select>` with one option. Porting it as a control would be a control that
looks enabled and does nothing.

`App\Models\SystemSetting` already exists, documents `sole()`, and has **zero
callers** — this phase is its first.

### D2 — The public contact page reads the row **and carries a form**

`BUSINESS-REQUIREMENTS.md:504`: *"The administration's name, phone and contact
hours, **plus a short form**."* The first draft of this spec dropped the form and
said a blank detail should omit its line — which would ship a blank page to
exactly the visitor the page exists for.

So `/contact` renders the three stored details, omitting any that is blank
(never a placeholder, never an invented default), **and always renders the
feedback form**: name, phone, subject, body, posting site-wide feedback with a
null `bookshelf_id`. The reference rate-limits it per phone per day
(`lien-he/page.tsx`), and we keep a limit; `Feedback` already exists from Phase
2b and is already rate-limited by hashed identifier.

**It is public** — no membership, no shelf, no tenant. It must therefore touch
**no shelf-scoped model**, or `BookshelfScope` throws for precisely the visitor
this page serves. That is §5 test 1.

### D3 — Categories are system-wide, but their writes still belong in `app/Actions/Admin/`

Two halves, and the first draft got the second backwards.

**True:** `Category` does not use `BelongsToBookshelf` and `categories` has no
`bookshelf_id`. Genres are shared by every shelf, so nothing here needs
`systemWide()`.

**False as first written:** "these writes need neither `systemWide()` nor
`app/Actions/Admin/`." The reference audits all three category commands
**globally** (`audit-actions.ts:644,651,660`), and `AuditRecorder`'s `global()`
is fenced by `WideningArchitectureTest:118-127` to `app/Actions/Admin/`. So the
commands must live there. Same for D1's two settings commands.

Three commands, matching the reference: create, rename, archive.

- **The slug is immutable on rename.** The reference records why: moving it
  silently repoints already-catalogued books. Renaming changes the display name
  only — the same shape as 3b-i's D1 for a shelf's slug.
- **Archiving is refused while books still carry the genre**, with the
  reference's own sentence: *"Chỉ lưu trữ được khi không còn sách nào thuộc thể
  loại này."* The first draft's test asserted the opposite — that archiving
  succeeds and books keep the reference — which would have tested that the
  refusal does not exist.
- **No BR mandate.** `DATABASE.md:658-730` says outright that a categories screen
  *"is a decision rather than something the requirements settled"* and that §5.1
  does not list Category among the entities. We port the reference's screen and
  say so, rather than citing §16.4 for it.

### D4 — `manage/settings` is **read-only**. The manager edits nothing here.

**Reversed after review.** The first draft proposed sharing 3b-i's
`UpdateBookshelfPolicy` between an admin writer and a manager writer. Three
independent sources falsify that:

1. **The Action authorizes internally as super admin.**
   `UpdateBookshelfPolicy::execute()` opens with
   `Gate::forUser($actor)->authorize('update', $shelf)`, and
   `BookshelfPolicy::update()` returns `asSuperAdmin($user)`, denying **as 404**.
   A manager calling it gets a 404. "One Action, two authorizations" is not
   possible without editing the Action *and* the policy.
2. **The reference's manager screen is read-only and says so on the page.** Every
   policy value renders through a `PolicyRow` whose docstring reads *"plain text,
   never a control, because a manager cannot edit it"*
   (`quan-ly/cai-dat/page.tsx:63`), under the line *"Chỉ quản trị viên mới đổi
   được các mục này"* (`:226`). Its only POSTs are three CSV exports.
3. **BR lists no manager settings screen.** §16.3 enumerates fourteen manager
   screens and Settings is not among them; §16.4 puts the lending policy on the
   **admin** Bookshelves screen.

So `manage/settings` is a summary: the eight policy values, the shelf's
contacts, its taxonomy shape — all as text, with the sentence saying who can
change them. That makes the first draft's "anti-drift" test and its
"both directions" authorization test moot; both are dropped.

### D5 — Unit CRUD lands on the **admin** shelf editor, beside the taxonomy shape

**Reversed after review**, for the same reason and with a sharper precedent.

The first draft split the work: the super administrator configures the *shape*
(levels, labels, nesting) from the admin editor, and the manager fills in the
*units* from `manage/units`. That split is invented. All five parish-unit
commands call `requireSuperAdmin` in the reference; `BUSINESS-REQUIREMENTS.md:600`
(§16.4) puts *"level count, each level's label, nesting, **and the unit lists
themselves**"* on the admin Bookshelves screen; and 3b-i's own D8 described the
deferred editor as *"a sub-editor with level count, labels, a nesting flag **and
unit-list CRUD**."*

The reference's own screen carries the precedent, in a docstring worth quoting
because this spec reproduced the exact mistake it records:

> Rendering the write forms to them anyway would be exactly the defect this
> branch's own QA sweep spent itself cataloguing on other screens: a control that
> looks enabled and does nothing. **This first shipped that way — reviewed and
> corrected before merge.**

So: the admin shelf editor gains a fourth section carrying both the shape and
the units. `manage/units` becomes a **read-only** view of the shelf's units for
its manager.

**The shape's keys are `ParishTaxonomy`'s, not prose.**
`app/Support/Members/ParishTaxonomy.php` already fixes the storage: under
`parish_taxonomy`, the keys are **`levels`, `nested`, `level1_label`,
`level2_label`** (snake_case in `settings`, camelCase in PHP), and
`app/Queries/ParishContextQuery.php:63` already reads them. Naming these here
rather than describing them is the direct lesson of 3b-i, where a settings key
taken from the requirements instead of the code (`allow_comments` for the real
`comments_enabled`) would have saved successfully and changed nothing.

**`parish_taxonomy` must be merged into `settings`, not assigned over it** — the
bag also holds the eight policy keys and the two public-display settings, and
3b-i's `UpdateBookshelfPolicy` carries a test proving a wholesale write drops
them.

**Reordering is part of CRUD.** `reorder-parish-units.ts` exists and the
reference ships JS-free reorder controls. One subtlety must come across:
level-2 siblings group by their **real `parent_id`**, never by the flat display
list — a shelf that turned `nested` off otherwise refuses every click.

**No built-in unit list ships.** `BUSINESS-REQUIREMENTS.md:247` is explicit that
a list of units baked into the product would be right for whichever parish it
was copied from and wrong for every other. The narrower carve-out at `:249` is
that the two *label words* may appear as hint text: `Tổ` and `Giáo họ` are the
only two the requirements have seen a parish use, and `Tổ` is the level-1
default — which matches `ParishTaxonomy::default()` already.

### D6 — Deleting a unit writes one audit row per row deleted

`delete-parish-unit.ts` cascades to level-2 children and writes an audit row for
**each** deleted row, marking the children `cascaded: true` in the `after`
payload. That shape is deliberate — a single row saying "deleted a unit" would
hide that four sub-units went with it — and it comes across.

### D7 — Bounds are the reference's, including two zero-minimums

`old_next/src/domain/admin/policy.ts:61-72`, applied to D1's six defaults:

| setting | min | max |
|---|---|---|
| `loan_days` | 1 | 365 |
| `max_concurrent_loans` | 1 | 50 |
| `max_renewals` | **0** | 10 |
| `renewal_days` | 1 | 365 |
| `hold_days` | 1 | 30 |
| `due_soon_days` | **0** | 30 |

The two zero-minimums are load-bearing: "no renewals allowed" is a real policy
under BR §5.5, and a min of 1 would forbid it. Each bound is validated as a safe
integer first, so `"3.5"` and `1e400` are refused before a range check.

### D8 — Ten new audit actions, and the pin moves 48 → 58

The first draft mentioned no audit work at all. The reference requires:

| action | writer |
|---|---|
| `system_settings.updated` | D1's defaults form |
| `site_contact.updated` | D1's contact form |
| `category.created` / `.renamed` / `.archived` | D3 |
| `parish_unit.created` / `.renamed` / `.deleted` / `.reordered` | D5 |
| `parish_taxonomy.updated` | D5 |

Two actions for D1 because it has two forms, matching the reference.

Each needs an `ACTIONS` entry under the `administration` group 3b-i created, a
`phrase()` arm, a `lang/vi/audit.php` line, and the partition pin at
`tests/Unit/Audit/AuditSentencesTest.php:435` moved from **48 to 58**.
`AuditActionCensusTest` asserts set-equality in both directions, so a missing
sentence or a missing writer is red immediately — and, per 3b-i's practice, each
action lands in the same task as the code that writes it.

### D9 — A new shelf copies the system defaults, closing 3b-i's open reasoning

3b-i's `CreateBookshelf` writes `settings => []`, arguing the `system_settings`
table exists but nothing reads it and its six values are character-for-character
what `LendingSettings::fromShelf()` coalesces to (verified: 14/3/3/1/7/3 both
sides), so copying would change nothing while turning "never had a policy" into
"chose these numbers."

**D1 makes that obsolete**, because the six become editable. Once an
administrator sets `default_loan_days` to 21, a shelf created afterwards that
silently uses 14 is wrong. So `CreateBookshelf` copies them at creation and its
docblock is rewritten to say why the earlier reasoning no longer holds.

The reference does the same and says so on-screen: *"Chỉ áp dụng cho tủ sách mở
mới. Các tủ sách đang hoạt động giữ nguyên quy định của mình."* — the defaults
apply to new shelves only; existing shelves keep their own.

**No 3b-i test asserts a new shelf's settings are empty.** The only creation test
asserts profile fields and the audit row and never touches `settings`; every
`'settings' => []` elsewhere is a factory argument. So this change breaks
nothing, and the first draft's risk bullet claiming otherwise was an unmeasured
guess.

## 5. Testing

1. **The public contact page renders for a caller with no membership and no
   shelf** — the case the page exists for, and the one that throws if any
   shelf-scoped model is touched.
2. **A blank contact detail omits its line**, and **the form renders anyway** —
   the first draft would have shipped a blank page here.
3. **Changing the contact details changes the public page**, end to end, no
   deploy.
4. **The two settings forms refuse independently**, and both write
   `changed_by`/`changed_at`.
5. **`parish_taxonomy` merges** — saving it leaves the eight policy keys and the
   two public-display settings intact. 3b-i's data-loss test, applied to the new
   writer.
6. **`manage/settings` and `manage/units` render no control a manager cannot
   use** — the D4/D5 inversion, asserted as the absence of a form rather than
   the presence of text.
7. **Archiving a category with books is refused**; archiving an empty one
   succeeds and it leaves the picker.
8. **A category rename does not move its slug.**
9. **Deleting a parent unit writes one audit row per deleted row**, children
   marked cascaded.
10. **Reordering groups level-2 siblings by real `parent_id`** — proven on a
    shelf with `nested` turned off.
11. **A shelf created after a default changes carries the new value** (D9); one
    created before is untouched.
12. **The census passes at 58 actions**, both directions.

Per project practice, **every test is watched failing before it is accepted**.

## 6. Risks

- **The admin shelf editor gains a fourth section that is itself a sub-editor**
  with list CRUD and reordering — much the largest screen in the phase, landing
  where three forms already live. 3b-i's per-section-form rule is what keeps it
  an addition.
- **Ten audit actions is the phase's bulk paperwork**, and the census bites in
  both directions, so a half-registered action is instantly red.
- **`/contact` is the app's only fully public surface besides the portal**, so a
  shelf-scoped model reached by accident throws for a real visitor rather than in
  a test.
- **D9 edits a 3b-i file.** Measured: no 3b-i test asserts empty settings, so
  nothing should break.
