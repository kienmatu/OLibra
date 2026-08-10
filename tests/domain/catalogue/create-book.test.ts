import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import {
  NotFound,
  ValidationFailed,
  RuleViolated,
} from "../../../src/domain/kernel/errors";
import { runCommand } from "../../../src/domain/kernel/unit-of-work";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { createBook } from "../../../src/domain/catalogue/commands/create-book";
import { addCopies } from "../../../src/domain/catalogue/commands/add-copies";
import { migrate } from "../../../src/db/migrate";
import { makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql, withTwoConnections } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-08T03:00:00Z"); // 10:00 in Ho Chi Minh City

/**
 * A shelf that already holds one copy coded `DT-0214`, so the next codes the
 * allocator hands out are `DT-0215`–`DT-0217` — the exact example both the
 * new-book form's hint and master §7.1's acceptance criterion use. Every test in
 * this file starts from that baseline, so a code assertion reads as the rule
 * rather than as an accident of how many rows a previous test left behind.
 */
async function shelfWithManager(slug = "dong-thap") {
  const shelf = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  await sql`
    insert into categories (slug, name, sort_order)
    values ('van-hoc-thieu-nhi', 'Văn học thiếu nhi', 10)
    on conflict (slug) do nothing
  `;
  const prefix = slug === "dong-thap" ? "DT" : "CT";
  const [existing] = await sql<{ id: string }[]>`
    insert into books (bookshelf_id, title, slug, author, is_published)
    values (${shelf.id}, 'Cũ', ${`cu-${slug}`}, 'A', true) returning id
  `;
  await sql`
    insert into book_copies (bookshelf_id, book_id, code)
    values (${shelf.id}, ${existing.id}, ${`${prefix}-0214`})
  `;
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  return { shelf, manager, ctx };
}

const BOOK = {
  title: "Dế Mèn Phiêu Lưu Ký",
  author: "Tô Hoài",
  categorySlug: "van-hoc-thieu-nhi",
  publisher: "Kim Đồng",
  publishedYear: 2019,
  pageCount: 176,
  copyCount: 3,
};

test("a book and its first copies are one transaction, with sequential codes", async () => {
  // OPS §1: "creating a book together with its initial batch of copies is one
  // cataloguing event ... not several commands stitched together, because a
  // book with zero copies is not yet meaningfully catalogued."
  const { ctx } = await shelfWithManager();

  const { bookId, copyIds } = await runCommand(sql, ctx, createBook, BOOK);

  expect(copyIds).toHaveLength(3);
  const codes = await sql<{ code: string }[]>`
    select code from book_copies where book_id = ${bookId} order by code
  `;
  // Master §7.1's acceptance criterion, spelled out in the new-book form's hint:
  // "Hệ thống sẽ tự sinh mã cho từng bản, ví dụ DT-0215, DT-0216, DT-0217".
  expect(codes.map((c) => c.code)).toEqual(["DT-0215", "DT-0216", "DT-0217"]);
});

test("the slug and the flags land on the row the fixtures already carry", async () => {
  const { ctx } = await shelfWithManager();
  const { bookId } = await runCommand(sql, ctx, createBook, BOOK);

  const [row] = await sql<
    {
      slug: string;
      is_published: boolean;
      language: string;
      title_folded: string;
      category_id: string;
      added_by: string;
    }[]
  >`select slug, is_published, language, title_folded, category_id, added_by
      from books where id = ${bookId}`;

  expect(row.slug).toBe("de-men-phieu-luu-ky");
  expect(row.is_published).toBe(true);
  expect(row.language).toBe("vi");
  // Generated column, not written by the command.
  expect(row.title_folded).toBe("de men phieu luu ky");
  expect(row.category_id).not.toBeNull();
  expect(row.added_by).toBe(ctx.actor.userId);
});

test("every generated copy starts available and perfect", async () => {
  // OPS §4.1: "each generated copy starts `available`".
  const { ctx } = await shelfWithManager();
  const { bookId } = await runCommand(sql, ctx, createBook, BOOK);
  const rows = await sql<{ state: string; condition: string }[]>`
    select state, condition from book_copies where book_id = ${bookId}
  `;
  expect(rows.every((r) => r.state === "available")).toBe(true);
  expect(rows.every((r) => r.condition === "perfect")).toBe(true);
});

