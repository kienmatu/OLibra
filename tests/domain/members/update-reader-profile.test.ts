import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../../src/db/migrate";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { NotFound, RuleViolated } from "../../../src/domain/kernel/errors";
import {
  systemContext,
  type TenantContext,
} from "../../../src/domain/kernel/tenant";
import { runCommand } from "../../../src/domain/kernel/unit-of-work";
import { updateReaderProfile } from "../../../src/domain/members/commands/update-reader-profile";
import { closeAll, resetDatabase, sql, withTwoConnections } from "../../support/db";
import { makeMember, makeShelf } from "../../support/factories";

/**
 * OPS §4.3's `UpdateReaderProfile`: a manager corrects a reader's details
 * directly, with no approval step.
 *
 * The command BR §6's restated INV-13 exists for (commit `fb95adc`), and the
 * one every test here is really about is the *audit* — INV-13b's substance is
 * that a person's details never change silently, so a correction that landed
 * without a truthful entry naming the manager would satisfy the letter of the
 * restatement and none of its point.
 */

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-09T02:00:00Z");

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

const personOf = (userId: string) =>
  sql<
    {
      full_name: string;
      phone: string | null;
      email: string | null;
      saint_name: string | null;
      username: string | null;
      updated_at: Date;
    }[]
  >`
    select full_name, phone, email, saint_name, username, updated_at
    from users where id = ${userId}
  `.then((r) => r[0]);

const auditRows = () =>
  sql<
    {
      action: string;
      actor_id: string | null;
      entity_type: string;
      entity_id: string;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
      occurred_at: Date;
    }[]
  >`
    select action, actor_id, entity_type, entity_id, before, after, occurred_at
    from audit_log order by occurred_at
  `;

// — the correction, and the record of it —

test("a manager corrects a phone number, and the audit names who, when, and what changed", async () => {
  // BR §16.3 calls the phone number the actual mechanism by which books come
  // back, and BR §2 permits this command only on the terms this test asserts:
  // the edit is attributable.
  const { ctx, reader, manager } = await shelfWithReader();

  await runCommand(sql, ctx, updateReaderProfile, {
    membershipId: reader.id,
    fields: { phone: "0912345678" },
  });

  expect((await personOf(reader.userId)).phone).toBe("0912345678");

  const [entry] = await auditRows();
  expect(entry.action).toBe("profile.corrected");
  expect(entry.actor_id).toBe(manager.userId);
  expect(entry.entity_type).toBe("user");
  expect(entry.entity_id).toBe(reader.userId);
  expect(entry.before).toEqual({ phone: "0900000000" });
  expect(entry.after).toEqual({ phone: "0912345678" });
  // From ctx.clock, not from a column default — DB §6's two-clocks rule.
  expect(entry.occurred_at.toISOString()).toBe("2026-08-09T02:00:00.000Z");
});

test("the audit carries only the fields that changed, not all eight", async () => {
  // OPS §4.3 asks for it and BR §14 is the reason: an entry listing eight
  // fields, seven identical on both sides, says "a manager rewrote this
  // person" when a manager fixed a spelling.
  const { ctx, reader } = await shelfWithReader();
  await runCommand(sql, ctx, updateReaderProfile, {
    membershipId: reader.id,
    fields: {
      full_name: "Nguyễn Thị Mai",
      // named, and identical to what is already there — so not a change
      phone: "0900000000",
    },
  });

  const [entry] = await auditRows();
  expect(Object.keys(entry.after!)).toEqual(["full_name"]);
  expect(entry.before).toEqual({ full_name: expect.any(String) });
});

test("two fields at once, including one cleared to null", async () => {
  const { ctx, reader } = await shelfWithReader();
  await sql`update users set email = 'cu@vd.vn' where id = ${reader.userId}`;

  await runCommand(sql, ctx, updateReaderProfile, {
    membershipId: reader.id,
    fields: { saint_name: "Giuse", email: null },
  });

  const after = await personOf(reader.userId);
  expect(after.saint_name).toBe("Giuse");
  expect(after.email).toBeNull();
  const [entry] = await auditRows();
  expect(entry.after).toEqual({ saint_name: "Giuse", email: null });
  expect(entry.before).toEqual({ saint_name: null, email: "cu@vd.vn" });
});

