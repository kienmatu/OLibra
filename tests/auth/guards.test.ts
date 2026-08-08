import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import { hashPassword } from "../../src/auth/password";
import { contextFor, requireRole } from "../../src/auth/guards";
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
    insert into users (full_name, father_name, mother_name, phone, username, password_hash)
    values ('Giuse Trần Minh', 'A', 'B', '0900000000', 'tranminh',
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

test("no token means guest", async () => {
  await makeShelf(sql, { slug: "dong-thap" });
  const ctx = await contextFor(sql, {
    token: null,
    bookshelfSlug: "dong-thap",
    clock,
  });
  expect(ctx.actor.role).toBe("guest");
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
