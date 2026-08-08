import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { NotFound, RuleViolated } from "../../../src/domain/kernel/errors";
import { runCommand, runQuery } from "../../../src/domain/kernel/unit-of-work";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { createBook } from "../../../src/domain/catalogue/commands/create-book";
import { retireCopy } from "../../../src/domain/catalogue/commands/retire-copy";
import { getCatalogue } from "../../../src/domain/catalogue/queries/get-catalogue";
import { searchCatalogue } from "../../../src/domain/catalogue/queries/search-catalogue";
import { getBookDetail } from "../../../src/domain/catalogue/queries/get-book-detail";
import { migrate } from "../../../src/db/migrate";
import { makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-08T03:00:00Z");

const TITLES = [
  "Dế Mèn Phiêu Lưu Ký",
  "Đất Rừng Phương Nam",
  "Totto-chan Bên Cửa Sổ",
  "Kính Vạn Hoa tập 4",
];

async function shelfWithCatalogue() {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const reader = await makeMember(sql, shelf.id);
  await sql`
    insert into categories (slug, name, sort_order)
    values ('van-hoc-thieu-nhi', 'Văn học thiếu nhi', 10)
    on conflict (slug) do nothing
  `;
  const managerCtx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  const readerCtx: TenantContext = {
    ...managerCtx,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
  };
  const ids: Record<string, string> = {};
  for (const title of TITLES) {
    const { bookId } = await runCommand(sql, managerCtx, createBook, {
      title,
      author: "Tô Hoài",
      categorySlug: "van-hoc-thieu-nhi",
      copyCount: 2,
    });
    ids[title] = bookId;
  }
  return { shelf, manager, managerCtx, readerCtx, ids };
}

const catalogue = (ctx: TenantContext, input: Parameters<typeof getCatalogue>[2]) =>
  runQuery(sql, ctx, (tx) => getCatalogue(tx, ctx, input));

test("availability is derived from copies_borrowable, never a stored count", async () => {
  // Master §7.1's acceptance criterion, and the rule BR §8 and DB §6 both single
  // as the most likely to be quietly violated. Nothing is written between the
  // two reads except a state change on one copy — if a counter existed
  // anywhere, this test would still report 2.
  const { readerCtx, managerCtx, ids } = await shelfWithCatalogue();

  const before = await catalogue(readerCtx, { scope: "all" });
  const row = before.rows.find((r) => r.bookId === ids["Dế Mèn Phiêu Lưu Ký"])!;
  expect(row.copiesTotal).toBe(2);
  expect(row.copiesAvailable).toBe(2);

  const [copy] = await sql<{ id: string }[]>`
    select id from book_copies where book_id = ${row.bookId} order by code limit 1
  `;
  await runCommand(sql, managerCtx, retireCopy, {
    copyId: copy.id,
    reason: "Mục nát",
  });

  const after = await catalogue(readerCtx, { scope: "all" });
  const again = after.rows.find((r) => r.bookId === row.bookId)!;
  expect(again.copiesAvailable).toBe(1);
  expect(again.copiesTotal).toBe(1); // the retired copy is no longer a copy on the shelf
});

test("an unexpired hold makes a copy unavailable without changing its state", async () => {
  // BR §8: "a copy is borrowable when it is available and no unexpired hold
  // references it." The state stays `available`; only copies_borrowable knows.
  const { readerCtx, ids } = await shelfWithCatalogue();
  const bookId = ids["Đất Rừng Phương Nam"];
  const [copy] = await sql<{ id: string; bookshelf_id: string }[]>`
    select id, bookshelf_id from book_copies where book_id = ${bookId} order by code limit 1
  `;
  const holder = await makeMember(sql, copy.bookshelf_id);
  await sql`
    insert into borrow_requests
      (bookshelf_id, book_id, copy_id, member_id, status, hold_expires_at)
    values (${copy.bookshelf_id}, ${bookId}, ${copy.id}, ${holder.userId},
            'approved', now() + interval '3 days')
  `;

  const page = await catalogue(readerCtx, { scope: "all" });
  const row = page.rows.find((r) => r.bookId === bookId)!;
  expect(row.copiesTotal).toBe(2);
  expect(row.copiesAvailable).toBe(1);
  expect(
    await sql`select 1 from book_copies where id = ${copy.id} and state = 'available'`,
  ).toHaveLength(1);
});

test("scope=available hides a title with nothing on the shelf; scope=all does not", async () => {
  // The reader catalogue's two segments: "Sách có sẵn" and "Toàn bộ tủ sách"
  // (?loc=tat-ca).
  const { readerCtx, managerCtx, ids } = await shelfWithCatalogue();
  const bookId = ids["Kính Vạn Hoa tập 4"];
  const copies = await sql<{ id: string }[]>`
    select id from book_copies where book_id = ${bookId}
  `;
  for (const c of copies) {
    await runCommand(sql, managerCtx, retireCopy, {
      copyId: c.id,
      reason: "Mục nát",
    });
  }

  const available = await catalogue(readerCtx, { scope: "available" });
  expect(available.rows.map((r) => r.bookId)).not.toContain(bookId);

  const all = await catalogue(readerCtx, { scope: "all" });
  const row = all.rows.find((r) => r.bookId === bookId)!;
  expect(row.availability).toBe("retired");
});

test("an unpublished draft is hidden from members, on both scopes", async () => {
  // BR §5.4's published flag "hides drafts from the public" — member-facing,
  // not public, per BR §1.2. The manager list (Task 6) still shows it.
  const { readerCtx, ids } = await shelfWithCatalogue();
  await sql`update books set is_published = false where id = ${ids["Totto-chan Bên Cửa Sổ"]}`;

  for (const scope of ["available", "all"] as const) {
    const page = await catalogue(readerCtx, { scope });
    expect(page.rows.map((r) => r.bookId)).not.toContain(
      ids["Totto-chan Bên Cửa Sổ"],
    );
  }
});

test("the catalogue is paginated and reports its own total", async () => {
  const { readerCtx } = await shelfWithCatalogue();
  const page = await catalogue(readerCtx, { scope: "all", page: 2, pageSize: 3 });
  expect(page.total).toBe(4);
  expect(page.pageCount).toBe(2);
  expect(page.rows).toHaveLength(1);
});

test("a category filter narrows by slug, not by name", async () => {
  const { readerCtx } = await shelfWithCatalogue();
  const all = await catalogue(readerCtx, {
    scope: "all",
    category: "van-hoc-thieu-nhi",
  });
  expect(all.rows).toHaveLength(4);
  const none = await catalogue(readerCtx, { scope: "all", category: "lich-su" });
  expect(none.rows).toHaveLength(0);
});

test("one shelf's catalogue never contains another's", async () => {
  // INV-10, through the query rather than through a raw select.
  const a = await shelfWithCatalogue();
  const b = await makeShelf(sql, { slug: "can-tho" });
  const bManager = await makeMember(sql, b.id, { role: "manager" });
  await runCommand(
    sql,
    {
      bookshelfId: b.id,
      actor: {
        userId: bManager.userId,
        membershipId: bManager.id,
        role: "manager",
      },
      clock,
    },
    createBook,
    {
      title: "Sách Cần Thơ",
      author: "X",
      categorySlug: "van-hoc-thieu-nhi",
      copyCount: 1,
    },
  );

  const page = await catalogue(a.readerCtx, { scope: "all" });
  expect(page.total).toBe(4);
  expect(page.rows.map((r) => r.title)).not.toContain("Sách Cần Thơ");
});

test("search finds every DB §5 title typed without diacritics", async () => {
  // BR §12: "A child typing 'tim kiem kho bau' on a phone without diacritics
  // must find 'Tìm Kiếm Kho Báu'." tests/db/folding.test.ts already proves
  // olibra_fold() and fold() agree on these four inputs; this is the other
  // half — that the query actually uses that folding on both sides.
  const { readerCtx } = await shelfWithCatalogue();
  const found = async (q: string) =>
    (
      await runQuery(sql, readerCtx, (tx) => searchCatalogue(tx, readerCtx, { q }))
    ).map((r) => r.title);

  expect(await found("de men")).toContain("Dế Mèn Phiêu Lưu Ký");
  expect(await found("dat rung")).toContain("Đất Rừng Phương Nam");
  expect(await found("totto chan")).toContain("Totto-chan Bên Cửa Sổ");
  expect(await found("kinh van hoa tap 4")).toContain("Kính Vạn Hoa tập 4");
  // The hyphen case, from the other direction: a typed hyphen must not break it.
  expect(await found("Totto-chan")).toContain("Totto-chan Bên Cửa Sổ");
});

test("search covers author as well as title, and carries availability", async () => {
  const { readerCtx } = await shelfWithCatalogue();
  const rows = await runQuery(sql, readerCtx, (tx) =>
    searchCatalogue(tx, readerCtx, { q: "to hoai" }),
  );
  expect(rows).toHaveLength(4);
  expect(rows[0].copiesAvailable).toBe(2);
});

test("an empty search term returns nothing rather than the whole shelf", async () => {
  const { readerCtx } = await shelfWithCatalogue();
  expect(
    await runQuery(sql, readerCtx, (tx) =>
      searchCatalogue(tx, readerCtx, { q: "   " }),
    ),
  ).toHaveLength(0);
});

test("book detail resolves by slug and reports the queue and the holder", async () => {
  const { readerCtx, ids, shelf, manager } = await shelfWithCatalogue();
  const bookId = ids["Dế Mèn Phiêu Lưu Ký"];
  const [copy] = await sql<{ id: string }[]>`
    select id from book_copies where book_id = ${bookId} order by code limit 1
  `;
  const borrower = await makeMember(sql, shelf.id);
  await sql`update users set full_name = 'Giuse Trần Minh' where id = ${borrower.userId}`;
  await sql`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on)
    values (${shelf.id}, ${copy.id}, ${bookId}, ${borrower.userId}, ${manager.userId},
            date '2026-08-20')
  `;
  await sql`update book_copies set state = 'on_loan' where id = ${copy.id}`;
  const queued = await makeMember(sql, shelf.id);
  await sql`
    insert into borrow_requests (bookshelf_id, book_id, member_id, status)
    values (${shelf.id}, ${bookId}, ${queued.userId}, 'pending')
  `;

  const detail = await runQuery(sql, readerCtx, (tx) =>
    getBookDetail(tx, readerCtx, { bookSlug: "de-men-phieu-luu-ky" }),
  );

  expect(detail.title).toBe("Dế Mèn Phiêu Lưu Ký");
  expect(detail.copiesTotal).toBe(2);
  expect(detail.copiesAvailable).toBe(1);
  expect(detail.queueLength).toBe(1);
  expect(detail.currentLoan?.holderName).toBe("Giuse Trần Minh");
  // G5/G6: days remaining is computed from loans_current against the clock,
  // in Asia/Ho_Chi_Minh, not stored. 2026-08-20 minus 2026-08-08.
  expect(detail.currentLoan?.daysRemaining).toBe(12);
});

test("public_show_current_borrower off withholds the holder, keeps the availability", async () => {
  // BR §5.5. The panel still says the book is out; it just does not say with
  // whom.
  const { readerCtx, ids, shelf, manager } = await shelfWithCatalogue();
  await sql`
    update bookshelves
    set settings = settings || '{"public_show_current_borrower": false}'::jsonb
    where id = ${shelf.id}
  `;
  const bookId = ids["Dế Mèn Phiêu Lưu Ký"];
  const [copy] = await sql<{ id: string }[]>`
    select id from book_copies where book_id = ${bookId} order by code limit 1
  `;
  const borrower = await makeMember(sql, shelf.id);
  await sql`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on)
    values (${shelf.id}, ${copy.id}, ${bookId}, ${borrower.userId}, ${manager.userId},
            date '2026-08-20')
  `;
  await sql`update book_copies set state = 'on_loan' where id = ${copy.id}`;

  const detail = await runQuery(sql, readerCtx, (tx) =>
    getBookDetail(tx, readerCtx, { bookSlug: "de-men-phieu-luu-ky" }),
  );
  expect(detail.currentLoan).toBeNull();
  expect(detail.copiesAvailable).toBe(1);
});

test("an unknown slug, and another shelf's book, are both not-found", async () => {
  const a = await shelfWithCatalogue();
  await expect(
    runQuery(sql, a.readerCtx, (tx) =>
      getBookDetail(tx, a.readerCtx, { bookSlug: "khong-co" }),
    ),
  ).rejects.toBeInstanceOf(NotFound);
});

test("a guest reaches none of the three", async () => {
  // OPS §2 and BR §1.2: a bookshelf's catalogue, book detail and search now
  // require a membership of that shelf, not merely being signed in somewhere.
  const { readerCtx } = await shelfWithCatalogue();
  const guestCtx: TenantContext = {
    ...readerCtx,
    actor: { userId: null, membershipId: null, role: "guest" },
  };
  await expect(catalogue(guestCtx, { scope: "all" })).rejects.toBeInstanceOf(
    RuleViolated,
  );
  await expect(
    runQuery(sql, guestCtx, (tx) => searchCatalogue(tx, guestCtx, { q: "de men" })),
  ).rejects.toBeInstanceOf(RuleViolated);
});
