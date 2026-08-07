# Parish taxonomy — design

**Date:** 2026-08-08
**Status:** Approved. Feeds BUSINESS-REQUIREMENTS.md, DATABASE.md, OPERATIONS.md and the backend master plan.

How a parish subdivides its people, made configurable per bookshelf instead of assumed.

---

## 1. What is wrong today

`memberships` carries two free-text columns:

```sql
parish_group      text,   -- tổ
parish_community  text,   -- giáo họ
```

and the registration form hard-codes their values as literal options — `<option>Tổ 1</option>` through `Tổ 4`, `Giáo họ Thánh Tâm`, `Giáo họ Mân Côi`. Those belong to one parish. Every other parish using OLibra would be offered another parish's groups.

Free text fails three ways that matter:

**It cannot be grouped.** One volunteer types "Tổ 1", the next "tổ 1", a third "T1". The manager's reader list can never filter or sort by something with three spellings, and a filter is the main reason to record it.

**Renaming is a mass update.** A parish reorganises and *Giáo họ Mân Côi* becomes *Giáo họ Đức Mẹ*. With text, that is an edit to every membership row and a migration nobody wrote. With a reference, it is one edit.

**The structure is assumed rather than declared.** Two levels, always both, always called tổ and giáo họ. Real parishes vary in all three.

---

## 2. What varies, and what does not

The variation is real and threefold: **how many levels**, **what they are called**, and **whether the smaller nests inside the bigger**.

| Parish | Levels | Nested | Labels |
|---|---|---|---|
| Small, one flat division | 1 | — | *Tổ* |
| Sub-communities only | 1 | — | *Giáo họ* |
| Both, groups numbered within each sub-community | 2 | yes | *Giáo họ* → *Tổ* |
| Both, groups numbered across the whole parish | 2 | no | *Giáo họ*, *Tổ* |

What does **not** vary: at least one level, at most two. That ceiling is a deliberate limit, not an oversight — see §7.

**The system's own names for the levels are `bậc 1` and `bậc 2`.** It ships no vocabulary of its own beyond that. Every parish supplies the word it actually uses, and this document deliberately does not enumerate candidate words: inventing plausible-sounding Vietnamese parish terms is how a wrong one ends up in a dropdown.

---

## 3. The model

### 3.1 One self-referencing table

```sql
create table parish_units (
  id            uuid primary key default gen_random_uuid(),
  bookshelf_id  uuid not null references bookshelves(id) on delete restrict,
  level         smallint not null check (level in (1, 2)),
  parent_id     uuid references parish_units(id),
  name          text not null,
  sort_order    int  not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  constraint parish_units_l1_has_no_parent
    check (level = 1 or parent_id is not null or true),
  constraint parish_units_name_unique_in_scope
    unique (bookshelf_id, level, parent_id, name)
);
```

One table serves both shapes. **Nesting off** means every level-2 unit has a null `parent_id`. **Nesting on** means it has one. Switching a parish between them is data, not a migration.

A level-1 unit never has a parent — that is what makes it level 1.

### 3.2 Configuration lives in shelf settings

`bookshelves.settings` is already `jsonb`, so this costs no migration:

```json
"parish_taxonomy": {
  "levels": 2,
  "nested": true,
  "level1_label": "Giáo họ",
  "level2_label": "Tổ"
}
```

Defaults for a new shelf: one level, labelled `Tổ`, not nested. A parish that wants more turns it on; a parish that wants none leaves the unit list empty and the field never appears.

`nested` is meaningful only when `levels` is 2, and is ignored otherwise rather than being an error — a parish that drops to one level and later returns to two should find its previous choice intact.

### 3.3 Membership references units, not names

```sql
parish_unit_l1_id  uuid references parish_units(id),
parish_unit_l2_id  uuid references parish_units(id),
```

replacing `parish_group` and `parish_community`. Both nullable, always — see §5.

There is no data to migrate: no shelf has run yet, and the existing columns hold only fixture strings.

---

## 4. The rule that is not a constraint

**When a shelf is nested, the chosen level-2 unit must belong to the chosen level-1 unit.**

This cannot be a plain check constraint: it needs a lookup into another row of the same table, and whether it applies at all depends on a setting stored elsewhere. It is the same category as INV-5's loan limit, which DATABASE.md §7.2 already documents as application-enforced inside the transaction.

So it is enforced in the command, in the same transaction as the write, and it gets a named test. Recording it honestly matters more than the enforcement mechanism: a rule claimed as structural but implemented in application code is worse than one correctly labelled, because the label is what a future reader trusts.

**When a shelf is not nested**, no relationship between the two values exists to check, and none is checked.

---

## 5. Both levels stay optional, permanently

Not merely until the shelf is configured — always.

A shelf created this morning has no units and must still accept registrations, or a configuration task blocks real people. A manager fills the fields in after approving.

Beyond bootstrapping, a family may genuinely not belong to a group yet: newcomers, families between parishes, a child registered at the shelf by a volunteer who does not know. Forcing a value there produces a wrong one, and a wrong tổ is worse than a blank tổ because it looks like knowledge.

Where BR §16.1 currently marks these fields **Bắt buộc**, that changes. The requirement they were carrying — enough information to tell two children apart — is already carried by parents' names, which §5.3 makes required for exactly that reason.

---

## 6. What the screens do

