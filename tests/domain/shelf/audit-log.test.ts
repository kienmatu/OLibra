import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../../src/db/migrate";
import { addCopies } from "../../../src/domain/catalogue/commands/add-copies";
import { lendCopy } from "../../../src/domain/circulation/commands/lend-copy";
import { auditSentence } from "../../../src/domain/kernel/audit-actions";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { RuleViolated } from "../../../src/domain/kernel/errors";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runCommand, runQuery } from "../../../src/domain/kernel/unit-of-work";
import { approveMembership } from "../../../src/domain/members/commands/approve-membership";
import {
  getAuditActors,
  getAuditLog,
} from "../../../src/domain/shelf/queries/get-audit-log";
import { closeAll, resetDatabase, sql } from "../../support/db";
import { makeBookWithCopies, makeMember, makeShelf } from "../../support/factories";
import { managerContextFor } from "../../support/scenarios";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/**
 * `GetAuditLog` — OPS §3.3, BR §14.
 *
 * Every scenario below reaches `audit_log` the way the product does: by running
 * a real command through `runCommand`, never by inserting rows. An audit row
 * written by hand is a row no code path produces, and a test built on one stays
 * green against a command that stopped writing the entry at all.
 */

async function shelfWithManager(slug: string, instant?: string) {
  const shelf = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  return { shelf, manager, ctx: managerContextFor(shelf.id, manager, instant) };
}

function readerCtx(bookshelfId: string, member: { id: string; userId: string }) {
  return {
    bookshelfId,
    actor: { userId: member.userId, membershipId: member.id, role: "reader" },
    clock: fixedClock("2026-08-07T10:00:00Z"),
  } as const satisfies TenantContext;
}

test("a reader cannot read the audit log", async () => {
  // BR §13.3 and OPS §3.3's `manager` column. The page's own 404 is the second
  // half; this is the half that holds when somebody calls the query directly.
  const { shelf } = await shelfWithManager("dong-thap");
  const reader = await makeMember(sql, shelf.id);

  await expect(
    runQuery(sql, readerCtx(shelf.id, reader), (tx, ctx) =>
      getAuditLog(tx, ctx, {}),
    ),
  ).rejects.toThrow(RuleViolated);

  await expect(
    runQuery(sql, readerCtx(shelf.id, reader), getAuditActors),
  ).rejects.toThrow(RuleViolated);
});

test("a manager of one shelf sees nothing of another's", async () => {
  // INV-10, through RLS rather than through a `where` this query does not have.
  const a = await shelfWithManager("dong-thap");
  const b = await shelfWithManager("vinh-long");

  const bookB = await makeBookWithCopies(sql, b.shelf.id, 1);
  const readerB = await makeMember(sql, b.shelf.id);
  await runCommand(sql, b.ctx, lendCopy, {
    copyId: bookB.copyIds[0],
    membershipId: readerB.id,
  });

  // The positive control, before the two empty assertions below it. `lendCopy`
  // writing no audit row at all would satisfy "Đồng Tháp sees nothing" perfectly
  // — the degenerate-fixture shape U3 shipped — so Vĩnh Long's own manager is
  // asked first and has to see the entry.
  const theirs = await runQuery(sql, b.ctx, (tx, ctx) => getAuditLog(tx, ctx, {}));
  expect(theirs.total).toBe(1);
  expect(theirs.rows[0].action).toBe("loan.created");

  const page = await runQuery(sql, a.ctx, (tx, ctx) => getAuditLog(tx, ctx, {}));
  expect(page.rows).toEqual([]);
  expect(page.total).toBe(0);

  // And naming the other shelf's actor explicitly does not widen it. `users`
  // has no RLS, so this is the assertion that the scoping comes from the
  // `audit_log` join and not from the caller.
  const named = await runQuery(sql, a.ctx, (tx, ctx) =>
    getAuditLog(tx, ctx, { actorId: b.manager.userId }),
  );
  expect(named.rows).toEqual([]);
});

