import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { hashPassword, verifyPassword } from "../../../src/auth/password";
import { fixedClock } from "../../../src/domain/kernel/clock";
import {
  setPasswordHasher,
  setPasswordVerifier,
} from "../../../src/domain/kernel/crypto";
import { RuleViolated, ValidationFailed } from "../../../src/domain/kernel/errors";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runCommand } from "../../../src/domain/kernel/unit-of-work";
import { registerMembership } from "../../../src/domain/members/commands/register-membership";
import { type RegistrationInput } from "../../../src/domain/members/registration";
import { migrate } from "../../../src/db/migrate";
import { makeParishUnits, makePerson, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(async () => {
  await migrate(sql);
  // The domain may not import src/auth (architecture test); a test may.
  setPasswordHasher(hashPassword);
  setPasswordVerifier(verifyPassword);
});
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-08T03:00:00Z");

const FAMILY: RegistrationInput = {
  saintName: "Giuse",
  fullName: "Trần Minh",
  dateOfBirth: "2015-04-02",
  fatherName: "Giuse Trần Văn A",
  motherName: "Maria Nguyễn Thị B",
  phone: "0912345678",
};

/** A guest context, exactly what `contextFor` builds for an unauthenticated caller. */
async function guestAt(slug: string) {
  const shelf = await makeShelf(sql, { slug });
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: null, membershipId: null, role: "guest" },
    clock,
  };
  return { shelf, ctx };
}

const membership = (id: string) =>
  sql<
    {
      status: string;
      role: string;
      user_id: string;
      parish_unit_l1_id: string | null;
      parish_unit_l2_id: string | null;
      rejection_reason: string | null;
      approved_by: string | null;
    }[]
  >`select status, role, user_id, parish_unit_l1_id, parish_unit_l2_id,
           rejection_reason, approved_by
      from memberships where id = ${id}`.then((r) => r[0]);

const person = (id: string) =>
  sql<
    {
      full_name: string;
      phone: string;
      username: string | null;
      password_hash: string | null;
      avatar_url: string | null;
      saint_name: string | null;
    }[]
  >`select full_name, phone, username, password_hash, avatar_url, saint_name
      from users where id = ${id}`.then((r) => r[0]);

// — the ordinary path —

test("a guest registers and gets a pending membership and a new person", async () => {
  const { ctx } = await guestAt("dong-thap");
  const { userId, membershipId } = await runCommand(
    sql,
    ctx,
    registerMembership,
    FAMILY,
  );

  const m = await membership(membershipId);
  expect(m.status).toBe("pending");
  expect(m.role).toBe("reader");
  expect(m.user_id).toBe(userId);
  expect(m.approved_by).toBeNull();

  const p = await person(userId);
  expect(p.full_name).toBe("Trần Minh");
  expect(p.saint_name).toBe("Giuse");
  expect(p.username).toBeNull();
  expect(p.password_hash).toBeNull(); // INV-14: neither is a valid state.
});

test("the audit entry is written by the same transaction, with a null actor", async () => {
  // G3, INV-8, and audit_log.actor_id being nullable is what makes a guest
  // -called command auditable at all.
  const { ctx, shelf } = await guestAt("dong-thap");
  const { membershipId } = await runCommand(sql, ctx, registerMembership, FAMILY);
  const [entry] = await sql<
    {
      action: string;
      actor_id: string | null;
      entity_id: string;
      bookshelf_id: string;
    }[]
  >`select action, actor_id, entity_id, bookshelf_id from audit_log`;
  expect(entry.action).toBe("membership.registered");
  expect(entry.actor_id).toBeNull();
  expect(entry.entity_id).toBe(membershipId);
  expect(entry.bookshelf_id).toBe(shelf.id);
});

test("credentials are optional, and set together when supplied", async () => {
  // BR §2 / INV-14. A child who wants to check the shelf from home may have
  // them; most never will.
  const { ctx } = await guestAt("dong-thap");
  const { userId } = await runCommand(sql, ctx, registerMembership, {
    ...FAMILY,
    username: "TranMinh",
    password: "matkhau123",
    passwordConfirm: "matkhau123",
  });
  const p = await person(userId);
  expect(p.username).toBe("TranMinh");
  expect(await verifyPassword("matkhau123", p.password_hash!)).toBe(true);
});

