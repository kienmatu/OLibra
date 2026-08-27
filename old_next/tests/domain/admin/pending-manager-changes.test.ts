import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../../src/db/migrate";
import { fixedClock } from "../../../src/domain/kernel/clock";
import type { Role, TenantContext } from "../../../src/domain/kernel/tenant";
import {
  runAdminCommand,
  runAdminQuery,
  runCommand,
  runQuery,
} from "../../../src/domain/kernel/unit-of-work";
import {
  countPendingManagerChanges,
  getPendingManagerChanges,
} from "../../../src/domain/admin/queries/get-pending-manager-changes";
import { approveProfileChange } from "../../../src/domain/members/commands/approve-profile-change";
import { proposeProfileChange } from "../../../src/domain/members/commands/propose-profile-change";
import { getPendingProfileChanges } from "../../../src/domain/members/queries/get-pending-profile-changes";
import { closeAll, resetDatabase, sql } from "../../support/db";
import { makeMember, makeShelf } from "../../support/factories";
import { managerContext, superAdminContext } from "../../support/scenarios";

/**
 * §9 of docs/superpowers/specs/2026-08-12-po-feedback-design.md — PO feedback
 * round 1, Task 10. `getPendingProfileChanges` (the shelf-level queue) now
 * filters to `m.role = 'reader'`; this file is the complement it left
 * nowhere visible — `getPendingManagerChanges`, `m.role in ('manager',
 * 'admin')`, cross-shelf. See `../../../src/domain/admin/queries/
 * get-pending-manager-changes.ts` for the full argument; this file only
 * covers what its own docstring cannot: that the two queries actually
 * partition every pending request between them, that the permission boundary
 * holds on both the kernel's path and the query's own, and that a row this
 * query hands back is actually usable to decide the request it names.
 */

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

async function codeThrownBy(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? null;
  }
}

function ctxFor(
  bookshelfId: string,
  member: { id: string | null; userId: string | null },
  role: Role,
  instant: string,
): TenantContext {
  return {
    bookshelfId,
    actor: { userId: member.userId, membershipId: member.id, role },
    clock: fixedClock(instant),
  };
}

/** A shelf with one manager and one reader — the least each test needs. */
async function aShelfWithAManager(over: { slug?: string } = {}) {
  const shelf = await makeShelf(sql, over.slug ? { slug: over.slug } : {});
  const reader = await makeMember(sql, shelf.id, { status: "active" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  return { shelf, reader, manager };
}

function propose(
  ctx: TenantContext,
  membershipId: string,
  phone: string,
): Promise<{ profileChangeRequestId: string }> {
  return runCommand(sql, ctx, proposeProfileChange, {
    membershipId,
    fields: { phone },
  });
}

// ── The queue spans every shelf, and only the subjects Task 9 routed here ──

test("the admin queue lists manager changes across every shelf and excludes reader subjects", async () => {
  const a = await aShelfWithAManager({ slug: "dong-thap" });
  const b = await aShelfWithAManager({ slug: "thanh-tam" });

  await propose(
    ctxFor(a.shelf.id, a.manager, "manager", "2026-08-13T07:00:00Z"),
    a.manager.id,
    "0912345678",
  );
  await propose(
    ctxFor(b.shelf.id, b.manager, "manager", "2026-08-13T08:00:00Z"),
    b.manager.id,
    "0987654321",
  );
  await propose(
    ctxFor(a.shelf.id, a.reader, "reader", "2026-08-13T07:30:00Z"),
    a.reader.id,
    "0900111222",
  );

  const { ctx } = await superAdminContext(sql);
  const rows = await runAdminQuery(sql, ctx, (tx, c) =>
    getPendingManagerChanges(tx, c),
  );

  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.shelfSlug).sort()).toEqual(["dong-thap", "thanh-tam"]);
  expect(
    rows.every((r) => r.subjectRole === "manager" || r.subjectRole === "admin"),
  ).toBe(true);
});

