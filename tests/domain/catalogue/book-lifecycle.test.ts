import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { NotFound, RuleViolated } from "../../../src/domain/kernel/errors";
import { runCommand } from "../../../src/domain/kernel/unit-of-work";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { updateBook } from "../../../src/domain/catalogue/commands/update-book";
import { deleteBook } from "../../../src/domain/catalogue/commands/delete-book";
import { migrate } from "../../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../../support/factories";
import {
  closeAll,
  resetDatabase,
  sql,
  withDelayedQuery,
  withTwoConnections,
} from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-08T03:00:00Z");

// `slug` defaults to "dong-thap" but is overridable — mirrors
// `create-book.test.ts`'s `shelfWithManager`. A test that needs two shelves
// at once (the cross-shelf "not-found" test below) must pass distinct slugs,
// since `bookshelves_slug_unique` is a plain, shelf-independent unique index.
async function catalogued(copies = 3, slug = "dong-thap") {
  const shelf = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, copies);
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  return { shelf, manager, ctx, bookId, copyIds };
}

/** A loan row, written directly — LendCopy is C1, and this slice must not wait for it. */
async function lend(
  shelfId: string,
  bookId: string,
  copyId: string,
  lentBy: string,
) {
  const borrower = await makeMember(sql, shelfId);
  const [loan] = await sql<{ id: string }[]>`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on)
    values (${shelfId}, ${copyId}, ${bookId}, ${borrower.userId}, ${lentBy}, date '2026-08-22')
    returning id
  `;
  await sql`update book_copies set state = 'on_loan' where id = ${copyId}`;
  return loan.id;
}

test("UpdateBook writes only the fields it was given, and audits before and after", async () => {
  const { ctx, bookId } = await catalogued();
  await sql`update books set publisher = 'Kim Đồng' where id = ${bookId}`;

  await runCommand(sql, ctx, updateBook, {
    bookId,
    title: "Dế Mèn Phiêu Lưu Ký",
    published: false,
  });

  const [row] = await sql<
    {
      title: string;
      author: string;
      is_published: boolean;
      slug: string;
      publisher: string;
    }[]
  >`select title, author, is_published, slug, publisher from books where id = ${bookId}`;
  expect(row.title).toBe("Dế Mèn Phiêu Lưu Ký");
  expect(row.is_published).toBe(false);
  // Untouched, because the input did not name it.
  expect(row.author).toBe("Tô Hoài");
  // `publisher` is nullable and reached through the ${x !== undefined ? x :
  // undefined} idiom rather than `coalesce` — this is exactly the field the
  // undefined-binding question lands on. An input that never names it must
  // not blank it, and (empirically, against the live `postgres` driver) an
  // implementation that lets a bare `undefined` reach the query would not
  // even do that silently: the driver rejects it with `UNDEFINED_VALUE:
  // Undefined values are not allowed`, an unstructured exception from
  // inside the transaction. Either failure mode is caught here.
  expect(row.publisher).toBe("Kim Đồng");

  const [entry] = await sql<
    {
      action: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }[]
  >`select action, before, after from audit_log where action = 'book.updated'`;
  expect(entry.before).toMatchObject({ isPublished: true });
  expect(entry.after).toMatchObject({
    title: "Dế Mèn Phiêu Lưu Ký",
    isPublished: false,
  });
});

test("IMPORTANT 3: a concurrent edit to a field this call never named is not silently reverted", async () => {
  // fix-report, 2026-08-08-b1-catalogue. The first fix for the
  // undefined-binding question read every optional column's current value
  // up front and bound that same JS value back at the end, which makes the
  // UPDATE a full-row write: a second manager's commit landing in the
  // window between this command's own read and its own write was silently
  // discarded — verified live, with a manually-controlled transaction
  // reproducing exactly this window, two connections, manager A editing
  // title, manager B committing a publisher change mid-flight; B's
  // publisher came back overwritten with A's stale snapshot.
  //
  // withDelayedQuery holds connection A's own `before` read open — inside
  // its own transaction, past its own await — until B's entire, separate
  // runCommand has committed, so the interleaving is deterministic rather
  // than a race that might not land in the window at all.
  const { ctx, bookId } = await catalogued();
  await sql`update books set publisher = 'NXB Cũ' where id = ${bookId}`;

  await withTwoConnections(async (a, b) => {
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const delayedA = withDelayedQuery(
      a,
      (s) => s.includes("select title, author, isbn, is_published"),
      gate,
    );

    const pendingA = runCommand(delayedA, ctx, updateBook, {
      bookId,
      title: "Tên Mới",
    });
    // Give A's own `before` read time to be sent and its (delayed)
    // resolution queued before B starts.
    await new Promise((r) => setTimeout(r, 20));

    await runCommand(b, ctx, updateBook, { bookId, publisher: "NXB Mới" });
    releaseGate();
    await pendingA;
  });

  const [row] = await sql<
    { title: string; publisher: string }[]
  >`select title, publisher from books where id = ${bookId}`;
  expect(row.title).toBe("Tên Mới");
  // The field this call is about, per the docstring on `undefined`-binding.
  expect(row.publisher).toBe("NXB Mới");
});

