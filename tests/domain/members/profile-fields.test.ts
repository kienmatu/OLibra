import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../../src/db/migrate";
import type { AuditEntry } from "../../../src/domain/kernel/audit";
import { assertNoSecrets } from "../../../src/domain/kernel/audit";
import { fixedClock } from "../../../src/domain/kernel/clock";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runCommand } from "../../../src/domain/kernel/unit-of-work";
import {
  applyProfileFields,
  diffProfileFields,
  normaliseProfilePatch,
  pickProfileFields,
  PROFILE_FIELDS,
  readProfileFields,
  type ProfileFields,
  type ProfilePatch,
} from "../../../src/domain/members/profile-fields";
import { closeAll, resetDatabase, sql } from "../../support/db";
import { makeShelf, makeUser } from "../../support/factories";
import type { ScopedUserId } from "../../../src/domain/members/scoped-user";

/**
 * A raw `users.id`, branded, for the two functions in this file that are driven
 * *below* the commands which normally mint one.
 *
 * `applyProfileFields` and `readProfileFields` take a `ScopedUserId`
 * (`src/domain/members/scoped-user.ts`), a string only that module can produce
 * and only by joining a shelf-scoped `memberships` row — which is what stops a
 * future command reaching any person in the system through a sanctioned writer.
 * These tests call the writer itself, so the guarantee is being *assumed* here
 * rather than earned, and the double cast is deliberately the ugliest available
 * spelling: it is exactly the shape a bypass in `src/` would have to take, and
 * `tests/invariants/inv-13-one-pending-profile-change.test.ts` fails if one
 * appears there.
 */
const asScoped = (id: string) => id as unknown as ScopedUserId;

/**
 * `src/domain/members/profile-fields.ts` — INV-13b's application half — on its
 * own, before either of the two commands that call it.
 *
 * The command tests exercise it too, but through a manager's eyes; these are
 * the properties the module owes both callers regardless of which one is
 * asking, and the ones a wrong implementation would still let a command test
 * pass on (a whole-row rewrite looks identical from one caller).
 */

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-09T02:00:00Z");

/** `applyProfileFields` needs a guarded `tx`; only `runCommand` hands one out. */
async function apply(bookshelfId: string, userId: string, patch: ProfilePatch) {
  const ctx: TenantContext = {
    bookshelfId,
    actor: { userId, membershipId: null, role: "manager" },
    clock,
  };
  return runCommand(
    sql,
    ctx,
    async (tx) => ({
      result: await applyProfileFields(tx, asScoped(userId), patch),
      audit: { action: "profile.corrected", entityType: "user", entityId: userId },
    }),
    undefined,
  );
}

// — the allowlist is data, and the allowlist is the whole of it —

test("PROFILE_FIELDS names exactly the eight verified details, and no credential", () => {
  // The list is the security boundary, not a convenience. `username` and
  // `password_hash` are BR §2's separate power with separate audit rules;
  // `is_super_admin` is a grant. A field added to this array becomes writable
  // by a manager on a reader's behalf, which is why the array is asserted
  // rather than merely used.
  expect([...PROFILE_FIELDS]).toEqual([
    "saint_name",
    "full_name",
    "date_of_birth",
    "father_name",
    "mother_name",
    "phone",
    "email",
    "avatar_url",
  ]);
  for (const forbidden of ["username", "password_hash", "is_super_admin"]) {
    expect(PROFILE_FIELDS as readonly string[]).not.toContain(forbidden);
  }
});

test("pickProfileFields drops every key that is not one of the eight", () => {
  // `proposed_values` is jsonb with no check constraint behind it
  // (DATABASE.md §4.11), so this is the boundary between an arbitrary stored
  // object and an `update users`.
  expect(
    pickProfileFields({
      phone: "0912345678",
      username: "kelely",
      password_hash: "$argon2id$stolen",
      is_super_admin: true,
      avatar_object: "avatars/abc.jpg",
      nonsense: { deep: 1 },
    }),
  ).toEqual({ phone: "0912345678" });

  expect(pickProfileFields(null)).toEqual({});
  expect(pickProfileFields(["full_name"])).toEqual({});
  // A number is dropped rather than coerced: String(42) in `phone` would look
  // deliberate to every screen that read it back.
  expect(pickProfileFields({ phone: 42 })).toEqual({});
});

