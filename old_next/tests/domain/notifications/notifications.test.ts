import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import type { Command } from "../../../src/domain/kernel/unit-of-work";
import { runCommand, runQuery } from "../../../src/domain/kernel/unit-of-work";
import { notify } from "../../../src/domain/notifications/write";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "../../../src/domain/notifications/commands/mark-notification-read";
import { getMyNotifications } from "../../../src/domain/notifications/queries/get-my-notifications";
import { approveMembership } from "../../../src/domain/members/commands/approve-membership";
import { rejectMembership } from "../../../src/domain/members/commands/reject-membership";
import { migrate } from "../../../src/db/migrate";
import { makeMember } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";
import { SCENARIO_CLOCK, managerContext } from "../../support/scenarios";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

function readerContext(
  bookshelfId: string,
  reader: { id: string; userId: string },
): TenantContext {
  return {
    bookshelfId,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
    clock: fixedClock(SCENARIO_CLOCK),
  };
}

test("approving a registration tells the reader, and nobody else", async () => {
  // The BR §15 rule with teeth: **managers get none**. The manager here is the
  // actor, and a notification system that told the actor about their own action
  // is the ordinary mistake — so this asserts the row count as well as the
  // recipient. One row, and it belongs to the child.
  const { shelf, manager, ctx } = await managerContext(sql);
  const reader = await makeMember(sql, shelf.id, { status: "pending" });

  await runCommand(sql, ctx, approveMembership, { membershipId: reader.id });

  const rows = await sql<{ user_id: string; kind: string }[]>`
    select user_id, kind from notifications
  `;
  expect(rows).toHaveLength(1);
  expect(rows[0].user_id).toBe(reader.userId);
  expect(rows[0].kind).toBe("membership_approved");
  expect(rows[0].user_id).not.toBe(manager.userId);
});

test("a rejection carries its reason to the reader", async () => {
  const { shelf, ctx } = await managerContext(sql);
  const reader = await makeMember(sql, shelf.id, { status: "pending" });

  await runCommand(sql, ctx, rejectMembership, {
    membershipId: reader.id,
    reason: "Chưa đủ tuổi tham gia",
  });

  const [row] = await sql<{ kind: string; payload: { reason: string } }[]>`
    select kind, payload from notifications
  `;
  expect(row.kind).toBe("membership_rejected");
  expect(row.payload.reason).toBe("Chưa đủ tuổi tham gia");
});

test("a notification cannot survive the transaction that wrote it failing", async () => {
  // OPS §7: every reader notification is written "in the same transaction as
  // the state change it announces". The claim under test belongs to `notify`
  // itself — that it takes a `Tx` and never opens one — so the command here is
  // deliberately a stand-in rather than a real one: it isolates the property
  // from whatever else a real command might do before failing. What it must not
  // be is a test that passes because nothing was written in the first place, so
  // the successful case above is what proves the write happens at all.
  //
  // **This guard could not be falsified by mutation, and that is worth saying
  // rather than leaving as an unearned tick.** The obvious defect — `notify`
  // opening its own transaction — is not expressible: it takes a `Tx` and has
  // no `Sql` to open one with, and postgres.js's nested `begin` is a savepoint,
  // which rolls back with its parent anyway. So the property is structural
  // rather than test-enforced, and this test's real value is that it fails the
  // day somebody changes the signature to take an `Sql`.
  const { shelf, ctx } = await managerContext(sql);
  const reader = await makeMember(sql, shelf.id);

  const notifyThenFail: Command<void, void> = async (tx) => {
    await notify(tx, { userId: reader.userId, kind: "membership_approved" });
    throw new Error("the state change failed after the notification was written");
  };

  await expect(runCommand(sql, ctx, notifyThenFail, undefined)).rejects.toThrow();

  const rows = await sql`select id from notifications`;
  expect(rows).toHaveLength(0);
});

