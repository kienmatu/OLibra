import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { RuleViolated } from "../../src/domain/kernel/errors";
import { runCommand, runQuery } from "../../src/domain/kernel/unit-of-work";
import { lendCopy } from "../../src/domain/circulation/commands/lend-copy";
import { reportCopyLost } from "../../src/domain/catalogue/commands/report-copy-lost";
import { retireCopy } from "../../src/domain/catalogue/commands/retire-copy";
import {
  bookFromSlug,
  chooseCopyToLend,
  readerFromParam,
} from "../../src/lib/lending";
import { readShelf } from "../../src/lib/shelf";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeMember } from "../support/factories";
import { managerContext } from "../support/scenarios";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/**
 * The surface helpers the five lending screens are built out of (U1 Task 3).
 *
 * These are lookups and one aggregation, not rules — the rules stay in
 * `domain/circulation/policy.ts`. So what is worth pinning is not "does
 * `copyLendable` work", which `tests/domain/circulation/policy.test.ts`
 * already answers, but the two things a screen can get wrong on its own:
 *
 * 1. **Agreement.** The sentence the confirm screen shows when it will not
 *    lend must be the sentence `lendCopy` would throw. BR §16.3 exists because
 *    the alternative is a volunteer told yes and then no, or told no about a
 *    book that is sitting on the shelf.
 * 2. **A parameter is not evidence.** `?sach=`, `?nguoi-doc=` and `?muon=` are
 *    strings out of an address bar. A malformed one must produce an empty
 *    screen, never a `22P02` from inside a transaction (OPS §2: "a command
 *    never fails with a bare 500 or an unstructured exception").
 */

// — the shelf's own policy, which the pages read and the queries take —

test("readShelf reads this shelf's overrides, not BR §5.5's defaults", async () => {
  // The failure this catches is silent and one-directional: a page that
  // defaulted to 3 would refuse a reader on a shelf that allows 5, and
  // `lendCopy` — which reads the same column for itself — would have accepted
  // them. That is the "turns a child away from a book that is actually there"
  // direction, and nothing in the domain suite can see it, because the domain
  // is handed the number rather than reading it.
  const { shelf, ctx } = await managerContext(sql);
  await sql`
    update bookshelves
       set settings = settings || '{"max_concurrent_loans": 5, "loan_days": 21}'::jsonb
     where id = ${shelf.id}
  `;

  const read = await runQuery(sql, ctx, (tx, c) => readShelf(tx, c));

  expect(read.maxConcurrentLoans).toBe(5);
  expect(read.loanDays).toBe(21);
  expect(read.name).toBe(`Tủ sách ${shelf.slug}`);
});

test("readShelf falls back to BR §5.5's defaults when the shelf overrides nothing", async () => {
  // `makeShelf` writes no `settings`, and DB §4.2 says a shelf row "need only
  // store what it overrides" — so the coalesce default is the value nearly
  // every real shelf uses, not a corner case.
  const { ctx } = await managerContext(sql);

  const read = await runQuery(sql, ctx, (tx, c) => readShelf(tx, c));

  expect(read.maxConcurrentLoans).toBe(3);
  expect(read.loanDays).toBe(14);
});

/**
 * The slug `makeBookWithCopies` gave a title.
 *
 * Read back rather than reconstructed: the factory names books from a counter
 * shared across the whole suite, so a test that hard-coded "sach-1" would pass
 * alone and fail the moment another file ran first.
 */
async function slugOf(bookId: string): Promise<string> {
  const [row] = await sql<{ slug: string }[]>`
    select slug from books where id = ${bookId}
  `;
  return row.slug;
}

// — the agreement between the confirm screen and the command —

test("the copy the screen names is one lendCopy accepts", async () => {
  const { shelf, ctx } = await managerContext(sql);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 3);
  const reader = await makeMember(sql, shelf.id);

  const slug = await slugOf(bookId);
  const book = await runQuery(sql, ctx, (tx, c) => bookFromSlug(tx, c, slug));
  const chosen = chooseCopyToLend(book!);

  // The lowest shelf-mark, deterministically: step 2 shows a code, step 3
  // shows a code, and a volunteer who goes back and forward must not see them
  // swap. `copies` arrives ordered by `code`.
  expect(chosen.copy!.code).toBe(
    (
      await sql<{ code: string }[]>`
      select code from book_copies where id = any(${copyIds}) order by code limit 1
    `
    )[0].code,
  );
  expect(chosen.block.blocked).toBe(false);

  // And the command agrees: the very copy the screen offered is lent.
  await runCommand(sql, ctx, lendCopy, {
    copyId: chosen.copy!.copyId,
    membershipId: reader.id,
  });
  const [loan] = await sql<{ copy_id: string }[]>`
    select copy_id from loans where status = 'active'
  `;
  expect(loan.copy_id).toBe(chosen.copy!.copyId);
});

test("a title whose only copy is out refuses in the code lendCopy throws", async () => {
  // Asserted against `thrown`, never against the literal string, for the reason
  // `lending-queries.test.ts` gives: a test naming "copy_not_available" on both
  // sides stays green while the two sides drift to a third value together, and
  // says nothing about whether they were ever the same rule.
  const { shelf, ctx } = await managerContext(sql);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const borrower = await makeMember(sql, shelf.id);
  await runCommand(sql, ctx, lendCopy, {
    copyId: copyIds[0],
    membershipId: borrower.id,
  });
  const other = await makeMember(sql, shelf.id);

  const slug = await slugOf(bookId);
  const book = await runQuery(sql, ctx, (tx, c) => bookFromSlug(tx, c, slug));
  const chosen = chooseCopyToLend(book!);

  const thrown = await runCommand(sql, ctx, lendCopy, {
    copyId: copyIds[0],
    membershipId: other.id,
  }).catch((e) => e);

  expect(thrown).toBeInstanceOf(RuleViolated);
  expect(chosen.copy).toBeNull();
  expect(chosen.block).toEqual({ blocked: true, reason: thrown.code });
});

