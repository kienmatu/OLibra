import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { hashPassword } from "../../../src/auth/password";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { NotFound, RuleViolated } from "../../../src/domain/kernel/errors";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runQuery } from "../../../src/domain/kernel/unit-of-work";
import { getPendingRegistrations } from "../../../src/domain/members/queries/get-pending-registrations";
import { getReaderDetail } from "../../../src/domain/members/queries/get-reader-detail";
import { getReadersList } from "../../../src/domain/members/queries/get-readers-list";
import { searchReadersForLending } from "../../../src/domain/members/queries/search-readers-for-lending";
import { migrate } from "../../../src/db/migrate";
import {
  makeBookWithCopies,
  makeMember,
  makeParishUnits,
  makePerson,
  makeShelf,
} from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-08T03:00:00Z");

async function shelfWithReaders(slug = "dong-thap") {
  const shelf = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const ids = await makeParishUnits(
    sql,
    shelf.id,
    { levels: 2, nested: true, level1Label: "Giáo họ", level2Label: "Tổ" },
    [
      { level: 1, name: "Thánh Tâm", sortOrder: 1 },
      { level: 2, name: "Tổ 3", parentName: "Thánh Tâm", sortOrder: 3 },
    ],
  );
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  return { shelf, manager, ctx, ids };
}

async function reader(
  shelfId: string,
  over: {
    fullName?: string;
    status?: string;
    l1?: string | null;
    l2?: string | null;
  } = {},
) {
  const user = await makePerson(sql, { fullName: over.fullName });
  // memberships_rejected_has_reason (verified live) requires a reason
  // whenever status = 'rejected' -- same fixture note factories.ts's
  // makeMember carries, since this helper varies status the same way.
  const rejectionReason =
    (over.status ?? "active") === "rejected" ? "lý do khởi tạo cho kiểm thử" : null;
  const [row] = await sql<{ id: string }[]>`
    insert into memberships
      (bookshelf_id, user_id, status, parish_unit_l1_id, parish_unit_l2_id, rejection_reason)
    values (${shelfId}, ${user.id}, ${over.status ?? "active"},
            ${over.l1 ?? null}, ${over.l2 ?? null}, ${rejectionReason})
    returning id
  `;
  return { id: row.id, userId: user.id };
}

async function lend(
  shelfId: string,
  borrowerId: string,
  lentBy: string,
  dueOn: string,
) {
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelfId, 1);
  const [loan] = await sql<{ id: string }[]>`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on)
    values (${shelfId}, ${copyIds[0]}, ${bookId}, ${borrowerId}, ${lentBy},
            ${dueOn}::date)
    returning id
  `;
  await sql`update book_copies set state = 'on_loan' where id = ${copyIds[0]}`;
  return loan.id;
}

// — GetReadersList —

test("a reader's parish line uses the shelf's own labels, never a hard-coded word", async () => {
  // BR §16.3: "the shelf's own label for the level and the unit's own name,
  // never the words "Tổ" or "Giáo họ" written into the screen itself."
  const { ctx, shelf, ids } = await shelfWithReaders();
  await reader(shelf.id, {
    fullName: "Trần Minh",
    l1: ids.get("Thánh Tâm")!,
    l2: ids.get("Tổ 3")!,
  });
  const page = await runQuery(sql, ctx, (tx, c) => getReadersList(tx, c, {}));
  const row = page.rows.find((r) => r.fullName === "Trần Minh")!;
  expect(row.parishLine).toBe("Tổ 3 · Thánh Tâm");
  expect(row.parishUnitL1Name).toBe("Thánh Tâm");
  // The word a filter header labels itself with, carried rather than assumed.
  expect(page.taxonomy.level1Label).toBe("Giáo họ");
});

test("holdingCount is derived on read, and moves with no command in between", async () => {
  // G5, BR §8: "Overdue status, hold expiry, and book availability are
  // computed on read, from stored data and the current clock." A test that
  // re-ran a command would pass against a stored counter too.
  const { ctx, shelf, manager } = await shelfWithReaders();
  const r = await reader(shelf.id, { fullName: "Trần Minh" });
  const read = async () =>
    (await runQuery(sql, ctx, (tx, c) => getReadersList(tx, c, {}))).rows.find(
      (x) => x.membershipId === r.id,
    )!.holdingCount;

  expect(await read()).toBe(0);
  const loanId = await lend(shelf.id, r.userId, manager.userId, "2026-08-22");
  expect(await read()).toBe(1);
  // loans_returned_has_condition requires a condition whenever status is
  // 'returned' -- membership-lifecycle.test.ts's fixture carries the same.
  await sql`update loans set status = 'returned', returned_at = now(), return_condition = 'perfect' where id = ${loanId}`;
  expect(await read()).toBe(0);
});

