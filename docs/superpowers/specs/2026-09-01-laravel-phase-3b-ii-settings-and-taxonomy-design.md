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

**In:** the five routes above; the taxonomy *shape* editor on the admin shelf
editor and unit CRUD on `manage/units`, gated (D5); ten new audit actions (D8);
the new-shelf defaults of D9.

**Out:** the resolver filter and export; the whole of 3c — **including the public
contact form**, which D2 defers to land with the inbox that reads it; and the
backup controls §16.4 lists, which D1 omits deliberately.

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

**The contact phone is validated, because it is published.** The reference calls
`assertPhone` on a non-empty value (`system-settings.ts:50`) and gives the
reason on the line above: this is `/lien-he`'s public number, so a bad value is a
*public* dead link rather than a private inconvenience. `App\Support\Phone`
already exists here.

**Backup is listed by §16.4 and deliberately not built.** `BUSINESS-REQUIREMENTS.md:598`
names it, and OPS specifies a last-backup time and a `DownloadSystemBackup`
command — but the reference's own settings page renders none of it, and a backup
control is an operations feature rather than a settings field. Omitted on
purpose, recorded in `known-gaps.md`, and said here rather than left as a silent
gap the way the first draft left locale and timezone.

`App\Models\SystemSetting` already exists, documents `sole()`, and has **zero
callers** — this phase is its first.

### D2 — The public contact page shows the details; the form waits for its inbox

`BUSINESS-REQUIREMENTS.md:504` reads *"The administration's name, phone and
contact hours, **plus a short form**."* The first draft dropped the form; the
second claimed the reference "always renders" it. **Both were wrong**, and the
second was wrong about the reference itself: `lien-he/page.tsx:62` computes
`hasContact = Boolean(contact.name || contact.phone)` and `:83` is a **ternary**
— the contact card *or* the form, never both. Its docstring says why:

> An administrator who *has* filled in the contact block still sees the ordinary
> card below — the form is only for the gap it exists to close.

Note the gate is `name || phone`; `contact_hours` alone does not count.

**This phase ships the details and defers the form**, because the form has no
reader. There is **no feedback write path in this application at all** — no
action, no controller, no POST route, and the only registered rate limiter is
`register` (`AppServiceProvider.php:128`; the "3 per phone per day" figure at
`:96` is a comment describing a writer that does not exist). Building one here
would also need its inbox, and `/admin/feedback` (`routes/web.php:619`) and the
shelf feedback page (`:202`) are both explicitly 3c's.

A form whose messages land in a table no screen can read is worse than no form:
it promises a reply that cannot come. So `/contact` renders the three stored
details, omitting any that is blank — never a placeholder, never an invented
default — and when no contact is configured at all it says plainly that the
visitor should approach their parish directly. **The form lands in 3c, with the
inbox that reads it**, and this is recorded as a deliberate deferral rather than
an oversight.

**The page is public** — no membership, no shelf, no tenant — so it must touch
**no shelf-scoped model**, or `BookshelfScope` throws for precisely the visitor
it serves. `Feedback` is deliberately not `BelongsToBookshelf`, which is what
will make 3c's form safe here too.

### D3 — Categories are system-wide, but their writes still belong in `app/Actions/Admin/`

Two halves, and the first draft got the second backwards.

**True:** `Category` does not use `BelongsToBookshelf` and `categories` has no
`bookshelf_id`. Genres are shared by every shelf, so nothing here needs
`systemWide()`.

**False as first written:** "these writes need neither `systemWide()` nor
`app/Actions/Admin/`." The reference audits all three category commands
**globally** — and the evidence is in the writers (`create-category.ts:109`,
`rename-category.ts:47`, `archive-category.ts:63`), not in the `ACTIONS`
entries, which carry only `group` and `phrase`. (The reference's own comment at
`audit-actions.ts:640` claiming every entry there sets `global: true` is stale;
this spec's first draft inherited that false statement instead of reading the
writers.) And `AuditRecorder`'s `global()`
is fenced by `WideningArchitectureTest:122-131` to `app/Actions/Admin/`. So the
commands must live there. Same for D1's two settings commands.

Three commands, matching the reference: create, rename, archive.