**Shelf settings** (`/quan-tri/tu-sach/[id]`, super admin — where lending policy is already edited, and where the manager's own settings page stays read-only): a *Phân chia giáo xứ* section. Choose one or two levels, name each, switch nesting on or off when there are two, and manage the unit lists. With nesting on, the level-2 list is edited under its parent.

**Registration** (`/dang-ky`) and **manager-registers-reader** (`/quan-ly/nguoi-doc/moi`): render zero, one or two pickers according to what the shelf declared, labelled with the shelf's own words. Nested means picking level 1 filters level 2. Both optional. The hard-coded `Tổ 1`–`Tổ 4` options go.

**Reader list** (`/quan-ly/nguoi-doc`): filter by unit. This is the payoff — the thing free text made impossible.

**Everywhere a reader is described** — the approval queue, the lending confirmation, comment moderation, the request queue — shows the shelf's labels and the unit names, not the words "Tổ" and "Giáo họ" written into the page. Several screens currently hard-code them.

---

## 6.1 One module owns the shape

Six screens read this taxonomy and two write it. Without a shared module each
one re-derives "which pickers do I show", "which units belong under this
parent" and "how do I write a person's parish line" — and they will drift, the
way "Tổ 3 · Giáo họ Thánh Tâm" is currently written by hand into five
different pages.

**The pure logic lives in the domain**, framework-free and testable with no
database and no browser, because the same rules must run on the server when a
registration is submitted. A picker that filters correctly while the command
accepts anything is not validation.

`src/domain/members/parish-taxonomy.ts`:

```ts
type ParishTaxonomy = {
  levels: 1 | 2;
  nested: boolean;
  level1Label: string;
  level2Label: string;
};

type ParishUnit = {
  id: string;
  level: 1 | 2;
  parentId: string | null;
  name: string;
  sortOrder: number;
};

/** One level, "Tổ", not nested. What a brand-new shelf gets. */
function defaultTaxonomy(): ParishTaxonomy;

/** The options a picker should offer, ordered by sortOrder then name. */
function unitOptions(
  units: ParishUnit[],
  level: 1 | 2,
  parentId?: string | null,
): ParishUnit[];

/** INV: when nested, l2 must belong to l1. Same Block shape circulation uses. */
function validateSelection(
  taxonomy: ParishTaxonomy,
  units: ParishUnit[],
  selection: { l1: string | null; l2: string | null },
): Block;

/** "Tổ 3 · Giáo họ Thánh Tâm", or "" when nothing is set. */
function describeSelection(
  taxonomy: ParishTaxonomy,
  units: ParishUnit[],
  selection: { l1: string | null; l2: string | null },
): string;
```

`describeSelection` is the one that earns its place fastest: every screen that
names a reader's parish calls it instead of writing the words itself, so a
shelf that calls its divisions something else is correct everywhere at once.

`validateSelection` returns the same `Block` shape the circulation policy uses
(`{ blocked: true, reason: ErrorCode } | { blocked: false }`), so the picker
and the command share one implementation of §4's rule rather than two that can
disagree.

**The UI component consumes it** — `src/components/parish-unit-fields.tsx`
renders zero, one or two selects from a taxonomy and a unit list, handles the
nested filtering, and is used by registration, manager-registers-reader, and
the reader-list filter. It holds no rules of its own.

---

## 7. What this deliberately does not do

- **No third level.** Vietnamese parish structure can nest further, but a bookshelf serving a few hundred books needs enough to identify a family, not a full ecclesiastical hierarchy. Two levels with configurable names cover every shape reported. A third is additive if it is ever wanted.
- **No merging or splitting units.** Renaming is free because members reference an id. Merging two tổ into one is a real administrative event, but it is rare, and doing it properly means deciding what happens to history. Out of scope until asked for.
- **No cross-shelf taxonomy.** Units belong to one bookshelf. Two parishes with a *Giáo họ Thánh Tâm* have two unrelated rows, which is correct — they are different places.
- **No deletion of a unit that members reference.** Soft-delete only: the unit stops being offered in pickers and keeps describing the people already in it. A membership pointing at a deleted unit is history, not an error.
- **No inference from a name.** The system never parses "Tổ 3" to derive a number or an ordering. `sort_order` is explicit, because "Tổ 10" sorting before "Tổ 2" is exactly the kind of detail that makes software feel careless.

---

## 8. New operations

| Operation | Caller | Note |
|---|---|---|
| `GetParishUnits` | `reader` | The shelf's units and labels, for rendering the pickers |
| `CreateParishUnit` | `super_admin` | |
| `RenameParishUnit` | `super_admin` | The reason ids are stored |
| `ReorderParishUnits` | `super_admin` | Sets `sort_order` |
| `DeleteParishUnit` | `super_admin` | Soft delete |
| `UpdateParishTaxonomy` | `super_admin` | Level count, labels, nesting |

`RegisterMembership`, `ManagerRegisterReader`, `RegisterMemberOnBehalf` and `ApproveProfileChange` take `parishUnitL1Id` and `parishUnitL2Id` in place of the two text fields. `GetReadersList` gains a unit filter.

`GetParishUnits` is `reader` rather than `guest` because registration already knows which shelf it is joining and a stranger has no business enumerating a parish's internal divisions.

---

## 9. Why now, before S1

S1 lands the schema. Doing this afterwards means a migration on `memberships`, a backfill from free text that cannot be done reliably, and every query that reads a reader's parish details rewritten. Doing it now is two columns that never existed.