test("the member donor lands on every copy the call creates", async () => {
  // Master §7.1's acceptance: donorMembershipId populates
  // acquired_from_membership_id. Split from a test that used to send
  // donorMembershipId *and* donorName together — see the QA remediation
  // Task 19 tests below for why that shape is now refused rather than
  // exercised as the happy path.
  const { shelf, ctx } = await shelfWithManager();
  const donor = await makeMember(sql, shelf.id);

  const { bookId } = await runCommand(sql, ctx, createBook, {
    ...BOOK,
    donorMembershipId: donor.id,
    acquiredOn: "2026-07-19",
  });

  const rows = await sql<
    {
      acquired_from: string | null;
      acquired_from_membership_id: string | null;
      acquired_on: Date;
    }[]
  >`select acquired_from, acquired_from_membership_id, acquired_on
      from book_copies where book_id = ${bookId}`;
  expect(rows).toHaveLength(3);
  expect(rows.every((r) => r.acquired_from === null)).toBe(true);
  expect(rows.every((r) => r.acquired_from_membership_id === donor.id)).toBe(true);
});

test("the free-text donor lands on every copy the call creates", async () => {
  // The other of the two ways OPS's donor picker offers — a donor with no
  // account, chosen instead of a member rather than alongside one.
  const { ctx } = await shelfWithManager();

  const { bookId } = await runCommand(sql, ctx, createBook, {
    ...BOOK,
    donorName: "bác Hoà",
    acquiredOn: "2026-07-19",
  });

  const rows = await sql<
    {
      acquired_from: string | null;
      acquired_from_membership_id: string | null;
    }[]
  >`select acquired_from, acquired_from_membership_id
      from book_copies where book_id = ${bookId}`;
  expect(rows).toHaveLength(3);
  expect(rows.every((r) => r.acquired_from === "bác Hoà")).toBe(true);
  expect(rows.every((r) => r.acquired_from_membership_id === null)).toBe(true);
});

/**
 * QA remediation Task 19. The add-book form says "chọn đúng MỘT trong hai
 * cách" (choose exactly ONE of the two ways) and, until this task, accepted
 * both: filling the donor <select> and the free-text box together wrote
 * `acquired_from = 'bác Hoà'` *and* `acquired_from_membership_id = <donor's
 * id>` onto every copy — two contradicting attributions on one row, with the
 * CSV export (`../queries/exports.ts`) reporting the free text and silently
 * discarding the membership link a manager thought they were recording. This
 * is the exact fixture the pre-existing "donor fields land on every copy"
 * test exercised as its happy path, unnoticed, until this task split it in
 * two above.
 */
test("filling both donor controls is refused, naming the field a manager can fix", async () => {
  const { shelf, ctx } = await shelfWithManager();
  const donor = await makeMember(sql, shelf.id);

  await expect(
    runCommand(sql, ctx, createBook, {
      ...BOOK,
      donorMembershipId: donor.id,
      donorName: "bác Hoà",
    }),
  ).rejects.toMatchObject({ code: "donor_ambiguous" });

  // Refused before any write — no book and no copy from the rejected call.
  expect(
    await sql`select 1 from books where bookshelf_id = ${shelf.id}`,
  ).toHaveLength(1); // shelfWithManager's own baseline book only.
});

test("neither donor control is filled: the ordinary case, not an error", async () => {
  // Restated from "a copy with no donor recorded is the ordinary case" below,
  // for the guard specifically: absence of both is not ambiguity.
  const { ctx } = await shelfWithManager();
  await expect(
    runCommand(sql, ctx, createBook, BOOK),
  ).resolves.toMatchObject({ bookId: expect.any(String) });
});

test("AddCopies refuses both donor controls at once too", async () => {
  // The guard belongs to both catalogue commands that write acquired_from* —
  // `DonorInput` is shared between them (`../commands/create-book.ts`).
  const { shelf, ctx } = await shelfWithManager();
  const { bookId } = await runCommand(sql, ctx, createBook, BOOK);
  const donor = await makeMember(sql, shelf.id);

  await expect(
    runCommand(sql, ctx, addCopies, {
      bookId,
      count: 1,
      donorMembershipId: donor.id,
      donorName: "bác Hoà",
    }),
  ).rejects.toMatchObject({ code: "donor_ambiguous" });

  expect(
    await sql`select 1 from book_copies where book_id = ${bookId}`,
  ).toHaveLength(3); // createBook's three; the rejected AddCopies added none.
});

