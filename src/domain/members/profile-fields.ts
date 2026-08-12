import { RuleViolated, ValidationFailed } from "../kernel/errors";
import type { Tx } from "../kernel/unit-of-work";
import { assertPhone } from "./policy";
import type { ScopedUserId } from "./scoped-user";

/**
 * INV-13b's application half: the one place in `src/domain/` that writes a
 * person's verified details.
 *
 * ── Why this module exists at all ────────────────────────────────────────
 *
 * BR §6's INV-13 was restated on 2026-08-09, after the product owner decided
 * that a manager corrects a reader's details directly rather than by proposing
 * on their behalf (master plan §5 Q8). That leaves **two** sanctioned write
 * paths where there was one: `ApproveProfileChange` writes the fields named in
 * a request's `proposed_values`, and `UpdateReaderProfile` writes the fields
 * named in a manager's input.
 *
 * Two field lists are two things that can disagree, and the failure is silent:
 * a field added to one path is simply not writable through the other, and
 * nothing anywhere raises. So neither command writes `users` itself. They call
 * `applyProfileFields` below, and the allowlist is `PROFILE_FIELDS` — data, not
 * a chain of `if`s, so the two can be compared by eye and driven by a test.
 * `tests/invariants/inv-13-one-pending-profile-change.test.ts` iterates
 * `PROFILE_FIELDS` and drives *both* paths for every entry: a ninth field added
 * with a one-path implementation fails without anyone having to remember.
 *
 * ── The defect this module exists to make impossible ─────────────────────
 *
 * A third `update users` appearing in `src/domain/`. INV-13b is application
 * discipline precisely because no constraint can express which code path may
 * write a column (DATABASE.md §7, §4.11), so the only thing that can hold it is
 * a test that reads the source. That test is in the INV-13 file too, and it
 * **enumerates** the permitted writers with a reason each rather than counting
 * them — because "exactly one other command writes `users`" was asserted by
 * B2a and was already false when it was written: `commands/change-own-password
 * .ts` writes `password_hash` as well, and B2a shipped both.
 *
 * ── What is deliberately *not* in the list ───────────────────────────────
 *
 * `username` and `password_hash` (`SetReaderCredentials`' pair, INV-14's) are
 * not verified details — BR §2 gives a manager that power explicitly and by a
 * separate argument, and the audit rules for it are different (no before, no
 * after). `is_super_admin` is a grant, not a fact about a person.
 * `display_name` and `locale` are written by nothing in `src/domain/` at all
 * today; adding either here would make it writable by a manager on a reader's
 * behalf, which nothing has asked for.
 */

/**
 * The nine columns of `users` that are a person's *verified details* — the
 * subject of BR §5.3's registration form and of every proposal a reader may
 * make (OPS §4.3), plus the photograph and the one column that explains
 * rather than states a fact: `phone_missing_reason` (PO feedback round 1,
 * Task 7).
 *
 * Spelled as the database spells them, snake_case, because both callers put
 * these names into `profile_change_requests.proposed_values` (a `jsonb` shadow
 * of this table's own shape, DATABASE.md §4.11) and into audit `before`/`after`
 * bags. One spelling end to end means no translation layer that can drift.
 */
export const PROFILE_FIELDS = [
  "saint_name",
  "full_name",
  "date_of_birth",
  "father_name",
  "mother_name",
  "phone",
  "phone_missing_reason",
  "email",
  "avatar_url",
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];

/** All nine, as they stand. `date_of_birth` is an ISO `YYYY-MM-DD` string. */
export type ProfileFields = Record<ProfileField, string | null>;

/** A subset: exactly the fields a caller named, and nothing else. */
export type ProfilePatch = Partial<ProfileFields>;

/**
 * The four that are `not null` on the table (`0003_identity.sql:16-19`,
 * `20260812_01_contacts_profile_and_hours.sql`).
 *
 * Blanking one has to be a named refusal — OPS §4.3's
 * `required_fields_missing` — rather than a `23502` out of the driver, which
 * OPS §2 forbids ("a command never fails with a bare 500 or an unstructured
 * exception"). `phone`, `phone_missing_reason`, `email` and `avatar_url` are
 * all nullable and clearing one is a legitimate edit: a family that never gave
 * a phone number is a real row. `date_of_birth` is nullable too — clearing it
 * is not itself refused, though `assertStorableDate` below still guards any
 * value supplied. `saint_name` joined this list in PO feedback round 1, Task
 * 7: "a parish register with no saint name is not a parish register" — the
 * column became `not null` in the same migration that added
 * `phone_missing_reason`, and this array is what turns that column-level fact
 * into the named refusal OPS §2 asks for, rather than a bare `23502`.
 */