test("the parish-unit filter narrows, at either level", async () => {
  // OPS §3.3 calls this "the payoff a text field could never give"; BR §16.3
  // says the same in its own words — "the filter free text could never
  // support (§5.3), and the reason the unit reference exists at all".
  const { ctx, shelf, ids } = await shelfWithReaders();
  await reader(shelf.id, {
    fullName: "Trong Tổ",
    l1: ids.get("Thánh Tâm")!,
    l2: ids.get("Tổ 3")!,
  });
  await reader(shelf.id, { fullName: "Ngoài Tổ" });

  const byL1 = await runQuery(sql, ctx, (tx, c) =>
    getReadersList(tx, c, { parishUnitId: ids.get("Thánh Tâm")! }),
  );
  expect(byL1.rows.map((r) => r.fullName)).toEqual(["Trong Tổ"]);

  const byL2 = await runQuery(sql, ctx, (tx, c) =>
    getReadersList(tx, c, { parishUnitId: ids.get("Tổ 3")! }),
  );
  expect(byL2.rows.map((r) => r.fullName)).toEqual(["Trong Tổ"]);
});

test("the status filter narrows too", async () => {
  const { ctx, shelf } = await shelfWithReaders();
  await reader(shelf.id, { fullName: "Đang chờ", status: "pending" });
  await reader(shelf.id, { fullName: "Đang hoạt động", status: "active" });
  const page = await runQuery(sql, ctx, (tx, c) =>
    getReadersList(tx, c, { status: "pending" }),
  );
  expect(page.rows.map((r) => r.fullName)).toEqual(["Đang chờ"]);
  expect(page.total).toBe(1);
});

test("the name filter is diacritic-insensitive and refuses a garbage query", async () => {
  // The second half is B1's M7, relearned: olibra_fold reduces a query of pure
  // punctuation to '', which without the guard degenerates the LIKE pattern to
  // matching every reader.
  const { ctx, shelf } = await shelfWithReaders();
  await reader(shelf.id, { fullName: "Trần Minh" });
  await reader(shelf.id, { fullName: "Nguyễn Lan" });

  const found = await runQuery(sql, ctx, (tx, c) =>
    getReadersList(tx, c, { q: "tran minh" }),
  );
  expect(found.rows.map((r) => r.fullName)).toEqual(["Trần Minh"]);

  const garbage = await runQuery(sql, ctx, (tx, c) =>
    getReadersList(tx, c, { q: "%" }),
  );
  expect(garbage.rows).toHaveLength(0);
});

test("the roster sorts by name in Vietnamese, not in byte order", async () => {
  // U3 wave 1's reconciliation: this query shipped `order by u.full_name`,
  // which under this cluster's `C` collation is byte order — `Đ` begins 0xC4,
  // above every ASCII letter, so every child called Đặng sorted after every
  // child called Vũ. The same defect U2 fixed in the two catalogue queries and
  // in getBooksList, on a fourth query nobody had connected to them.
  const { ctx, shelf } = await shelfWithReaders();
  for (const fullName of ["Vũ Bảo", "Đặng Minh", "An Nhiên"]) {
    await reader(shelf.id, { fullName });
  }

  const page = await runQuery(sql, ctx, (tx, c) => getReadersList(tx, c, {}));

  expect(page.rows.map((r) => r.fullName)).toEqual([
    "An Nhiên",
    "Đặng Minh",
    // The shelf's manager, made by `makeMember` as "Người đọc <n>".
    expect.stringContaining("Người đọc"),
    "Vũ Bảo",
  ]);
});

