import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import { assertNoSecrets } from "../../src/domain/kernel/audit";
import { runCommand } from "../../src/domain/kernel/unit-of-work";
import { migrate } from "../../src/db/migrate";
import { makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

test("INV-8: an audit record names actor, time, before and after", async () => {
  const shelf = await makeShelf(sql);
  const [user] = await sql<{ id: string }[]>`
    insert into users (full_name, father_name, mother_name, phone)
    values ('Maria Lan', 'A', 'B', '0900000001') returning id
  `;
  const clock = fixedClock("2026-08-03T07:32:00Z"); // 14:32 in Ho Chi Minh City

  await runCommand(
    sql,
    {
      bookshelfId: shelf.id,
      actor: { userId: user.id, membershipId: null, role: "manager" },
      clock,
    },
    async () => ({
      result: null,
      audit: {
        action: "loan.created",
        entityType: "loan",
        entityId: shelf.id,
        before: { state: "available" },
        after: { state: "on_loan" },
      },
    }),
    {},
  );

  const [entry] = await sql<Record<string, unknown>[]>`
    select actor_id, occurred_at, before, after from audit_log
  `;
  expect(entry.actor_id).toBe(user.id);
  expect(entry.occurred_at).toEqual(clock.now());
  expect(entry.before).toEqual({ state: "available" });
  expect(entry.after).toEqual({ state: "on_loan" });
});

test("INV-8: a secret can never reach the audit log", () => {
  // BR §2: "The audit records the act, never the secret." SetReaderCredentials
  // is the command where the temptation to log what it was changed to is
  // strongest, so the guard is in the kernel rather than in that command.
  expect(() =>
    assertNoSecrets({
      action: "credentials.set",
      entityType: "user",
      entityId: "x",
      after: { password_hash: "$2b$whatever" },
    }),
  ).toThrow(/never the secret/);
});