test("a copy with no donor recorded is the ordinary case, not an error", async () => {
  // Master §7.1: "both may be absent, since most copies still arrive with no donor
  // recorded at all." acquiredOn still defaults to today, in Asia/Ho_Chi_Minh.
  const { ctx } = await shelfWithManager();
  const { bookId } = await runCommand(sql, ctx, createBook, BOOK);
  const [row] = await sql<
    {
      acquired_from: string | null;
      acquired_from_membership_id: string | null;
      acquired_on: Date;
    }[]
  >`select acquired_from, acquired_from_membership_id, acquired_on
      from book_copies where book_id = ${bookId} limit 1`;
  expect(row.acquired_from).toBeNull();
  expect(row.acquired_from_membership_id).toBeNull();
  expect(row.acquired_on.toISOString().slice(0, 10)).toBe("2026-08-08");
});

test("one audit entry per cataloguing event, naming the codes it produced", async () => {
  // OPS §4.1: CreateBook's audit action is `book.created` — singular, because
  // OPS §1 calls the book and its first copies one business fact. The codes go
  // in `after` so the audit browser can say which labels were printed.
  const { ctx } = await shelfWithManager();
  const { bookId } = await runCommand(sql, ctx, createBook, BOOK);

  const entries = await sql<
    { action: string; entity_id: string; after: { copyCodes: string[] } }[]
  >`select action, entity_id, after from audit_log`;
  expect(entries).toHaveLength(1);
  expect(entries[0].action).toBe("book.created");
  expect(entries[0].entity_id).toBe(bookId);
  expect(entries[0].after.copyCodes).toEqual(["DT-0215", "DT-0216", "DT-0217"]);
});

test("a missing required field fails with OPS §4.1's own sentence", async () => {
  const { shelf, ctx } = await shelfWithManager();
  await expect(
    runCommand(sql, ctx, createBook, { ...BOOK, title: "  " }),
  ).rejects.toBeInstanceOf(ValidationFailed);
  await expect(
    runCommand(sql, ctx, createBook, { ...BOOK, author: "" }),
  ).rejects.toMatchObject({ code: "required_fields_missing" });
  await expect(
    runCommand(sql, ctx, createBook, { ...BOOK, categorySlug: "khong-co" }),
  ).rejects.toMatchObject({ code: "category_not_found" });
  // shelfWithManager already seeded one book ("Cũ") for the baseline copy;
  // none of the three rejected calls above should have added another.
  expect(
    await sql`select 1 from books where bookshelf_id = ${shelf.id}`,
  ).toHaveLength(1);
});

test("a duplicate ISBN on the same shelf is refused; the same ISBN elsewhere is not", async () => {
  const { ctx } = await shelfWithManager();
  await runCommand(sql, ctx, createBook, { ...BOOK, isbn: "978-604-2-12345-6" });

  await expect(
    runCommand(sql, ctx, createBook, {
      ...BOOK,
      title: "Khác",
      isbn: "978-604-2-12345-6",
    }),
  ).rejects.toMatchObject({ code: "duplicate_isbn" });

  // OPS §4.1 scopes it to "trong tủ sách" — another parish holding the same
  // title is not a conflict.
  const other = await shelfWithManager("can-tho");
  await expect(
    runCommand(sql, other.ctx, createBook, { ...BOOK, isbn: "978-604-2-12345-6" }),
  ).resolves.toMatchObject({ bookId: expect.any(String) });
});