export const REQUIRED_PROFILE_FIELDS: readonly ProfileField[] = [
  "saint_name",
  "full_name",
  "father_name",
  "mother_name",
];

const PROFILE_FIELD_SET: ReadonlySet<string> = new Set(PROFILE_FIELDS);

/** `YYYY-MM-DD`, the only shape a date column may be handed. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Refuses any date string this application must not hand to a `date` column,
 * and it is **both** callers' guard — `normaliseProfilePatch` below and
 * `register()` in `../registration.ts`, which is where a volunteer first types
 * a child's date of birth.
 *
 * ── What actually happens without it, measured through this driver ────────
 *
 * `olibra_test`'s `DateStyle` is the Postgres default `ISO, MDY`, and it is
 * pinned by `compose.yaml` rather than inherited from an image default — but
 * pinning is defence in depth, not the rule, because a web request, a migration
 * console and a background job may each carry a different session setting
 * (DATABASE.md §2.2 makes the same argument about `TimeZone`). The rule is
 * here, in the domain.
 *
 * The three cases, and the second is the reason this is a function rather than
 * one regex:
 *
 *     '02/04/2015'  ->  stores 2015-02-03
 *     '2015-02-30'  ->  stores 2015-03-02
 *     'hôm qua'     ->  RangeError: Invalid Date, out of the driver
 *
 * A volunteer typing 2 April 2015 the way it is written in Vietnamese gets 3
 * February 2015 on the record — the wrong month *and* the wrong day, because
 * `postgres.js` turns the string into a JavaScript `Date` before it is ever
 * sent, so `MDY` reads it as 4 February and the timezone offset then shifts it
 * back one more. And `'2015-02-30'` is ISO-shaped, passes any regex, and rolls
 * silently over into March. Both are a child's date of birth quietly wrong on a
 * record BR §5.3 exists to make trustworthy, with nothing raised anywhere.
 *
 * (This paragraph used to describe these as SQL literals — `22007` for the
 * third case, and `2015-02-04` for the first. Those are what a `psql` session
 * does. They are not what this code path does, and the difference matters to
 * the next person who tries to reproduce them: the driver never sends a string.)
 *
 * `validation_failed` — "Vui lòng kiểm tra lại thông tin." — is OPS §4.3's own
 * sentence for input a command cannot act on, and OPS §2 forbids the
 * alternative of a raw driver error reaching a caller.
 */
export function assertStorableDate(value: string, field: string): void {
  if (!ISO_DATE_RE.test(value)) {
    throw new ValidationFailed("validation_failed", field);
  }
  // The round trip is the check. `Date.UTC` normalises an impossible day into
  // the next month rather than refusing it, exactly as `::date` does, so
  // comparing the three components back out is what tells them apart — and
  // `Date.UTC`, not the local constructor, because a date has no o'clock and a
  // local midnight in `Asia/Ho_Chi_Minh` is the previous day in UTC.
  const [year, month, day] = value.split("-").map(Number);
  const at = new Date(Date.UTC(year, month - 1, day));
  if (
    at.getUTCFullYear() !== year ||
    at.getUTCMonth() !== month - 1 ||
    at.getUTCDate() !== day
  ) {
    throw new ValidationFailed("validation_failed", field);
  }
}

/**
 * Whether a patch *names* a field, which is not the same question as whether
 * the key is present.
 *
 * `undefined` means "not named" and `null` means "clear it" — the same split
 * `updateBook` settled empirically for the catalogue (`input.x !== undefined`,
 * IMPORTANT 3, fix-report 2026-08-08-b1-catalogue). Reading presence with
 * `hasOwnProperty` instead would make `{ phone: undefined }` — the shape a
 * form handler produces for a field the request omitted — clear the reader's
 * phone number, which is the exact silent data loss this module is here to
 * prevent. One definition, used by every function below, so the two halves
 * (validate, then write) cannot disagree about which fields were named.
 */
function named(patch: ProfilePatch, field: ProfileField): boolean {
  return patch[field] !== undefined;
}