test("an entry renders BR §14's sentence out of what it stored", async () => {
  const { shelf, ctx, manager } = await shelfWithManager(
    "dong-thap",
    "2026-08-03T07:32:00Z", // 14:32 in Ho Chi Minh City
  );
  await sql`update users set full_name = 'Maria Lan' where id = ${manager.userId}`;
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  await sql`update books set title = 'Dế Mèn Phiêu Lưu Ký' where id = ${bookId}`;
  const reader = await makeMember(sql, shelf.id);
  await sql`update users set full_name = 'Giuse Minh' where id = ${reader.userId}`;

  await runCommand(sql, ctx, lendCopy, {
    copyId: copyIds[0],
    membershipId: reader.id,
  });

  const page = await runQuery(sql, ctx, (tx, c) => getAuditLog(tx, c, {}));
  expect(page.rows).toHaveLength(1);

  expect(
    auditSentence(page.rows[0].action, page.rows[0].facts, {
      time: "14:32",
      date: "03/08/2026",
    }),
  ).toBe(
    "Maria Lan đã cho Giuse Minh mượn Dế Mèn Phiêu Lưu Ký lúc 14:32 ngày 03/08/2026",
  );

  // The expansion shows the stored values, not a re-derivation.
  expect(page.rows[0].facts.before).toEqual({ copy_state: "available" });
  expect(page.rows[0].facts.after).toMatchObject({ copy_state: "on_loan" });
});

test("the sentence does not change when the book and the people are renamed", async () => {
  // P1 §3.2, in the one direction that tells the two rules apart.
  //
  // The **title** is a stored value and must not move: the entry says what was
  // handed over that day. The **names** are references and must move: an audit
  // trail whose actor is called by a name nobody uses any more cannot answer BR
  // §14's "who has been touching whose account".
  const { shelf, ctx, manager } = await shelfWithManager("dong-thap");
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  await sql`update books set title = 'Dế Mèn Phiêu Lưu Ký' where id = ${bookId}`;
  const reader = await makeMember(sql, shelf.id);

  await runCommand(sql, ctx, lendCopy, {
    copyId: copyIds[0],
    membershipId: reader.id,
  });

  await sql`update books set title = 'Một tên hoàn toàn khác' where id = ${bookId}`;
  await sql`update users set full_name = 'Maria Nguyễn Thị Lan' where id = ${manager.userId}`;
  await sql`update users set full_name = 'Giuse Trần Minh' where id = ${reader.userId}`;

  const page = await runQuery(sql, ctx, (tx, c) => getAuditLog(tx, c, {}));
  const sentence = auditSentence(page.rows[0].action, page.rows[0].facts, {
    time: "14:32",
    date: "03/08/2026",
  });

  expect(sentence).toContain("Dế Mèn Phiêu Lưu Ký");
  expect(sentence).not.toContain("Một tên hoàn toàn khác");
  expect(sentence).toContain("Maria Nguyễn Thị Lan");
  expect(sentence).toContain("Giuse Trần Minh");
});

test("a subject is resolved for a membership entry too", async () => {
  const { shelf, ctx } = await shelfWithManager("dong-thap");
  const applicant = await makeMember(sql, shelf.id, { status: "pending" });
  await sql`update users set full_name = 'Anna Phạm Thu Hà' where id = ${applicant.userId}`;

  await runCommand(sql, ctx, approveMembership, {
    membershipId: applicant.id,
  });

  const page = await runQuery(sql, ctx, (tx, c) => getAuditLog(tx, c, {}));
  const entry = page.rows.find((r) => r.action === "membership.approved");
  expect(entry?.facts.subject).toBe("Anna Phạm Thu Hà");
});

test("a soft-deleted person keeps their name in the log", async () => {
  // The deliberate difference from every list query in this codebase. INV-12
  // makes these rows immutable so that "who did this" keeps its answer; a name
  // that quietly becomes "Hệ thống" because somebody left the parish is that
  // guarantee failing without a test failing with it.
  const { shelf, ctx, manager } = await shelfWithManager("dong-thap");
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);
  await sql`update users set full_name = 'Maria Lan' where id = ${manager.userId}`;

  await runCommand(sql, ctx, lendCopy, {
    copyId: copyIds[0],
    membershipId: reader.id,
  });
  await sql`update users set deleted_at = now() where id = ${manager.userId}`;

  const page = await runQuery(sql, ctx, (tx, c) => getAuditLog(tx, c, {}));
  expect(page.rows[0].facts.actor).toBe("Maria Lan");
});