test("a field this call never named survives a concurrent correction to it", async () => {
  // IMPORTANT 3's lesson from updateBook (fix-report, 2026-08-08-b1-catalogue):
  // an implementation that reads the row into JavaScript and binds that
  // snapshot back for every field the caller did not name is a whole-row write,
  // and it silently discards a second manager's commit that landed between the
  // read and the write.
  //
  // **The obvious way to write this test does not catch that, and the first
  // version of this test did not.** Delaying the command's membership read and
  // committing B inside that window leaves the defective implementation's own
  // snapshot to be taken *after* B commits — so it snapshots the new value and
  // loses nothing. Verified by planting the defect: that test stayed green.
  //
  // The window has to be opened where the defect actually lives, between the
  // snapshot and the write, and the row lock is what opens it deterministically
  // without the test knowing anything about the implementation's shape:
  //
  //   1. B locks the person and holds the lock.
  //   2. A starts. A defective A takes its (unlocked, read-committed) snapshot
  //      immediately — B has not committed, so it reads the *old* phone — and
  //      then blocks on B's lock at its write. The shipped A blocks straight
  //      away, at the `for update` inside its one statement, having read
  //      nothing yet.
  //   3. B writes the new phone and commits.
  //   4. A proceeds. The shipped A's `select … for update` re-evaluates against
  //      the committed row version and sees the new phone; a defective A writes
  //      the stale one back over it.
  //
  // Two real connections, because `tests/support/db.ts`'s shared `sql` is
  // `max: 1` on purpose and a command paused on the only connection in the pool
  // deadlocks rather than races.
  const { ctx, reader } = await shelfWithReader();

  await withTwoConnections(async (a, b) => {
    let releaseB: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      releaseB = resolve;
    });

    const second = b.begin(async (tx) => {
      await tx`select id from users where id = ${reader.userId} for update`;
      await held;
      await tx`update users set phone = '0912345678' where id = ${reader.userId}`;
    });

    await new Promise((r) => setTimeout(r, 40)); // B takes the lock

    const first = runCommand(a, ctx, updateReaderProfile, {
      membershipId: reader.id,
      fields: { saint_name: "Giuse" },
    });

    await new Promise((r) => setTimeout(r, 80)); // A gets as far as it can

    releaseB();
    await second;
    await first;
  });

  const after = await personOf(reader.userId);
  expect(after.saint_name).toBe("Giuse");
  expect(after.phone).toBe("0912345678");
});

// — an edit that changes nothing —

test("naming no fields at all is refused, and writes nothing", async () => {
  const { ctx, reader } = await shelfWithReader();
  await expect(
    runCommand(sql, ctx, updateReaderProfile, {
      membershipId: reader.id,
      fields: {},
    }),
  ).rejects.toMatchObject({ code: "empty_proposal" });
  expect(await auditRows()).toEqual([]);
});

test("naming fields that all match the current values is refused, and moves nothing", async () => {
  // The subtle half. The command writes first and refuses on the statement's
  // own before/after, so what stops the no-op UPDATE from committing is the
  // rollback the throw causes — `updated_at` is the assertion that proves it,
  // because a pre-check implementation would leave it untouched by accident
  // and this one has to be rolled back on purpose.
  const { ctx, reader } = await shelfWithReader();
  const before = await personOf(reader.userId);

  await expect(
    runCommand(sql, ctx, updateReaderProfile, {
      membershipId: reader.id,
      fields: { phone: "0900000000", full_name: before.full_name },
    }),
  ).rejects.toMatchObject({ code: "empty_proposal" });

  const after = await personOf(reader.userId);
  expect(after.updated_at.toISOString()).toBe(before.updated_at.toISOString());
  expect(await auditRows()).toEqual([]);
});

// — validation, before any write —

