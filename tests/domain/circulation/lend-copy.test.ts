import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runCommand } from "../../../src/domain/kernel/unit-of-work";
import { lendCopy } from "../../../src/domain/circulation/commands/lend-copy";
import { migrate } from "../../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/**
 * `LendCopy`'s contract, minus the invariants.
 *
 * INV-1, INV-3, INV-4, INV-5 and INV-7 each have a named file under
 * `tests/invariants/` and are asserted there, per G12 — duplicating them here
 * would make it ambiguous which file owns a rule. What is left is everything
 * OPS §4.2 and §5 require of this command that is not one of the fourteen: who
 * may call it, what it does with an id it cannot see, which clock its
 * timestamps come from, and the audit record INV-8 counts.
 */

const clock = fixedClock("2026-08-07T23:30:00Z");

async function shelfWithManager(slug: string) {
  const shelf = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  return { shelf, manager, ctx };
}

test("only a manager may lend", async () => {
  // BR §13.3: "the interface hiding an action is never the security control."
  // The quick-lend screen is manager-only, and so is the command behind it.
  const { shelf, ctx } = await shelfWithManager("dong-thap");
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);
  const asReader: TenantContext = {
    ...ctx,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
  };

  await expect(
    runCommand(sql, asReader, lendCopy, {
      copyId: copyIds[0],
      membershipId: reader.id,
    }),
  ).rejects.toMatchObject({ code: "not_permitted" });
  expect(await sql`select 1 from loans`).toHaveLength(0);
});

test("INV-10: another shelf's copy is not found, not merely refused", async () => {
  // OPS §5 step 1: "a copy id from another tenant must be structurally
  // unreachable, not merely rejected here as a courtesy." RLS filters the
  // select, so the command cannot tell the difference between a copy that
  // belongs to somebody else and one that does not exist — which is the point.
  // A `copy_not_available` here would confirm the copy exists.
  const { ctx } = await shelfWithManager("an-giang");
  const other = await makeShelf(sql, { slug: "can-tho" });
  const { copyIds } = await makeBookWithCopies(sql, other.id, 1);
  const reader = await makeMember(sql, ctx.bookshelfId);

  await expect(
    runCommand(sql, ctx, lendCopy, {
      copyId: copyIds[0],
      membershipId: reader.id,
    }),
  ).rejects.toMatchObject({ code: "copy_not_found" });

  // And the same for the reader: a membership of another shelf is invisible.
  const { copyIds: ours } = await makeBookWithCopies(sql, ctx.bookshelfId, 1);
  const stranger = await makeMember(sql, other.id);
  await expect(
    runCommand(sql, ctx, lendCopy, {
      copyId: ours[0],
      membershipId: stranger.id,
    }),
  ).rejects.toMatchObject({ code: "membership_not_found" });
});

test("lent_at and due_on both come from ctx.clock, not from the database's", async () => {
  // The constraint recorded from the `feat/sql-clock` review, asserted rather
  // than trusted. `loans.lent_at` carries `default now()`
  // (0005_circulation.sql:24), so an insert that simply omitted the column
  // would still produce a plausible-looking row — and `bun run check` would
  // stay green — while that row's timestamp came from the *database* host's
  // clock and its `due_on`, `is_overdue` and `days_remaining` came from the
  // application's. DB §6, "Two clocks in one transaction".
  //
  // The fixed clock is 23:30Z on the 7th deliberately: that is already 06:30
  // on the 8th in Ho Chi Minh City (G6), so `due_on` is fourteen days after
  // the 8th. A `lent_at` left to the column default would land in whatever
  // year this suite is actually run, tens of years from `due_on`, and the two
  // could never be related by any assertion at all.
  const { shelf, ctx } = await shelfWithManager("vinh-long");
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);

  const { loanId, dueOn } = await runCommand(sql, ctx, lendCopy, {
    copyId: copyIds[0],
    membershipId: reader.id,
  });

  const [loan] = await sql<{ lent_at: Date; due_on: string }[]>`
    select lent_at, due_on::text from loans where id = ${loanId}
  `;
  expect(loan.lent_at.toISOString()).toBe("2026-08-07T23:30:00.000Z");
  expect(loan.due_on).toBe("2026-08-22");
  expect(dueOn).toBe("2026-08-22");

  // INV-8's "a loan's lent_at precedes its due_on", which is only a statement
  // anybody can make once both come from the same clock.
  expect(loan.lent_at.getTime()).toBeLessThan(Date.parse("2026-08-22T00:00:00Z"));
});

test("loan_days is the shelf's own setting, defaulting to 14", async () => {
  // BR §5.5's table, and the same shape `max_concurrent_loans` has: DB §4.2
  // says a shelf row "need only store what it overrides", so the default is
  // what nearly every shelf uses and the override is the exception.
  const { shelf, ctx } = await shelfWithManager("tra-vinh");
  await sql`
    update bookshelves
       set settings = settings || ${sql.json({ loan_days: 7 })}
     where id = ${shelf.id}
  `;
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);

  const { dueOn } = await runCommand(sql, ctx, lendCopy, {
    copyId: copyIds[0],
    membershipId: reader.id,
  });
  expect(dueOn).toBe("2026-08-15");
});

test("INV-8: the lend writes one audit record naming both ids", async () => {
  // `audit_log`'s columns are `before` and `after` (0007_audit_notifications
  // .sql:29-30). The two ids are both recorded because they answer different
  // questions later: `borrower_id` is what the row holds and every join keys
  // on, `membership_id` is what the manager picked and the only one of the two
  // that is shelf-specific.
  const { shelf, ctx } = await shelfWithManager("bac-lieu");
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);

  const { loanId } = await runCommand(sql, ctx, lendCopy, {
    copyId: copyIds[0],
    membershipId: reader.id,
  });

  const rows = await sql<
    {
      action: string;
      entity_type: string;
      entity_id: string;
      actor_id: string;
      occurred_at: Date;
      before: { copy_state: string };
      after: { copy_state: string; borrower_id: string; membership_id: string };
    }[]
  >`select action, entity_type, entity_id, actor_id, occurred_at, before, after
      from audit_log`;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    action: "loan.created",
    entity_type: "loan",
    entity_id: loanId,
    actor_id: ctx.actor.userId,
  });
  expect(rows[0].before.copy_state).toBe("available");
  expect(rows[0].after.copy_state).toBe("on_loan");
  expect(rows[0].after.borrower_id).toBe(reader.userId);
  expect(rows[0].after.membership_id).toBe(reader.id);
  // The audit row's own timestamp is the injected clock's too — `toRow`
  // stamps `ctx.clock.now()` (audit.ts:192) — so the whole transaction reads
  // as one instant rather than two.
  expect(rows[0].occurred_at.toISOString()).toBe("2026-08-07T23:30:00.000Z");
});