/**
 * Keeps only the nine allowed keys out of an untrusted bag, and drops
 * everything else silently.
 *
 * The untrusted bag is real: `proposed_values` is `jsonb` with no check
 * constraint behind it (DATABASE.md §4.11 names that as the price of the
 * design), and the avatar wave will put **`avatar_object`** into it — the
 * storage key of the proposed image, which is never copied onto `users` and
 * must therefore never reach `applyProfileFields`. That field is called
 * `avatar_object` rather than the more obvious `avatar_key` because
 * `kernel/audit.ts`'s `FORBIDDEN` list matches `key` as a whole token, so an
 * `avatar_key` in an audited payload throws `audit_forbidden_field` the moment
 * a command audits `proposed_values`. Naming avoids the landmine; remembering
 * would not have.
 *
 * Dropping rather than throwing, because the caller is a historical row: a
 * request written by an older version of the application, or one carrying a
 * field a later slice removed from the list, must still be approvable. What it
 * must not do is write a column nobody sanctioned.
 */
export function pickProfileFields(raw: unknown): ProfilePatch {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const patch: ProfilePatch = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!PROFILE_FIELD_SET.has(key)) continue;
    if (value === null || value === undefined) {
      patch[key as ProfileField] = null;
    } else if (typeof value === "string") {
      patch[key as ProfileField] = value;
    }
    // Anything else — a number, an object, a boolean — is dropped rather than
    // coerced. `String(42)` would write "42" into `phone` and look deliberate.
  }
  return patch;
}

/**
 * Trims, folds whitespace-only to null, and refuses what the columns refuse —
 * before any write, so a refusal is a sentence rather than a constraint
 * violation.
 *
 * Trimming here rather than in each caller is the same lesson M5 recorded on
 * `updateBook` (fix-report, 2026-08-08-b1-catalogue): a value trimmed for the
 * write and untrimmed for the audit entry is two values, and the audit is the
 * one that lies.
 */
export function normaliseProfilePatch(patch: ProfilePatch): ProfilePatch {
  const out: ProfilePatch = {};
  for (const field of PROFILE_FIELDS) {
    if (!named(patch, field)) continue;
    const raw = patch[field] ?? null;
    const value = raw === null ? null : raw.trim() === "" ? null : raw.trim();

    if (value === null && REQUIRED_PROFILE_FIELDS.includes(field)) {
      throw new ValidationFailed("required_fields_missing", field);
    }
    // The whole of the reasoning — and the three measured outcomes — is on
    // `assertStorableDate` above, shared with `register()`, which is where a
    // volunteer *first* types a child's date of birth and which was not covered
    // by this check at all until review found it.
    if (field === "date_of_birth" && value !== null) {
      assertStorableDate(value, "date_of_birth");
    }
    // QA remediation Task 18. `phone` is nullable on `users`, so `value ===
    // null` here is a real edit — a manager clearing a number nobody actually
    // has — and must not be refused; the check applies only when a caller
    // supplied a nonempty replacement. This is the call `UpdateReaderProfile`
    // and `ProposeProfileChange` both inherit for free, since both go through
    // this one function — the same reasoning `register()`'s own call gives for
    // covering three registration commands from one place.
    if (field === "phone" && value !== null) {
      assertPhone(value, "phone");
    }
    out[field] = value;
  }
  return out;
}

/**
 * Which of the nine actually differ, and what they were and became.
 *
 * OPS §4.3 wants `profile.corrected`'s audit entry to carry "only the fields
 * that actually changed", and BR §14 wants an audit browser that can say what
 * happened. An entry listing all nine, seven of them identical on both sides,
 * says "a manager rewrote this person" when a manager fixed a phone number.
 */
export function diffProfileFields(
  before: ProfileFields,
  after: ProfileFields,
): { changed: ProfileField[]; before: ProfilePatch; after: ProfilePatch } {
  const changed = PROFILE_FIELDS.filter((f) => before[f] !== after[f]);
  const pick = (from: ProfileFields): ProfilePatch =>
    Object.fromEntries(changed.map((f) => [f, from[f]])) as ProfilePatch;
  return { changed: [...changed], before: pick(before), after: pick(after) };
}

