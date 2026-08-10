import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { hashPassword, verifyPassword } from "../../../src/auth/password";
import { resolveSession } from "../../../src/auth/session";
import { fixedClock } from "../../../src/domain/kernel/clock";
import {
  setPasswordHasher,
  setPasswordVerifier,
} from "../../../src/domain/kernel/crypto";
import { NotFound, RuleViolated } from "../../../src/domain/kernel/errors";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runCommand } from "../../../src/domain/kernel/unit-of-work";
import { changeOwnPassword } from "../../../src/domain/members/commands/change-own-password";
import { setReaderCredentials } from "../../../src/domain/members/commands/set-reader-credentials";
import { migrate } from "../../../src/db/migrate";
import { makeMember, makePerson, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(async () => {
  await migrate(sql);
  setPasswordHasher(hashPassword);
  setPasswordVerifier(verifyPassword);
});
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-08T03:00:00Z");

async function shelfWithReader(slug = "dong-thap") {
  const shelf = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const reader = await makeMember(sql, shelf.id, { status: "active" });
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  const readerCtx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
    clock,
  };
  return { shelf, manager, reader, ctx, readerCtx };
}

const credentialsOf = (userId: string) =>
  sql<
    { username: string | null; password_hash: string | null }[]
  >`select username, password_hash from users where id = ${userId}`.then(
    (r) => r[0],
  );

// — the happy path —

test("a manager gives an account the ability to sign in for the first time", async () => {
  // BR §2: "The same action creates credentials for an account that had none."
  const { ctx, reader } = await shelfWithReader();
  expect((await credentialsOf(reader.userId)).username).toBeNull();

  await runCommand(sql, ctx, setReaderCredentials, {
    membershipId: reader.id,
    username: "TranMinh",
    password: "matkhau123",
  });

  const after = await credentialsOf(reader.userId);
  expect(after.username).toBe("TranMinh");
  expect(await verifyPassword("matkhau123", after.password_hash!)).toBe(true);
});

test("and gives it back to someone who forgot", async () => {
  // §4's assumption 2: no outbound email, so no self-service reset. A child who
  // forgets asks the volunteer standing at the shelf.
  const { ctx, reader } = await shelfWithReader();
  await runCommand(sql, ctx, setReaderCredentials, {
    membershipId: reader.id,
    username: "tranminh",
    password: "matkhaucu1",
  });
  await runCommand(sql, ctx, setReaderCredentials, {
    membershipId: reader.id,
    username: "tranminh",
    password: "matkhaumoi2",
  });
  const after = await credentialsOf(reader.userId);
  expect(await verifyPassword("matkhaumoi2", after.password_hash!)).toBe(true);
  expect(await verifyPassword("matkhaucu1", after.password_hash!)).toBe(false);
});

// — the audit records the act, never the secret (BR §2, §14) —

test("the audit entry names the manager, the reader and the time, with no before and no after", async () => {
  // OPS §4.3, verbatim on both halves: the entry is "an explicit event naming
  // the manager, the reader and the time, with no before and no after".
  const { ctx, reader, manager } = await shelfWithReader();
  await runCommand(sql, ctx, setReaderCredentials, {
    membershipId: reader.id,
    username: "tranminh",
    password: "matkhau123",
  });

  const [entry] = await sql<
    {
      action: string;
      actor_id: string;
      entity_id: string;
      before: unknown;
      after: unknown;
      occurred_at: Date;
    }[]
  >`select action, actor_id, entity_id, before, after, occurred_at from audit_log`;

  expect(entry.action).toBe("credentials.set");
  expect(entry.actor_id).toBe(manager.userId);
  expect(entry.entity_id).toBe(reader.userId);
  expect(entry.before).toBeNull();
  expect(entry.after).toBeNull();
  expect(entry.occurred_at.toISOString()).toBe("2026-08-08T03:00:00.000Z");
});

test("no part of the audit row carries the password or its hash", async () => {
  // The kernel's assertNoSecrets walks `before` and `after` only — it never
  // reads `action`, `entityType` or `entityId`, and toRow does not emit
  // `context` at all. So asserting on before/after alone would not catch a
  // hash smuggled into an entity id or an action name. Scan the whole row.
  const { ctx, reader } = await shelfWithReader();
  await runCommand(sql, ctx, setReaderCredentials, {
    membershipId: reader.id,
    username: "tranminh",
    password: "matkhau123",
  });

  const [{ whole }] = await sql<{ whole: string }[]>`
    select audit_log::text as whole from audit_log
  `;
  expect(whole).not.toContain("$argon2id$");
  expect(whole).not.toContain("matkhau123");
  expect(whole.toLowerCase()).not.toContain("password");

  // And the hash really was written — otherwise this test passes vacuously.
  expect((await credentialsOf(reader.userId)).password_hash).toContain(
    "$argon2id$",
  );
});