/**
 * Namesakes in the paging fixture below, and why it is this many.
 *
 * The fixture shipped as eight namesakes walked three at a time, and at that
 * size the guard cannot fail: deleting `m.id` from the `order by` leaves it
 * green. Postgres answers a small `limit`/`offset` with a bounded top-N
 * heapsort, and over nine rows in pages of three the heap happens to hand back
 * a consistent order across the three pages — there are not enough rows for the
 * per-page heaps to disagree about where a tie belongs.
 *
 * Measured on this cluster with `m.id` deleted, rows lost off the roster
 * entirely:
 *
 * | namesakes | pageSize | collected | distinct | lost |
 * |---|---|---|---|---|
 * | 8   | 3 | 10  | 10  | 0    |
 * | 40  | 7 | 41  | 40  | 1    |
 * | 80  | 7 | 81  | 75  | 5–7  |
 * | 120 | 7 | 121 | 111 | 9–11 |
 *
 * Eighty is the first size with a margin rather than a coincidence: twenty
 * consecutive trials lost between five and seven readers and none lost zero,
 * where forty sat on a single row and would go green the first time the heap
 * broke a tie the other way. It costs about a tenth of a second.
 *
 * This is not a hypothetical size, either. BR §5.3 requires parents' names
 * precisely because a parish can have this many children sharing a name
 * variant, and a roster that silently drops six of them puts those six on no
 * page at all.
 */
const PAGING_NAMESAKES = 80;
const PAGING_PAGE_SIZE = 7;

test("paging the roster never loses a reader, however alike the names", async () => {
  // The other half, and the one that is invisible until somebody pages: two
  // children called "Nguyễn Văn An" is the ordinary case (BR §5.3 requires
  // parents' names precisely to tell them apart), so `full_name` is not a
  // total order and `limit`/`offset` over it repeats some rows and drops
  // others. U2 measured 304 titles collected over a paged walk and 229
  // distinct. `m.id` ends the order so it cannot tie.
  //
  // See `PAGING_NAMESAKES` above for why the fixture is eighty rather than the
  // eight it shipped as. Falsified by deleting `m.id` from the `order by`: red
  // on every run, in this file and in isolation.
  const { ctx, shelf } = await shelfWithReaders();
  for (let i = 0; i < PAGING_NAMESAKES; i++) {
    await reader(shelf.id, { fullName: "Nguyễn Văn An" });
  }

  // The namesakes plus the shelf's own manager.
  const total = PAGING_NAMESAKES + 1;
  const pages = Math.ceil(total / PAGING_PAGE_SIZE);

  const seen: string[] = [];
  for (let page = 1; page <= pages; page++) {
    const result = await runQuery(sql, ctx, (tx, c) =>
      getReadersList(tx, c, { page, pageSize: PAGING_PAGE_SIZE }),
    );
    seen.push(...result.rows.map((r) => r.membershipId));
  }

  // Every reader exactly once: none repeated onto a second page, and — the
  // failure that matters — none dropped off the roster altogether.
  expect(seen).toHaveLength(total);
  expect(new Set(seen).size).toBe(total);
});

// — GetReaderDetail —

// BR:126 (§4, assumption 5) is the rule that makes these four manager-only:
// "Date of birth, parents' names, phone number, and parish-unit placement
// (§5.6) remain visible only to managers and administrators." §5.3 defines
// where the fields live, which is a different claim.
test("the detail carries the manager-only fields BR §4 names", async () => {
  const { ctx, shelf, ids } = await shelfWithReaders();
  const r = await reader(shelf.id, {
    fullName: "Trần Minh",
    l1: ids.get("Thánh Tâm")!,
    l2: ids.get("Tổ 3")!,
  });
  const detail = await runQuery(sql, ctx, (tx, c) =>
    getReaderDetail(tx, c, { membershipId: r.id }),
  );
  expect(detail.dateOfBirth).toBe("2015-04-02");
  expect(detail.fatherName).toBe("Giuse Trần Văn A");
  expect(detail.motherName).toBe("Maria Nguyễn Thị B");
  expect(detail.phone).not.toBeNull();
  expect(detail.parishLine).toBe("Tổ 3 · Thánh Tâm");
});