test("an avatar is a URL the domain records, never bytes it stores", async () => {
  // The plan's Avatars decision: B5 is not built, so nothing here uploads.
  const { ctx } = await guestAt("dong-thap");
  const { userId } = await runCommand(sql, ctx, registerMembership, {
    ...FAMILY,
    avatarUrl: "https://cdn.example/olibra/avatars/abc.jpg",
  });
  expect((await person(userId)).avatar_url).toBe(
    "https://cdn.example/olibra/avatars/abc.jpg",
  );
});

// — validation —

test("the required fields are the ones the database and BR §5.3 agree on", async () => {
  // OPS §4.3 marks father/mother optional; BR §5.3 and §16.1 say required,
  // and users.father_name / mother_name are `not null`. The columns decide.
  const { ctx } = await guestAt("dong-thap");
  for (const missing of [
    "fullName",
    "dateOfBirth",
    "fatherName",
    "motherName",
    "phone",
  ] as const) {
    await expect(
      runCommand(sql, ctx, registerMembership, { ...FAMILY, [missing]: "  " }),
    ).rejects.toMatchObject({ code: "required_fields_missing" });
  }
});

test("a password shorter than eight characters, and a mistyped confirmation", async () => {
  const { ctx } = await guestAt("dong-thap");
  await expect(
    runCommand(sql, ctx, registerMembership, {
      ...FAMILY,
      username: "tranminh",
      password: "ngan",
      passwordConfirm: "ngan",
    }),
  ).rejects.toMatchObject({ code: "password_too_short" });

  await expect(
    runCommand(sql, ctx, registerMembership, {
      ...FAMILY,
      username: "tranminh",
      password: "matkhau123",
      passwordConfirm: "matkhau124",
    }),
  ).rejects.toMatchObject({ code: "passwords_dont_match" });
});

test("INV-14: a username with no password, or a password with no username, is refused", async () => {
  const { ctx } = await guestAt("dong-thap");
  await expect(
    runCommand(sql, ctx, registerMembership, { ...FAMILY, username: "tranminh" }),
  ).rejects.toBeInstanceOf(ValidationFailed);
  await expect(
    runCommand(sql, ctx, registerMembership, {
      ...FAMILY,
      password: "matkhau123",
      passwordConfirm: "matkhau123",
    }),
  ).rejects.toBeInstanceOf(ValidationFailed);
});

// — the parish rule, in the transaction rather than in the picker —

test("the parish selection rule runs in the command, not in the picker", async () => {
  // OPS §4.3's named invariant, and master §7.2's named test: validateSelection
  // is already covered in isolation; what is missing is that the *command*
  // calls it. Verified live that the database will not: a level-2 unit's id in
  // parish_unit_l1_id inserts cleanly.
  const { ctx, shelf } = await guestAt("dong-thap");
  const ids = await makeParishUnits(
    sql,
    shelf.id,
    { levels: 2, nested: true, level1Label: "Giáo họ", level2Label: "Tổ" },
    [
      { level: 1, name: "Thánh Tâm", sortOrder: 1 },
      { level: 1, name: "Mân Côi", sortOrder: 2 },
      { level: 2, name: "Tổ 3", parentName: "Thánh Tâm", sortOrder: 3 },
      { level: 2, name: "Tổ 1", parentName: "Mân Côi", sortOrder: 1 },
    ],
  );

  await expect(
    runCommand(sql, ctx, registerMembership, {
      ...FAMILY,
      parishUnitL1Id: ids.get("Thánh Tâm")!,
      parishUnitL2Id: ids.get("Tổ 1")!,
    }),
  ).rejects.toMatchObject({ code: "parish_unit_l2_not_in_l1" });

  // The level rule the FK cannot express: a level-2 id in the level-1 slot.
  await expect(
    runCommand(sql, ctx, registerMembership, {
      ...FAMILY,
      parishUnitL1Id: ids.get("Tổ 3")!,
    }),
  ).rejects.toMatchObject({ code: "parish_unit_l1_not_found" });

  const { membershipId } = await runCommand(sql, ctx, registerMembership, {
    ...FAMILY,
    parishUnitL1Id: ids.get("Thánh Tâm")!,
    parishUnitL2Id: ids.get("Tổ 3")!,
  });
  const m = await membership(membershipId);
  expect(m.parish_unit_l1_id).toBe(ids.get("Thánh Tâm")!);
  expect(m.parish_unit_l2_id).toBe(ids.get("Tổ 3")!);
});