test("the two queues partition every pending request, with none in neither", async () => {
  // The falsification for the query above: a reader's pending change must be
  // exactly as absent from *this* queue as a manager's is from the shelf
  // queue (`tests/domain/members/approval-routing.test.ts`'s own "the shelf
  // queue lists only reader subjects").
  const a = await aShelfWithAManager({ slug: "dong-thap" });
  await propose(
    ctxFor(a.shelf.id, a.manager, "manager", "2026-08-13T07:00:00Z"),
    a.manager.id,
    "0912345678",
  );
  await propose(
    ctxFor(a.shelf.id, a.reader, "reader", "2026-08-13T07:30:00Z"),
    a.reader.id,
    "0900111222",
  );

  const shelfQueue = await runQuery(
    sql,
    ctxFor(a.shelf.id, a.manager, "manager", "2026-08-13T09:00:00Z"),
    (tx, c) => getPendingProfileChanges(tx, c),
  );
  const { ctx } = await superAdminContext(sql);
  const adminQueue = await runAdminQuery(sql, ctx, (tx, c) =>
    getPendingManagerChanges(tx, c),
  );

  expect(shelfQueue).toHaveLength(1);
  expect(shelfQueue[0].userId).toBe(a.reader.userId);
  expect(adminQueue).toHaveLength(1);
  expect(adminQueue[0].userId).toBe(a.manager.userId);
});

test("the queue is ordered oldest first", async () => {
  const a = await aShelfWithAManager({ slug: "dong-thap" });
  const b = await aShelfWithAManager({ slug: "thanh-tam" });

  // Proposed out of order — b before a — so a pass-through of insertion order
  // would fail this the same way a missing `order by` would.
  const laterOne = await propose(
    ctxFor(b.shelf.id, b.manager, "manager", "2026-08-13T10:00:00Z"),
    b.manager.id,
    "0987654321",
  );
  const earlierOne = await propose(
    ctxFor(a.shelf.id, a.manager, "manager", "2026-08-13T06:00:00Z"),
    a.manager.id,
    "0912345678",
  );

  const { ctx } = await superAdminContext(sql);
  const rows = await runAdminQuery(sql, ctx, (tx, c) =>
    getPendingManagerChanges(tx, c),
  );

  expect(rows.map((r) => r.profileChangeRequestId)).toEqual([
    earlierOne.profileChangeRequestId,
    laterOne.profileChangeRequestId,
  ]);
});

test("each row names its own shelf and carries what it takes to decide it", async () => {
  const a = await aShelfWithAManager({ slug: "dong-thap" });
  await propose(
    ctxFor(a.shelf.id, a.manager, "manager", "2026-08-13T07:00:00Z"),
    a.manager.id,
    "0912345678",
  );

  const { ctx } = await superAdminContext(sql);
  const [row] = await runAdminQuery(sql, ctx, (tx, c) =>
    getPendingManagerChanges(tx, c),
  );

  expect(row.shelfSlug).toBe("dong-thap");
  // `makeShelf` (`tests/support/factories.ts`) names every shelf it inserts
  // `Tủ sách <slug>` — the fact this asserts is that the name comes from the
  // `join bookshelves`, not that any particular Vietnamese string was typed.
  expect(row.shelfName).toBe("Tủ sách dong-thap");
  expect(row.bookshelfId).toBe(a.shelf.id);
  expect(row.subjectRole).toBe("manager");
  expect(row.proposedValues.phone).toBe("0912345678");
  // "Current" is live, not the snapshot — the same guarantee the shelf-side
  // query makes, exercised here because this query re-reads `users` itself
  // rather than sharing the reader-side query's implementation.
  expect(row.currentValues.phone).not.toBe("0912345678");
});