test("days remaining and overdue are read from the view, never recomputed here", async () => {
  // G5, through loans_current's own derived columns. This test moves `due_on`
  // rather than the clock, and that is now a choice rather than the only
  // option: it is asserting that `GetReaderDetail` *reads* the view instead of
  // recomputing overdue in TypeScript, which a `due_on` move demonstrates as
  // well as a clock move and with less machinery.
  //
  // The comment that used to sit here said the view computed both columns from
  // SQL `now()` and that the injected Clock could not move them, calling it a
  // real limitation for C1/C2 to inherit. That is no longer true:
  // `20260808_14_olibra_now.sql` replaced `now()` with `olibra_now()`, which
  // reads the `olibra.now` GUC that `unit-of-work.ts` sets from `ctx.clock` on
  // every command and every scoped query. `tests/db/sql-clock.test.ts` moves
  // the clock and nothing else.
  const { ctx, shelf, manager } = await shelfWithReaders();
  const r = await reader(shelf.id, { fullName: "Trần Minh" });
  const loanId = await lend(shelf.id, r.userId, manager.userId, "2999-01-01");

  const before = await runQuery(sql, ctx, (tx, c) =>
    getReaderDetail(tx, c, { membershipId: r.id }),
  );
  expect(before.currentLoans[0].isOverdue).toBe(false);
  expect(before.currentLoans[0].daysRemaining).toBeGreaterThan(0);

  await sql`update loans set due_on = date '2000-01-01' where id = ${loanId}`;

  const after = await runQuery(sql, ctx, (tx, c) =>
    getReaderDetail(tx, c, { membershipId: r.id }),
  );
  expect(after.currentLoans[0].isOverdue).toBe(true);
  expect(after.currentLoans[0].daysRemaining).toBeLessThan(0);
  // Derived, not stored: nothing was written to say "overdue".
  const [{ count }] = await sql<
    { count: string }[]
  >`select count(*) from audit_log`;
  expect(Number(count)).toBe(0);
});

test("the detail never carries a password hash", async () => {
  // BR §14's rule is about the audit log, but a screen is no better a place
  // for a hash. `hasCredentials` is the boolean a manager actually needs —
  // "does this account have sign-in details" — and is what the reader-detail
  // screen's "Đặt lại mật khẩu" button reads.
  const { ctx, shelf } = await shelfWithReaders();
  const user = await makePerson(sql, {
    fullName: "Có mật khẩu",
    username: "tranminh",
    passwordHash: await hashPassword("matkhau123"),
  });
  const [m] = await sql<{ id: string }[]>`
    insert into memberships (bookshelf_id, user_id, status)
    values (${shelf.id}, ${user.id}, 'active') returning id
  `;
  const detail = await runQuery(sql, ctx, (tx, c) =>
    getReaderDetail(tx, c, { membershipId: m.id }),
  );
  expect(detail.hasCredentials).toBe(true);
  expect(JSON.stringify(detail)).not.toContain("$argon2id$");
});

// — GetPendingRegistrations —

test("a near-duplicate name is flagged for the manager, and never acted on", async () => {
  // BR §16.3: "A similar-name warning appears when an existing member closely
  // matches, to catch duplicate registrations." A warning to a human — this
  // slice merges, links and rejects nothing on the strength of it.
  const { ctx, shelf } = await shelfWithReaders();
  const existing = await reader(shelf.id, {
    fullName: "Trần Minh",
    status: "active",
  });
  await reader(shelf.id, { fullName: "Tran Minh Duc", status: "pending" });

  const [row] = await runQuery(sql, ctx, (tx, c) => getPendingRegistrations(tx, c));
  expect(row.fullName).toBe("Tran Minh Duc");
  expect(row.similarTo?.membershipId).toBe(existing.id);
  expect(row.similarTo!.similarity).toBeGreaterThanOrEqual(0.6);
  // The pending row is still pending: a warning changes nothing.
  expect(row.status).toBe("pending");
});

test("an unrelated name gets no warning", async () => {
  const { ctx, shelf } = await shelfWithReaders();
  await reader(shelf.id, { fullName: "Trần Minh", status: "active" });
  await reader(shelf.id, { fullName: "Nguyễn Thị Lan", status: "pending" });
  const [row] = await runQuery(sql, ctx, (tx, c) => getPendingRegistrations(tx, c));
  expect(row.similarTo).toBeNull();
});

test("only pending applications appear in the queue", async () => {
  const { ctx, shelf } = await shelfWithReaders();
  await reader(shelf.id, { fullName: "Đã duyệt", status: "active" });
  await reader(shelf.id, { fullName: "Đã từ chối", status: "rejected" });
  const rows = await runQuery(sql, ctx, (tx, c) => getPendingRegistrations(tx, c));
  expect(rows).toHaveLength(0);
});

// — SearchReadersForLending —