/**
 * The tiebreak, and the three fixtures that did **not** show its absence.
 *
 * U3's warning applies here exactly — "a tiebreak *test* can be green in the
 * broken state" — and this file is where it was measured rather than repeated.
 * With `, a.id desc` deleted from `getAuditLog`'s `order by`, all three of
 * these walked 320 entries and collected 320 distinct ones:
 *
 * 1. 90 entries at one instant, pageSize 7.
 * 2. 320 entries across 40 instants, `analyze`d, pageSize 7.
 * 3. The same, walked twice under different planner settings.
 *
 * The reason is worth writing down, because it is why the obvious test is
 * worthless: a `Limit → Sort → Seq Scan` over a table nothing is touching
 * produces the *same* arbitrary tie order on every page, because the sort's
 * input — physical order — is the same every time. Each page is wrong in a way
 * that happens to agree with every other page. Postgres also short-circuits a
 * fully-tied sort as already-sorted, so an all-equal fixture is the worst of
 * the three.
 *
 * **What a paged walk actually is, and what this test does instead.** The
 * thirteen queries are thirteen separate requests, minutes apart, made by a
 * volunteer clicking "Sau". Between any two of them the physical order can move
 * — an autovacuum, a HOT update, a plan flip on new statistics — and *that* is
 * when an order with no unique final key stops agreeing with itself. `cluster`
 * is a deterministic stand-in for a non-deterministic fact of life, not a
 * contrivance to make a point: the point is that the query's answer must not
 * depend on where the rows happen to be on disk.
 *
 * Measured: without the tiebreak, this collects **320 rows of which 263 are
 * distinct** — 57 entries a manager can never reach, no error anywhere. It is
 * U2's 304→229 on the catalogue, on a query nobody had connected to it.
 */
test("a paged walk loses no entry when the storage order moves under it", async () => {
  const { shelf, ctx, manager } = await shelfWithManager("dong-thap");
  const { bookId } = await makeBookWithCopies(sql, shelf.id, 1);

  // 320 entries over 40 instants — eight sharing each. Non-degenerate in both
  // directions: the key really ties, and it is not *only* ties, so the sort
  // does real work rather than taking its presorted short-circuit. Each batch
  // is one `addCopies`, which is how a multi-entry command writes in
  // production: one clock, one instant, one row per copy.
  for (let i = 0; i < 40; i++) {
    const at = new Date(Date.UTC(2026, 7, 7, 10, 0, i)).toISOString();
    await runCommand(sql, managerContextFor(shelf.id, manager, at), addCopies, {
      bookId,
      count: 8,
    });
  }
  await sql`analyze audit_log`;

  const [{ instants }] = await sql<{ instants: number }[]>`
    select count(distinct occurred_at)::int as instants from audit_log
  `;
  expect(instants).toBe(40);

  const pageSize = 7;
  const first = await runQuery(sql, ctx, (tx, c) =>
    getAuditLog(tx, c, { pageSize, page: 1 }),
  );
  expect(first.total).toBe(320);

  const seen: string[] = [];
  for (let page = 1; page <= first.pageCount; page++) {
    // The physical order moves between pages, exactly as it does between two
    // clicks on a live shelf. Alternating between two indexes so no single
    // layout is being tested against itself.
    await sql.unsafe(
      `cluster audit_log using ${page % 2 ? "audit_log_entity" : "audit_log_actor"}`,
    );
    const result = await runQuery(sql, ctx, (tx, c) =>
      getAuditLog(tx, c, { pageSize, page }),
    );
    seen.push(...result.rows.map((r) => r.id));
  }

  expect(seen).toHaveLength(320);
  expect(new Set(seen).size).toBe(320);
});

test("the actor filter answers 'what has this manager been doing'", async () => {
  const { shelf, ctx, manager } = await shelfWithManager("dong-thap");
  const other = await makeMember(sql, shelf.id, { role: "manager" });
  const otherCtx = managerContextFor(shelf.id, other);

  const one = await makeBookWithCopies(sql, shelf.id, 1);
  const two = await makeBookWithCopies(sql, shelf.id, 1);
  const readerA = await makeMember(sql, shelf.id);
  const readerB = await makeMember(sql, shelf.id);

  await runCommand(sql, ctx, lendCopy, {
    copyId: one.copyIds[0],
    membershipId: readerA.id,
  });
  await runCommand(sql, otherCtx, lendCopy, {
    copyId: two.copyIds[0],
    membershipId: readerB.id,
  });

  const mine = await runQuery(sql, ctx, (tx, c) =>
    getAuditLog(tx, c, { actorId: manager.userId }),
  );
  expect(mine.total).toBe(1);
  expect(mine.rows[0].entityId).toBeTruthy();

  const actors = await runQuery(sql, ctx, getAuditActors);
  expect(actors.map((a) => a.userId).sort()).toEqual(
    [manager.userId, other.userId].sort(),
  );
  expect(actors.every((a) => a.entries === 1)).toBe(true);
});