/**
 * Writes exactly the fields `patch` names onto one person, and returns what
 * they were and what they became.
 *
 * ── Three things about the statement, each of which has a tidier wrong
 * version somebody will otherwise write ─────────────────────────────────
 *
 * **1. Only the named columns move, and the others are not rewritten with a
 * value this function read earlier.** That is IMPORTANT 3's lesson from
 * `updateBook` (fix-report, 2026-08-08-b1-catalogue), verified there with two
 * connections: reading a row into JavaScript and writing the whole row back
 * silently discards a *different* manager's edit to a field this call never
 * touched, committed in the window between the read and the write. Here the
 * `else` branch of every arm reads `prev`, a CTE over the same row in the same
 * statement — one snapshot, one atomic write, no window.
 *
 * **2. `for update` on that CTE.** Both commands calling this read the person
 * again for their own reasons; the lock makes the whole read-decide-write
 * sequence serialise against a second manager doing the same thing to the same
 * reader, so two concurrent corrections produce two audit entries in a defined
 * order rather than one entry describing a diff that never existed.
 *
 * **3. `before` comes out of the same statement as `after`, via `returning`,
 * not from a separate `select` this function ran first.** An audit entry is a
 * claim about what changed; sourcing its two halves from two statements makes
 * it a claim about two different moments.
 *
 * A zero-row result raises the kernel's `write_target_not_found` by default
 * (`guardWrites`, `kernel/unit-of-work.ts`) and is deliberately not opted out
 * of: both callers have already resolved this `userId` by joining `memberships`
 * to `users` with `deleted_at is null`, so zero rows here means the row was
 * soft-deleted underneath them, and silently succeeding at nothing is the
 * failure mode that guard exists for.
 *
 * **`users` has no row-level security** (`0010_rls.sql:38-41`, by design — it
 * is a global table). So this function's `userId` must have been resolved
 * through a shelf-scoped `memberships` row, and **that obligation is now in the
 * type**: `ScopedUserId` (`./scoped-user.ts`) is a branded string only that
 * module can mint, and it mints one only by performing the join.
 *
 * This paragraph used to end "and it is the one place in this domain where that
 * obligation is not visible in the type". Review showed what that cost. The
 * mechanism holding it was the `update users` grep in
 * `tests/invariants/inv-13-one-pending-profile-change.test.ts`, and the evasion
 * that matters is not a clever one: **a new command calling
 * `applyProfileFields(tx, userIdFromInput, patch)` stays green** — it writes no
 * `update users` of its own, re-uses a sanctioned writer unsanctioned, and
 * skips the shelf-scoped join that is the whole protection against a manager of
 * one parish rewriting a person in another. The grep and the brand catch
 * different things and both are kept.
 */
