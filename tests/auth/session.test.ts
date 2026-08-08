import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import { hashPassword } from "../../src/auth/password";
import {
  resolveSession,
  revokeAllSessions,
  signIn,
  signOut,
} from "../../src/auth/session";
import { migrate } from "../../src/db/migrate";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-07T10:00:00Z");

async function makeUserWithCredentials(username: string, password: string) {
  const [row] = await sql<{ id: string }[]>`
    insert into users (full_name, father_name, mother_name, phone, username, password_hash)
    values ('Giuse Trần Minh', 'Giuse Trần Văn A', 'Maria Nguyễn Thị B',
            '0900000000', ${username}, ${await hashPassword(password)})
    returning id
  `;
  return row.id;
}

test("signing in with correct credentials returns a token", async () => {
  const userId = await makeUserWithCredentials("tranminh", "con-meo-nho");
  const { token } = await signIn(sql, {
    username: "tranminh",
    password: "con-meo-nho",
    clock,
  });
  expect(await resolveSession(sql, token, clock)).toEqual({ userId });
});

test("a wrong password does not sign in", async () => {
  await makeUserWithCredentials("tranminh", "con-meo-nho");
  await expect(
    signIn(sql, { username: "tranminh", password: "sai", clock }),
  ).rejects.toMatchObject({ code: "sign_in_failed" });
});

test("an account with no credentials cannot sign in", async () => {
  // INV-14. BR §2: most readers are children who will never use the site;
  // a person may exist purely as a record. That is a valid state, and the
  // sign-in path must handle it as a failed sign-in rather than a crash.
  await sql`
    insert into users (full_name, father_name, mother_name, phone)
    values ('Têrêsa Lê Ngọc Ánh', 'A', 'B', '0900000002')
  `;
  await expect(
    signIn(sql, { username: "leanh", password: "bat-ky", clock }),
  ).rejects.toMatchObject({ code: "sign_in_failed" });
});

test("who signed in from where is recorded, per DATABASE.md §4.1's promise", async () => {
  // M8: user_agent/ip_address were columns on the table and nothing more —
  // signIn never wrote them. Optional, still: a caller with nothing to
  // report (this suite, most tests above) must not be forced to invent one.
  await makeUserWithCredentials("tranminh", "con-meo-nho");
  await signIn(sql, {
    username: "tranminh",
    password: "con-meo-nho",
    clock,
    userAgent: "OLibra test suite",
    ipAddress: "203.0.113.7",
  });

  const [row] = await sql<
    { user_agent: string | null; ip_address: string | null }[]
  >`
    select user_agent, ip_address from sessions
  `;
  expect(row.user_agent).toBe("OLibra test suite");
  expect(row.ip_address).toBe("203.0.113.7");
});

test("the raw token is never stored", async () => {
  // A leaked backup should not be a stack of usable sessions.
  const { token } = await (async () => {
    await makeUserWithCredentials("tranminh", "con-meo-nho");
    return signIn(sql, { username: "tranminh", password: "con-meo-nho", clock });
  })();

  const rows = await sql<{ token_hash: string }[]>`select token_hash from sessions`;
  expect(rows).toHaveLength(1);
  expect(rows[0].token_hash).not.toBe(token);
});

test("an expired session resolves to nothing, with no sweep having run", async () => {
  // G5. Expiry is compared against the clock at read time; the housekeeping
  // delete is tidying, not correctness.
  await makeUserWithCredentials("tranminh", "con-meo-nho");
  const { token } = await signIn(sql, {
    username: "tranminh",
    password: "con-meo-nho",
    clock,
  });

  const muchLater = fixedClock("2026-12-31T10:00:00Z");
  expect(await resolveSession(sql, token, muchLater)).toBeNull();
  // The row is still there — nothing tidied it — and it is still unusable.
  expect(await sql`select 1 from sessions`).toHaveLength(1);
});

test("a soft-deleted user's session no longer resolves", async () => {
  // CRITICAL 1, the other half: resolveSession never checked users.deleted_at,
  // so contextFor's per-request identity check ran the same gap even where
  // membershipFor was fixed. Deleting a person must stop their existing
  // session from resolving, the same way it stops a fresh signIn (which
  // already filters `deleted_at is null`).
  const userId = await makeUserWithCredentials("tranminh", "con-meo-nho");
  const { token } = await signIn(sql, {
    username: "tranminh",
    password: "con-meo-nho",
    clock,
  });
  expect(await resolveSession(sql, token, clock)).toEqual({ userId });

  await sql`update users set deleted_at = ${clock.now()} where id = ${userId}`;

  expect(await resolveSession(sql, token, clock)).toBeNull();
});

test("signing out invalidates only that session", async () => {
  await makeUserWithCredentials("tranminh", "con-meo-nho");
  const first = await signIn(sql, {
    username: "tranminh",
    password: "con-meo-nho",
    clock,
  });
  const second = await signIn(sql, {
    username: "tranminh",
    password: "con-meo-nho",
    clock,
  });

  await signOut(sql, first.token);

  expect(await resolveSession(sql, first.token, clock)).toBeNull();
  expect(await resolveSession(sql, second.token, clock)).not.toBeNull();
});

test("revoking all sessions ends every one of them", async () => {
  // The reason database-backed sessions were chosen. When a manager sets a
  // reader's credentials (BR §2), every existing session for that reader must
  // end — a signed stateless cookie could not do this.
  const userId = await makeUserWithCredentials("tranminh", "con-meo-nho");
  const a = await signIn(sql, {
    username: "tranminh",
    password: "con-meo-nho",
    clock,
  });
  const b = await signIn(sql, {
    username: "tranminh",
    password: "con-meo-nho",
    clock,
  });

  await revokeAllSessions(sql, userId);

  expect(await resolveSession(sql, a.token, clock)).toBeNull();
  expect(await resolveSession(sql, b.token, clock)).toBeNull();
});