- **The slug is immutable on rename.** The reference records why: moving it
  silently repoints already-catalogued books. Renaming changes the display name
  only — the same shape as 3b-i's D1 for a shelf's slug.
- **Archiving is refused while books still carry the genre**, with the
  reference's own sentence: *"Chỉ lưu trữ được khi không còn sách nào thuộc thể
  loại này."* The refusal code is `category_in_use`
  (`archive-category.ts:52`) and needs a Vietnamese sentence in
  `lang/vi/rules.php` plus an entry in `RuleViolatedCodesHaveSentencesTest`'s
  hand-written list — the members slice has a census that would catch a missing
  one, the catalogue slice does not, so this fails silently rather than red. The first draft's test asserted the opposite — that archiving
  succeeds and books keep the reference — which would have tested that the
  refusal does not exist.
- **No BR mandate.** §16.4 (`BUSINESS-REQUIREMENTS.md:596-612`) lists eight
  administration pages and a categories screen is not among them. We port the
  reference's screen and say so, rather than citing §16.4 for it. (`DATABASE.md:660`
  is often quoted here — but its "a decision rather than something the
  requirements settled" is about categories being *global reference data rather
  than tenant data*, not about whether a screen should exist.)

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
change them. (`manage/units` is different: D5 gives it a real editor, gated.) That makes the first draft's "anti-drift" test and its
"both directions" authorization test moot; both are dropped.

### D5 — Unit CRUD lives on `manage/units`, gated by `canEdit`; the shape lives on the admin editor

**Reversed twice.** The first draft let the *manager* edit units — invented, and
falsified by all five reference commands calling `requireSuperAdmin`. The second
moved the whole editor onto the admin shelf editor. That was also wrong, in two
ways the review measured:

1. **It is not where the reference puts it.** The reference's unit CRUD screen is
   `quan-ly/co-cau/page.tsx` — the *manager* route, `manage/units`'s own
   analogue. It renders `const canEdit = viewer.role === "super_admin"` (`:342`)
   and switches between an interactive tree and read-only text.
2. **The docstring quoted as its "precedent" argues the opposite.** That block
   (`:45-49`) is arguing for the `canEdit` switch *on that screen*; the next
   paragraph (`:50-56`) says so outright. The spec cited a source against itself.

And the placement carried a cost the spec never named. **`ParishUnit` uses
`BelongsToBookshelf`** (`app/Models/ParishUnit.php:16`) and `BookshelfScope`
fails closed, while `/admin` binds no tenant — so unit CRUD on the admin editor
would make **every `ParishUnit` read and write** require `systemWide()`, the
capability fenced by test precisely so it stays rare. `manage/*` binds a tenant,
so the reference's placement needs none of it.

**So:** unit CRUD lives on `shelves/{shelf}/manage/units`, rendering the editing
tree when the viewer is a super administrator and the same values as read-only
text otherwise. `BUSINESS-REQUIREMENTS.md:600` lists the unit lists under the
admin Bookshelves screen; we diverge on **location** while matching it on
**authority**, and the divergence is recorded rather than left to be discovered.

The **shape** — level count, labels, nesting — stays on the admin shelf editor as
3b-i's D8 promised, since it is a property of the shelf stored in its `settings`.

**The shape's keys are `ParishTaxonomy`'s, not prose.**
`app/Support/Members/ParishTaxonomy.php` fixes them: under `parish_taxonomy`, the
keys are **`levels`, `nested`, `level1_label`, `level2_label`** (snake_case in
`settings`, camelCase in PHP), with `default()` = `(1, false, 'Tổ', 'Tổ')`.
Naming them here rather than describing them is the direct lesson of 3b-i, where
a key taken from the requirements instead of the code (`allow_comments` for the
real `comments_enabled`) would have saved successfully and changed nothing.

**`parish_taxonomy` must be merged into `settings`, not assigned over it** — the
bag also holds the eight policy keys and the two public-display settings, and
3b-i carries a test proving a wholesale write drops them.

**Reordering has two rules, not one.** Level-2 siblings group by their real
`parent_id`, never the flat display list — a shelf that turned `nested` off
otherwise refuses every click. And the posted list must be the **entire** sibling
group: a partial list is `validation_failed`, because `[C, A]` over three units
yields the tie `C=1, A=2, B=2` and silently restores name ordering
(`reorder-parish-units.ts:118-145`).

