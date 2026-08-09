# B2b · Profile changes, parish units, and the avatar

**Slice:** master plan §7.2, second half — the split declared in
[B2a](2026-08-08-b2-members.md#this-is-one-of-two-plans-read-this-section-before-deciding-what-to-build).
**Blocked by:** B2a (merged), B5 (merged — `src/storage/s3.ts`).
**Blocks:** D1's profile-change notifications, the `/quan-tri/tu-sach` settings
screen, and every screen that edits a person.

Reconciled against `main` at **`a8f819e`**. Every claim below was read off disk
or out of a migration, not out of a source document.

---

## 1. What this slice is

Eleven commands and three queries, in three groups that share one table each:

| Group | Commands | Reads/writes |
|---|---|---|
| The profile-change lifecycle | `ProposeProfileChange`, `ApproveProfileChange`, `RejectProfileChange`, `CancelProfileChange`, `UpdateOwnProfile` | `profile_change_requests`, `users`, `memberships` |
| **The manager's direct edit — new, and the reason this slice is picked up now** | `UpdateReaderProfile` | `users` |
| The avatar | `ProposeAvatarChange` | `profile_change_requests`, `src/storage/s3.ts` |
| Parish units | `CreateParishUnit`, `RenameParishUnit`, `ReorderParishUnits`, `DeleteParishUnit`, `UpdateParishTaxonomy` | `parish_units`, `bookshelves.settings` |

Queries: `GetMyProfile`, `GetMyProfileChangeRequest`, `GetPendingProfileChanges`
— the first two moved here from D3 by B2a's known gap 9
(`2026-08-08-b2-members.md:4144`), because neither touches a loan and leaving
them in a C1-blocked slice would block a reader seeing their own pending change
for no reason.

**Screens are not in scope.** See §7.

---

## 2. Reconciliation against shipped code

Every plan in this project has gone stale before execution and this pass has
caught real defects every time — C1's found fourteen. Ranked by how much damage
an implementer would do by following the spec as written.

| What the spec says | What the code says | Consequence |
|---|---|---|
| **Master §5 Q8** (`2026-08-07-olibra-backend-master.md:345`): the assumed answer is "a manager may **propose** on a member's behalf, producing a request another manager approves — keeping INV-13's audit trail intact rather than adding a silent edit". | The product owner has now decided the opposite: **a manager edits directly, with a full audit record, no approval step.** | An implementer following the master plan builds the wrong command entirely, and builds it against an invariant nobody restated. **§3 is this plan's largest section for that reason.** |
| **BR §6:259 / DATABASE.md:1307** — INV-13: "A person's verified details change only through an approved ProfileChangeRequest." | A second write path is now sanctioned. **The sentence is false as written.** | Shipping the command before the documents change leaves the codebase contradicting its own numbered specification of correctness. Documents change **first** — Task 1. |
| **OPS §4.3:497** — `ApproveProfileChange` "is the *only* path by which a person's verified details change". | Same. | Same sentence, second home. Both must change together or they disagree. |
| B2a: writes to `users` are safe because RLS scopes them. | **`users` carries no row-level security at all.** `0010_rls.sql:38-41` names it excluded by design; B2a probed it live: `update users … where id = <any user> -> UPDATE 1` (`2026-08-08-b2-members.md:97`, `:100`). | Any command here that takes a `userId` from its caller lets a manager of one parish rewrite **any person in the system**. Every command below resolves its subject through a shelf-scoped `memberships` select and takes a `membershipId`. Non-negotiable; see §4.2. |
| **OPS §4.3:480** — proposing again while one is pending "**replaces** it rather than creating a second… this is normal, specified behavior, not a failure". | `profile_change_requests_one_pending` is `unique (user_id) where status = 'pending'` (`0008_profile_changes.sql:27-29`) — **global across shelves, not per shelf**. `profile_change_requests` is RLS-scoped (`0010_rls.sql:64`), so a pending row belonging to shelf A is invisible from shelf B *and* an update targeting it affects zero rows silently (B2a probed both: `:93-94`). | "Replace" is achievable only within one shelf. A reader with memberships at two shelves who proposes at the second gets a **raw `23505` out of the driver**, which OPS §2 forbids. Must be caught and mapped — §4.4. |
| B2a `:148` — its "contribution to INV-13b is negative": `SetReaderCredentials` writes `users` "and it must be the *only* command in B2a that does". | **It is not.** `change-own-password.ts:57-60` also runs `update users set password_hash = …`, and B2a shipped both. | The INV-13b guard cannot be "exactly one other file" or "exactly two". It must **enumerate** the exempt writers with a reason each, or it will be written wrong and then relaxed until it proves nothing. §3.5, Drift 2. |
| **OPS §4.3:542** — `ProposeAvatarChange` inputs: "`userId`, image file (≤2 MB, square, per the profile screen's own copy)". | Three separate problems. (a) `userId` — the trap above. (b) **The profile screen has no such copy.** `src/app/tu-sach/[shelf]/toi/ho-so/page.tsx:58` reads only "Ảnh mới sẽ gửi cho quản lý xem và duyệt trước khi hiển thị."; `2 MB`, `MB`, `vuông` and `square` appear **nowhere** under `src/app/` or `src/components/`. (c) The domain may not receive bytes — `tests/architecture/boundaries.test.ts:46` forbids `src/domain/` importing `src/storage/`. | The size limit has a sentence (`file_too_large`, OPS:547) so it can be implemented; **"square" has no sentence, no code, and no source.** U1 §6.1:134 already recorded that "a maximum upload size, an allowed content-type list, and what a volunteer sees when a photo is rejected" do not exist anywhere. Flagged to the product owner in §8 — not invented here. |
| Parish CRUD's caller is `super_admin` (OPS §4.5:739, `:750`, `:761`, `:774`; taxonomy design §8:234-238). | **There is no `requireSuperAdmin` anywhere in `src/`.** `policy.ts:153-181` has `requireManager`, `requireReader`, `requireSelfOrManager`. The rank exists (`tenant.ts:10`) and `contextFor` does produce `role: "super_admin"` (`guards.ts:107-117`). | One gate to add — **and it must be paired with `requireIdentifiedActor`** (`tenant.ts:84`). `systemContext` (`tenant.ts:42-48`) yields `{ userId: null, membershipId: null, role: "super_admin" }` — the highest rank with nobody behind it — so a rank-only gate passes under the seed and commits an audit row with a null actor. That docstring records this exact defect shipping once already, in `voidLoan`. |
| `parish_units_l1_has_no_parent` makes the hierarchy sound. | It is `check (level = 2 or parent_id is null)` (`0003_identity.sql:74-75`). That forbids a level-1 unit having a parent. **Nothing forbids a level-2 unit's parent being another level-2 unit.** B2a verified the sibling case live: the database does not check that `memberships.parish_unit_l1_id` names a level-1 unit either (`2026-08-08-b2-members.md:57`). | `CreateParishUnit` must check its `parentId` resolves to a **live level-1 unit of this shelf** in its own transaction. The composite FK (`20260808_04:68-71`) gets the *shelf* right; the *level* is application-enforced, exactly like the nesting rule (DATABASE.md:1313). |
| Taxonomy design §3.1:69-71 shows `parish_units_name_unique_in_scope` as a table constraint. | `20260808_03_soft_delete_aware_uniqueness.sql:16-19` dropped it and replaced it with `create unique index … (bookshelf_id, level, parent_id, name) nulls not distinct where deleted_at is null`. B2a verified both halves: a duplicate live name raises `23505`; a soft-deleted unit **frees its name** (`2026-08-08-b2-members.md:62`). | `CreateParishUnit`/`RenameParishUnit` can hit `23505`, and **OPS §4.5:744 lists no failure mode for a duplicate name** — its `validation_failed` covers "empty `name`, `parentId` supplied for a level-1 unit, or `level` outside `{1, 2}`". §8 flags it; §4.5 says what to ship in the meantime. |
| DATABASE.md §4.11:1072 — `requested_at timestamptz not null default now()`. | The default is the **database host's** clock. `20260808_06_updated_at_triggers.sql:18-22` adds `set_updated_at()`, also SQL `now()`, and attaches it to `profile_change_requests`, `parish_units`, `memberships` and `users` (`:28-31`). `runCommand` sets `olibra.now` from `ctx.clock` (`unit-of-work.ts:180-181`). | Two clocks in one transaction (DATABASE.md §6). `requested_at` and `decided_at` are timestamps **the domain means** and come from `ctx.clock.now()` (§4.7). `updated_at` will not agree with them under a `fixedClock`, and no test may assert that it does. |
| OPS §4.3 lists `not_pending` for `ApproveProfileChange`, `RejectProfileChange` and `CancelProfileChange` — "Yêu cầu này đã được xử lý." (`:500`, `:514`, `:525`). | `errors.ts:91` already holds that **exact sentence** under `request_not_pending` — which is C1/C2's *borrow*-request code (OPS §4.2:306, `:316`). B2a split the membership half off as `registration_not_pending` (`errors.ts:120`, sentence "Đơn đăng ký này đã được xử lý."). | **This is the fourth `not_pending` collision, and it is B2b's** — B2a said so at `2026-08-08-b2-members.md:34`. A new code, not a reuse: two codes may share a sentence, but one code may not name two different things a later slice will want to split. §4.3. |
| — | `errors.ts:99` holds `change_already_pending: "Bạn đang có một yêu cầu thay đổi chờ duyệt."` and **nothing references it** — grepped across `src/` and `tests/`. OPS §4.3 names no such failure mode. | It is the honest sentence for the cross-shelf `23505` above, and it is already shipped, so no new Vietnamese is written. Do not reword it (B1's rule). |
| — | `errors.ts:100` holds `reason_required_on_reject: "Từ chối cần ghi lý do."` and **nothing references it** either. B2a recorded it as B3's (`:4136`). OPS §4.3:513 uses "Vui lòng ghi lý do từ chối." = shipped `reject_reason_required`. | Not B2b's. `RejectProfileChange` uses `reject_reason_required`. Recorded so nobody "tidies" it. |
| DATABASE.md §4.11:1092-1097 argues `jsonb` so "adding a proposable field is additive on the application side only — no migration". | `profile_change_requests` has **no avatar column and no `deleted_at`** (`0008_profile_changes.sql:5-25`), confirmed by B2a's `\d` pass (`:65`). | The proposed image's URL and its storage key live in `proposed_values`, which is what that argument was written for. **No migration in this slice.** §4.6. |
| — | `audit.ts:66-77` forbids any audit field whose whole-token name includes `key`. `avatar_key` tokenizes to `avatar`/`key` and would throw `RuleViolated("audit_forbidden_field")` the moment a command audited `proposed_values`. | The jsonb field is named **`avatar_object`**, not `avatar_key`. A landmine avoided by naming, not by remembering. |
| U1 §6.1:133 — "The running app has never been given the seven `S3_*` variables." | **Stale.** `compose.yaml:181-190` passes all seven to the `app` service, and `.env.example:50-59` documents them. What *is* true: **nothing constructs an `ObjectStore`** — `createObjectStore`/`s3ConfigFromEnv` have no caller outside `src/storage/` and `tests/`, verified by grep — and no test asserts compose's `app` service carries them, unlike CI's `tests/architecture/ci-supplies-required-env.test.ts`. | B2b wires the store (§4.6, Task 7). B5's own smoke gate is vacuous until something under `src/app/` imports the store (`2026-08-08-b5-object-storage.md:104-113`); **this slice is what makes it real.** |
| The brief cites `docs/superpowers/plans/2026-08-08-parish-taxonomy-design.md`. | It is at `docs/superpowers/specs/2026-08-08-parish-taxonomy-design.md`. | Cosmetic; recorded so the next reader does not conclude it was deleted. |
| The brief lists `parish-taxonomy.ts`'s exports as `validateSelection`, `unitOptions`, `describeSelection`, `hasVisibleLevel2`. | Six, not four: also `defaultTaxonomy` (`:41`) and `unitName` (`:185`). | `UpdateParishTaxonomy` writes `defaultTaxonomy()`'s shape for a shelf never configured; the settings screen renders rows through `unitName`. Both are needed; neither is to be re-derived. |

### What this pass verified as still correct

Stated explicitly, because a reconciliation that only reports breakage does not
tell you whether it looked.

- **Column lists.** `users` (`0003_identity.sql:11-29`), `memberships`
  (`:83-110`), `parish_units` (`:63-78`), `profile_change_requests`
  (`0008:5-25`) match DATABASE.md §4.1 and §4.11 field for field. `users
  .avatar_url` is a live `text` column. `memberships.leaderboard_opt_in` is a
  live `boolean not null default true` — `UpdateOwnProfile` has a column to
  write.
- **Enum labels.** `profile_change_status` is `pending | approved | rejected |
  cancelled` (`0008:3`), exactly BR §7.4's four states.
- **Constraints.** `profile_change_requests_rejected_has_reason`
  (`0008:23-24`) still fires, so `RejectProfileChange` must set the reason in
  the same statement as the status. `parish_units_l1_has_no_parent` is the
  corrected form, not the `or true` no-op the design's first draft carried
  (spec §3.1:64-66).
- **Privileges.** `0010_rls.sql:27` grants `olibra_app` select/insert/update
  and **no delete** on these tables. `DeleteParishUnit` is an
  `update … set deleted_at`, which is what taxonomy design §7:223 wants anyway
  — an implementer who writes `delete from parish_units` gets a privilege
  error, not a silent pass.
- **`validateSelection`'s three error codes** — `parish_unit_l1_not_found`,
  `parish_unit_l2_not_found`, `parish_unit_l2_not_in_l1` — are shipped
  (`errors.ts:103-106`) with OPS's exact sentences, and `validateSelection`
  (`parish-taxonomy.ts:107-140`) deliberately treats a soft-deleted unit as
  existing, so re-validating an unchanged selection in `ApproveProfileChange`
  does not start failing the day a manager retires that unit (`:100-106`).
  **`ApproveProfileChange` is the only code path B2b shares with B2a**, and it
  is shared as an import (B2a `:32`).
- **`not_own_request`** (`errors.ts:94`, "Bạn không thể huỷ yêu cầu của người
  khác.") is character-identical to OPS §4.3:524's sentence for
  `CancelProfileChange` and OPS §4.2:340's for `CancelOwnRequest`. Same
  meaning, same sentence — **reuse, no split.** Checked precisely because
  three slices in a row found one that needed splitting.
- **`validation_failed`** is not a fourth collision here. OPS §4.3's two
  sentences were already split by B1 into `required_fields_missing` and
  `validation_failed` (`errors.ts:33`, `:45`), and all four parish commands
  (OPS §4.5:733, `:744`, `:755`, `:766`) use the same sentence "Vui lòng kiểm
  tra lại thông tin." — which is `validation_failed`'s shipped wording.
- **`audit_log.action` is `text`, not an enum** (`0007:26`). Five new action
  names cost no migration.
- **The kernel's write guard.** `guardWrites`/`guardPendingQuery`
  (`unit-of-work.ts:218-297`) turns any `UPDATE`/`DELETE` a command runs
  through `tx` that affects zero rows into `NotFound("write_target_not_found")`
  unless the query opts out with `.allowZero()`. That is what stands between
  this slice and the silent cross-shelf no-op that shipped once already
  (`unit-of-work.ts:452-460`).
- **B5's interface.** `ObjectStore` is `put(key, body, contentType)`,
  `url(key)`, `delete(key)` (`s3.ts:75-79`); `objectKey(prefix, extension)`
  (`:397`) allows `jpg | jpeg | png | webp` (`:368`) and throws on anything
  else; `delete` of a key that does not exist does not throw
  (`2026-08-08-b5-object-storage.md:239-240`).

### The user-id / membership-id map for this slice

This project's recurring defect. `20260808_04_composite_tenant_fks.sql:41-45`
states the rule: every foreign key pointing at `users(id)` was left alone,
"because `users` is a global table, not a shelf-scoped one". The worst
offender it names is `borrow_requests.member_id`, which is a **user** id
(`0005_circulation.sql:63`) — as is `loans.borrower_id` (`:20`).

Every column this slice touches, so an implementer cannot get it wrong:

| Column | Holds | Source |
|---|---|---|
| `users.id` | **user id.** Global table, **no RLS**. | `0003:12`, `0010:38-41` |
| `memberships.id` | **membership id.** RLS-scoped. **This is what every command in this slice takes as input.** | `0003:84` |
| `memberships.user_id` | user id | `0003:86` |
| `memberships.approved_by` | user id | `0003:96` |
| `memberships.parish_unit_l1_id` / `_l2_id` | parish-unit id, **composite FK** `(bookshelf_id, …) → parish_units(bookshelf_id, id)` | `20260808_04:75-83` |
| `profile_change_requests.user_id` | **user id — not a membership id**, despite the table being shelf-scoped and every command here taking a `membershipId` | `0008:7` |
| `profile_change_requests.decided_by` | **user id** | `0008:16` |
| `profile_change_requests.bookshelf_id` | bookshelf id — set from `ctx.bookshelfId`, **never from input** | `0008:8` |
| `parish_units.parent_id` | parish-unit id, **composite FK** to the same table | `20260808_04:68-71` |
| `audit_log.actor_id` | **user id** (`ctx.actor.userId`, written by the kernel) | `0007:25`, `audit.ts:192` |
| `audit_log.entity_id` | **bare `uuid`, no foreign key.** Each command below states which id it writes. | `0007:28` |

**One structural gap that follows from the table.**
`profile_change_requests.user_id` references `users(id)` plainly, and `users`
is global — so **nothing structurally ties a request row to a membership of
its own `bookshelf_id`.** RLS's `with check` guarantees the `bookshelf_id`
matches the session (`0010:87`), and that is all it guarantees. A row naming a
`user_id` with no membership at that shelf is representable. Every command that
reads or writes this table therefore joins through `memberships` as well.

---

## 3. The product decision, and the invariant it changes

### 3.1 The hole

BR §2:75 makes credentials optional *because* most readers are children who
will never sign in. `ProposeProfileChange`'s caller is `reader` (self only)
(OPS §4.3:479). No manager-edit command exists. So a family that moves house
has no path to a corrected phone number — the number BR §16.3 calls the actual
mechanism by which books come back.

**The answer chosen: a manager edits directly, with a full audit record. No
approval step.**

This supersedes master §5 Q8's assumed reading, which added a proposal step. It
is a change to a named invariant and is handled as one.

### 3.2 Why this is not a weakening

BR §2:77-81 already contains the identical argument, made about a strictly
larger power:

> **A manager sets and changes those credentials.** … This hands a manager real
> power … The mitigation is not to restrict the power but to make every use of
> it **visible**.

Whoever can set a reader's password can already sign in as that reader and
propose anything they like as that reader. A manager who wanted to change a
child's phone number silently could do it today, in two commands, and the audit
trail would say a *reader* proposed it. **The direct edit is the more
truthful record, not the weaker one.**

What INV-13b actually protected was traceability — that a person's details
never change silently — not the approval step as such. The approval step
protects something narrower and still holds: **a reader** may not rewrite their
own verified details.

### 3.3 The restatement, and who owns it

DATABASE.md:1313 is explicit that this is not DATABASE.md's call:

> BR §6 owns that numbered list, and adding to or changing a set BR §6 itself
> calls "the specification of correctness" is a product decision for that
> document to make, not one this document should make on its behalf.

That product decision has now been made, so **BR §6 is where it is recorded,
and DATABASE.md and OPERATIONS.md follow.** Three documents change, in that
order:

**1. `docs/BUSINESS-REQUIREMENTS.md` §6, row INV-13** (currently line 259):

> **INV-13** — At most one ProfileChangeRequest per person is pending at a
> time. A person's verified details never change silently: every change is
> either an approved ProfileChangeRequest or a manager's direct correction, and
> both write an audit record naming the actor, the time, and the values before
> and after. A **reader** changes their own verified details only by proposal.

**2. `docs/BUSINESS-REQUIREMENTS.md` §2**, after the existing "Changing your own
details is a request, not an edit" paragraph (`:83`) — which stays exactly as
it is, because it is about the reader and remains true. One new paragraph,
deliberately mirroring the credentials paragraph three above it:

> **A manager corrects a reader's details directly.** Most readers are
> children who never sign in (§2, above), so a proposal a reader cannot make is
> not a route to a corrected phone number — and the phone number is how books
> come back (§16.3). A manager edits the record, and the edit writes an audit
> entry naming the manager, the reader, the time and the values before and
> after. This is the same trade the previous two paragraphs make about
> credentials: the mitigation for a power a manager needs is visibility, not
> withholding.

**3. `docs/DATABASE.md`** — §7's INV-13 row (`:1307`) restates the above and
keeps the split honest: the partial unique index is still the whole of the
first half, and the second half is still application discipline, now over
**two** sanctioned write paths instead of one. §4.11:1099's paragraph on
`profile_change_requests_one_pending` needs the same edit.

**4. `docs/OPERATIONS.md` §4.3** — the new command's entry (§3.4 below), and
`ApproveProfileChange`'s parenthetical at `:497` ("this is the *only* path by
which a person's verified details change") loses the word *only*.

### 3.4 `UpdateReaderProfile` — the command, in OPS §4.3's own register

Named after `SetReaderCredentials`, its closest sibling: a manager acting on a
named reader's person record. `UpdateOwnProfile` (reader, own) and
`UpdateReaderProfile` (manager, a reader's) then read as the pair they are.

- **Inputs:** `bookshelfId`, `membershipId`, new values for any subset of:
  saint name, full name, DOB, father's name, mother's name, phone, email,
  avatar URL. **Never a `userId`** — see §2's map and §4.2.
- **Caller:** `manager`
- **Invariants enforced:** INV-8; INV-13 as restated — this is the second
  sanctioned write path to a person's verified details, and it is audited with
  before and after
- **Audit action:** `profile.corrected` — `entityType: "user"`,
  `entityId: <the user id resolved through the membership>`, `before`/`after`
  carrying **only the fields that actually changed**. Deliberately not
  `membership.updated` (which `UpdateOwnProfile` already uses for the
  leaderboard toggle) and not `profile_change.approved` (a different act by a
  manager who was shown a proposal). BR §14 wants a name the audit browser can
  filter on; the thing a super administrator must be able to filter for is
  exactly "a manager changed someone's details without an approval step", the
  same oversight need `credentials.set` serves (BR §2:79, §13.2).
- **Failure modes** — every code and sentence already shipped; **no new
  Vietnamese is written here**:
  - `membership_not_found` — "Không tìm thấy bạn đọc này." (`errors.ts:98`;
    OPS §4.3:448 already uses this sentence for `SetReaderCredentials`)
  - `required_fields_missing` — "Vui lòng điền đầy đủ các trường bắt buộc."
    (`errors.ts:45`) — `full_name`, `father_name`, `mother_name` are `not null`
    (`0003:16-19`), so blanking one must be a named failure, not a `23502`
  - `validation_failed` — "Vui lòng kiểm tra lại thông tin." (`errors.ts:33`)
  - `empty_proposal` — "Vui lòng thay đổi ít nhất một trường." (OPS §4.3:484;
    new code, §4.3) — a manager edit that changes nothing must not write an
    audit entry claiming it did
  - `not_permitted` — "Bạn không có quyền thực hiện việc này." (`errors.ts:129`)

**The one new sentence this command needs is not an error message.** It is the
screen's own copy: whatever a manager reads above the form, and whatever the
audit browser renders `profile.corrected` as in Vietnamese (BR §14). Neither
exists in OPERATIONS.md or in any built screen. **Flagged to the product owner
in §8 rather than written here.**

### 3.5 Can the manager edit and the approval path drift, and what holds them together

Yes, in three ways, and each gets a mechanism rather than a promise.

**Drift 1 — the field set.** `ApproveProfileChange` writes the fields named in
`proposed_values`; `UpdateReaderProfile` writes the fields named in its input.
Two field lists are two things that can disagree, and the failure is silent: a
field added to one path is simply not writable through the other.

*Mechanism:* one module, `src/domain/members/profile-fields.ts`, exports the
allowlist **as data** and a single writer:

```ts
export const PROFILE_FIELDS = [
  "saint_name", "full_name", "date_of_birth",
  "father_name", "mother_name", "phone", "email", "avatar_url",
] as const;

export async function applyProfileFields(
  tx: Tx, userId: string, fields: Partial<ProfileFields>,
): Promise<{ before: ProfileFields; after: ProfileFields }>;
```

Both commands call it and neither writes `users` itself. `username`,
`password_hash` (`SetReaderCredentials`'s, and INV-14's), `is_super_admin`,
`display_name` and `locale` are **not** in the list. The update writes only the
named fields — B1's `UpdateBook` lesson (`65d46e1`), not a whole-row rewrite.

*Test that holds it:* a table-driven test over `PROFILE_FIELDS` that, for
**every** entry, drives both paths and asserts the same column ends with the
same value. Adding a ninth field with a one-path implementation fails it
without anyone having to remember.

**Drift 2 — a third write path appearing later.** INV-13b is application
discipline precisely because no constraint can express which code path may
write `users` (DATABASE.md:1307).

*Mechanism:* an architecture test in the INV-13 file that greps `src/domain/`
for `update users` and asserts it appears in exactly **three** files, each for
a stated reason:

| File | Writes | Why it is exempt from INV-13b |
|---|---|---|
| `profile-fields.ts` (new) | the eight verified fields | it *is* INV-13b's application half |
| `commands/set-reader-credentials.ts:116-120` | `username` **and** `password_hash`, in one statement so INV-14's pairing cannot be broken even momentarily | credentials are not verified details — BR §2:77 gives a manager this power explicitly |
| `commands/change-own-password.ts:57-60` | `password_hash` | BR §16.2: the password is one of the two things "not a fact about the person that a manager verified" |

**Three, not two** — verified by grep at `a8f819e`, and the second and third
are the reason the test must enumerate rather than count: "no other command
writes `users`" is false and always was. `display_name`, `locale` and
`is_super_admin` are written by nothing in `src/domain/` at all today, and the
test's value is that a fourth file appearing is a review conversation rather
than a discovery. Same shape as
`tests/architecture/storage-speaks-s3.test.ts`, and for the same reason: the
failure should land in the suite the author is running.

**Drift 3 — a manager edit making a pending proposal's `previous_values` lie.**
BR §5.4 says the snapshot exists so "a manager reviewing a week-old request
sees what it would actually change". A direct edit after the snapshot was taken
makes it show what it *was* expected to change.

*Decision:* `UpdateReaderProfile` does not touch a pending request, and
`GetPendingProfileChanges` renders the "current" column **from `users`, live**,
never from `previous_values`. `previous_values` stays what DATABASE.md §4.11
calls it — a historical record of the state at proposal time — and the queue
can never show a stale current value.

*Test that holds it:* correct a phone number through `UpdateReaderProfile`
while a proposal for that phone number is pending, then assert
`GetPendingProfileChanges` shows the **new** number as current and the row's
`previous_values` unchanged.

### 3.6 How `tests/invariants/inv-13-one-pending-profile-change.test.ts` must change

The file today (55 lines) has three tests, all inserting directly with the
superuser `sql` handle, and it says so in its own comment
(`:18`): *"The database's half … 'only through an approved request' is
application discipline and is not tested here."* B2a assigned that half to B2b
(`2026-08-08-b2-members.md:148`).

**What must still be guaranteed, unchanged:** all three existing tests keep
passing, verbatim. A second pending row for the same person collides with
`23505`; a decided request does not occupy the slot; two different people may
each have one pending. Those are the partial unique index, and the index is not
changing.

**What must be added:**

1. **INV-13a through the command**, not through raw SQL. The three shipped
   tests prove the *index*; none proves that `ProposeProfileChange` behaves
   correctly when it fires. A second proposal at the same shelf replaces; a
   second proposal from a **different** shelf fails `change_already_pending`
   rather than raising `23505` (§4.4).
2. **INV-13b, both paths.** After `ApproveProfileChange`, `users` holds the
   proposed value and an audit row names the manager. After
   `UpdateReaderProfile`, the same, with `profile.corrected`. **Neither commits
   without its audit row** — that is `Command<I, O>`'s signature doing the work
   (`unit-of-work.ts:333-348`), and the test asserts it rather than trusting it.
3. **INV-13b, negatively** — Drift 2's grep test above.
4. **The reader cannot.** `ProposeProfileChange` writes nothing to `users`: the
   existing phone number is still in force after a proposal. This is master
   §7.2's acceptance clause that B2a explicitly deferred here
   (`2026-08-08-b2-members.md:4120`).

The file gains a header comment recording the restatement and the date, so the
next reader learns that INV-13b's wording changed and why, from the test rather
than from a commit message.

---

## 4. Decisions

### 4.1 Documents change before code, not after

Task 1 is the three-document edit and nothing else. The reason is mechanical
rather than ceremonial: §3.6's tests are written against the restated INV-13,
and a test asserting a behaviour the specification forbids is a test nobody can
review. Landing the code first would also leave `main` in a state where
`docs/BUSINESS-REQUIREMENTS.md:259` and `src/domain/members/` contradict each
other, which is the exact failure mode DATABASE.md:1313 argues against — "a
rule described as structural but implemented in application code is worse than
one correctly labelled, because the label is what a future reader trusts."

### 4.2 Every command takes a `membershipId`; `users` is reached only through it

`users` has no RLS (`0010_rls.sql:38-41`). `set-reader-credentials.ts:53-60`
already states the rule and the reason in its own docstring: *"That is why the
input is a `membershipId` and why there is no `userId` parameter to get
wrong."*

Applied here:

- `ProposeProfileChange`, `CancelProfileChange`, `ProposeAvatarChange`,
  `UpdateOwnProfile` — `membershipId`, gated by `requireSelfOrManager`
  (`policy.ts:172`), which compares `ctx.actor.membershipId` (resolved from the
  session by `contextFor`, never supplied by the caller).
- `UpdateReaderProfile` — `membershipId`, `requireManager`.
- `ApproveProfileChange`, `RejectProfileChange` — `profileChangeRequestId`
  (OPS §4.3:495, `:508`), and the command joins from the request through
  `memberships` to prove the subject is a member of **this** shelf before
  writing `users`. RLS scopes the request row; it does not scope the `users`
  write that follows.

This **diverges from OPS §4.3:531 and `:542`**, which give `ChangeOwnPassword`
and `ProposeAvatarChange` a `userId`. B2a already diverged the same way for
`ChangeOwnPassword` and recorded it as a gap OPS should close
(`2026-08-08-b2-members.md:4134`). B2b makes the same divergence for
`ProposeAvatarChange` and closes both in OPERATIONS.md as part of Task 1.

### 4.3 New error codes — four, and every sentence is somebody else's

Checked against all 55 shipped entries in `errors.ts`, not assumed free.

```ts
  // — members: B2b —
  // OPS §4.3's own sentences. `profile_change_not_pending` is the fourth
  // one-code-two-sentences split this catalogue has needed: OPS gives
  // `not_pending` "Đơn đăng ký này đã được xử lý." under ApproveMembership
  // (:391) and "Yêu cầu này đã được xử lý." under ApproveProfileChange
  // (:500). B2a took the first as `registration_not_pending`. The second
  // shares its sentence with the shipped `request_not_pending` (:91), which
  // is a *borrow* request's — same words, different subject, so a distinct
  // code rather than a reuse: two codes may share a sentence, but one code
  // may not name two things a later slice will want to tell apart.
  profile_change_not_pending: "Yêu cầu này đã được xử lý.",
  empty_proposal: "Vui lòng thay đổi ít nhất một trường.",
  file_too_large: "Ảnh vượt quá 2 MB.",
  invalid_image: "Tệp này không phải là ảnh hợp lệ.",
```

Reused unchanged, each verified present: `change_already_pending` (`:99`),
`not_own_request` (`:94`), `reject_reason_required` (`:125`),
`membership_not_found` (`:98`), `required_fields_missing` (`:45`),
`validation_failed` (`:33`), `not_permitted` (`:129`),
`write_target_not_found` (`:143`), `parish_unit_l1_not_found` /
`parish_unit_l2_not_found` / `parish_unit_l2_not_in_l1` (`:103-106`).

**No code is invented for "that profile change request does not exist."** OPS
§4.3 names none, and an `ErrorCode` may not be invented with a Vietnamese
sentence nobody wrote (the rule `tenant.ts:77-82` states). The commands select
the row first and throw `NotFound("write_target_not_found")` — "Không tìm thấy
dữ liệu cần thay đổi." — which is the kernel's honest generic. §8 asks the
product owner for the sentence.

**Two collisions remain open and are still not B2b's.** `errors.ts:79-84`
names them: `membership_not_active` reads "không thể mượn thêm" here and
"không thể gửi yêu cầu mượn" under `CreateBorrowRequest` (OPS:293), and
`copy_lost_or_retired` gains "Bản sách đã chọn…" under `ApproveBorrowRequest`
(OPS:305). Both belong to C2. Re-checked while adding the four above; neither
is reachable from any command in this slice.

### 4.4 The cross-shelf pending request, and why "replace" is not enough

`profile_change_requests_one_pending` is global across shelves
(`0008:27-29`). RLS hides another shelf's pending row in both directions
(`0010:84-88`; B2a probed it, `2026-08-08-b2-members.md:93-94`).

So `ProposeProfileChange` does, in order:

1. `update profile_change_requests set … where user_id = … and status =
   'pending'` — the replace OPS §4.3:480 specifies. RLS scopes it to this
   shelf. `.allowZero()`, because "no pending request" is the normal case and
   the kernel's guard would otherwise reject it.
2. If nothing was updated, `insert`. Wrapped in `try`/`catch` on
   `isUniqueViolation` (`errors.ts:192`) → `RuleViolated("change_already_pending")`.

The `catch` is not belt-and-braces. It is the **only** way a reader with
memberships at two shelves gets a sentence instead of a `PostgresError`, and
step 1 cannot see the row that will reject step 2. B2a recorded this exact
sequence as the thing B2b "will not think to" do
(`2026-08-08-b2-members.md:4138`).

The test falsifies it: remove the `catch` and the two-shelf case must fail with
a raw `23505`.

### 4.5 Parish units — five commands, one new gate, one flagged gap

- **`requireSuperAdmin(ctx)`** joins `policy.ts`'s three gates, built on
  `atLeast(ctx.actor.role, "super_admin")` (`tenant.ts:16`), **and every one of
  the five commands also calls `requireIdentifiedActor`** (`tenant.ts:84`) —
  see §2's row on `systemContext`.
- **`CreateParishUnit`** checks `parentId` resolves to a live **level-1** unit
  of this shelf, in its own transaction. The composite FK gets the shelf right;
  nothing in the database gets the level right (§2).
- **`DeleteParishUnit`** is `update … set deleted_at = ${ctx.clock.now()}`, and
  **cascades to live level-2 children when the target is level 1** (OPS
  §4.5:771, taxonomy design §7:224), in the same transaction, with **one audit
  entry per row** — `Command`'s return type already takes an `AuditEntry[]`
  (`unit-of-work.ts:348`). `hasVisibleLevel2` (`parish-taxonomy.ts:206-215`)
  documents precisely what breaks without the cascade.
- **`ReorderParishUnits`** uses the statement B2a verified live and recorded
  for this slice (`2026-08-08-b2-members.md:109-115`) — `unnest(…) with
  ordinality`, one `UPDATE`, `sort_order` in the array's order. It is not
  re-derived here.
- **`UpdateParishTaxonomy`** writes `bookshelves.settings->'parish_taxonomy'`
  with **snake_case** keys (`level1_label`, `level2_label`) — the seed writes
  them that way (`seed.ts:67-71`) and `parish-context.ts:14-23` is the one place
  that translates. It **never resets a field it was not asked to change**: OPS
  §4.5:730 requires `nested` to survive a drop to one level, and
  `validateSelection` (`parish-taxonomy.ts:134`) and `describeSelection`
  (`:163`) both depend on that being true.

**Flagged, not invented:** a duplicate live unit name raises `23505` from
`parish_units_name_unique_in_scope` and **OPS §4.5 lists no failure mode for
it** (§2). Ship: catch `isUniqueViolation` and raise
`ValidationFailed("validation_failed")` — OPS's own sentence for that command,
vague but honest, and not a raw driver error. §8 asks for the specific
sentence.

### 4.6 The avatar — where the bytes go, who deletes them, and who wires the store

Four constraints, all shipped, that together determine the shape:

1. The domain may not import `src/storage/` or `@aws-sdk/*`
   (`tests/architecture/boundaries.test.ts:46-68`).
2. `registration.ts:38-48` already establishes the seam: the domain records
   *which object* is this person's photograph and never moves bytes.
3. B5:249-254 names the tempting wrong move by name — a command storing the
   file inside its own transaction leaves an orphaned object on rollback.
4. `profile_change_requests` has no avatar column and DATABASE.md
   §4.11:1092-1097 argues `jsonb` precisely so a new proposable field needs no
   migration.

**So:**

- **The surface uploads, then calls the command.** A server action reads the
  multipart form, enforces the size and content-type policy, calls
  `objectKey("avatars", ext)` and `store.put(...)`, and passes
  `{ avatarUrl: store.url(key), avatarObject: key }` into
  `ProposeAvatarChange`. `file_too_large` and `invalid_image` are raised at the
  surface with the domain's own codes — B5 §5 already assigned both to this
  slice (`2026-08-08-b5-object-storage.md:205-207`).
- **`proposed_values` carries both** `avatar_url` (copied to `users.avatar_url`
  on approval) and **`avatar_object`** (the key, never copied anywhere). Named
  `avatar_object` and not `avatar_key` because `audit.ts:66-77` forbids `key`
  as a whole token and would throw `audit_forbidden_field` the moment a command
  audited the payload (§2).
- **`RejectProfileChange` and `CancelProfileChange` return the orphaned key;
  the surface deletes it after the transaction commits.** OPS §4.3:488 requires
  the deletion; the domain cannot perform it; and a delete inside the
  transaction would destroy an image a rolled-back request still points at —
  constraint 3, inverted. `store.delete` of a missing key does not throw, so a
  retried action is safe.

  **The residual failure, named rather than hidden:** commit succeeds, the
  delete fails, one object is orphaned. That is strictly better than the
  inverse (a live request pointing at a deleted image), it is retryable, and it
  costs storage rather than correctness.

  **What OPS does not ask for and this slice does not invent:** *approving* a
  change orphans the **previous** image. OPS §4.3:488 requires deletion only on
  reject or cancel, and the previous image's key is not recoverable in general
  — an avatar set at registration arrives as a URL with no key
  (`registration.ts:48`). Recorded, not solved.

- **Who wires the store: this slice.** `src/lib/object-store.ts` gains
  `objectStore()` — a process-lifetime cached `ObjectStore` built from
  `s3ConfigFromEnv()`, cached on `globalThis` behind a symbol so Next's
  hot-reload does not leak one per edit. **That is U1 §3.1's `pool()` treatment
  applied to a second resource, and U1 §6.1:132 says so in as many words.** It
  lives in `src/lib/`, beside `page-data.ts`, for the same reason `loadPage`
  does: the surface imports the domain and the store, never the reverse.

  `compose.yaml:181-190` already passes all seven variables to the `app`
  service (§2 — U1's claim that it does not is stale). Add the compose-side
  assertion the CI side already has, mirroring
  `tests/architecture/ci-supplies-required-env.test.ts`.

  **This is also the slice that makes B5's Docker smoke gate real.** B5
  §4.1:104-113 records that gate as vacuous *"until B1 or B2b wires the store
  into a route"*, because nothing under `src/app/` imports it and Next's
  dependency tracing therefore never pulls `@aws-sdk/client-s3` into
  `.next/standalone`. After Task 7, `docker build --target smoke .` is evidence
  rather than a formality — and if the SDK does not survive Bun's standalone
  build, this is the slice that finds out.

### 4.7 Timestamps come from `ctx.clock`, never from a column default

The constraint recorded from the `feat/sql-clock` review
(`2026-08-07-c1-lending-core.md:1281-1296`) applies to three columns here:
`profile_change_requests.requested_at`, `.decided_at`, and
`parish_units.deleted_at`.

All three have or would have defaults, and all three are timestamps **the
domain means**: a test with a `fixedClock` must be able to make a request look
a week old without waiting a week. `runCommand` sets `olibra.now` from
`ctx.clock` (`unit-of-work.ts:180-181`) so `olibra_now()` agrees, but a
`default now()` does not consult it.

**The corollary a test author must know:** `updated_at` on all four tables is
written by `set_updated_at()` from SQL `now()`
(`20260808_06_updated_at_triggers.sql:18-31`). Under a `fixedClock` it will not
match `requested_at`, and **no test may assert that it does.** That is DATABASE
§6's two-clocks rule, not a bug.

### 4.8 Documentation is written to the standard of `src/domain/kernel/fold.ts`

Because `fold.ts` is 56 lines of which 35 are prose explaining *who notices
when it stops* — it names the two other implementations that must agree with
it, the test that holds each agreement, and the library decision it is
deliberately not making, so a future reader cannot reverse the decision without
first reading the reason. Every non-obvious choice in this slice is of that
kind: `avatar_object` not `avatar_key`, `profile_change_not_pending` not
`request_not_pending`, the surface deleting after commit rather than the
command deleting inside it, `previous_values` not being the queue's "current"
column. Each is a line of code that looks arbitrary and is not, and each has a
tidier-looking wrong version a future reader will otherwise write.

---

## 5. Tasks

Sequential. Task 1 blocks everything; Tasks 4–5 and 8 are independent of each
other.

**1 — The three documents.** BR §6's INV-13 row and BR §2's new paragraph
(§3.3); DATABASE.md §7:1307 and §4.11:1099; OPERATIONS.md §4.3 — the new
`UpdateReaderProfile` entry (§3.4), the word *only* out of `:497`, and the two
`userId` → `membershipId` input corrections (§4.2, closing B2a's known gap 4).
**No code in this task.**

**2 — Error codes.** The four in §4.3, with the collision reasoning as a
comment in the register `errors.ts:41-53`, `:61-84` and `:108-112` already
establish.

**3 — `src/domain/members/profile-fields.ts`.** `PROFILE_FIELDS` as data,
`applyProfileFields` as the one writer of a person's verified details.
Documented to `fold.ts`'s standard: it must say that it is INV-13b's
application half and that a second `update users` anywhere in `src/domain/`
is the defect it exists to make impossible.

**4 — The reader's half:** `ProposeProfileChange` (with §4.4's replace-then-
insert-then-catch), `CancelProfileChange`, `UpdateOwnProfile`, and
`GetMyProfile` / `GetMyProfileChangeRequest`.

**5 — The manager's half:** `ApproveProfileChange` (calling `validateSelection`
against `loadParishContext`, the one path shared with B2a),
`RejectProfileChange`, and `GetPendingProfileChanges` with §3.5's live-current
column.

**6 — `UpdateReaderProfile`**, on top of Task 3. The command §3 exists for.

**7 — The avatar and the store wiring.** `src/lib/object-store.ts`'s
`objectStore()`; `ProposeAvatarChange`; the orphaned-key return on reject and
cancel; the compose-env architecture test; `docker build --target smoke .` run
once by hand, because this is the first time that gate has had anything to
check (§4.6).

**8 — Parish units.** `requireSuperAdmin`, then the five commands (§4.5).

**9 — `tests/invariants/inv-13-one-pending-profile-change.test.ts`.** §3.6, in
full: three existing tests untouched, four additions, one of them the grep.

**10 — Falsification.** Not "the tests pass" — for each of the seven claims in
§6, break the implementation in the specific way named and confirm the specific
test goes red. Tests are falsified, not merely written.

---

## 6. Acceptance

- [ ] BR §6's INV-13 names both write paths; DATABASE.md and OPERATIONS.md
      follow it and nothing in `docs/` still says "only through an approved
      request"
- [ ] `grep -rn "update users" src/domain/` returns exactly the three files
      §3.5 enumerates, and a test in `tests/invariants/` fails if a fourth
      appears
- [ ] Every field in `PROFILE_FIELDS` is writable through **both**
      `ApproveProfileChange` and `UpdateReaderProfile`, asserted per field, not
      per path
- [ ] A manager of shelf B calling any command here with shelf A's
      `membershipId` or `profileChangeRequestId` fails
      `membership_not_found` / `write_target_not_found` — because RLS filtered
      the select to zero rows, not because anyone compared two shelf ids
- [ ] A reader with memberships at two shelves proposing at the second sees
      `change_already_pending`, never a `23505`
- [ ] A pending proposal leaves the existing phone number in force (master
      §7.2's clause, deferred here by B2a `:4120`)
- [ ] A rejected and a cancelled proposal each leave **no** object in storage,
      asserted with a real `fetch` of `url(key)` returning 404 — the shape
      B5's own suite uses (`2026-08-08-b5-object-storage.md:236-238`)
- [ ] `GetPendingProfileChanges` shows a phone number corrected by
      `UpdateReaderProfile` as *current*, with the request's `previous_values`
      unchanged
- [ ] Deleting a level-1 unit soft-deletes its live level-2 children in the
      same transaction, with one audit entry each, and `hasVisibleLevel2` then
      returns `false` for a shelf with nothing left
- [ ] A soft-deleted unit leaves `unitOptions` and keeps describing the members
      already in it (`describeSelection`) — B2a's Task 2 test still green
- [ ] `requested_at`, `decided_at` and `parish_units.deleted_at` all move with
      a `fixedClock`; no test asserts `updated_at` agrees with them
- [ ] `docker build --target smoke .` passes **with** `@aws-sdk/client-s3`
      present in `.next/standalone` — the first non-vacuous run of B5's gate
- [ ] `bun run check` green, and **CI green on the PR** — checked on the badge,
      not locally

---

## 7. Out of scope, deliberately

Each is named because it is a place a reviewer might reasonably expect
something.

- **Every screen.** `toi/ho-so`, `quan-ly/doi-thong-tin`,
  `quan-ly/nguoi-doc/[id]` and `quan-tri/tu-sach` all still import from
  `@/lib/fixtures` and **none of them calls `loadPage`** — verified by grep.
  U1 wired six lending screens and left the other forty-one on fixtures
  (`2026-08-09-u1-page-data-seam.md:15`). When they are wired they follow U1's
  seam unchanged: `loadPage`/`submitCommand`, the `force-dynamic` rule, and
  `tests/architecture/pages-reading-the-database-are-dynamic.test.ts`. The one
  exception is the server action Task 7 needs for the avatar upload, which is
  not a screen and is the first `submitCommand` caller that carries a file.
- **A migration.** Nothing in this slice needs one. Every column, index,
  constraint, policy and grant it relies on is live at `a8f819e`.
- **Notifications.** BR §15 lists no notification for a profile-change
  decision and OPS §4.3:527 records the gap without inventing one. D1 owns
  `src/domain/notifications/write.ts`. Unchanged from B2a's known gap 13.
- **Merging or splitting parish units, and a third level.** Taxonomy design
  §7:220-221 rules both out until asked for.
- **Cleaning up an approved change's previous image.** §4.6.
- **`membershipAllowsNewLoan`'s over-broad sentence.** U1 §7:155 hands "B2's
  membership lifecycle" a real defect: `policy.ts:116-119` returns
  `membership_not_active` for `pending` and `left` alike, and `errors.ts:58`
  pairs that code with "Tài khoản đang tạm khoá" — so a reader whose
  registration was never approved is told their account is temporarily locked.
  It is B2a's `policy.ts`, on C1's lending path, and B2b touches neither.
  **Recorded, not fixed** — whichever slice next opens that file owns the
  split.
- **`reason_required_on_reject`.** Still unreferenced, still B3's (§2).

---

## 8. Where the source documents do not answer, and the product owner must

Four. Each blocks a specific line, and each has an interim stated above so the
slice is not blocked as a whole.

1. **The avatar's size limit and "square".** OPS §4.3:542 attributes both to
   "the profile screen's own copy", and that copy does not exist (§2).
   `file_too_large`'s sentence names 2 MB so the limit can be implemented from
   the sentence; **"square" has no sentence, no code and no source at all.**
   Interim: enforce ≤2 MB and the four extensions `objectKey` already allows
   (`s3.ts:368`); enforce nothing about aspect ratio. U1 §6.1:134 recorded the
   same three missing policies for the return photo.
2. **The Vietnamese for the manager's direct edit.** Two sentences that do not
   exist anywhere: what a manager reads above the edit form, and how the audit
   browser renders `profile.corrected` (BR §14 requires a readable Vietnamese
   sentence per entry). **Deliberately not written here** — every other
   Vietnamese string in this slice is copied from OPERATIONS.md or already
   shipped in `ERROR_MESSAGES`.
3. **A profile-change request that does not exist.** OPS §4.3 names no failure
   mode. Interim: the kernel's `write_target_not_found` (§4.3).
4. **A duplicate parish-unit name.** OPS §4.5:744 names no failure mode for
   the `23505` that `parish_units_name_unique_in_scope` will raise. Interim:
   `validation_failed`, that command's own sentence (§4.5).

**And one product question this plan answers on a reading, flagged so it can be
cheaply reversed.** OPS §4.3:540 calls `ProposeAvatarChange` "the file-carrying
case rather than a separate lifecycle" of `ProposeProfileChange`, and
`:480` says a new proposal **replaces** the pending one. Read literally
together, a reader who proposes a corrected phone number and then a new
photograph silently loses the phone proposal, with no signal on a screen that
shows one pending card. **This plan merges instead:** each command replaces
only the portion it names, re-snapshots `previous_values` for the fields it
touches, and returns any superseded avatar object for deletion. One predicate
and one test to reverse if the product owner reads `:480` strictly.

---

**Next:** the screens — `toi/ho-so`, `quan-ly/doi-thong-tin` and
`quan-tri/tu-sach`, on U1's seam, with the avatar upload as the project's first
file-carrying server action.