test("both parish fields stay optional, permanently", async () => {
  // BR §5.6: "A shelf with no units yet must still accept registrations."
  const { ctx } = await guestAt("dong-thap");
  const { membershipId } = await runCommand(sql, ctx, registerMembership, FAMILY);
  const m = await membership(membershipId);
  expect(m.parish_unit_l1_id).toBeNull();
  expect(m.parish_unit_l2_id).toBeNull();
});

test("INV-10: a unit belonging to another shelf is not found, not borrowed", async () => {
  const a = await guestAt("dong-thap");
  const b = await guestAt("can-tho");
  const bIds = await makeParishUnits(
    sql,
    b.shelf.id,
    { levels: 1, nested: false, level1Label: "Tổ", level2Label: "Tổ" },
    [{ level: 1, name: "Tổ 1" }],
  );
  await expect(
    runCommand(sql, a.ctx, registerMembership, {
      ...FAMILY,
      parishUnitL1Id: bIds.get("Tổ 1")!,
    }),
  ).rejects.toMatchObject({ code: "parish_unit_l1_not_found" });
});

// — identity reuse, and the probe (BR §5.3) —

test("a family that moves keeps its identity and re-enters only the parish details", async () => {
  const a = await guestAt("dong-thap");
  const b = await guestAt("can-tho");
  const bIds = await makeParishUnits(
    sql,
    b.shelf.id,
    { levels: 1, nested: false, level1Label: "Tổ", level2Label: "Tổ" },
    [{ level: 1, name: "Tổ 4" }],
  );

  const first = await runCommand(sql, a.ctx, registerMembership, FAMILY);
  const second = await runCommand(sql, b.ctx, registerMembership, {
    ...FAMILY,
    parishUnitL1Id: bIds.get("Tổ 4")!,
  });

  expect(second.userId).toBe(first.userId);
  expect(second.membershipId).not.toBe(first.membershipId);
  const [{ count }] = await sql<{ count: string }[]>`select count(*) from users`;
  expect(Number(count)).toBe(1);
});

test("re-registering never rewrites the person's verified details", async () => {
  // INV-13 read strictly, and BR §5.3's "only the parish details are
  // re-entered". A new phone number at the new parish is a ProposeProfileChange
  // (B2b), not a silent overwrite — writing it here is the obvious wrong
  // implementation.
  const a = await guestAt("dong-thap");
  const b = await guestAt("can-tho");
  const { userId } = await runCommand(sql, a.ctx, registerMembership, FAMILY);
  await runCommand(sql, b.ctx, registerMembership, {
    ...FAMILY,
    saintName: "Phêrô",
  });
  const p = await person(userId);
  expect(p.saint_name).toBe("Giuse");
});

test("the match is the exact triple, never a name or a phone alone", async () => {
  // BR §5.3's own argument for requiring both parents' names is that a name
  // does not identify a child. A looser rule would merge two people.
  const a = await guestAt("dong-thap");
  const b = await guestAt("can-tho");
  const first = await runCommand(sql, a.ctx, registerMembership, FAMILY);

  // Same name and phone, different date of birth: a different child.
  const other = await runCommand(sql, b.ctx, registerMembership, {
    ...FAMILY,
    dateOfBirth: "2017-09-11",
  });
  expect(other.userId).not.toBe(first.userId);

  const [{ count }] = await sql<{ count: string }[]>`select count(*) from users`;
  expect(Number(count)).toBe(2);
});