test("a command that tried to log the hash would be refused by the kernel", async () => {
  // Belt and braces for the routes assertNoSecrets *does* cover, so a future
  // edit that starts populating `after` cannot quietly reintroduce this.
  const { ctx, reader } = await shelfWithReader();
  const leaky = async () => ({
    result: undefined,
    audit: {
      action: "credentials.set",
      entityType: "user",
      entityId: reader.userId,
      after: { credentials: { password_hash: "$argon2id$leaked" } },
    },
  });
  await expect(runCommand(sql, ctx, leaky as never, {})).rejects.toMatchObject({
    code: "audit_forbidden_field",
  });
});

// — revocability (BR §2) —

test("setting credentials ends every session that reader already had", async () => {
  // BR §2's argument is that the power is watched, not withheld. Credentials
  // that changed while an old session kept working are neither watched nor
  // revoked.
  const { ctx, reader } = await shelfWithReader();
  await sql`
    insert into sessions (token_hash, user_id, expires_at)
    values (encode(sha256('phien-cu'::bytea), 'hex'), ${reader.userId},
            now() + interval '30 days')
  `;
  expect(await resolveSession(sql, "phien-cu", clock)).not.toBeNull();

  await runCommand(sql, ctx, setReaderCredentials, {
    membershipId: reader.id,
    username: "tranminh",
    password: "matkhau123",
  });

  expect(await resolveSession(sql, "phien-cu", clock)).toBeNull();
});

test("another reader's sessions are untouched", async () => {
  const { ctx, reader, shelf } = await shelfWithReader();
  const other = await makeMember(sql, shelf.id, { status: "active" });
  await sql`
    insert into sessions (token_hash, user_id, expires_at)
    values (encode(sha256('phien-khac'::bytea), 'hex'), ${other.userId},
            now() + interval '30 days')
  `;
  await runCommand(sql, ctx, setReaderCredentials, {
    membershipId: reader.id,
    username: "tranminh",
    password: "matkhau123",
  });
  expect(await resolveSession(sql, "phien-khac", clock)).not.toBeNull();
});

// — scoping: users has no RLS, so the membership select is the only guard —

test("INV-10: a manager of one shelf cannot set credentials on another shelf's reader", async () => {
  // Verified live: `update users ... where id = <any user>` succeeds from any
  // scoped session, because `users` carries no policy (DB §3). The membership
  // select is the whole of the protection, so this is the test that proves it
  // is there.
  const a = await shelfWithReader("dong-thap");
  const b = await shelfWithReader("can-tho");

  await expect(
    runCommand(sql, b.ctx, setReaderCredentials, {
      membershipId: a.reader.id,
      username: "chiemquyen",
      password: "matkhau123",
    }),
  ).rejects.toBeInstanceOf(NotFound);

  expect((await credentialsOf(a.reader.userId)).username).toBeNull();
  const [{ count }] = await sql<
    { count: string }[]
  >`select count(*) from audit_log`;
  expect(Number(count)).toBe(0);
});

test("IMPORTANT 4: a soft-deleted identity cannot receive new credentials", async () => {
  // Narrower than the identity-slice Critical: signIn and resolveSession both
  // filter deleted_at, so credentials written here could never be used to
  // sign in. But the membership select alone does not join users at all, so
  // nothing stops the write from landing on a deleted identity — latent today
  // because nothing soft-deletes a users row yet, live the moment something
  // does.
  const { ctx, reader } = await shelfWithReader();
  await sql`update users set deleted_at = now() where id = ${reader.userId}`;

  await expect(
    runCommand(sql, ctx, setReaderCredentials, {
      membershipId: reader.id,
      username: "tranminh",
      password: "matkhau123",
    }),
  ).rejects.toMatchObject({ code: "membership_not_found" });

  expect((await credentialsOf(reader.userId)).username).toBeNull();
});

test("a reader cannot set anyone's credentials, including their own", async () => {
  // BR §2 makes this a manager's act specifically. A reader changing their own
  // password is ChangeOwnPassword, which needs the current one.
  const { readerCtx, reader } = await shelfWithReader();
  await expect(
    runCommand(sql, readerCtx, setReaderCredentials, {
      membershipId: reader.id,
      username: "tranminh",
      password: "matkhau123",
    }),
  ).rejects.toBeInstanceOf(RuleViolated);
});

// — validation —

test("a taken username is refused, case-insensitively, in the manager's words", async () => {
  // users_username_key is `unique (lower(username)) where deleted_at is null
  // and username is not null` — verified live. `username_in_use`, not
  // `username_taken`: a manager typing on a reader's behalf is not being told
  // to pick a different name for themselves (OPS §4.3's two sentences).
  const { ctx, reader } = await shelfWithReader();
  await makePerson(sql, {
    username: "TranMinh",
    passwordHash: await hashPassword("kohieu12"),
  });
  await expect(
    runCommand(sql, ctx, setReaderCredentials, {
      membershipId: reader.id,
      username: "tranminh",
      password: "matkhau123",
    }),
  ).rejects.toMatchObject({ code: "username_in_use" });
});