test("the group filter is the action set, not a prefix", async () => {
  const { shelf, ctx } = await shelfWithManager("dong-thap");
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);
  await runCommand(sql, ctx, addCopies, { bookId, count: 2 });
  await runCommand(sql, ctx, lendCopy, {
    copyId: copyIds[0],
    membershipId: reader.id,
  });

  const books = await runQuery(sql, ctx, (tx, c) =>
    getAuditLog(tx, c, { group: "sach" }),
  );
  expect(books.rows.map((r) => r.action)).toEqual(["copy.added", "copy.added"]);

  const loans = await runQuery(sql, ctx, (tx, c) =>
    getAuditLog(tx, c, { group: "muon-tra" }),
  );
  expect(loans.rows.map((r) => r.action)).toEqual(["loan.created"]);

  const readers = await runQuery(sql, ctx, (tx, c) =>
    getAuditLog(tx, c, { group: "nguoi-doc" }),
  );
  expect(readers.rows).toEqual([]);
});

test("the date range is inclusive of both days, read in Ho Chi Minh City", async () => {
  // The trap this is written for: 03/08 in Vietnam begins at 17:00 UTC on the
  // 2nd and ends at 17:00 UTC on the 3rd. An entry written at 23:30 local on
  // the 3rd is `2026-08-03T16:30:00Z`, and a naive `occurred_at::date` bound in
  // UTC would file it under the 3rd correctly — while an entry at 00:30 local
  // on the 3rd (`2026-08-02T17:30:00Z`) would be filed under the 2nd and vanish
  // from a range asking for the 3rd alone.
  const { shelf, ctx } = await shelfWithManager("dong-thap");
  const early = managerContextFor(
    shelf.id,
    { id: ctx.actor.membershipId!, userId: ctx.actor.userId! },
    "2026-08-02T17:30:00Z", // 00:30 on 03/08, local
  );
  const late = managerContextFor(
    shelf.id,
    { id: ctx.actor.membershipId!, userId: ctx.actor.userId! },
    "2026-08-03T16:30:00Z", // 23:30 on 03/08, local
  );
  const before = managerContextFor(
    shelf.id,
    { id: ctx.actor.membershipId!, userId: ctx.actor.userId! },
    "2026-08-02T16:30:00Z", // 23:30 on 02/08, local
  );

  const { bookId } = await makeBookWithCopies(sql, shelf.id, 1);
  for (const c of [before, early, late]) {
    await runCommand(sql, c, addCopies, { bookId, count: 1 });
  }

  const onTheThird = await runQuery(sql, ctx, (tx, c) =>
    getAuditLog(tx, c, { from: "2026-08-03", to: "2026-08-03" }),
  );
  expect(onTheThird.total).toBe(2);

  const both = await runQuery(sql, ctx, (tx, c) =>
    getAuditLog(tx, c, { from: "2026-08-02", to: "2026-08-03" }),
  );
  expect(both.total).toBe(3);

  const neither = await runQuery(sql, ctx, (tx, c) =>
    getAuditLog(tx, c, { from: "2026-08-04", to: "2026-08-05" }),
  );
  expect(neither.total).toBe(0);
});

test("a payload naming no uuid does not reach Postgres as a cast", async () => {
  // The `~` guard in the subject join. `after->>'borrower_id'` is whatever a
  // command serialised, and a bare `::uuid` on a non-uuid string is a raw 22P02
  // from inside the transaction — the unstructured exception OPS §2 forbids.
  // `copy.added` stores `acquiredFrom`, a donor's *name*, in the same payload
  // shape, so this is not a hypothetical row.
  //
  // Written through `runCommand` with a hand-built entry rather than by
  // `update audit_log` — INV-12's trigger refuses that outright ("rows in
  // audit_log cannot be updated directly"), which is the point of INV-12 and
  // is itself worth knowing when writing a test against this table.
  const { shelf, ctx } = await shelfWithManager("dong-thap");
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  await runCommand(
    sql,
    ctx,
    async () => ({
      result: null,
      audit: {
        action: "copy.added" as const,
        entityType: "copy",
        entityId: copyIds[0],
        after: { code: "DT-0001", borrower_id: "khong-phai-uuid" },
      },
    }),
    {},
  );

  const page = await runQuery(sql, ctx, (tx, c) => getAuditLog(tx, c, {}));
  expect(page.rows).toHaveLength(1);
  expect(page.rows[0].facts.subject).toBeNull();
});