test("a blocked reader is listed with the reason, not filtered away", async () => {
  // BR §16.3: blocking conditions "surface as a clear message *before* the
  // confirm step, never as an error afterwards." A reader who silently
  // vanished from the results teaches the volunteer nothing — this is the
  // assertion that catches an implementation which filters instead of flags.
  const { ctx, shelf, manager } = await shelfWithReaders();
  const ok = await reader(shelf.id, { fullName: "Trần Minh" });
  const suspended = await reader(shelf.id, {
    fullName: "Trần Lan",
    status: "suspended",
  });
  const atLimit = await reader(shelf.id, { fullName: "Trần Hoa" });
  for (const due of ["2026-08-22", "2026-08-23", "2026-08-24"]) {
    await lend(shelf.id, atLimit.userId, manager.userId, due);
  }

  const rows = await runQuery(sql, ctx, (tx, c) =>
    searchReadersForLending(tx, c, { q: "tran", maxConcurrentLoans: 3 }),
  );
  const by = (id: string) => rows.find((r) => r.membershipId === id)!;

  expect(rows).toHaveLength(3); // all three present, none filtered out
  expect(by(ok.id).block).toEqual({ blocked: false });
  expect(by(suspended.id).block).toEqual({
    blocked: true,
    reason: "membership_not_active",
  });
  expect(by(atLimit.id).block).toEqual({
    blocked: true,
    reason: "loan_limit_reached",
  });
  expect(by(atLimit.id).activeLoans).toBe(3);
});

test("the loan limit is the shelf's, not a constant", async () => {
  // BR §5.5: max_concurrent_loans is per-shelf configuration. The caller
  // passes it, so this query is not a second place that knows where settings
  // live.
  const { ctx, shelf, manager } = await shelfWithReaders();
  const r = await reader(shelf.id, { fullName: "Trần Hoa" });
  for (const due of ["2026-08-22", "2026-08-23", "2026-08-24"]) {
    await lend(shelf.id, r.userId, manager.userId, due);
  }
  const rows = await runQuery(sql, ctx, (tx, c) =>
    searchReadersForLending(tx, c, { q: "tran", maxConcurrentLoans: 5 }),
  );
  expect(rows[0].block).toEqual({ blocked: false });
});

// — scoping and roles, across all four —

test("INV-10: a manager of one shelf sees none of another shelf's readers", async () => {
  const a = await shelfWithReaders("dong-thap");
  const b = await shelfWithReaders("can-tho");
  const hidden = await reader(a.shelf.id, {
    fullName: "Trần Minh",
    status: "pending",
  });

  const list = await runQuery(sql, b.ctx, (tx, c) => getReadersList(tx, c, {}));
  expect(list.rows.some((r) => r.membershipId === hidden.id)).toBe(false);

  const queue = await runQuery(sql, b.ctx, (tx, c) =>
    getPendingRegistrations(tx, c),
  );
  expect(queue).toHaveLength(0);

  const lendable = await runQuery(sql, b.ctx, (tx, c) =>
    searchReadersForLending(tx, c, { q: "tran", maxConcurrentLoans: 3 }),
  );
  expect(lendable).toHaveLength(0);

  await expect(
    runQuery(sql, b.ctx, (tx, c) =>
      getReaderDetail(tx, c, { membershipId: hidden.id }),
    ),
  ).rejects.toBeInstanceOf(NotFound);
});

test("a reader cannot call any of the four", async () => {
  // BR §13.3. These carry the manager-only fields of every child on the shelf,
  // so the gate is the point, not a formality.
  const { shelf } = await shelfWithReaders();
  const r = await reader(shelf.id, { fullName: "Trần Minh" });
  const readerCtx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: r.userId, membershipId: r.id, role: "reader" },
    clock,
  };
  await expect(
    runQuery(sql, readerCtx, (tx, c) => getReadersList(tx, c, {})),
  ).rejects.toBeInstanceOf(RuleViolated);
  await expect(
    runQuery(sql, readerCtx, (tx, c) => getPendingRegistrations(tx, c)),
  ).rejects.toBeInstanceOf(RuleViolated);
  await expect(
    runQuery(sql, readerCtx, (tx, c) =>
      searchReadersForLending(tx, c, { q: "tran", maxConcurrentLoans: 3 }),
    ),
  ).rejects.toBeInstanceOf(RuleViolated);
  await expect(
    runQuery(sql, readerCtx, (tx, c) =>
      getReaderDetail(tx, c, { membershipId: r.id }),
    ),
  ).rejects.toBeInstanceOf(RuleViolated);
});