test("a reader reads their own bell, and the count is the unread ones", async () => {
  const { shelf, ctx } = await managerContext(sql);
  const reader = await makeMember(sql, shelf.id, { status: "pending" });
  await runCommand(sql, ctx, approveMembership, { membershipId: reader.id });

  const mine = await runQuery(sql, readerContext(shelf.id, reader), (tx, rctx) =>
    getMyNotifications(tx, rctx),
  );

  expect(mine.unread).toBe(1);
  expect(mine.rows).toHaveLength(1);
  // The Vietnamese, never the kind — the same rule `auditSentence` follows.
  expect(mine.rows[0].sentence).toContain("đã được duyệt");
  expect(mine.rows[0].sentence).not.toContain("membership_approved");
});

test("one reader's bell never shows another's", async () => {
  const { shelf, ctx } = await managerContext(sql);
  const a = await makeMember(sql, shelf.id, { status: "pending" });
  const b = await makeMember(sql, shelf.id);
  await runCommand(sql, ctx, approveMembership, { membershipId: a.id });

  const theirs = await runQuery(sql, readerContext(shelf.id, b), (tx, rctx) =>
    getMyNotifications(tx, rctx),
  );
  expect(theirs.rows).toHaveLength(0);
  expect(theirs.unread).toBe(0);
});

test("marking one read leaves the rest, and marking all clears the bell", async () => {
  const { shelf, ctx } = await managerContext(sql);
  const reader = await makeMember(sql, shelf.id, { status: "pending" });
  await runCommand(sql, ctx, approveMembership, { membershipId: reader.id });
  // A second notification for the same reader, so "one" and "all" differ.
  await sql`
    insert into notifications (bookshelf_id, user_id, kind)
    values (${shelf.id}, ${reader.userId}, 'loan_overdue')
  `;

  const rctx = readerContext(shelf.id, reader);
  const before = await runQuery(sql, rctx, (tx, c) => getMyNotifications(tx, c));
  expect(before.unread).toBe(2);

  await runCommand(sql, rctx, markNotificationRead, {
    notificationId: before.rows[0].id,
  });
  const middle = await runQuery(sql, rctx, (tx, c) => getMyNotifications(tx, c));
  expect(middle.unread).toBe(1);

  const { marked } = await runCommand(
    sql,
    rctx,
    markAllNotificationsRead,
    undefined,
  );
  expect(marked).toBe(1);
  const after = await runQuery(sql, rctx, (tx, c) => getMyNotifications(tx, c));
  expect(after.unread).toBe(0);
  // Read, not deleted — the row is still the record that they were told.
  expect(after.rows).toHaveLength(2);
});

test("a reader cannot mark somebody else's notification read", async () => {
  // Keyed on `user_id`, not on the id the caller passed — and it is a no-op
  // rather than an error, so nothing tells them the notification exists.
  const { shelf, ctx } = await managerContext(sql);
  const owner = await makeMember(sql, shelf.id, { status: "pending" });
  const stranger = await makeMember(sql, shelf.id);
  await runCommand(sql, ctx, approveMembership, { membershipId: owner.id });

  const [row] = await sql<{ id: string }[]>`select id from notifications`;
  await runCommand(sql, readerContext(shelf.id, stranger), markNotificationRead, {
    notificationId: row.id,
  });

  const [after] = await sql<{ read_at: Date | null }[]>`
    select read_at from notifications where id = ${row.id}
  `;
  expect(after.read_at).toBeNull();
});

test("marking read writes no audit entry, deliberately", async () => {
  // OPS §4 names `notification.read` and calls it questionable in the same
  // line. This pins the departure so it reads as a decision rather than an
  // omission — see the command's docstring for the three reasons.
  const { shelf, ctx } = await managerContext(sql);
  const reader = await makeMember(sql, shelf.id, { status: "pending" });
  await runCommand(sql, ctx, approveMembership, { membershipId: reader.id });

  const [row] = await sql<{ id: string }[]>`select id from notifications`;
  await runCommand(sql, readerContext(shelf.id, reader), markNotificationRead, {
    notificationId: row.id,
  });

  const entries = await sql<{ action: string }[]>`
    select action from audit_log where action like 'notification%'
  `;
  expect(entries).toHaveLength(0);
});