test("IMPORTANT 2: two concurrent CreateBook calls with the same ISBN do not both commit", async () => {
  // fix-report, 2026-08-08-b1-catalogue. The ISBN check ran *before*
  // allocateCopyCodes's advisory lock, so its window was not actually closed
  // by that lock — verified live, both committed and `select count(*) from
  // books where isbn = ...` returned 2. The check now runs after the lock,
  // so exactly one of these two must win.
  const { ctx } = await shelfWithManager();

  const results = await withTwoConnections((a, b) =>
    Promise.allSettled([
      runCommand(a, ctx, createBook, {
        ...BOOK,
        title: "Sách A",
        isbn: "SAME-ISBN",
      }),
      runCommand(b, ctx, createBook, {
        ...BOOK,
        title: "Sách B",
        isbn: "SAME-ISBN",
      }),
    ]),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const [rejected] = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  expect(rejected.reason).toMatchObject({ code: "duplicate_isbn" });

  const [{ count }] = await sql<{ count: string }[]>`
    select count(*) from books where isbn = 'SAME-ISBN'
  `;
  expect(count).toBe("1");
});

test("CRITICAL 1: a second, different edition of a title already on this shelf gets a disambiguated slug, not a 23505", async () => {
  // fix-report, 2026-08-08-b1-catalogue. books_bookshelf_id_slug_key is a
  // live partial unique index; cataloguing the same title twice used to
  // crash with a raw PostgresError 23505 — verified live.
  const { ctx } = await shelfWithManager();
  const first = await runCommand(sql, ctx, createBook, {
    ...BOOK,
    isbn: "EDITION-1",
  });
  const second = await runCommand(sql, ctx, createBook, {
    ...BOOK,
    isbn: "EDITION-2",
  });

  expect(first.bookId).not.toBe(second.bookId);
  const rows = await sql<{ id: string; slug: string }[]>`
    select id, slug from books where title = ${BOOK.title} order by created_at
  `;
  expect(rows.map((r) => r.slug)).toEqual([
    "de-men-phieu-luu-ky",
    "de-men-phieu-luu-ky-2",
  ]);

  // A third edition continues the sequence rather than colliding with -2.
  const third = await runCommand(sql, ctx, createBook, {
    ...BOOK,
    isbn: "EDITION-3",
  });
  const [thirdRow] = await sql<{ slug: string }[]>`
    select slug from books where id = ${third.bookId}
  `;
  expect(thirdRow.slug).toBe("de-men-phieu-luu-ky-3");
});

test("CRITICAL 1: two concurrent CreateBook calls for the same title never pick the same slug", async () => {
  // The advisory lock allocateCopyCodes already takes is what allocateCopyCodes
  // documents as the guarantee for copy codes; the slug disambiguation reuses
  // it (see nextAvailableSlug's docstring). Both calls must commit, each with
  // its own slug.
  const { ctx } = await shelfWithManager();

  const results = await withTwoConnections((a, b) =>
    Promise.allSettled([
      runCommand(a, ctx, createBook, { ...BOOK, isbn: "CONCURRENT-1" }),
      runCommand(b, ctx, createBook, { ...BOOK, isbn: "CONCURRENT-2" }),
    ]),
  );
  expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);

  const rows = await sql<{ slug: string }[]>`
    select slug from books where title = ${BOOK.title} order by slug
  `;
  expect(rows.map((r) => r.slug)).toEqual([
    "de-men-phieu-luu-ky",
    "de-men-phieu-luu-ky-2",
  ]);
});

test("a reader cannot catalogue a book", async () => {
  // BR §13.3: the screen hiding the button is not the security control.
  const { shelf, ctx } = await shelfWithManager();
  const reader = await makeMember(sql, shelf.id);
  const readerCtx: TenantContext = {
    ...ctx,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
  };
  await expect(runCommand(sql, readerCtx, createBook, BOOK)).rejects.toBeInstanceOf(
    RuleViolated,
  );
  // shelfWithManager already seeded one book ("Cũ") for the baseline copy;
  // the rejected call above should not have added another.
  expect(
    await sql`select 1 from books where bookshelf_id = ${shelf.id}`,
  ).toHaveLength(1);
});

test("AddCopies continues the same sequence and writes one audit row per copy", async () => {
  // OPS §4.1: "the record affected is singular per entry, so a batch of five
  // new copies is five audit rows".
  const { ctx } = await shelfWithManager();
  const { bookId } = await runCommand(sql, ctx, createBook, BOOK);
  // audit_log rows cannot be deleted (INV-12: audit_log_no_delete forbids
  // it) — a high-water mark on the identity column, rather than a delete,
  // isolates the entries this call produces from createBook's own.
  const [{ before }] = await sql<{ before: string }[]>`
    select coalesce(max(id), 0) as before from audit_log
  `;

  const { codes } = await runCommand(sql, ctx, addCopies, { bookId, count: 2 });

  expect(codes).toEqual(["DT-0218", "DT-0219"]);
  const entries = await sql<{ action: string; after: { code: string } }[]>`
    select action, after from audit_log where id > ${before} order by id
  `;
  expect(entries.map((e) => e.action)).toEqual(["copy.added", "copy.added"]);
  expect(entries.map((e) => e.after.code)).toEqual(["DT-0218", "DT-0219"]);
});