**No built-in unit list ships.** `BUSINESS-REQUIREMENTS.md:247` is explicit that a
list baked into the product would be right for whichever parish it was copied
from and wrong for every other. The narrower carve-out at `:249` is that the two
*label words* may appear as hint text: `Tổ` and `Giáo họ` are the only two the
requirements have seen a parish use.

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
2. **A blank contact detail omits its line**, and a page with no contact at all
   still tells the visitor what to do — never a blank page, a placeholder, or an
   invented default.
3. **Changing the contact details changes the public page**, end to end, no
   deploy.
4. **The two settings forms refuse independently**, and both write
   `changed_by`/`changed_at`.
5. **`parish_taxonomy` merges** — saving it leaves the eight policy keys and the
   two public-display settings intact. 3b-i's data-loss test, applied to the new
   writer.
6. **`manage/settings` renders no control at all** — D4, asserted as the absence
   of a form rather than the presence of text.
7. **`manage/units` renders the editor to a super administrator and read-only
   text to a manager** — D5's `canEdit` switch, both directions. A manager
   seeing a control the server would refuse is the defect the reference's own
   docstring records having shipped and corrected.
8. **Archiving a category with books is refused**; archiving an empty one
   succeeds and it leaves the picker.
9. **A category rename does not move its slug.**
10. **Deleting a parent unit writes one audit row per deleted row**, children
   marked cascaded.
11. **Reordering groups level-2 siblings by real `parent_id`** — proven on a
    shelf with `nested` turned off — **and refuses a partial sibling list**,
    which would otherwise tie the ranks and silently restore name ordering.
12. **A shelf created after a default changes carries the new value** (D9); one
    created before is untouched.
13. **The census passes at 58 actions**, both directions.

Per project practice, **every test is watched failing before it is accepted**.

## 6. Architecture pins this phase will hit

3b-i hit four of these the hard way; naming them costs a paragraph and saves a
red CI run.

1. **`WideningArchitectureTest`** — two fences. `systemWide()` is confined to
   `app/Queries/Admin/` and `app/Actions/Admin/`; the `AuditRecorder`
   configurator (`->global(` / `->forShelf(`) to `app/Actions/Admin/` alone
   (`:122-131`). D3's settings and category commands live there for the second
   reason. D5's placement means unit CRUD needs **neither**, which is most of
   why that placement is right.
2. **`AuditActionCensusTest`** — set-equality in both directions between actions
   recorded in code and sentences declared, and it bans computed action names.
   With ten new actions, a half-registered one is instantly red. Plus
   `AuditSentencesTest:435`'s count, 48 → 58.
3. **`FreeTextEncodingGuardTest:323`** sweeps every Form Request: each free-text
   field needs `encoding:UTF-8` or a documented exemption, and `:354` catches
   stale exemptions. This phase adds many — `contact_name`, `contact_hours`,
   category `name`, unit `name`, `level1_label`, `level2_label`.
4. **`RouteOrderTest`** — super-admin middleware on every `admin/`-prefixed route
   (`:138`), a `role:` middleware on every `/manage` route (`:67`), tenant
   middleware on every route naming `{shelf}` (`:23`), and **no Vietnamese path
   segments** (`:153`). The reference's routes are `/quan-tri/the-loai`,
   `/co-cau` and `/lien-he`; none of those names carries across.
5. **`LabelsArchitectureTest:23`** is a census of `Asia/Ho_Chi_Minh` literals in
   `app/`. D1's read-only timezone block has no column to read — `system_settings`
   carries no `locale` or `timezone` — so the value comes from
   `App\Support\Clock::ZONE`, never a fresh literal.

**Comment-blindness applies to two of these.** `WideningArchitectureTest`'s
`offendersFor` reads raw file contents with no comment stripping, and
`TenancyArchitectureTest`'s `[^;]*` spans from a comment into the code below it
because comments carry no semicolon. Name constraints in prose; do not spell
where-shaped calls or `->global(` inside a comment.

## 7. Risks

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