export async function applyProfileFields(
  tx: Tx,
  userId: ScopedUserId,
  patch: ProfilePatch,
): Promise<{ before: ProfileFields; after: ProfileFields }> {
  const has = (f: ProfileField): boolean => named(patch, f);
  const val = (f: ProfileField): string | null => patch[f] ?? null;
  /**
   * B6's companion column. Not a `ProfileField` — nothing proposes a storage
   * key — so it is read off the patch directly, and only ever written in the
   * same arm as `avatar_url`.
   */
  const avatarObject =
    (patch as { avatar_object?: string | null }).avatar_object ?? null;

  // The nine arms below are the only place `PROFILE_FIELDS` is spelled a
  // second time — the driver takes a tagged template, so a column list cannot
  // be composed from the array without dropping out of the guarded `tx` the
  // kernel hands every command. What holds the two spellings in step is the
  // table-driven test over `PROFILE_FIELDS` in the INV-13 file: a field added
  // to the array and forgotten here is a red test, not a silent no-op.
  const [row] = await tx<
    (Record<`before_${ProfileField}`, string | null> &
      Record<`after_${ProfileField}`, string | null>)[]
  >`
    with prev as (
      select id, saint_name, full_name, date_of_birth::text as date_of_birth,
             father_name, mother_name, phone, phone_missing_reason, email,
             avatar_url, avatar_object
        from users
       where id = ${userId} and deleted_at is null
         for update
    )
    update users u set
      saint_name    = case when ${has("saint_name")}    then ${val("saint_name")}            else prev.saint_name end,
      full_name     = case when ${has("full_name")}     then ${val("full_name")}             else prev.full_name end,
      date_of_birth = case when ${has("date_of_birth")} then ${val("date_of_birth")}::date   else prev.date_of_birth::date end,
      father_name   = case when ${has("father_name")}   then ${val("father_name")}           else prev.father_name end,
      mother_name   = case when ${has("mother_name")}   then ${val("mother_name")}           else prev.mother_name end,
      phone         = case when ${has("phone")}         then ${val("phone")}                 else prev.phone end,
      -- PO feedback round 1, Task 7: a phone that arrives clears the reason
      -- it was missing — the reason describes an absence, and a present
      -- number makes it stale rather than true. A caller may still name
      -- phone_missing_reason on its own (recording or updating why, with no
      -- phone supplied this time), which the second arm covers. (No
      -- backticks in this comment: it is inside a tagged template and one
      -- would end the literal.)
      phone_missing_reason = case
        when ${has("phone")} and ${val("phone")}::text is not null then null
        when ${has("phone_missing_reason")} then ${val("phone_missing_reason")}
        else prev.phone_missing_reason end,
      email         = case when ${has("email")}         then ${val("email")}                 else prev.email end,
      avatar_url    = case when ${has("avatar_url")}    then ${val("avatar_url")}            else prev.avatar_url end,
      -- B6. The storage key travels with the URL and is NOT a ProfileField:
      -- nothing proposes a key, and giving it an entry in PROFILE_FIELDS would
      -- demand a Vietnamese label for a storage identifier no reader ever sees
      -- -- which profile-labels.ts refused to compile, correctly. So it moves
      -- exactly when avatar_url moves, from the same patch, and a row can never
      -- hold a URL and a key naming different objects. (No backticks in a SQL
      -- comment here: this is inside a tagged template and one would end the
      -- literal.)
      avatar_object = case when ${has("avatar_url")}    then ${avatarObject}                     else prev.avatar_object end
      from prev
     where u.id = prev.id
    returning
      prev.saint_name    as before_saint_name,    u.saint_name    as after_saint_name,
      prev.full_name     as before_full_name,     u.full_name     as after_full_name,
      prev.date_of_birth as before_date_of_birth, u.date_of_birth::text as after_date_of_birth,
      prev.father_name   as before_father_name,   u.father_name   as after_father_name,
      prev.mother_name   as before_mother_name,   u.mother_name   as after_mother_name,
      prev.phone         as before_phone,         u.phone         as after_phone,
      prev.phone_missing_reason as before_phone_missing_reason,
      u.phone_missing_reason    as after_phone_missing_reason,
      prev.email         as before_email,         u.email         as after_email,
      prev.avatar_url    as before_avatar_url,    u.avatar_url    as after_avatar_url,
      prev.avatar_object as before_avatar_object, u.avatar_object as after_avatar_object
  `;

  const side = (prefix: "before" | "after"): ProfileFields =>
    Object.fromEntries(
      PROFILE_FIELDS.map((f) => [
        f,
        row[`${prefix}_${f}` as keyof typeof row] ?? null,
      ]),
    ) as ProfileFields;

  return { before: side("before"), after: side("after") };
}

/**
 * Refuses a write — or, since fix round 1, a *proposal* — that would leave
 * the subject with neither a phone number nor a stated reason for lacking
 * one. PO feedback round 1, Task 8, and its own fix round 1.
 *
 * **Checked against the resulting record, never the patch alone.** That is
 * what makes "a reason already on file counts" true: a caller that touches
 * an unrelated field and leaves both `phone` and `phone_missing_reason`
 * exactly as they were inherits whatever the record already carries, and
 * only a record that is *genuinely* silent on both — no number, no reason,
 * on the row as it now stands — is refused. `applyProfileFields` itself
 * stays unconditional (its own test drives `{ phone: null }` with no reason
 * and expects it to succeed) precisely so this rule can live one level up.
 *
 * The parameter is `Pick<ProfileFields, "phone" | "phone_missing_reason">`
 * rather than the full nine-key `ProfileFields`, because it now has three
 * callers with three different shapes of "the resulting record" in hand:
 *
 * - `./commands/update-reader-profile.ts` and
 *   `./commands/approve-profile-change.ts` pass `after`, the authoritative
 *   post-write row `applyProfileFields` returns — a `ProfileFields`, which
 *   satisfies this narrower type structurally.
 * - `./commands/propose-profile-change.ts` passes a two-key object built
 *   from the merged proposal overlaid on the person as they stand now — see
 *   that command for why the check belongs there and not only at approval:
 *   a reader may leave the phone blank with no reason on a screen with no
 *   phone box at all (`ApproveProfileChange`'s), and a refusal nobody on
 *   that screen can answer is not a refusal, it is a dead end.
 * - `register()` (`../registration.ts`) raises the identical code directly,
 *   for the two registration write paths, where there is no existing record
 *   to overlay at all.
 *
 * `ApproveProfileChange`'s own call stays in place as the backstop it always
 * was — a request written before this fix, or by a caller that bypasses
 * `ProposeProfileChange` entirely (`profile_change_requests` is `jsonb` with
 * no check constraint, DATABASE.md §4.11's own price for the design), still
 * cannot be approved into a phone-less, reason-less record.
 */