test("AddCopies on an unknown book, and a count of zero, are named failures", async () => {
  const { ctx } = await shelfWithManager();
  const { bookId } = await runCommand(sql, ctx, createBook, BOOK);

  await expect(
    runCommand(sql, ctx, addCopies, {
      bookId: "00000000-0000-0000-0000-000000000000",
      count: 1,
    }),
  ).rejects.toBeInstanceOf(NotFound);
  await expect(
    runCommand(sql, ctx, addCopies, { bookId, count: 0 }),
  ).rejects.toMatchObject({ code: "copy_count_invalid" });
});

test("AddCopies cannot reach a book on another shelf", async () => {
  // G4. RLS filters the lookup to zero rows; the command must turn that into
  // book_not_found rather than inserting an orphan copy.
  const a = await shelfWithManager("dong-thap");
  const b = await shelfWithManager("can-tho");
  const { bookId } = await runCommand(sql, b.ctx, createBook, BOOK);

  await expect(
    runCommand(sql, a.ctx, addCopies, { bookId, count: 1 }),
  ).rejects.toBeInstanceOf(NotFound);
  expect(
    await sql`select 1 from book_copies where book_id = ${bookId}`,
  ).toHaveLength(3);
});

test("two managers cataloguing at once get different codes, not an error", async () => {
  // The race this slice exists to get right. Without the per-shelf advisory
  // lock in allocateCopyCodes, both transactions read the same max and one
  // loses to book_copies_code_unique with a raw 23505 — verified live. With
  // it, they queue and both commit.
  const { shelf, ctx } = await shelfWithManager();
  const { bookId } = await runCommand(sql, ctx, createBook, BOOK);

  await withTwoConnections(async (a, b) => {
    const results = await Promise.allSettled([
      runCommand(a, ctx, addCopies, { bookId, count: 2 }),
      runCommand(b, ctx, addCopies, { bookId, count: 2 }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
  });

  const codes = await sql<{ code: string }[]>`
    select code from book_copies where bookshelf_id = ${shelf.id} order by code
  `;
  expect(codes.map((c) => c.code)).toEqual([
    "DT-0214", // the baseline copy shelfWithManager seeds
    "DT-0215",
    "DT-0216",
    "DT-0217", // createBook's three
    "DT-0218",
    "DT-0219",
    "DT-0220",
    "DT-0221", // two racing AddCopies calls
  ]);
});

test("a soft-deleted code is never handed out again", async () => {
  // book_copies_code_unique is partial (`where deleted_at is null`), so the
  // database would permit reuse. A code is a QR label stuck to a physical
  // book; the allocator scans every row, deleted or not.
  const { ctx } = await shelfWithManager();
  const { bookId } = await runCommand(sql, ctx, createBook, BOOK);
  await sql`update book_copies set deleted_at = now() where code = 'DT-0217'`;

  const { codes } = await runCommand(sql, ctx, addCopies, { bookId, count: 1 });
  expect(codes).toEqual(["DT-0218"]);
});

test("M7: a copy_code_prefix override containing an underscore is not treated as a LIKE wildcard", async () => {
  // fix-report, 2026-08-08-b1-catalogue. `code like ${prefix + "-%"}` with an
  // unescaped prefix would let Postgres's LIKE single-character wildcard
  // sweep a hand-imported code with a different letter in that position into
  // this shelf's sequence — verified live, an unescaped "D_T" prefix picked
  // up a hand-written "DXT-0099" and allocated "D_T-0100" instead of
  // "D_T-0001".
  const { shelf, ctx } = await shelfWithManager("thanhtam");
  await sql`update bookshelves set settings = '{"copy_code_prefix": "D_T"}'::jsonb where id = ${shelf.id}`;
  const { bookId } = await runCommand(sql, ctx, createBook, {
    ...BOOK,
    copyCount: 1,
  });
  // A hand-imported code that must NOT be swept into "D_T"'s own sequence.
  await sql`
    insert into book_copies (bookshelf_id, book_id, code, state, condition)
    values (${shelf.id}, ${bookId}, 'DXT-0099', 'available', 'perfect')
  `;

  const { codes } = await runCommand(sql, ctx, addCopies, { bookId, count: 1 });
  expect(codes).toEqual(["D_T-0002"]);
});
