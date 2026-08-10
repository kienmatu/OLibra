import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import {
  runAdminCommand,
  runAdminQuery,
} from "../../../src/domain/kernel/unit-of-work";
import { archiveCategory } from "../../../src/domain/catalogue/commands/archive-category";
import { createCategory } from "../../../src/domain/catalogue/commands/create-category";
import { renameCategory } from "../../../src/domain/catalogue/commands/rename-category";
import { getCategoriesAdmin } from "../../../src/domain/catalogue/queries/get-categories-admin";
import { migrate } from "../../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";
import { superAdminContext } from "../../support/scenarios";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const NOW = "2026-08-10T03:00:00Z";

/**
 * A super_admin whose context holds no shelf — what `adminContextFor` builds,
 * and therefore what `submitAdminCommand` always passes in production.
 *
 * Every category command runs through `runAdminCommand`, not
 * `runGlobalCommand`: the plan's own prose says "the same escalation
 * `createBookshelf` uses", and `createBookshelf` (`bookshelves-and-
 * -managers.test.ts`) is invoked through `runAdminCommand` throughout, never
 * `runGlobalCommand`. That is also the only one of the two that tolerates the
 * empty `bookshelfId` a real super_admin context carries — `runGlobalCommand`
 * requires a non-empty, valid shelf id (`assertValidBookshelfId(...,
 * { allowEmpty: false })` in `runAs`), which is correct for the shelf-scoped
 * commands it actually serves today (`markFeedbackRead`/`resolveFeedback`,
 * exercised through `runAdminCommand` in `feedback-inbox.test.ts` despite the
 * name) but wrong for a command with no shelf to be inside of at all.
 */
async function admin() {
  const { ctx } = await superAdminContext(sql, NOW);
  return ctx;
}

// ── Creating ───────────────────────────────────────────────────────────────

test("creates a category with a folded slug", async () => {
  const ctx = await admin();
  const { id, slug } = await runAdminCommand(sql, ctx, createCategory, {
    name: "Truyện thiếu nhi",
  });
  expect(slug).toBe("truyen-thieu-nhi");
  const [row] = await sql`select name, slug from categories where id = ${id}`;
  expect(row.name).toBe("Truyện thiếu nhi");
});

test("refuses a duplicate slug", async () => {
  const ctx = await admin();
  await runAdminCommand(sql, ctx, createCategory, { name: "Giáo lý" });
  await expect(
    runAdminCommand(sql, ctx, createCategory, { name: "giao ly" }),
  ).rejects.toMatchObject({ code: "duplicate_category" });
});

test("refuses a blank name", async () => {
  const ctx = await admin();
  await expect(
    runAdminCommand(sql, ctx, createCategory, { name: "   " }),
  ).rejects.toMatchObject({ code: "validation_failed" });
});

test("creating a category writes a global audit row", async () => {
  // It has to be global: `categories` is DATABASE.md §4.3's global reference
  // data, and the category did not exist when the decision was made — the
  // same argument `bookshelves-and-managers.test.ts` makes for
  // `bookshelf.created`.
  const ctx = await admin();
  await runAdminCommand(sql, ctx, createCategory, { name: "Truyện tranh" });

  const [row] = await sql<{ bookshelf_id: string | null }[]>`
    select bookshelf_id from audit_log where action = 'category.created'
  `;
  expect(row.bookshelf_id).toBeNull();
});

test("only a super_admin may create a category", async () => {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const managerCtx = {
    bookshelfId: shelf.id,
    actor: {
      userId: manager.userId,
      membershipId: manager.id,
      role: "manager" as const,
    },
    clock: fixedClock(NOW),
  };

  await expect(
    runAdminCommand(sql, managerCtx, createCategory, { name: "Truyện tranh" }),
  ).rejects.toMatchObject({ code: "not_permitted" });
});

// ── Renaming ───────────────────────────────────────────────────────────────

test("slug never changes on rename", async () => {
  const ctx = await admin();
  const { id, slug } = await runAdminCommand(sql, ctx, createCategory, {
    name: "Kỹ năng",
  });
  await runAdminCommand(sql, ctx, renameCategory, { id, name: "Kỹ năng sống" });
  const [row] = await sql`select name, slug from categories where id = ${id}`;
  expect(row).toEqual({ name: "Kỹ năng sống", slug });
});

test("renaming a category that does not exist is refused by name", async () => {
  const ctx = await admin();
  await expect(
    runAdminCommand(sql, ctx, renameCategory, {
      id: crypto.randomUUID(),
      name: "Bất kỳ",
    }),
  ).rejects.toMatchObject({ code: "category_not_found" });
});

// ── Archiving ──────────────────────────────────────────────────────────────

test("archiving is refused while a book still uses the category", async () => {
  const ctx = await admin();
  const { id } = await runAdminCommand(sql, ctx, createCategory, {
    name: "Truyện cổ tích",
  });
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const { bookId } = await makeBookWithCopies(sql, shelf.id, 1);
  await sql`update books set category_id = ${id} where id = ${bookId}`;

  await expect(
    runAdminCommand(sql, ctx, archiveCategory, { id }),
  ).rejects.toMatchObject({ code: "category_in_use" });
});

test("archiving a soft-deleted book's category is not blocked by it", async () => {
  // The guard's own query names `books.deleted_at is null` — a category whose
  // only book has since been deleted is not "in use" any more.
  const ctx = await admin();
  const { id } = await runAdminCommand(sql, ctx, createCategory, {
    name: "Truyện dài kỳ",
  });
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const { bookId } = await makeBookWithCopies(sql, shelf.id, 1);
  await sql`update books set category_id = ${id}, deleted_at = now() where id = ${bookId}`;

  await runAdminCommand(sql, ctx, archiveCategory, { id });
  const [row] = await sql<{ deleted_at: Date | null }[]>`
    select deleted_at from categories where id = ${id}
  `;
  expect(row.deleted_at).not.toBeNull();
});

test("archiving twice is refused: the second call finds nothing live", async () => {
  const ctx = await admin();
  const { id } = await runAdminCommand(sql, ctx, createCategory, {
    name: "Truyện ngắn",
  });
  await runAdminCommand(sql, ctx, archiveCategory, { id });

  await expect(
    runAdminCommand(sql, ctx, archiveCategory, { id }),
  ).rejects.toMatchObject({ code: "category_not_found" });
});

// ── The admin listing ─────────────────────────────────────────────────────

test("the admin listing counts only live books and hides archived categories", async () => {
  const ctx = await admin();
  const { id: keepId } = await runAdminCommand(sql, ctx, createCategory, {
    name: "Truyện thiếu nhi",
  });
  const { id: goneId } = await runAdminCommand(sql, ctx, createCategory, {
    name: "Sách cũ",
  });
  await runAdminCommand(sql, ctx, archiveCategory, { id: goneId });

  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const { bookId: liveBook } = await makeBookWithCopies(sql, shelf.id, 1);
  const { bookId: deadBook } = await makeBookWithCopies(sql, shelf.id, 1);
  await sql`update books set category_id = ${keepId} where id in (${liveBook}, ${deadBook})`;
  await sql`update books set deleted_at = now() where id = ${deadBook}`;

  const rows = await runAdminQuery(sql, ctx, (tx, c) => getCategoriesAdmin(tx, c));
  expect(rows.map((r) => r.slug)).not.toContain("sach-cu");
  expect(rows.find((r) => r.id === keepId)?.bookCount).toBe(1);
});