test("`avatar_object` is auditable and `avatar_key` is not — the naming landmine", () => {
  // Not a style preference. `kernel/audit.ts`'s FORBIDDEN list matches `key`
  // as a whole token, so the moment a command audits `proposed_values` an
  // `avatar_key` in it throws `audit_forbidden_field` and the command fails
  // for a reason that has nothing to do with what it was doing. The avatar
  // wave is a later slice; the name is fixed here so that slice inherits it
  // rather than rediscovering it in a red test.
  const entry = (payload: Record<string, unknown>): AuditEntry => ({
    action: "profile_change.proposed",
    entityType: "profile_change_request",
    entityId: "irrelevant",
    after: payload,
  });
  expect(() =>
    assertNoSecrets(entry({ avatar_object: "avatars/abc.jpg" })),
  ).not.toThrow();
  expect(() => assertNoSecrets(entry({ avatar_key: "avatars/abc.jpg" }))).toThrow(
    /audit_forbidden_field|nhật ký/,
  );
});

// — named, absent, and cleared are three different things —

test("`undefined` means untouched and `null` means cleared", () => {
  // The distinction updateBook settled empirically for the catalogue. A form
  // handler produces `{ phone: undefined }` for a field the request omitted;
  // reading that as "clear it" is silent data loss.
  expect(normaliseProfilePatch({ phone: undefined })).toEqual({});
  expect(normaliseProfilePatch({ phone: null })).toEqual({ phone: null });
  // Whitespace is absence, the same rule `policy.ts`'s `blank` states.
  expect(normaliseProfilePatch({ phone: "   " })).toEqual({ phone: null });
  expect(normaliseProfilePatch({ phone: "  0912345678 " })).toEqual({
    phone: "0912345678",
  });
});

test("the three not-null columns refuse to be blanked, by name", () => {
  for (const field of ["full_name", "father_name", "mother_name"] as const) {
    expect(() => normaliseProfilePatch({ [field]: "  " })).toThrow(/điền đầy đủ/);
    expect(() => normaliseProfilePatch({ [field]: null })).toThrow(/điền đầy đủ/);
  }
  // And the five nullable ones really are clearable, so the loop above is
  // asserting a distinction rather than a blanket refusal.
  for (const field of [
    "saint_name",
    "date_of_birth",
    "phone",
    "email",
    "avatar_url",
  ] as const) {
    expect(normaliseProfilePatch({ [field]: null })).toEqual({ [field]: null });
  }
  // And the code, not merely the sentence — a screen branches on the code.
  try {
    normaliseProfilePatch({ full_name: "" });
    throw new Error("expected a refusal");
  } catch (e) {
    expect(e).toMatchObject({
      code: "required_fields_missing",
      field: "full_name",
    });
  }
});

test("a date that is not YYYY-MM-DD is refused before it reaches ::date", () => {
  // Two failures, and the ordering of these two assertions is the point.
  //
  // "02/04/2015" does **not** raise anything: `olibra_test`'s DateStyle is the
  // Postgres default `ISO, MDY`, and `select '02/04/2015'::date` returns
  // 2015-02-04 silently — so a volunteer typing 2 April 2015 the way it is
  // written in Vietnamese would store 4 February 2015, with nothing to notice.
  // That is the case this guard is really for; "hôm qua" merely raises 22007,
  // which is loud.
  expect(() => normaliseProfilePatch({ date_of_birth: "02/04/2015" })).toThrow();
  try {
    normaliseProfilePatch({ date_of_birth: "hôm qua" });
    throw new Error("expected a refusal");
  } catch (e) {
    expect(e).toMatchObject({ code: "validation_failed", field: "date_of_birth" });
  }
  expect(normaliseProfilePatch({ date_of_birth: "2015-04-02" })).toEqual({
    date_of_birth: "2015-04-02",
  });
  expect(normaliseProfilePatch({ date_of_birth: null })).toEqual({
    date_of_birth: null,
  });
});

// — the write —