test("a subject with membership at more than one shelf is not duplicated or misattributed", async () => {
  // Fix round 1: the query used to take the shelf from `m.bookshelf_id`
  // (`join memberships m on m.user_id = r.user_id`, no shelf predicate),
  // which fans out to one row per membership a multi-shelf subject holds.
  // Multi-shelf membership is ordinary (`src/domain/admin/commands/
  // managers.ts:12-14`), not an edge case, so `a.manager` here holds three:
  // manager at shelf A (where the request is proposed), manager at shelf B,
  // and — so the bug is not merely "two manager rows" — reader at shelf C.
  const a = await aShelfWithAManager({ slug: "dong-thap" });
  const b = await aShelfWithAManager({ slug: "thanh-tam" });
  const c = await makeShelf(sql, { slug: "vinh-long" });
  await sql`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${b.shelf.id}, ${a.manager.userId}, 'manager', 'active')
  `;
  await sql`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${c.id}, ${a.manager.userId}, 'reader', 'active')
  `;

  await propose(
    ctxFor(a.shelf.id, a.manager, "manager", "2026-08-13T07:00:00Z"),
    a.manager.id,
    "0912345678",
  );

  const { ctx } = await superAdminContext(sql);
  const rows = await runAdminQuery(sql, ctx, (tx, c) =>
    getPendingManagerChanges(tx, c),
  );
  const count = await runAdminQuery(sql, ctx, (tx, c) =>
    countPendingManagerChanges(tx, c),
  );

  // Exactly one row — not one per membership — and attributed to the shelf
  // the request was actually proposed at (`r.bookshelf_id`), never to a
  // shelf the subject merely also belongs to.
  expect(rows).toHaveLength(1);
  expect(rows[0].shelfSlug).toBe("dong-thap");
  expect(rows[0].bookshelfId).toBe(a.shelf.id);
  // The badge and the queue must agree — both read the identical `where`.
  expect(count).toBe(1);
});

// ── The permission boundary, falsified on both paths ────────────────────────

test("the kernel refuses a manager the admin role, before the query ever runs", async () => {
  const { ctx } = await managerContext(sql);

  let ran = false;
  const code = await codeThrownBy(() =>
    runAdminQuery(sql, ctx, async () => {
      ran = true;
    }),
  );

  expect(code).toBe("not_permitted");
  expect(ran).toBe(false);
});

test("a manager may not read the admin queue, on the path the kernel check does not cover", async () => {
  const { ctx } = await managerContext(sql);

  const code = await codeThrownBy(() =>
    runQuery(sql, ctx, (tx, c) => getPendingManagerChanges(tx, c)),
  );

  expect(code).toBe("not_permitted");
});

test("countPendingManagerChanges matches the queue's own length, for the sidebar badge", async () => {
  const a = await aShelfWithAManager({ slug: "dong-thap" });
  const b = await aShelfWithAManager({ slug: "thanh-tam" });
  await propose(
    ctxFor(a.shelf.id, a.manager, "manager", "2026-08-13T07:00:00Z"),
    a.manager.id,
    "0912345678",
  );
  await propose(
    ctxFor(b.shelf.id, b.manager, "manager", "2026-08-13T08:00:00Z"),
    b.manager.id,
    "0987654321",
  );

  const { ctx } = await superAdminContext(sql);
  const count = await runAdminQuery(sql, ctx, (tx, c) =>
    countPendingManagerChanges(tx, c),
  );

  expect(count).toBe(2);
});

// ── The row is not just readable — a super admin can decide it ─────────────

test("a super admin approving a manager's change through this queue's own row actually applies it", async () => {
  const a = await aShelfWithAManager({ slug: "dong-thap" });
  await propose(
    ctxFor(a.shelf.id, a.manager, "manager", "2026-08-13T07:00:00Z"),
    a.manager.id,
    "0912345678",
  );

  const { ctx } = await superAdminContext(sql);
  const [row] = await runAdminQuery(sql, ctx, (tx, c) =>
    getPendingManagerChanges(tx, c),
  );

  // `bookshelfId` off the row, exactly as `/quan-tri/doi-thong-tin`'s own
  // action scopes `submitAdminCommand` — the property this test exists to
  // check is that the row carries what it takes to decide the request it
  // names, not only to display it.
  await runAdminCommand(
    sql,
    { ...ctx, bookshelfId: row.bookshelfId },
    approveProfileChange,
    { profileChangeRequestId: row.profileChangeRequestId },
  );

  const [after] = await sql<{ phone: string }[]>`
    select phone from users where id = ${a.manager.userId}
  `;
  expect(after.phone).toBe("0912345678");

  const remaining = await runAdminQuery(sql, ctx, (tx, c) =>
    getPendingManagerChanges(tx, c),
  );
  expect(remaining).toHaveLength(0);
});
