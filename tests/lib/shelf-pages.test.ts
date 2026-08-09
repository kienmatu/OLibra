import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import { NotFound, RuleViolated } from "../../src/domain/kernel/errors";
import type { TenantContext } from "../../src/domain/kernel/tenant";
import { runCommand, runQuery } from "../../src/domain/kernel/unit-of-work";
import { createBook } from "../../src/domain/catalogue/commands/create-book";
import { readCatalogueCategories } from "../../src/lib/catalogue";
import { readShelfIdentity } from "../../src/lib/shelf";
import { statusForAvailability } from "../../src/lib/status";
import { migrate } from "../../src/db/migrate";
import { makeMember, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/**
 * The surface helpers the four member shelf pages are built out of (U2 Task 4),
 * the way `tests/lib/lending-screens.test.ts` covers U1's five.
 *
 * These are lookups and one mapping, not rules — the rules stay in
 * `src/domain/`. So what is worth pinning is not "does the select work", which
 * `tests/domain/catalogue/` already answers for every query these pages call,
 * but the three things a *surface* helper can get wrong on its own:
 *
 * 1. **The disclosure gate.** `readShelfIdentity` names `keeper_name` and
 *    `keeper_phone`, the two columns BR §16.1 withholds from anyone without a
 *    membership and the two `tests/db/bookshelves-public-columns.test.ts`
 *    exists for. That file lets this one through on the argument that the read
 *    refuses a non-member itself. This is where that argument is a fact.
 * 2. **Agreement with the query beside it.** The catalogue's category filter
 *    must offer exactly the categories `getCatalogue` can return rows for. A
 *    filter that lists a category whose only titles are drafts is a chip that
 *    empties the page.
 * 3. **A state with no honest answer.** A title with no live copies at all has
 *    no badge, and the mapping has to say so rather than reach for the nearest
 *    one.
 */

const clock = fixedClock("2026-08-08T03:00:00Z");

async function shelfWith(
  over: Partial<{
    location: string | null;
    openingHours: string | null;
    keeperName: string | null;
    keeperPhone: string | null;
  }> = {},
) {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  // `??` would be wrong here and quietly so: the interesting case a caller
  // passes is `null`, and `null ?? default` is the default.
  const or = <T>(given: T | undefined, fallback: T) =>
    given === undefined ? fallback : given;
  await sql`
    update bookshelves set
      location      = ${or(over.location, "Nhà xứ Đồng Tháp, ấp Tân Hoà, xã Tân Phú")},
      opening_hours = ${or(over.openingHours, "Mở sau lễ Chúa nhật · 9:00 đến 11:00")},
      keeper_name   = ${or(over.keeperName, "Maria Nguyễn Thị Lan")},
      keeper_phone  = ${or(over.keeperPhone, "0912 345 678")}
    where id = ${shelf.id}
  `;
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const reader = await makeMember(sql, shelf.id);
  const managerCtx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  const readerCtx: TenantContext = {
    ...managerCtx,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
  };
  const guestCtx: TenantContext = {
    ...managerCtx,
    actor: { userId: null, membershipId: null, role: "guest" },
  };
  return { shelf, managerCtx, readerCtx, guestCtx };
}

// — the shelf's own identity, and who may read it —

test("a member gets the keeper's name and number, which is what the page shows", async () => {
  // BR:497, shelf home item 1: "name, where it is, when it is open, who holds
  // the key with a tappable phone number." BR:511 puts the same pair in the
  // book page's contact line, word for word.
  const { readerCtx } = await shelfWith();

  const shelf = await runQuery(sql, readerCtx, (tx, c) => readShelfIdentity(tx, c));

  expect(shelf).toEqual({
    name: "Tủ sách dong-thap",
    location: "Nhà xứ Đồng Tháp, ấp Tân Hoà, xã Tân Phú",
    openingHours: "Mở sau lễ Chúa nhật · 9:00 đến 11:00",
    keeperName: "Maria Nguyễn Thị Lan",
    keeperPhone: "0912 345 678",
  });
});

test("a guest is refused the keeper's contact details, by this read and not by the page", async () => {
  // The whole justification for `src/lib/shelf.ts`'s entry in
  // `tests/db/bookshelves-public-columns.test.ts`. `bookshelves_public_read`
  // admits every active shelf's *row* to any caller, so RLS does not stop this
  // — the column list plus this refusal do. And the refusal has to be here:
  // `loadPage` hands a page its `Tx` before any query beside this one has run
  // its own `requireReader`, so a helper that trusted its neighbour would be
  // one reordered line away from reading a phone number for a stranger.
  //
  // `RuleViolated`, which `loadPage` turns into a redirect for a guest and a
  // 404 for a signed-in non-member — the same answer every other page of the
  // shelf gives them.
  const { guestCtx } = await shelfWith();

  await expect(
    runQuery(sql, guestCtx, (tx, c) => readShelfIdentity(tx, c)),
  ).rejects.toBeInstanceOf(RuleViolated);
});

test("a shelf that has filled in nothing but its name is rows the page omits, not nulls it prints", async () => {
  // Every column but the name is nullable, and a parish onboarded on a Sunday
  // afternoon has filled in what it knew. The page keys each row on these being
  // null; returning "" instead would print a "Giờ mở cửa" label over a blank.
  const { readerCtx } = await shelfWith({
    location: null,
    openingHours: null,
    keeperName: null,
    keeperPhone: null,
  });

  const shelf = await runQuery(sql, readerCtx, (tx, c) => readShelfIdentity(tx, c));

  expect(shelf).toEqual({
    name: "Tủ sách dong-thap",
    location: null,
    openingHours: null,
    keeperName: null,
    keeperPhone: null,
  });
});

test("a shelf id naming nothing is shelf_not_found, not a TypeError", async () => {
  // The row can vanish between `contextFor` resolving the id and this read
  // running. Destructuring an absent row would be a `TypeError` from inside a
  // render; `NotFound("shelf_not_found")` is the code `loadPage` maps to a 404.
  const { readerCtx } = await shelfWith();
  const gone: TenantContext = {
    ...readerCtx,
    bookshelfId: "00000000-0000-4000-8000-000000000000",
  };

  await expect(
    runQuery(sql, gone, (tx) => readShelfIdentity(tx, gone)),
  ).rejects.toBeInstanceOf(NotFound);
});

test("RLS is not what withholds the keeper's contact — the gate inside this read is", async () => {
  // The fact `tests/db/bookshelves-public-columns.test.ts` is built on, asserted
  // instead of assumed, because it is counter-intuitive and it decides where
  // the check has to live.
  //
  // `bookshelves_public_read` (20260808_12) is a *permissive* `for select`
  // policy over every active, undeleted shelf, and Postgres ORs permissive
  // policies together — so `bookshelves_tenant`'s `id = <the GUC>` does not
  // narrow `bookshelves` at all. Inside a transaction scoped to Đồng Tháp, a
  // plain select of Cần Thơ's `keeper_phone` returns it. That is deliberate
  // (it is what lets `resolveShelfId` and the portal work before anybody has a
  // membership), and it means the column list plus an explicit refusal are the
  // whole of what protects those two columns — never the tenant policy.
  const { readerCtx, guestCtx } = await shelfWith();
  const theirs = await makeShelf(sql, { slug: "can-tho" });
  await sql`update bookshelves set keeper_phone = '0909 000 111' where id = ${theirs.id}`;

  const reachable = await runQuery(
    sql,
    readerCtx,
    (tx) => tx<{ keeper_phone: string }[]>`
      select keeper_phone from bookshelves where id = ${theirs.id}
    `,
  );
  expect(reachable).toEqual([{ keeper_phone: "0909 000 111" }]);

  // And this is what actually stops a stranger seeing it: not the policy, but
  // `requireReader` at the top of the function that names the column.
  await expect(
    runQuery(sql, guestCtx, (tx, c) => readShelfIdentity(tx, c)),
  ).rejects.toBeInstanceOf(RuleViolated);
});

// — the catalogue's category filter —

async function catalogued(ctx: TenantContext, title: string, categorySlug: string) {
  return runCommand(sql, ctx, createBook, {
    title,
    author: "Tô Hoài",
    categorySlug,
    copyCount: 1,
  });
}

async function seedCategories() {
  await sql`
    insert into categories (slug, name, sort_order) values
      ('van-hoc-thieu-nhi', 'Văn học thiếu nhi', 10),
      ('van-hoc-viet-nam',  'Văn học Việt Nam',  20),
      ('lich-su',           'Lịch sử',           30)
    on conflict (slug) do nothing
  `;
}

test("the filter offers the categories this shelf stocks, and no others", async () => {
  // `categories` is global reference data with no `bookshelf_id`, so a helper
  // that simply selected the table would offer a parish every category in the
  // deployment — most of them chips that empty the grid. The join through
  // `books` is what makes the list a fact about this shelf, and RLS on `books`
  // is what makes it *this* shelf's.
  await seedCategories();
  const { managerCtx, readerCtx } = await shelfWith();
  await catalogued(managerCtx, "Dế Mèn Phiêu Lưu Ký", "van-hoc-thieu-nhi");

  const categories = await runQuery(sql, readerCtx, (tx, c) =>
    readCatalogueCategories(tx, c),
  );

  expect(categories).toEqual([
    { slug: "van-hoc-thieu-nhi", name: "Văn học thiếu nhi" },
  ]);
});

test("another shelf's categories do not leak into this shelf's filter", async () => {
  await seedCategories();
  const { managerCtx, readerCtx } = await shelfWith();
  await catalogued(managerCtx, "Dế Mèn Phiêu Lưu Ký", "van-hoc-thieu-nhi");

  const theirs = await makeShelf(sql, { slug: "can-tho" });
  const theirManager = await makeMember(sql, theirs.id, { role: "manager" });
  await catalogued(
    {
      bookshelfId: theirs.id,
      actor: {
        userId: theirManager.userId,
        membershipId: theirManager.id,
        role: "manager",
      },
      clock,
    },
    "Sách Cần Thơ",
    "lich-su",
  );

  const categories = await runQuery(sql, readerCtx, (tx, c) =>
    readCatalogueCategories(tx, c),
  );

  expect(categories.map((c) => c.slug)).toEqual(["van-hoc-thieu-nhi"]);
});

test("a category whose only titles are drafts is not offered", async () => {
  // The agreement that matters: `getCatalogue` filters `is_published`, so a
  // chip for a draft-only category is one that empties the grid and reads as
  // the page being broken. It also discloses to a reader that a title they
  // cannot see exists, which is what `is_published` is for (BR §5.4).
  await seedCategories();
  const { managerCtx, readerCtx } = await shelfWith();
  await catalogued(managerCtx, "Dế Mèn Phiêu Lưu Ký", "van-hoc-thieu-nhi");
  const draft = await catalogued(managerCtx, "Bản Nháp", "lich-su");
  await sql`update books set is_published = false where id = ${draft.bookId}`;

  const categories = await runQuery(sql, readerCtx, (tx, c) =>
    readCatalogueCategories(tx, c),
  );

  expect(categories.map((c) => c.slug)).toEqual(["van-hoc-thieu-nhi"]);
});

test("categories come back once each, in the order DATABASE.md §4.3 fixes", async () => {
  // Three titles in one category must not produce three identical chips —
  // `select distinct` over a join is the whole reason that keyword is there —
  // and the order is `sort_order`, which is the column that fixed list exists
  // to carry, not insertion order and not the byte order of the names.
  await seedCategories();
  const { managerCtx, readerCtx } = await shelfWith();
  await catalogued(managerCtx, "Lịch Sử Nước Nhà", "lich-su");
  await catalogued(managerCtx, "Dế Mèn Phiêu Lưu Ký", "van-hoc-thieu-nhi");
  await catalogued(managerCtx, "Đất Rừng Phương Nam", "van-hoc-thieu-nhi");
  await catalogued(managerCtx, "Tuổi Thơ Dữ Dội", "van-hoc-thieu-nhi");

  const categories = await runQuery(sql, readerCtx, (tx, c) =>
    readCatalogueCategories(tx, c),
  );

  expect(categories.map((c) => c.slug)).toEqual(["van-hoc-thieu-nhi", "lich-su"]);
});

test("a guest is refused the category list too", async () => {
  await seedCategories();
  const { managerCtx, guestCtx } = await shelfWith();
  await catalogued(managerCtx, "Dế Mèn Phiêu Lưu Ký", "van-hoc-thieu-nhi");

  await expect(
    runQuery(sql, guestCtx, (tx, c) => readCatalogueCategories(tx, c)),
  ).rejects.toBeInstanceOf(RuleViolated);
});

// — a title with no honest badge —

test("a title with no live copies gets no badge rather than the nearest one", () => {
  // `Availability` is `CopyState | "none"`, and `"none"` exists because M8
  // found every query falling through to `retired` for a title with nothing to
  // count. "Ngừng dùng" is a claim about copies that were withdrawn; a title
  // with no copies has none to withdraw, so the honest render is no badge —
  // the same answer the lending search already gives a blocked row.
  expect(statusForAvailability("none")).toBeNull();

  expect(statusForAvailability("available")).toBe("available");
  expect(statusForAvailability("on_loan")).toBe("onloan");
  expect(statusForAvailability("held")).toBe("held");
  expect(statusForAvailability("lost")).toBe("lost");
  expect(statusForAvailability("retired")).toBe("retired");
});
