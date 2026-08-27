import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import { hashPassword } from "../../src/auth/password";
import { contextFor, landingShelfFor, requireRole } from "../../src/auth/guards";
import { signIn } from "../../src/auth/session";
import { migrate } from "../../src/db/migrate";
import { makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-07T10:00:00Z");

async function signedInMemberOf(shelfId: string, role = "reader") {
  const [user] = await sql<{ id: string }[]>`
    insert into users (saint_name, full_name, father_name, mother_name, phone, username, password_hash)
    values ('Giuse', 'Giuse Trần Minh', 'A', 'B', '0900000000', 'tranminh',
            ${await hashPassword("x")})
    returning id
  `;
  await sql`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${shelfId}, ${user.id}, ${role}, 'active')
  `;
  const { token } = await signIn(sql, {
    username: "tranminh",
    password: "x",
    clock,
  });
  return { token, userId: user.id };
}

test("a member of this shelf gets their role", async () => {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const { token, userId } = await signedInMemberOf(shelf.id, "manager");

  const ctx = await contextFor(sql, { token, bookshelfSlug: "dong-thap", clock });

  expect(ctx.bookshelfId).toBe(shelf.id);
  expect(ctx.actor.userId).toBe(userId);
  expect(ctx.actor.role).toBe("manager");
});

test("a valid session for shelf A grants nothing on shelf B", async () => {
  // OPS §2, the rule this task exists for. Being signed in *somewhere* is not
  // the same as being a member *here*, and conflating the two would let any
  // reader browse every parish's catalogue.
  const a = await makeShelf(sql, { slug: "dong-thap" });
  await makeShelf(sql, { slug: "an-giang" });
  const { token } = await signedInMemberOf(a.id, "manager");

  const ctx = await contextFor(sql, { token, bookshelfSlug: "an-giang", clock });

  expect(ctx.actor.role).toBe("guest");
  expect(ctx.actor.membershipId).toBeNull();
});

test("a suspended member is not a reader", async () => {
  // INV-4 blocks new loans, but a suspended member should not be reading the
  // shelf either — status, not merely role, decides.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const { token, userId } = await signedInMemberOf(shelf.id, "reader");
  await sql`update memberships set status = 'suspended' where user_id = ${userId}`;

  const ctx = await contextFor(sql, { token, bookshelfSlug: "dong-thap", clock });
  expect(ctx.actor.role).toBe("guest");
});

test("a soft-deleted user resolves to guest, even mid-session", async () => {
  // CRITICAL 1: membershipFor filtered m.deleted_at and m.status, but never
  // u.deleted_at — a person deleted (e.g. removed for safeguarding reasons,
  // or a duplicate account merged away) kept every permission their old
  // session already carried, for up to 30 days (SESSION_DAYS), because
  // resolveSession never checked it either. Deleting a person must sign
  // them out in substance, not just remove them from pickers.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const { token, userId } = await signedInMemberOf(shelf.id, "admin");

  const before = await contextFor(sql, {
    token,
    bookshelfSlug: "dong-thap",
    clock,
  });
  expect(before.actor.role).toBe("admin");

  await sql`update users set deleted_at = ${clock.now()} where id = ${userId}`;

  const after = await contextFor(sql, { token, bookshelfSlug: "dong-thap", clock });
  expect(after.actor.role).toBe("guest");
  expect(after.actor.membershipId).toBeNull();
});

test("no token means guest", async () => {
  await makeShelf(sql, { slug: "dong-thap" });
  const ctx = await contextFor(sql, {
    token: null,
    bookshelfSlug: "dong-thap",
    clock,
  });
  expect(ctx.actor.role).toBe("guest");
});

test("landingShelfFor sends a single-shelf member straight there", async () => {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const { userId } = await signedInMemberOf(shelf.id, "reader");

  expect(await landingShelfFor(sql, userId)).toBe("dong-thap");
});

test("landingShelfFor sends a multi-shelf member to the portal instead of picking one", async () => {
  // IMPORTANT 6: nothing here may hard-code a single shelf. A member of more
  // than one bookshelf has no "the" shelf to land on.
  const a = await makeShelf(sql, { slug: "dong-thap" });
  const b = await makeShelf(sql, { slug: "an-giang" });
  const { userId } = await signedInMemberOf(a.id, "reader");
  await sql`insert into memberships (bookshelf_id, user_id, role, status)
            values (${b.id}, ${userId}, 'reader', 'active')`;

  expect(await landingShelfFor(sql, userId)).toBeNull();
});

test("landingShelfFor sends someone with no active membership to the portal", async () => {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const { userId } = await signedInMemberOf(shelf.id, "reader");
  await sql`update memberships set status = 'suspended' where user_id = ${userId}`;

  expect(await landingShelfFor(sql, userId)).toBeNull();
});

test("requireRole respects the hierarchy", () => {
  // BR §13.1: admin ⊃ manager ⊃ reader.
  const admin = {
    bookshelfId: "x",
    actor: { userId: "u", membershipId: "m", role: "admin" as const },
    clock,
  };
  const reader = {
    bookshelfId: "x",
    actor: { userId: "u", membershipId: "m", role: "reader" as const },
    clock,
  };

  expect(() => requireRole(admin, "manager")).not.toThrow();
  expect(() => requireRole(reader, "manager")).toThrow(/không có quyền/);
});
