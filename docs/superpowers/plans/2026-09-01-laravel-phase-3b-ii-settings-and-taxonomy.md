# Implementation plan: Phase 3b-ii — settings, taxonomy and the public contact page

Spec: `docs/superpowers/specs/2026-09-01-laravel-phase-3b-ii-settings-and-taxonomy-design.md`
Branch: `feat/phase-3b-ii-settings-and-taxonomy`, cut from `main` at `5cf8b9c`

## Context for whoever picks this up

OLibra is a Vietnamese parish lending-library system being ported from Next.js to
Laravel + Inertia + React. `old_next/` is a **read-only** behavioural reference —
never write to it. 3b-i made an installation operable (bookshelves, managers);
this phase makes it **configurable**: system settings, the public contact page,
book genres, the parish taxonomy and its units, and a manager's read-only view of
their own shelf.

**Read the spec before starting.** Two of its decisions reversed during review
and both look wrong until you read why:

- **`manage/settings` is read-only.** A manager edits nothing there.
  `UpdateBookshelfPolicy` authorizes internally as super admin, the reference's
  screen renders every value as plain text, and BR's fourteen manager screens do
  not include Settings.
- **`manage/units` has a real editor, gated on `is_super_admin`.** Not the admin
  area. `ParishUnit` is shelf-scoped and `/admin` binds no tenant, so putting it
  there would force `systemWide()` on every read and write.

If you find yourself rendering a control a manager cannot use, stop — the
reference's own docstring records shipping exactly that and correcting it before
merge, and this repo has now produced the same defect three times.

### The environment, and the six gates

`AGENTS.md` has the full list; the short version:

- Tests `docker exec laravel-app-1 php artisan test`
- **Never run `pint` or `php` on the host** — host PHP is 7.4 and aborts.
- The six gates CI runs: `pint --test`, `phpstan analyse`, `laravel:lint`
  (Biome — the one people forget), `laravel:typecheck`, `laravel:build`, Pest.
  **Run all six before claiming done.** 3b-i shipped red twice by running four.
- `npm run build` builds the read-only `old_next`. The app's build is
  `npm run laravel:build`.

### The five pins this phase will hit

Spec §6 has the detail. In short: the widening fences (`systemWide()` and the
audit configurator), the audit census in both directions, the free-text encoding
sweep over every Form Request, `RouteOrderTest` (super-admin/role/tenant
middleware, and **no Vietnamese path segments**), and the timezone-literal
census. Two of them read raw file contents with **no comment stripping**, so do
not spell `->global(` or a where-shaped call inside a comment.

### House rule: mandatory falsification

Every test is **watched failing before it is accepted** — mutate what it
protects, see red, restore, confirm `git status --porcelain` is clean.
**Restore by targeted edit, never `git checkout -- <file>`**: your work is
uncommitted and a checkout discards the task.

### Audit actions land with their writers

Ten new actions across this phase. Each lands in the **same task** as the code
that writes it, with its `phrase()` arm, its `lang/vi/audit.php` line, its group
(`administration`, which 3b-i created), and the partition count in
`tests/Unit/Audit/AuditSentencesTest.php:435` bumped by that task's share.
The census asserts set-equality **both ways**, so registering an action whose
writer does not exist yet turns the suite red until it does.

Count starts at **48** and ends at **58**. Each task's number is **absolute, not
relative**, so the task order below is mandatory rather than merely preferred.

**Two other ordering dependencies**, both real: Task 7 needs Task 1's editable
defaults (it says so), and **Task 2's end-to-end test needs Task 1's contact
form** — "changing the details changes the page" must go through the real save
path, not a direct database update.

---

## Task 1 — `/admin/settings`

Spec D1, D7, D8. Adds `system_settings.updated` and `site_contact.updated`
(48 → 50).

`system_settings` is single-row; `SystemSetting::sole()` and the model already
exist with **zero callers** — this is its first.

1. **Two forms, two submits, two refusals.** Contact first on the page (BR:598:
   it is the only setting the public can see). A typo in a default must not block
   fixing the administration's phone number.
2. **Contact form** — `contact_name`, `contact_phone`, `contact_hours`. Validate
   the phone with **`App\Support\Members\Phone`** (not `App\Support\Phone`)
   when non-empty: this is the number `/contact` publishes, so a bad value is a
   *public* dead link. Its API is `Phone::assert(string): void`, throwing
   `RuleViolated('phone_invalid')`, plus `isValid()`, `normalise()` and
   `PATTERN` for the HTML mirror. Every existing caller
   (`ProfileFields.php:71`, `Registration.php:90`) does the blank check first,
   then `assert()` — follow that, so the refusal reaches the shared
   `errors.rule` banner rather than being a field error.