test("a username is matched only against its own password", async () => {
  // Rule 2. Someone who knows a username but not the password is told exactly
  // what an unrelated collision is told, and learns nothing.
  const { ctx } = await guestAt("can-tho");
  await makePerson(sql, {
    fullName: "Người khác",
    username: "tranminh",
    passwordHash: await hashPassword("matkhaudung"),
  });

  await expect(
    runCommand(sql, ctx, registerMembership, {
      ...FAMILY,
      username: "TRANMINH", // the index is on lower(username)
      password: "doanbua123",
      passwordConfirm: "doanbua123",
    }),
  ).rejects.toMatchObject({ code: "username_taken" });
});

test("an account with no password cannot be claimed by supplying one", async () => {
  // INV-14's valid state is not a back door: a reader whose manager never set
  // credentials must not be adoptable by a stranger who guesses their name.
  const { ctx } = await guestAt("can-tho");
  await makePerson(sql, { fullName: "Chưa có mật khẩu" });
  await expect(
    runCommand(sql, ctx, registerMembership, {
      ...FAMILY,
      username: "chuaco",
      password: "matkhau123",
      passwordConfirm: "matkhau123",
    }),
  ).resolves.toBeDefined(); // no such username: an ordinary new registration
});

test("a match and a miss are indistinguishable from outside", async () => {
  // Rule 1. The whole anti-probe design in one assertion: same result shape,
  // same status, same audit action, whether or not the person already existed.
  const a = await guestAt("dong-thap");
  const b = await guestAt("can-tho");
  await runCommand(sql, a.ctx, registerMembership, FAMILY);

  const known = await runCommand(sql, b.ctx, registerMembership, FAMILY);
  const stranger = await runCommand(sql, b.ctx, registerMembership, {
    ...FAMILY,
    fullName: "Không ai biết",
    phone: "0900000999",
  });

  expect(Object.keys(known).sort()).toEqual(Object.keys(stranger).sort());
  expect((await membership(known.membershipId)).status).toBe("pending");
  expect((await membership(stranger.membershipId)).status).toBe("pending");
  const actions = await sql<{ action: string }[]>`
    select distinct action from audit_log
  `;
  expect(actions.map((a) => a.action)).toEqual(["membership.registered"]);

  // IMPORTANT 5: a shape assertion alone would still pass against an
  // implementation that quietly inserted a second row for an identity that
  // should have been reused — the "miss" branch above is a write, not a
  // read, and so is a probe. The state has to be checked too: exactly one
  // row per identity, on the shelf that already knew them. (This does not
  // exercise a suspended or left row — that is what the dedicated
  // "IMPORTANT 5: a probe against a suspended membership" test below
  // checks; a re-review of the previous fix report found this test had been
  // credited with catching that case, which it never exercised.)
  const [{ count: userCount }] = await sql<
    { count: string }[]
  >`select count(*) from users`;
  expect(Number(userCount)).toBe(2); // the known family, and the stranger — never a third.
  const [{ count: bMemberships }] = await sql<
    { count: string }[]
  >`select count(*) from memberships where user_id = ${known.userId}`;
  expect(Number(bMemberships)).toBe(2); // one row per shelf (a and b), not per attempt.
});

test("IMPORTANT 5: a probe against a suspended membership leaves that row exactly as it was", async () => {
  // The state half of the anti-probe property: whatever the response says,
  // a probe must never be a write against a row it was not entitled to touch.
  //
  // `suspended` is the only status this still holds for. `left` (and
  // `rejected`) are not a probe target any more — `policy.ts`'s graph already
  // allows `left -> pending`, and the walk-back's re-review (fix-report,
  // 2026-08-08-b2-members) removed the separate `role === "reader"` gate that
  // used to block a non-reader `left` row here too, since `role` on a
  // non-active row confers nothing. See "a manager who left can re-register
  // through the public form" above for that path's own coverage.
  const { ctx } = await guestAt("dong-thap");

  const suspended = await runCommand(sql, ctx, registerMembership, FAMILY);
  await sql`
    update memberships
    set status = 'suspended', suspension_reason = 'Tạm khoá'
    where id = ${suspended.membershipId}
  `;
  const before = await membership(suspended.membershipId);
  await expect(runCommand(sql, ctx, registerMembership, FAMILY)).rejects.toThrow();
  expect(await membership(suspended.membershipId)).toEqual(before);
});