export function assertPhoneOrReason(
  result: Pick<ProfileFields, "phone" | "phone_missing_reason">,
): void {
  const reason = result.phone_missing_reason;
  if (result.phone === null && (reason === null || reason.trim() === "")) {
    throw new RuleViolated("thieu-so-dien-thoai");
  }
}

/**
 * Takes the profile-change lifecycle's **one lock, in its one order**: the
 * subject's `users` row, before that person's `profile_change_requests` row is
 * read or written.
 *
 * ── The two defects this exists to close, which are the same defect ──────
 *
 * **A lost update.** `readPendingProposal` used to read the pending row with a
 * plain `select`. Two proposals landing together — a parent uploading a
 * photograph in one tab and correcting a phone number in another — each merged
 * from the same stale read, and the later `UPDATE` overwrote `proposed_values`
 * wholesale. Both commands reported success. Reproduced three times against the
 * real commands: twice the phone proposal vanished, and once the **photograph**
 * did, leaving `avatars/….png` in a public bucket referenced by nothing and
 * deletable by no code path — which is a retention failure, not a storage one
 * (`src/storage/s3.ts` on why name-plus-face is the most identifying pair here).
 * That is precisely the failure `carryAvatar` was written to prevent; it
 * prevented it sequentially and not concurrently.
 *
 * **A deadlock that escaped as a raw `PostgresError`.** `ApproveProfileChange`
 * held `for update` on the reader's `users` row (via `applyProfileFields`) and
 * then updated `profile_change_requests`; `CancelProfileChange` held the request
 * row and then needed `FOR KEY SHARE` on the same `users` row, for its audit
 * row's `actor_id` foreign key. Opposite orders, so a manager clicking *Duyệt*
 * as the reader clicked *Huỷ* deadlocked — confirmed 3/3 in both directions —
 * and `40P01` is not a `DomainError`, so the loser got a 500. OPS §2 forbids
 * exactly that shape.
 *
 * The two are one problem: the lifecycle touches two tables and had no agreed
 * order between them. This function is the order. **Every command that reads or
 * writes a `profile_change_requests` row calls it first**, with the subject's
 * user id, and there is no second sequence to keep in step. Retrying a deadlock
 * was rejected deliberately: a deadlock that is retried is still a design that
 * deadlocks, and the retry would hide the next one.
 *
 * ── Why `for no key update` and not `for update` ─────────────────────────
 *
 * It conflicts with `for update` and with itself, which is the whole of what
 * the ordering needs — two commands in this lifecycle touching one person
 * serialise, and one of them waits rather than both failing. It does **not**
 * conflict with the `FOR KEY SHARE` an unrelated insert takes on the same row
 * (a loan naming this borrower, an audit row naming this actor), so proposing a
 * photograph does not briefly block lending that reader a book. `for update`
 * would have been simpler to explain and strictly more blocking for no gain
 * here, because nothing in this lifecycle changes a key of `users`.
 *
 * Deliberately **not** `.allowZero()`-shaped: this is a `select`, so the
 * kernel's zero-row guard does not apply to it at all, and a person who is not
 * there is a case every caller already answers with `membership_not_found` or
 * `write_target_not_found` before or after reaching here.
 */
export async function lockPerson(tx: Tx, userId: ScopedUserId): Promise<void> {
  await tx`
    select id from users
     where id = ${userId} and deleted_at is null
       for no key update
  `;
}

/**
 * The nine fields as they stand, without writing anything.
 *
 * `ProposeProfileChange` needs them for `previous_values` — BR §5.4's snapshot,
 * "so a manager reviewing a week-old request sees what it would actually
 * change" — and it must not reach `users` by hand to get them, or the field
 * list has drifted again in a third place.
 */
export async function readProfileFields(
  tx: Tx,
  userId: ScopedUserId,
): Promise<ProfileFields | null> {
  const [row] = await tx<ProfileFields[]>`
    select saint_name, full_name, date_of_birth::text as date_of_birth,
           father_name, mother_name, phone, phone_missing_reason, email,
           avatar_url
      from users
     where id = ${userId} and deleted_at is null
  `;
  return row ?? null;
}