test("M5: an update that trims a title stores the same trimmed value it audits", async () => {
  // fix-report, 2026-08-08-b1-catalogue. `title = coalesce(${input.title ??
  // null}, title)` bound the raw, untrimmed input, while the audit's `after`
  // used `input.title?.trim()` — so the row and the audit trail disagreed
  // about a title with leading/trailing whitespace. Both now come from one
  // trimmed value.
  const { ctx, bookId } = await catalogued();

  await runCommand(sql, ctx, updateBook, {
    bookId,
    title: "  Tên Có Khoảng Trắng  ",
  });

  const [row] = await sql<{ title: string }[]>`
    select title from books where id = ${bookId}
  `;
  expect(row.title).toBe("Tên Có Khoảng Trắng");

  const [entry] = await sql<{ after: { title: string } }[]>`
    select after from audit_log where action = 'book.updated'
  `;
  expect(entry.after.title).toBe(row.title);
});

test("UpdateBook does not move the slug out from under an existing link", async () => {
  // BR §16.4 fixes a *bookshelf's* slug after creation and the database
  // enforces it (`bookshelves_no_slug_change`). Nothing says the same of a
  // book — but `books.slug` is what /tu-sach/[shelf]/sach/[slug] resolves,
  // and silently rewriting it turns every shared link into a 404. Renaming a
  // title is a metadata edit, not a re-cataloguing; the slug is decided once,
  // by CreateBook.
  const { ctx, bookId } = await catalogued();
  const [before] = await sql<
    { slug: string }[]
  >`select slug from books where id = ${bookId}`;

  await runCommand(sql, ctx, updateBook, {
    bookId,
    title: "Một Tên Hoàn Toàn Khác",
  });

  const [after] = await sql<
    { slug: string }[]
  >`select slug from books where id = ${bookId}`;
  expect(after.slug).toBe(before.slug);
});

test("UpdateBook on another shelf's book is not-found, not a silent no-op", async () => {
  // The exact failure the kernel's guarded Tx exists for: RLS filters an
  // UPDATE to zero rows rather than raising, so without the guard this
  // resolves having changed nothing while committing an audit row that says
  // it did.
  const a = await catalogued(3, "dong-thap");
  const b = await catalogued(3, "can-tho");

  await expect(
    runCommand(sql, a.ctx, updateBook, { bookId: b.bookId, title: "HACKED" }),
  ).rejects.toBeInstanceOf(NotFound);

  const [row] = await sql<
    { title: string }[]
  >`select title from books where id = ${b.bookId}`;
  expect(row.title).not.toBe("HACKED");
  expect(await sql`select 1 from audit_log`).toHaveLength(0);
});

test("UpdateBook refuses an ISBN already used on this shelf", async () => {
  const { ctx, bookId } = await catalogued();
  const other = await makeBookWithCopies(sql, ctx.bookshelfId, 1);
  await sql`update books set isbn = '978-604-2-12345-6' where id = ${other.bookId}`;

  await expect(
    runCommand(sql, ctx, updateBook, { bookId, isbn: "978-604-2-12345-6" }),
  ).rejects.toMatchObject({ code: "duplicate_isbn" });
});

test("Q7: DeleteBook soft-deletes the book and the copies that have no history", async () => {
  // BR §11: "Only a book's copies follow it when the book itself goes."
  // Nothing is hard-deleted — olibra_app holds no DELETE privilege at all.
  const { ctx, bookId } = await catalogued(3);

  const result = await runCommand(sql, ctx, deleteBook, { bookId });

  expect(result).toEqual({ copiesDeleted: 3, copiesRetained: 0 });
  const [book] = await sql<{ deleted_at: Date | null }[]>`
    select deleted_at from books where id = ${bookId}
  `;
  expect(book.deleted_at).not.toBeNull();
  const copies = await sql<{ deleted_at: Date | null }[]>`
    select deleted_at from book_copies where book_id = ${bookId}
  `;
  expect(copies.every((c) => c.deleted_at !== null)).toBe(true);
});