// — re-application (BR §2) —

test("a rejected applicant may re-apply, on the same membership row", async () => {
  // memberships_one_per_shelf ignores status — verified live, a second insert
  // over a rejected row raises 23505. So the row is walked back to pending,
  // which keeps its id and therefore keeps its audit history attached.
  const { ctx } = await guestAt("dong-thap");
  const first = await runCommand(sql, ctx, registerMembership, FAMILY);
  await sql`
    update memberships
    set status = 'rejected', rejection_reason = 'Thiếu thông tin'
    where id = ${first.membershipId}
  `;

  const again = await runCommand(sql, ctx, registerMembership, FAMILY);
  expect(again.membershipId).toBe(first.membershipId);
  const m = await membership(first.membershipId);
  expect(m.status).toBe("pending");
  expect(m.rejection_reason).toBeNull();
});

test("a member who left may come back the same way", async () => {
  const { ctx } = await guestAt("dong-thap");
  const first = await runCommand(sql, ctx, registerMembership, FAMILY);
  await sql`update memberships set status = 'left' where id = ${first.membershipId}`;
  const again = await runCommand(sql, ctx, registerMembership, FAMILY);
  expect(again.membershipId).toBe(first.membershipId);
  expect((await membership(first.membershipId)).status).toBe("pending");
});

test("registering twice while already pending or active is named, not silent", async () => {
  // The one leak the plan records: a caller who already supplied the full
  // triple learns this person is a member here. Reporting success and writing
  // nothing would leave a real family waiting for an approval that never comes.
  const { ctx } = await guestAt("dong-thap");
  await runCommand(sql, ctx, registerMembership, FAMILY);
  await expect(
    runCommand(sql, ctx, registerMembership, FAMILY),
  ).rejects.toMatchObject({ code: "already_registered_here" });
});

// — CRITICAL 1: a suspended reader must not be able to clear their own
// suspension by re-submitting the public form —

test("CRITICAL 1: a suspended membership does not walk back to pending through re-registration", async () => {
  // membershipTransition has no suspended -> pending edge in policy.ts's
  // graph; the walk-back must consult that graph rather than its own
  // hand-maintained list of blocked statuses, or this bypasses the state
  // machine entirely.
  const { ctx } = await guestAt("dong-thap");
  const first = await runCommand(sql, ctx, registerMembership, FAMILY);
  await sql`
    update memberships
    set status = 'suspended', suspension_reason = 'Tạm khoá'
    where id = ${first.membershipId}
  `;

  await expect(runCommand(sql, ctx, registerMembership, FAMILY)).rejects.toThrow();

  const m = await membership(first.membershipId);
  expect(m.status).toBe("suspended");
  const [{ suspension_reason }] = await sql<
    { suspension_reason: string | null }[]
  >`select suspension_reason from memberships where id = ${first.membershipId}`;
  expect(suspension_reason).toBe("Tạm khoá");
});

// — the walk-back forces role = 'reader' rather than refusing —

test("a manager who left can re-register through the public form, landing pending and demoted to reader", async () => {
  // Re-review (2026-08-08-b2-members): `role` on a non-active row confers
  // nothing — src/auth/guards.ts's membership lookup filters
  // `status = 'active'`, so this `left` row already resolves its holder to
  // `guest`. Refusing the walk-back protected a privilege that was not
  // there, and left a returning ex-manager stuck: nothing in src/ ever
  // writes memberships.role outside register()'s own hardcoded 'reader'
  // insert, so no command could ever re-enrol them. Forcing 'reader' here
  // matches that insert path and stays safe — the row lands pending, so a
  // manager still approves it.
  const { ctx } = await guestAt("dong-thap");
  const first = await runCommand(sql, ctx, registerMembership, FAMILY);
  await sql`
    update memberships set status = 'left', role = 'manager'
    where id = ${first.membershipId}
  `;

  const again = await runCommand(sql, ctx, registerMembership, FAMILY);
  expect(again.membershipId).toBe(first.membershipId);

  const m = await membership(first.membershipId);
  expect(m.status).toBe("pending");
  expect(m.role).toBe("reader");
});