test("only the named columns move; every other one keeps its value", async () => {
  const shelf = await makeShelf(sql);
  const user = await makeUser(sql);
  await sql`
    update users set saint_name = 'Giuse', email = 'cu@vd.vn',
                     date_of_birth = '2015-04-02'
    where id = ${user.id}
  `;

  const { before, after } = await apply(shelf.id, user.id, {
    phone: "0912345678",
  });

  expect(before.phone).toBe("0900000000");
  expect(after.phone).toBe("0912345678");
  // Everything else, on both sides, unchanged and equal.
  for (const f of PROFILE_FIELDS) {
    if (f === "phone") continue;
    expect(after[f]).toBe(before[f]);
  }
  expect(after.saint_name).toBe("Giuse");
  expect(after.email).toBe("cu@vd.vn");
  expect(after.date_of_birth).toBe("2015-04-02");
});

test("every field in PROFILE_FIELDS is actually writable through the one writer", async () => {
  // Table-driven over the array rather than a hand-written list, so a ninth
  // entry added to PROFILE_FIELDS and forgotten in the statement's eight arms
  // fails here. That is the whole reason the allowlist is data.
  const shelf = await makeShelf(sql);
  const values: ProfileFields = {
    saint_name: "Maria",
    full_name: "Nguyễn Thị Mai",
    date_of_birth: "2014-01-31",
    father_name: "Giuse Nguyễn Văn C",
    mother_name: "Anna Lê Thị D",
    phone: "0987654321",
    email: "mai@vd.vn",
    avatar_url: "https://vd.vn/anh.jpg",
  };

  for (const field of PROFILE_FIELDS) {
    const user = await makeUser(sql);
    const { after } = await apply(shelf.id, user.id, { [field]: values[field] });
    expect(after[field], `${field} was not written`).toBe(values[field]);
  }
});

test("a nullable field can be cleared, and the clearing is visible in the diff", async () => {
  const shelf = await makeShelf(sql);
  const user = await makeUser(sql);
  const { before, after } = await apply(shelf.id, user.id, { phone: null });
  expect(before.phone).toBe("0900000000");
  expect(after.phone).toBeNull();
  expect(diffProfileFields(before, after)).toEqual({
    changed: ["phone"],
    before: { phone: "0900000000" },
    after: { phone: null },
  });
});

test("diffProfileFields reports nothing when nothing differs", async () => {
  const shelf = await makeShelf(sql);
  const user = await makeUser(sql);
  const { before, after } = await apply(shelf.id, user.id, {
    phone: "0900000000",
  });
  expect(diffProfileFields(before, after).changed).toEqual([]);
});

test("readProfileFields returns the same eight, and null for a soft-deleted person", async () => {
  const shelf = await makeShelf(sql);
  const user = await makeUser(sql);
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: user.id, membershipId: null, role: "manager" },
    clock,
  };
  const read = await runCommand(
    sql,
    ctx,
    async (tx) => ({
      result: await readProfileFields(tx, asScoped(user.id)),
      audit: { action: "profile.corrected", entityType: "user", entityId: user.id },
    }),
    undefined,
  );
  expect(Object.keys(read!).sort()).toEqual([...PROFILE_FIELDS].sort());

  await sql`update users set deleted_at = now() where id = ${user.id}`;
  const gone = await runCommand(
    sql,
    ctx,
    async (tx) => ({
      result: await readProfileFields(tx, asScoped(user.id)),
      audit: { action: "profile.corrected", entityType: "user", entityId: user.id },
    }),
    undefined,
  );
  expect(gone).toBeNull();
});

test("writing to a soft-deleted person is refused by the kernel's zero-row guard", async () => {
  // Deliberately not opted out of with `.allowZero()`: both commands have
  // already resolved this user through `memberships join users … deleted_at is
  // null`, so zero rows here means the row went away underneath them, and
  // silently succeeding at nothing is what that guard exists to prevent.
  const shelf = await makeShelf(sql);
  const user = await makeUser(sql);
  await sql`update users set deleted_at = now() where id = ${user.id}`;
  await expect(
    apply(shelf.id, user.id, { phone: "0912345678" }),
  ).rejects.toMatchObject({ code: "write_target_not_found" });
});