test("a copy with loan history is retained, not deleted, and the count says so", async () => {
  // BR §11: "A copy with loan history cannot be removed." OPS §4.1 files
  // `copy_has_history` under Failure modes but describes a retention rule;
  // this plan implements the rule, so the command reports what it did rather
  // than refusing the whole delete.
  const { ctx, shelf, manager, bookId, copyIds } = await catalogued(3);
  const loanId = await lend(shelf.id, bookId, copyIds[0], manager.userId);
  await sql`
    update loans set status = 'returned', returned_at = now(),
                     received_by = ${manager.userId}, return_condition = 'perfect'
    where id = ${loanId}
  `;
  await sql`update book_copies set state = 'available' where id = ${copyIds[0]}`;

  const result = await runCommand(sql, ctx, deleteBook, { bookId });

  expect(result).toEqual({ copiesDeleted: 2, copiesRetained: 1 });
  const [kept] = await sql<{ deleted_at: Date | null }[]>`
    select deleted_at from book_copies where id = ${copyIds[0]}
  `;
  expect(kept.deleted_at).toBeNull();
});

test("DeleteBook refuses while a copy is out or held", async () => {
  // OPS §4.1: has_active_loans — "Không thể xoá sách đang có bản được mượn."
  const { ctx, shelf, manager, bookId, copyIds } = await catalogued(2);
  await lend(shelf.id, bookId, copyIds[0], manager.userId);

  await expect(runCommand(sql, ctx, deleteBook, { bookId })).rejects.toMatchObject({
    code: "has_active_loans",
  });

  const [book] = await sql<{ deleted_at: Date | null }[]>`
    select deleted_at from books where id = ${bookId}
  `;
  expect(book.deleted_at).toBeNull();

  // `held` counts too, for the reader waiting on the hold.
  await sql`update book_copies set state = 'available' where id = ${copyIds[0]}`;
  await sql`update loans set status = 'voided', void_reason = 'x' where book_id = ${bookId}`;
  await sql`update book_copies set state = 'held' where id = ${copyIds[1]}`;
  await expect(runCommand(sql, ctx, deleteBook, { bookId })).rejects.toMatchObject({
    code: "has_active_loans",
  });
});

test("DeleteBook audits the delete with the retention it performed", async () => {
  const { ctx, bookId } = await catalogued(2);
  await runCommand(sql, ctx, deleteBook, { bookId });

  const [entry] = await sql<
    { action: string; entity_id: string; after: { copiesDeleted: number } }[]
  >`select action, entity_id, after from audit_log where action = 'book.deleted'`;
  expect(entry.entity_id).toBe(bookId);
  expect(entry.after.copiesDeleted).toBe(2);
});

test("M6: DeleteBook writes deleted_at through the injected clock, not SQL's now()", async () => {
  // fix-report, 2026-08-08-b1-catalogue. `update ... set deleted_at = now()`
  // used Postgres's own clock while the audited `deletedAt` used
  // `ctx.clock.now()` — under the suite's fixed clock (2026-08-08T03:00:00Z)
  // those differ by hours, and G6 requires every command to write time
  // through the injected clock so a test can move it.
  const { ctx, bookId } = await catalogued(1);

  await runCommand(sql, ctx, deleteBook, { bookId });

  const [book] = await sql<{ deleted_at: Date }[]>`
    select deleted_at from books where id = ${bookId}
  `;
  const [copy] = await sql<{ deleted_at: Date }[]>`
    select deleted_at from book_copies where book_id = ${bookId}
  `;
  expect(book.deleted_at.toISOString()).toBe(clock.now().toISOString());
  expect(copy.deleted_at.toISOString()).toBe(clock.now().toISOString());
});

test("a reader can neither edit nor delete", async () => {
  const { ctx, shelf, bookId } = await catalogued(1);
  const reader = await makeMember(sql, shelf.id);
  const readerCtx: TenantContext = {
    ...ctx,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
  };
  await expect(
    runCommand(sql, readerCtx, updateBook, { bookId, title: "x" }),
  ).rejects.toBeInstanceOf(RuleViolated);
  await expect(
    runCommand(sql, readerCtx, deleteBook, { bookId }),
  ).rejects.toBeInstanceOf(RuleViolated);
});