test("keeping the same username while changing the password is not a collision", async () => {
  // The obvious wrong implementation: a bare "does this username exist" check
  // that finds the reader's own row and refuses the reset they came for.
  const { ctx, reader } = await shelfWithReader();
  await runCommand(sql, ctx, setReaderCredentials, {
    membershipId: reader.id,
    username: "tranminh",
    password: "matkhaucu1",
  });
  await expect(
    runCommand(sql, ctx, setReaderCredentials, {
      membershipId: reader.id,
      username: "tranminh",
      password: "matkhaumoi2",
    }),
  ).resolves.toBeUndefined();
});

test("a short password, and a blank username, are refused before any write", async () => {
  const { ctx, reader } = await shelfWithReader();
  await expect(
    runCommand(sql, ctx, setReaderCredentials, {
      membershipId: reader.id,
      username: "tranminh",
      password: "ngan",
    }),
  ).rejects.toMatchObject({ code: "password_too_short" });
  await expect(
    runCommand(sql, ctx, setReaderCredentials, {
      membershipId: reader.id,
      username: "  ",
      password: "matkhau123",
    }),
  ).rejects.toMatchObject({ code: "required_fields_missing" });
  // INV-14: neither was written, so the account is still credential-less.
  expect((await credentialsOf(reader.userId)).password_hash).toBeNull();
});

// — ChangeOwnPassword —

test("a reader changes their own password with the current one", async () => {
  const { ctx, readerCtx, reader } = await shelfWithReader();
  await runCommand(sql, ctx, setReaderCredentials, {
    membershipId: reader.id,
    username: "tranminh",
    password: "matkhaucu1",
  });

  await runCommand(sql, readerCtx, changeOwnPassword, {
    membershipId: reader.id,
    currentPassword: "matkhaucu1",
    newPassword: "matkhaumoi2",
  });

  const after = await credentialsOf(reader.userId);
  expect(await verifyPassword("matkhaumoi2", after.password_hash!)).toBe(true);
  expect(after.username).toBe("tranminh");

  const [entry] = await sql<
    { action: string; before: unknown; after: unknown }[]
  >`select action, before, after from audit_log where action = 'user.password_changed'`;
  expect(entry.action).toBe("user.password_changed");
  expect(entry.before).toBeNull();
  expect(entry.after).toBeNull();
});

test("the wrong current password, and a too-short new one, each say so", async () => {
  const { ctx, readerCtx, reader } = await shelfWithReader();
  await runCommand(sql, ctx, setReaderCredentials, {
    membershipId: reader.id,
    username: "tranminh",
    password: "matkhaucu1",
  });
  await expect(
    runCommand(sql, readerCtx, changeOwnPassword, {
      membershipId: reader.id,
      currentPassword: "doanbua123",
      newPassword: "matkhaumoi2",
    }),
  ).rejects.toMatchObject({ code: "current_password_incorrect" });
  await expect(
    runCommand(sql, readerCtx, changeOwnPassword, {
      membershipId: reader.id,
      currentPassword: "matkhaucu1",
      newPassword: "ngan",
    }),
  ).rejects.toMatchObject({ code: "new_password_too_short" });
});

test("an account with no credentials cannot change a password it does not have", async () => {
  // INV-14's valid state. Failing as `current_password_incorrect` rather than
  // "you have no password" keeps this from telling a caller which accounts are
  // credential-less — the same reasoning `sign_in_failed` already carries.
  const { readerCtx, reader } = await shelfWithReader();
  await expect(
    runCommand(sql, readerCtx, changeOwnPassword, {
      membershipId: reader.id,
      currentPassword: "batky12345",
      newPassword: "matkhaumoi2",
    }),
  ).rejects.toMatchObject({ code: "current_password_incorrect" });
});

test("one reader cannot change another reader's password", async () => {
  const { readerCtx, shelf } = await shelfWithReader();
  const other = await makeMember(sql, shelf.id, { status: "active" });
  await expect(
    runCommand(sql, readerCtx, changeOwnPassword, {
      membershipId: other.id,
      currentPassword: "batky12345",
      newPassword: "matkhaumoi2",
    }),
  ).rejects.toBeInstanceOf(RuleViolated);
});

test("changing your own password also ends your other sessions", async () => {
  const { ctx, readerCtx, reader } = await shelfWithReader();
  await runCommand(sql, ctx, setReaderCredentials, {
    membershipId: reader.id,
    username: "tranminh",
    password: "matkhaucu1",
  });
  await sql`
    insert into sessions (token_hash, user_id, expires_at)
    values (encode(sha256('phien-cu'::bytea), 'hex'), ${reader.userId},
            now() + interval '30 days')
  `;
  await runCommand(sql, readerCtx, changeOwnPassword, {
    membershipId: reader.id,
    currentPassword: "matkhaucu1",
    newPassword: "matkhaumoi2",
  });
  expect(await resolveSession(sql, "phien-cu", clock)).toBeNull();
});