3. **Defaults form** — the six `default_*` columns, bounds from spec D7:
   loan 1–365, concurrent 1–50, renewals **0**–10, renewal days 1–365, hold
   1–30, due-soon **0**–30. The two zero-minimums are load-bearing ("no renewals
   allowed" is a real policy); validate as a safe integer before the range check.
4. **Both writers set `changed_by` and `changed_at` explicitly** — the model has
   `$timestamps = false`, so nothing fills them and the provenance columns would
   stay null forever.
5. **Locale and timezone render as a fixed read-only block**, not a `<select>`
   with one option. There is no column for either; the timezone string comes from
   `App\Support\Clock::ZONE` — **never a fresh `Asia/Ho_Chi_Minh` literal**,
   which `LabelsArchitectureTest:23` censuses.
6. Commands live in `app/Actions/Admin/` — required, because they audit and the
   audit configurator is fenced there.

**Extend `tests/Feature/Admin/AdminScreensRenderFeedbackTest.php`.** Its screen
list is **hand-written** (`:79-81`) and will not grow to cover a new admin page
on its own — so a screen that renders neither its refusals nor its flashes ships
silently. That is the exact defect the file exists to catch; its docblock is a
forty-line argument about it.

**Routes and controller:** every other task inherits an existing screen; this one
invents a page. Two POSTs under the `/admin` group, an `Admin\SettingsController`,
and the screen at `resources/js/pages/admin/settings/index.tsx`. New Vietnamese
copy goes in `resources/js/lib/copy.ts`, the pattern `admin/shelves/edit.tsx:9`
uses.

**Tests:** the two forms refuse independently; both writers set
`changed_by`/`changed_at`; a phone that fails `Phone` is refused; a default
below its minimum is refused and `max_renewals: 0` is accepted.

Note `changed_at` is `->useCurrent()` and **not nullable** — only `changed_by`
can stay null, so assert that one.

**Falsify:** set `max_renewals`' minimum to 1 and watch the zero case go red.

---

## Task 2 — The public `/contact`

Spec D2. No new audit actions.

Renders `contact_name`, `contact_phone`, `contact_hours` from the single row,
**omitting any that is blank** — never a placeholder, never an invented default.
When no contact is configured at all, the page says plainly that the visitor
should approach their parish directly. **The sentence is given here rather than
invented**, because this is the app's only public front door and the reference
has none to port (its else-branch is the form this phase defers):

> Hiện chưa có thông tin liên hệ chung. Xin liên hệ trực tiếp với giáo xứ của
> bạn.

It goes in `resources/js/lib/copy.ts` with the rest of the page's copy.

**No feedback form.** It is deferred to 3c to land with the inbox that reads it;
there is no feedback write path in this application today and `/admin/feedback`
is 3c's. Do not build one.

**The page is public** — no membership, no shelf, no tenant. It must touch **no
shelf-scoped model**, or `BookshelfScope` throws for exactly the visitor it
serves.

**Test:** it renders for a caller with no membership and no shelf; a blank detail
omits its line; a wholly unconfigured page still tells the visitor what to do;
changing the details changes the page end to end.

**Falsify:** touch a shelf-scoped model in the controller and watch the
no-membership test throw.

---

## Task 3 — `/admin/categories`

Spec D3, D8. Adds `category.created`, `.renamed`, `.archived` (50 → 53).

`Category` is **not** shelf-scoped and `categories` has no `bookshelf_id`, so
nothing here needs `systemWide()`. The commands still live in
`app/Actions/Admin/` because they audit **globally** (`->global()`), which is
fenced there.

- **Rename does not move the slug.** Moving it silently repoints already-catalogued
  books — the same shape as 3b-i's D1 for a shelf's slug.
- **Archive is refused while books still carry the genre**, with the reference's
  sentence: *"Chỉ lưu trữ được khi không còn sách nào thuộc thể loại này."*
  The refusal code is `category_in_use`. It needs a Vietnamese sentence in
  `lang/vi/rules.php` **and** an entry in `RuleViolatedCodesHaveSentencesTest`'s
  hand-written list. **That census is not slice-scoped** despite living under
  `tests/Unit/Catalogue/` — it globs the whole of `app/` (`:24`), regexes every
  literal `new RuleViolated('code')` and asserts set-equality against its list.
  So minting a code without listing it turns the suite **red immediately**, on
  the set-equality, before the sentence check runs. (An earlier draft of this
  plan said the opposite; do not trust it.)

**The slug is derived on create**, never typed — `categories.slug` is unique and
`utf8mb4_bin`. Use the repo's `Fold` helper, matching how the reference's
`create-category.ts` derives it.

**Extend `AdminScreensRenderFeedbackTest`'s hand-written screen list** for this
page too, for the reason given in Task 1.

**Tests:** archiving with books is refused; archiving an empty genre succeeds and
it leaves the picker; a rename leaves the slug untouched.

**Falsify:** drop the in-use check and watch the refusal test go red.

---

## Task 4 — The taxonomy *shape*, on the admin shelf editor

Spec D5, D8. Adds `parish_taxonomy.updated` (53 → 54).

A fourth section on `resources/js/pages/admin/shelves/edit.tsx`, beside profile,
policy and contacts. 3b-i's per-section rule is what makes this an addition
rather than a restructure — **it is its own form with its own submit and its own
refusal.**

**The keys are `ParishTaxonomy`'s, not prose.**
`app/Support/Members/ParishTaxonomy.php` fixes them: under `parish_taxonomy`, the
keys are `levels`, `nested`, `level1_label`, `level2_label` (snake_case in
`settings`, camelCase in PHP), with `default()` = `(1, false, 'Tổ', 'Tổ')`. Read
that class rather than trusting this list — a key taken from the requirements
instead of the code is this project's signature failure.

**The writer lives in `app/Actions/Admin/`** and audits with
`->forShelf($shelf->id)->record('parish_taxonomy.updated', ...)`. The admin
editor binds no tenant, so `AuditRecorder::record()` throws unless configured,
and the configurator is fenced to that directory.

**Give the form its own flash key.** `admin/shelves/edit.tsx:255-282` has one
`flash.success` banner and one `InputError message={pageErrors.rule}` shared by
all its forms, distinguished only by per-form flash keys
(`bookshelf_profile_saved_flash` and siblings). Without a fourth key this save is
indistinguishable from a policy save.

**Merge into `settings`, never assign over it.** The bag also holds the eight
policy keys and the two public-display settings; 3b-i carries a test proving a
wholesale write drops them.

Hint text may name `Tổ` and `Giáo họ` as examples (BR:249). **No built-in unit
list ships** (BR:247).

**Test:** saving the shape leaves the eight policy keys and the two
public-display settings intact — 3b-i's data-loss test applied to the new writer.

**Falsify:** assign instead of merging and watch it go red.

---

## Task 5 — `manage/units`: unit CRUD, gated

Spec D5, D6, D8. Adds `parish_unit.created`, `.renamed`, `.deleted`, `.reordered`
(54 → 58).

The largest task in the phase. On `shelves/{shelf}/manage/units`, which **binds a
tenant** — so `ParishUnit` resolves through the ordinary scoped path and nothing
here needs `systemWide()`. That is most of why the spec puts it here.

**Render the editing tree only when the viewer is a super administrator**;
everyone else gets the same values as read-only text. `canEdit` in the reference
is exactly this. A manager must not see a control the server refuses.

- **Delete cascades to level-2 children and writes one audit row per deleted
  row**, children marked `cascaded: true` in the `after` payload. A single row
  saying "deleted a unit" would hide that four sub-units went with it.
- **Duplicate names are a database constraint, not a validation nicety.**
  `parish_units` carries `parish_units_name_unique_in_scope`, a UNIQUE over a
  generated `name_scope_key` of `(bookshelf_id, level, parent_id, name)`, null
  when soft-deleted. A duplicate live name is a raw 1062 — a 500, not a refusal.
  Catch it and re-raise as `validation_failed`, the way the reference does
  (`create-parish-unit.ts:38-50,136`, `rename-parish-unit.ts:23-25,66`).
  A missing parent is `parish_unit_l1_not_found` (`create-parish-unit.ts:109`),
  a code that does **not** exist in `lang/vi/rules.php` today: add the sentence
  **and** the census-list entry, or the suite goes red on set-equality.
- **Name the audit payload keys explicitly; never dump the model.**
  `AuditSecrets` forbids any payload key containing the token `key`
  (`app/Support/Audit/AuditSecrets.php:26`, matched whole within snake splits),
  and `ParishUnit` carries `name_scope_key`. So `->record(..., $unit->toArray())`
  or `getChanges()` throws `audit_forbidden_field`. D6's one-row-per-deleted-row
  shape is exactly what invites a wholesale dump.
- **Reorder has two rules.** Level-2 siblings group by their real `parent_id`,
  never the flat display list — a shelf with `nested` off otherwise refuses every
  click. And the posted list must be the **entire** sibling group: a partial list
  is `validation_failed`, because `[C, A]` over three units ties the ranks and
  silently restores name ordering.

**Tests:** a super admin sees the editor and a manager sees text, both
directions — the server half asserts the Inertia `canEdit` prop, and the half
that matters (that the component actually switches on it) is a **comment-stripped**
source read using `AdminScreensRenderFeedbackTest`'s helper, because a comment
saying `// canEdit switches the tree` satisfies a naive grep; deleting a parent writes one row per deleted row; reordering groups
by real `parent_id` on a shelf with `nested` off; a partial sibling list is
refused.

**Falsify:** group by the display list and watch the `nested`-off test go red.

---

## Task 6 — `manage/settings`: read-only

Spec D4.

A summary for the shelf's manager: the eight policy values, the shelf's contacts,
its taxonomy shape — **all as text**, with a line saying who can change them
(the reference's is *"Chỉ quản trị viên mới đổi được các mục này."*).

**No form, no submit, no Action.** `UpdateBookshelfPolicy` authorizes internally
as super admin and would 404 a manager; do not reach for it, and do not add a
manager-side writer.

**Test — and this is the weakest test in the plan unless you write it
deliberately.** "The absence of a control" has two vacuous forms and one honest
one:

- A raw `.tsx` grep for `<form` is **defeated by a comment** mentioning the word.
  `AdminScreensRenderFeedbackTest:43-58` exists solely because a raw grep passed
  on prose alone; use its comment-stripping helper, not a bare grep.
- A route-absence assertion alone is **green against an empty implementation**,
  since no POST exists under `manage/settings` before this task either.

So do both: assert no POST/PATCH/PUT route exists under `manage/settings`
(`CatalogueArchitectureTest.php:44-53` is the precedent — "there is deliberately
no delete-book route"), **and** read the screen source with comments stripped and
assert it references no form bag.

**Falsify:** add a form and a POST route, watch both halves go red, remove them.
This is the only task whose test cannot be falsified by mutating existing code,
so the mutation has to be additive.

---

## Task 7 — A new shelf copies the system defaults

Spec D9. Edits a 3b-i file deliberately.

`CreateBookshelf` currently writes `settings => []`, arguing that
`system_settings` exists but nothing reads it. **Task 1 makes that obsolete**:
once an administrator sets `default_loan_days` to 21, a shelf created afterwards
that silently uses 14 is wrong.

Copy the six `default_*` values into the new shelf's `settings` at creation, and
rewrite the docblock to say why the earlier reasoning no longer holds. Defaults
apply to **new shelves only**; existing shelves keep their own.

**Measured:** no 3b-i test asserts a new shelf's settings are empty — the one
creation test asserts profile fields and the audit row and never touches
`settings`. So nothing should break; if something does, read it before changing
it.

**Test:** a shelf created after a default changes carries the new value; one
created before is untouched.

---

## Task 8 — Record what this phase leaves open

`docs/known-gaps.md`, a `## Phase 3b-ii` section after the last `##` heading,
following the file's convention (read `## Phase 3b-i` for tone and citation
style). Record:

- **The public contact form is deferred to 3c**, to land with the inbox that
  reads it. BR:504 lists it; there is no feedback write path in the app and
  `/admin/feedback` is 3c's, so a form shipped now would promise a reply that
  cannot come.
- **Backup controls are not built** (BR:598 lists them; OPS specifies a
  last-backup time and a download command). An operations feature, not a settings
  field, and the reference's own settings page renders none of it.
- **Unit CRUD lives on `manage/units`, not the admin screen** — BR:600 puts the
  unit lists under the admin Bookshelves screen. We match it on authority
  (super admin only) and diverge on location, because `ParishUnit` is
  shelf-scoped and `/admin` binds no tenant.
- **Five of this phase's ten audit rows land where no screen can read them.**
  `system_settings.updated`, `site_contact.updated` and the three `category.*`
  are global rows; `AuditLogQuery:220` filters by `bookshelf_id`, so global rows
  are excluded, and `/admin/audit` is `underConstruction` (3c's). Defensible — an
  audit row is a record, not a promise — but it sits oddly beside D2's reasoning
  for deferring the contact form, so it is written down rather than left implicit.
- **The archived-shelf resolver filter and export remain deferred**, per 3b-i,
  with export still unscheduled and still a precondition.

---

## Definition of done

- **All six CI gates green**, run in the container where they belong.
- Every test watched failing and restored; `git status --porcelain` clean.
- Audit count at 58, census green in both directions.
- Screenshots of `/admin/settings`, `/contact`, `/admin/categories` and
  `manage/units` in both modes.
- No task left the suite red across a boundary.