test("blanking a not-null field is a sentence, not a 23502", async () => {
  const { ctx, reader } = await shelfWithReader();
  const before = await personOf(reader.userId);
  await expect(
    runCommand(sql, ctx, updateReaderProfile, {
      membershipId: reader.id,
      fields: { full_name: "   " },
    }),
  ).rejects.toMatchObject({ code: "required_fields_missing" });
  expect((await personOf(reader.userId)).full_name).toBe(before.full_name);
  expect(await auditRows()).toEqual([]);
});

test("a malformed date is a sentence, not a 22007 from inside the transaction", async () => {
  const { ctx, reader } = await shelfWithReader();
  await expect(
    runCommand(sql, ctx, updateReaderProfile, {
      membershipId: reader.id,
      fields: { date_of_birth: "02/04/2015" },
    }),
  ).rejects.toMatchObject({ code: "validation_failed" });
});

// — who may call it —

test("a reader cannot correct anyone's details, including their own", async () => {
  // The narrower thing the approval step protects, and it still holds: a
  // reader changes their own verified details only by proposal (BR §6, INV-13
  // as restated).
  const { readerCtx, reader } = await shelfWithReader();
  await expect(
    runCommand(sql, readerCtx, updateReaderProfile, {
      membershipId: reader.id,
      fields: { phone: "0912345678" },
    }),
  ).rejects.toBeInstanceOf(RuleViolated);
  expect((await personOf(reader.userId)).phone).toBe("0900000000");
});

test("systemContext holds the highest rank and is still refused", async () => {
  // `systemContext` is `{ userId: null, membershipId: null, role:
  // "super_admin" }` — the top of ROLE_RANK with nobody behind it. A gate on
  // rank alone passes here and commits an audit row with a null actor, which
  // is the defect `requireIdentifiedActor`'s docstring records `voidLoan`
  // shipping. INV-8 asks for the actor by name, and BR §2 permits this command
  // only because its use is attributable.
  const { shelf, reader } = await shelfWithReader();
  await expect(
    runCommand(sql, systemContext(shelf.id, clock), updateReaderProfile, {
      membershipId: reader.id,
      fields: { phone: "0912345678" },
    }),
  ).rejects.toMatchObject({ code: "not_permitted" });
  expect((await personOf(reader.userId)).phone).toBe("0900000000");
  expect(await auditRows()).toEqual([]);
});

// — `users` has no RLS, so the membership select is the whole of the guard —

test("INV-10: a manager of one shelf cannot correct another shelf's reader", async () => {
  // `users` carries no row-level security at all (0010_rls.sql, by design;
  // B2a probed it live). Nothing between a manager of Cần Thơ and every person
  // in the system except the membership select, which RLS filters to zero
  // rows. This is the test that proves the select is there and is load-bearing.
  const a = await shelfWithReader("dong-thap");
  const b = await shelfWithReader("can-tho");

  await expect(
    runCommand(sql, b.ctx, updateReaderProfile, {
      membershipId: a.reader.id,
      fields: { phone: "0912345678" },
    }),
  ).rejects.toBeInstanceOf(NotFound);

  expect((await personOf(a.reader.userId)).phone).toBe("0900000000");
  expect(await auditRows()).toEqual([]);
});

test("a soft-deleted identity cannot be corrected", async () => {
  const { ctx, reader } = await shelfWithReader();
  await sql`update users set deleted_at = now() where id = ${reader.userId}`;
  await expect(
    runCommand(sql, ctx, updateReaderProfile, {
      membershipId: reader.id,
      fields: { phone: "0912345678" },
    }),
  ).rejects.toMatchObject({ code: "membership_not_found" });
});

test("no correction can reach a credential column", async () => {
  // The allowlist as a boundary rather than as a convenience. `username` and
  // `password_hash` are BR §2's separate power, with separate audit rules (no
  // before, no after) that this command's entry would break.
  const { ctx, reader } = await shelfWithReader();
  await expect(
    runCommand(sql, ctx, updateReaderProfile, {
      membershipId: reader.id,
      fields: {
        username: "kelely",
        password_hash: "$argon2id$stolen",
      } as never,
    }),
  ).rejects.toMatchObject({ code: "empty_proposal" });
  expect((await personOf(reader.userId)).username).toBeNull();
});