test("a title whose every copy is lost or retired says so, and not merely 'out'", async () => {
  // The distinction `searchBooksForLending`'s docstring records as a shipped
  // defect: deriving the reason from "no copies available" alone told a
  // volunteer whose only copy is *lost* to go and wait for a book nobody has.
  // This screen aggregates per-copy answers instead, so it inherits the right
  // one — and `lendCopy` throws the same code for the same copy.
  const { shelf, ctx } = await managerContext(sql);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 2);
  const borrower = await makeMember(sql, shelf.id);
  // Lost, the only way BR §7.1 draws an arrow into it: out on loan first.
  await runCommand(sql, ctx, lendCopy, {
    copyId: copyIds[0],
    membershipId: borrower.id,
  });
  await runCommand(sql, ctx, reportCopyLost, { copyId: copyIds[0] });
  await runCommand(sql, ctx, retireCopy, {
    copyId: copyIds[1],
    reason: "Bìa rời hẳn khỏi ruột sách",
  });
  const reader = await makeMember(sql, shelf.id);

  const slug = await slugOf(bookId);
  const book = await runQuery(sql, ctx, (tx, c) => bookFromSlug(tx, c, slug));
  const chosen = chooseCopyToLend(book!);

  const thrown = await runCommand(sql, ctx, lendCopy, {
    copyId: copyIds[0],
    membershipId: reader.id,
  }).catch((e) => e);

  expect(thrown).toBeInstanceOf(RuleViolated);
  expect(chosen.block).toEqual({ blocked: true, reason: thrown.code });
  expect(thrown.code).toBe("copy_lost_or_retired");
});

test("a title with no copies recorded at all is 'not available', not 'lost'", async () => {
  // `searchBooksForLending` documents this choice and this screen has to make
  // the same one: nothing about such a title is lost, and `ErrorCode` may not
  // gain a third code whose Vietnamese sentence nobody wrote.
  const { shelf, ctx } = await managerContext(sql);
  await sql`
    insert into books (bookshelf_id, title, author, slug, is_published)
    values (${shelf.id}, 'Chưa có bản nào', 'Tô Hoài', 'chua-co-ban-nao', true)
  `;

  const book = await runQuery(sql, ctx, (tx, c) =>
    bookFromSlug(tx, c, "chua-co-ban-nao"),
  );

  expect(chooseCopyToLend(book!).block).toEqual({
    blocked: true,
    reason: "copy_not_available",
  });
});

// — a URL parameter is a string, not evidence —

test("a slug naming nothing is an empty screen, not an error", async () => {
  const { ctx } = await managerContext(sql);

  expect(
    await runQuery(sql, ctx, (tx, c) => bookFromSlug(tx, c, "khong-co-sach-nay")),
  ).toBeNull();
  // And a missing parameter behaves identically, so `xac-nhan` reached with no
  // query string at all renders rather than throwing.
  expect(
    await runQuery(sql, ctx, (tx, c) => bookFromSlug(tx, c, undefined)),
  ).toBeNull();
});

test("a manager can lend a title that has not been announced yet", async () => {
  // The reason `bookFromSlug` resolves the slug itself instead of calling the
  // reader-facing `getBookDetail`, which filters `is_published`. A draft is
  // exactly what `getBooksList` exists to find, and a volunteer holding a book
  // that has not been announced can still hand it to a child.
  const { shelf, ctx } = await managerContext(sql);
  await sql`
    insert into books (bookshelf_id, title, author, slug, is_published)
    values (${shelf.id}, 'Bản nháp', 'Tô Hoài', 'ban-nhap', false)
  `;

  const book = await runQuery(sql, ctx, (tx, c) => bookFromSlug(tx, c, "ban-nhap"));

  expect(book?.book.slug).toBe("ban-nhap");
  expect(book?.book.isPublished).toBe(false);
});

test("a membership parameter that is not a uuid is refused before it reaches Postgres", async () => {
  // Without the shape check this is a `22P02` raised inside the transaction and
  // rendered as a 500 — the unstructured exception OPS §2 forbids — for nothing
  // more than a hand-edited address bar. The assertion is that it resolves to
  // `null`; the failure it catches is that it throws at all.
  const { ctx } = await managerContext(sql);

  expect(
    await runQuery(sql, ctx, (tx, c) => readerFromParam(tx, c, "khong-phai-uuid")),
  ).toBeNull();
  expect(
    await runQuery(sql, ctx, (tx, c) => readerFromParam(tx, c, undefined)),
  ).toBeNull();
  // A well-formed id naming nobody on this shelf is the same empty screen: a
  // stale link, not a fault.
  expect(
    await runQuery(sql, ctx, (tx, c) =>
      readerFromParam(tx, c, "00000000-0000-4000-8000-000000000000"),
    ),
  ).toBeNull();
});

test("a reader on another shelf is invisible to this one's confirm screen", async () => {
  // INV-10, through the surface. `readerFromParam` runs `getReaderDetail`
  // inside `runQuery`'s scoped transaction, so RLS filters the row before the
  // query's own `if (!row)` ever runs — "belongs to another tenant" and "does
  // not exist" are deliberately the same answer.
  const { ctx } = await managerContext(sql, { slug: "dong-thap" });
  const theirs = await managerContext(sql, { slug: "can-tho" });
  const stranger = await makeMember(sql, theirs.shelf.id);

  expect(
    await runQuery(sql, ctx, (tx, c) => readerFromParam(tx, c, stranger.id)),
  ).toBeNull();
});
