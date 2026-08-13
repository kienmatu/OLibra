import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { RuleViolated } from "../../../src/domain/kernel/errors";
import { runCommand, runQuery } from "../../../src/domain/kernel/unit-of-work";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { createBook } from "../../../src/domain/catalogue/commands/create-book";
import { assessCondition } from "../../../src/domain/catalogue/commands/assess-condition";
import { getBooksList } from "../../../src/domain/catalogue/queries/get-books-list";
import { getBookDetailManager } from "../../../src/domain/catalogue/queries/get-book-detail-manager";
import { searchBooksForLending } from "../../../src/domain/catalogue/queries/search-books-for-lending";
import { migrate } from "../../../src/db/migrate";
import { makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-08T03:00:00Z");

async function shelf() {
  const s = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, s.id, { role: "manager" });
  await sql`
    insert into categories (slug, name, sort_order)
    values ('van-hoc-thieu-nhi', 'Văn học thiếu nhi', 10) on conflict (slug) do nothing
  `;
  const ctx: TenantContext = {
    bookshelfId: s.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  const { bookId } = await runCommand(sql, ctx, createBook, {
    title: "Dế Mèn Phiêu Lưu Ký",
    author: "Tô Hoài",
    categorySlug: "van-hoc-thieu-nhi",
    copyCount: 3,
  });
  return { s, manager, ctx, bookId };
}

async function lend(
  s: string,
  bookId: string,
  copyId: string,
  lentBy: string,
  due = "2026-08-20",
) {
  const borrower = await makeMember(sql, s);
  await sql`update users set full_name = 'Giuse Trần Minh' where id = ${borrower.userId}`;
  const [loan] = await sql<{ id: string }[]>`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on)
    values (${s}, ${copyId}, ${bookId}, ${borrower.userId}, ${lentBy}, ${due}::date)
    returning id
  `;
  await sql`update book_copies set state = 'on_loan' where id = ${copyId}`;
  return loan.id;
}

test("the manager list sorts by title alphabetically in Vietnamese", async () => {
  // U2 Task 4, extended to this query: the same `case when … then title end`
  // expression the two reader-facing catalogue queries carried, and the same
  // `C` collation underneath it, so "Đất Rừng Phương Nam" (`Đ` is `0xC4`)
  // sorted after every unaccented title on the shelf. U3 wires the page that
  // reads this.
  const { ctx } = await shelf();
  for (const title of ["Đất Rừng Phương Nam", "Kính Vạn Hoa tập 4"]) {
    await runCommand(sql, ctx, createBook, {
      title,
      author: "Tô Hoài",
      categorySlug: "van-hoc-thieu-nhi",
      copyCount: 1,
    });
  }

  const list = await runQuery(sql, ctx, (tx) =>
    getBooksList(tx, ctx, { sort: "title" }),
  );

  expect(list.rows.map((r) => r.title)).toEqual([
    "Đất Rừng Phương Nam",
    "Dế Mèn Phiêu Lưu Ký",
    "Kính Vạn Hoa tập 4",
  ]);
});

test("the manager list shows a draft the reader catalogue hides", async () => {
  const { ctx, bookId } = await shelf();
  await sql`update books set is_published = false where id = ${bookId}`;

  const list = await runQuery(sql, ctx, (tx) => getBooksList(tx, ctx, {}));
  const row = list.rows.find((r) => r.bookId === bookId)!;
  expect(row.isPublished).toBe(false);
  expect(row.copiesTotal).toBe(3);
  // The secondary line under the title on the built list page.
  expect(row.codes).toBe("DT-0001 – DT-0003");
});

test("the manager list filters by folded query and by category", async () => {
  const { ctx } = await shelf();
  expect(
    (await runQuery(sql, ctx, (tx) => getBooksList(tx, ctx, { q: "de men" }))).rows,
  ).toHaveLength(1);
  expect(
    (await runQuery(sql, ctx, (tx) => getBooksList(tx, ctx, { q: "khong co" })))
      .rows,
  ).toHaveLength(0);
  expect(
    (
      await runQuery(sql, ctx, (tx) =>
        getBooksList(tx, ctx, { category: "lich-su" }),
      )
    ).rows,
  ).toHaveLength(0);
});

test("M7: a garbage manager-list query returns nothing, not the whole shelf", async () => {
  // fix-report, 2026-08-08-b1-catalogue. Same mechanism as search-catalogue's
  // twin test: olibra_fold() strips a query made entirely of punctuation
  // down to '', which used to degenerate the LIKE pattern to '%%' and
  // reveal every book — even though the manager typed something, and even
  // though this list already shows everything for a truly empty query.
  const { ctx } = await shelf();
  const garbage = await runQuery(sql, ctx, (tx) =>
    getBooksList(tx, ctx, { q: "%" }),
  );
  expect(garbage.rows).toHaveLength(0);

  // The truly-empty case is unchanged: still shows everything.
  const empty = await runQuery(sql, ctx, (tx) => getBooksList(tx, ctx, { q: "" }));
  expect(empty.rows.length).toBeGreaterThan(0);
});

test("M8: the manager list reports none, not retired, for a title with zero live copies", async () => {
  const { ctx, bookId } = await shelf();
  await sql`update book_copies set deleted_at = now() where book_id = ${bookId}`;

  const list = await runQuery(sql, ctx, (tx) => getBooksList(tx, ctx, {}));
  const row = list.rows.find((r) => r.bookId === bookId)!;
  expect(row.availability).toBe("none");
  expect(row.copiesTotal).toBe(0);
});

test("manager book detail carries per-copy state, condition and 'đang ở đâu'", async () => {
  const { ctx, s, manager, bookId } = await shelf();
  const copies = await sql<{ id: string; code: string }[]>`
    select id, code from book_copies where book_id = ${bookId} order by code
  `;
  await lend(s.id, bookId, copies[1].id, manager.userId);
  await runCommand(sql, ctx, assessCondition, {
    copyId: copies[0].id,
    condition: "slightly_worn",
    note: "Gáy hơi lỏng",
  });

  const detail = await runQuery(sql, ctx, (tx) =>
    getBookDetailManager(tx, ctx, { bookId }),
  );

  expect(detail.copies).toHaveLength(3);
  const [first, second] = detail.copies;
  expect(first.code).toBe(copies[0].code);
  expect(first.state).toBe("available");
  expect(first.condition).toBe("slightly_worn");
  expect(first.conditionNote).toBe("Gáy hơi lỏng");
  expect(first.holderName).toBeNull();
  expect(second.state).toBe("on_loan");
  expect(second.holderName).toBe("Giuse Trần Minh");
  expect(second.dueOn).toBe("2026-08-20");
  expect(second.isOverdue).toBe(false);

  expect(detail.conditionHistory).toHaveLength(1);
  expect(detail.conditionHistory[0].condition).toBe("slightly_worn");
  expect(detail.conditionHistory[0].copyCode).toBe(copies[0].code);

  expect(detail.loanHistory).toHaveLength(1);
  expect(detail.loanHistory[0].borrowerName).toBe("Giuse Trần Minh");
  expect(detail.loanHistory[0].returnedAt).toBeNull();
});

/**
 * QA remediation Task 20. `acquired_from`/`acquired_from_membership_id` were
 * selected here since B1 and rendered nowhere — a donor could be recorded and
 * nobody could ever read it back. The name resolution added in this task is
 * the fix's read half; `sach/[id]/page.tsx`'s new "Người tặng" column is the
 * other.
 */
test("a member donor resolves to their name; a free-text one does not", async () => {
  const { ctx, s, bookId } = await shelf();
  const donor = await makeMember(sql, s.id);
  await sql`update users set full_name = 'Bác Hoà Thật' where id = ${donor.userId}`;
  const copies = await sql<{ id: string }[]>`
    select id from book_copies where book_id = ${bookId} order by code
  `;
  await sql`
    update book_copies set acquired_from_membership_id = ${donor.id}
    where id = ${copies[0].id}
  `;
  await sql`
    update book_copies set acquired_from = 'bác Hoà (không có tài khoản)'
    where id = ${copies[1].id}
  `;

  const detail = await runQuery(sql, ctx, (tx) =>
    getBookDetailManager(tx, ctx, { bookId }),
  );

  const [memberCopy, freeTextCopy, noDonorCopy] = detail.copies;
  expect(memberCopy.acquiredFromMembershipId).toBe(donor.id);
  expect(memberCopy.acquiredFromMembershipName).toBe("Bác Hoà Thật");

  expect(freeTextCopy.acquiredFrom).toBe("bác Hoà (không có tài khoản)");
  expect(freeTextCopy.acquiredFromMembershipId).toBeNull();
  expect(freeTextCopy.acquiredFromMembershipName).toBeNull();

  expect(noDonorCopy.acquiredFrom).toBeNull();
  expect(noDonorCopy.acquiredFromMembershipId).toBeNull();
  expect(noDonorCopy.acquiredFromMembershipName).toBeNull();
});

test("overdue on a copy row is computed against the clock, not stored", async () => {
  // G5, and DB §4.5: "There is no is_overdue column, and there must never be
  // one." loans_current does the arithmetic in Asia/Ho_Chi_Minh.
  const { ctx, s, manager, bookId } = await shelf();
  const copies = await sql<{ id: string }[]>`
    select id from book_copies where book_id = ${bookId} order by code
  `;
  await lend(s.id, bookId, copies[0].id, manager.userId, "2026-08-01");

  const detail = await runQuery(sql, ctx, (tx) =>
    getBookDetailManager(tx, ctx, { bookId }),
  );
  expect(detail.copies[0].isOverdue).toBe(true);
});

test("loan history survives the copy being retired", async () => {
  // BR §5.4 stores book_id on the loan for exactly this, and BR §11 keeps the
  // loan forever. The built page says so: "Lịch sử mượn không bao giờ bị xoá,
  // kể cả khi bản sách đã ngừng dùng."
  const { ctx, s, manager, bookId } = await shelf();
  const copies = await sql<{ id: string }[]>`
    select id from book_copies where book_id = ${bookId} order by code
  `;
  const loanId = await lend(s.id, bookId, copies[0].id, manager.userId);
  await sql`
    update loans set status = 'returned', returned_at = now(),
                     received_by = ${manager.userId}, return_condition = 'worn'
    where id = ${loanId}
  `;
  await sql`
    update book_copies set state = 'retired', retired_at = now(), retired_reason = 'Mục nát'
    where id = ${copies[0].id}
  `;

  const detail = await runQuery(sql, ctx, (tx) =>
    getBookDetailManager(tx, ctx, { bookId }),
  );
  expect(detail.loanHistory).toHaveLength(1);
  expect(detail.loanHistory[0].returnCondition).toBe("worn");
  // The retired copy is still listed on the management page, with its reason.
  const retired = detail.copies.find((c) => c.state === "retired")!;
  expect(retired.retiredReason).toBe("Mục nát");
});

/**
 * Post-review fix wave, item 7. `book.copiesTotal` used to exclude only
 * `retired` copies, which left a `lost` one inflating the count the manager
 * page's summary line renders as "N bản trong tủ" — "in the cupboard" is the
 * one thing a lost copy is not. It also disagreed with the page's own
 * "Các bản sách (N)" heading, which is now built from this same field
 * (`quan-ly/sach/[id]/page.tsx`) rather than `detail.copies.length` — so this
 * test pins the one number both parts of the page now share.
 */
test("copiesTotal excludes both lost and retired copies, but the copies table still lists every one", async () => {
  const { ctx, bookId } = await shelf();
  const copies = await sql<{ id: string }[]>`
    select id from book_copies where book_id = ${bookId} order by code
  `;
  await sql`
    update book_copies set state = 'lost', lost_reported_at = now()
    where id = ${copies[0].id}
  `;
  await sql`
    update book_copies
       set state = 'retired', retired_at = now(), retired_reason = 'Mục nát'
     where id = ${copies[1].id}
  `;
  // copies[2] stays 'available'.

  const detail = await runQuery(sql, ctx, (tx) =>
    getBookDetailManager(tx, ctx, { bookId }),
  );

  expect(detail.book.copiesTotal).toBe(1);
  // The table itself is unchanged: a manager still sees the lost and the
  // retired copy, with their reasons, alongside the one that is actually on
  // the shelf.
  expect(detail.copies).toHaveLength(3);
});

test("a title with every copy out is blocked, with the reason the command would throw", async () => {
  // BR §16.3: blocking conditions surface "before the confirm step, never as
  // an error afterwards." C1's own test asserts this exact reason string.
  const { ctx, s, manager, bookId } = await shelf();
  const copies = await sql<{ id: string }[]>`
    select id from book_copies where book_id = ${bookId} order by code
  `;
  for (const c of copies) await lend(s.id, bookId, c.id, manager.userId);

  const [row] = await runQuery(sql, ctx, (tx) =>
    searchBooksForLending(tx, ctx, { q: "de men" }),
  );
  expect(row.blocked).toBe(true);
  expect(row.reason).toBe("copy_not_available");
  expect(row.copiesAvailable).toBe(0);
  expect(row.copiesTotal).toBe(3);
});

test("a title with one copy free is not blocked", async () => {
  const { ctx, s, manager, bookId } = await shelf();
  const copies = await sql<{ id: string }[]>`
    select id from book_copies where book_id = ${bookId} order by code
  `;
  await lend(s.id, bookId, copies[0].id, manager.userId);
  await lend(s.id, bookId, copies[1].id, manager.userId);

  const [row] = await runQuery(sql, ctx, (tx) =>
    searchBooksForLending(tx, ctx, { q: "de men" }),
  );
  expect(row.blocked).toBe(false);
  expect(row.reason).toBeUndefined();
  expect(row.copiesAvailable).toBe(1);
});

test("quick-lend search is diacritic-insensitive, like every other search", async () => {
  const { ctx } = await shelf();
  const rows = await runQuery(sql, ctx, (tx) =>
    searchBooksForLending(tx, ctx, { q: "de men" }),
  );
  expect(rows.map((r) => r.title)).toContain("Dế Mèn Phiêu Lưu Ký");
});

test("M7: a garbage quick-lend query returns nothing, not the whole shelf", async () => {
  // fix-report, 2026-08-08-b1-catalogue. See the twin tests on
  // searchCatalogue and getBooksList — same olibra_fold()-strips-to-empty
  // mechanism, same "whole shelf revealed" bug.
  const { ctx } = await shelf();
  const rows = await runQuery(sql, ctx, (tx) =>
    searchBooksForLending(tx, ctx, { q: "%" }),
  );
  expect(rows).toHaveLength(0);
});

test("QA remediation T27: quick-lend search also matches a copy code", async () => {
  const { ctx, bookId } = await shelf();
  const [{ code }] = await sql<{ code: string }[]>`
    select code from book_copies where book_id = ${bookId} order by code limit 1
  `;

  // Lowercase and partial, the same forgiveness the title/author halves of
  // this query already give — `ilike`, not `like`, and no need for
  // `olibra_fold`: a copy code is plain ASCII assigned by `copy-codes.ts`,
  // never Vietnamese text.
  const rows = await runQuery(sql, ctx, (tx) =>
    searchBooksForLending(tx, ctx, { q: code.toLowerCase().slice(0, -1) }),
  );
  expect(rows.map((r) => r.title)).toContain("Dế Mèn Phiêu Lưu Ký");

  // The book this matched has three copies. A match found through only one
  // of their codes must still report all three — this is the aggregate this
  // query's own docstring says the `exists` clause is written to leave
  // alone, as opposed to a condition added to the `cp` alias the counts
  // below are built from, which would have fanned the join down to the one
  // matching copy before `count(cp.id) filter (...)` ever ran.
  const [row] = rows;
  expect(row.copiesTotal).toBe(3);
});

test("QA remediation T27: a copy code match is literal, not a LIKE wildcard", async () => {
  // escapeLikePattern's own concern (copy-codes.ts), mirrored here on the
  // search side: a manager typing a stray `%` or `_` must not turn "find
  // this one code" into "find every code that has any character there".
  // Every seeded code is `DT-####` — a hyphen, not an underscore — so an
  // unescaped `_` in this query would still match one via the wildcard.
  const { ctx } = await shelf();
  const rows = await runQuery(sql, ctx, (tx) =>
    searchBooksForLending(tx, ctx, { q: "DT_0001" }),
  );
  expect(rows).toHaveLength(0);
});

test("a reader reaches none of the three", async () => {
  const { ctx, s, bookId } = await shelf();
  const reader = await makeMember(sql, s.id);
  const readerCtx: TenantContext = {
    ...ctx,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
  };
  await expect(
    runQuery(sql, readerCtx, (tx) => getBooksList(tx, readerCtx, {})),
  ).rejects.toBeInstanceOf(RuleViolated);
  await expect(
    runQuery(sql, readerCtx, (tx) =>
      getBookDetailManager(tx, readerCtx, { bookId }),
    ),
  ).rejects.toBeInstanceOf(RuleViolated);
  await expect(
    runQuery(sql, readerCtx, (tx) =>
      searchBooksForLending(tx, readerCtx, { q: "de" }),
    ),
  ).rejects.toBeInstanceOf(RuleViolated);
});

/**
 * IMPORTANT 5 (fix-report, 2026-08-09-u2-shelf-and-portal), the manager half.
 *
 * `getBooksList` carried the same `order by olibra_fold(title), created_at
 * desc` as the two reader queries, and the same defect: `created_at` defaults
 * to `now()`, which is transaction start time, so every book written in one
 * transaction shares one instant and the sort is not a total order.
 * `limit`/`offset` over a partial order shows some rows twice and skips
 * others. See `get-catalogue.ts`'s docstring for the measurement and
 * `reader-queries.test.ts` for the reader-facing version of this test.
 *
 * Worth having on this query separately rather than trusting the shared shape:
 * a manager paging a bulk-loaded shelf looking for the draft they just created
 * can page past it without it appearing at all, and it is a *different* query
 * — no `is_published` filter, an extra `codes` aggregate — which is exactly
 * how one of three copies of an expression comes to differ from the others.
 */
const MANAGER_PAGING_ROWS = 200;

test("paging the manager list loses no book and repeats none", async () => {
  const { s, ctx } = await shelf();

  // Bulk, in one statement, sharing one created_at — which is what a bulk load
  // looks like and what `createBook` (one transaction per book) cannot produce.
  // Half of them drafts, since this list is the one place a draft appears and
  // a page boundary must not be where one goes missing.
  const titles: string[] = [];
  const slugs: string[] = [];
  const published: string[] = [];
  for (let i = 0; i < MANAGER_PAGING_ROWS; i++) {
    // olibra_fold collapses and trims runs of non-[a-z0-9], so a different
    // number of trailing dots is a distinct title with an identical sort key.
    titles.push(
      `${["Dế Mèn", "Đất Rừng"][i % 2]}${".".repeat(Math.floor(i / 2) + 1)}`,
    );
    slugs.push(`bulk-${String(i).padStart(3, "0")}`);
    published.push(i % 2 === 0 ? "true" : "false");
  }
  await sql`
    insert into books (bookshelf_id, title, author, slug, is_published, created_at)
    select ${s.id}, t.title, 'Tô Hoài', t.slug, t.published::boolean, '2026-08-01T00:00:00Z'
    from unnest(${titles}::text[], ${slugs}::text[], ${published}::text[])
      as t(title, slug, published)
  `;

  for (const sort of ["recent", "title"] as const) {
    for (const pageSize of [7, 24]) {
      const first = await runQuery(sql, ctx, (tx) =>
        getBooksList(tx, ctx, { sort, page: 1, pageSize }),
      );
      const seen = first.rows.map((r) => r.slug);
      for (let page = 2; (page - 1) * pageSize < first.total; page++) {
        const result = await runQuery(sql, ctx, (tx) =>
          getBooksList(tx, ctx, { sort, page, pageSize }),
        );
        seen.push(...result.rows.map((r) => r.slug));
      }

      const where = `sort=${sort} pageSize=${pageSize}`;
      expect(first.total, where).toBe(MANAGER_PAGING_ROWS + 1);
      expect(seen, where).toHaveLength(first.total);
      expect(new Set(seen).size, where).toBe(first.total);
    }
  }
});
