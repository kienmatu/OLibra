import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { runPublicQuery } from "../../../src/domain/kernel/unit-of-work";
import { findPublicShelf } from "../../../src/domain/portal/queries/find-public-shelf";
import { migrate } from "../../../src/db/migrate";
import { makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

/**
 * IMPORTANT 3 (fix-report, 2026-08-09-u2-shelf-and-portal). The lookup behind
 * the sign-in form's heading.
 *
 * Against a real database for the same reason `list-public-shelves.test.ts`
 * gives: the question is what a caller with no shelf and no session may see,
 * and that is decided by Postgres privileges and policies rather than by
 * anything in TypeScript.
 */

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

async function makeNamedShelf(slug: string, name: string) {
  const shelf = await makeShelf(sql, { slug });
  await sql`update bookshelves set name = ${name} where id = ${shelf.id}`;
  return shelf;
}

const find = (slug: string) =>
  runPublicQuery(sql, (tx) => findPublicShelf(tx, { slug }));

test("it names the parish the visitor actually asked for", async () => {
  // The whole defect, in one assertion. Three shelves exist; the sign-in page
  // rendered a fixture and said "Tủ sách Đồng Tháp" to all three parishes'
  // visitors. A lookup by slug is what makes the heading follow the link.
  await makeNamedShelf("dong-thap", "Tủ sách Đồng Tháp");
  await makeNamedShelf("vinh-long", "Tủ sách Vĩnh Long");
  await makeNamedShelf("can-tho", "Tủ sách Cần Thơ");

  expect((await find("vinh-long"))?.name).toBe("Tủ sách Vĩnh Long");
  expect((await find("can-tho"))?.name).toBe("Tủ sách Cần Thơ");
  expect((await find("dong-thap"))?.name).toBe("Tủ sách Đồng Tháp");
});

test("it returns the shelf's name, address and slug — and no other key", async () => {
  // The same assertion `list-public-shelves.test.ts` makes, on the same
  // grounds and for the same reason: what reaches a stranger is the object,
  // not the SQL, and this query returns the driver's row unmapped so the keys
  // are the columns. A `keeper_phone` added to the `select` fails here even if
  // no TypeScript declared it.
  const shelf = await makeNamedShelf("dong-thap", "Tủ sách Đồng Tháp");
  await sql`
    update bookshelves set
      location = 'Nhà xứ Đồng Tháp, ấp Tân Hoà',
      keeper_name = 'Maria Nguyễn Thị Lan',
      keeper_phone = '0912345678'
    where id = ${shelf.id}
  `;

  const row = await find("dong-thap");
  expect(Object.keys(row ?? {}).sort()).toEqual(["location", "name", "slug"]);
});

test("a slug naming nothing is null, not an error", async () => {
  // `loadPublicPage` catches nothing, deliberately, so a throw here would turn
  // a hand-typed `?tu-sach=` into an HTTP 500 on the sign-in form. The page
  // falls back to the front-door header instead.
  await makeNamedShelf("dong-thap", "Tủ sách Đồng Tháp");

  expect(await find("khong-co-tu-sach-nay")).toBeNull();
  expect(await find("")).toBeNull();
});

test("an archived or soft-deleted shelf is not found, the same as the directory", async () => {
  // `bookshelves_public_read`'s own comment: "an archived or soft-deleted
  // shelf has no business being discoverable by slug." The `where` clause here
  // repeats that predicate rather than leaning on the policy, for the reason
  // `listPublicShelves` records — `bookshelves_tenant` is a second permissive
  // policy, and Postgres ORs permissive policies together — and this is the
  // half of that which a public caller can see.
  const archived = await makeNamedShelf("can-tho", "Tủ sách Cần Thơ");
  const gone = await makeNamedShelf("ben-tre", "Tủ sách Bến Tre");
  await sql`update bookshelves set status = 'archived' where id = ${archived.id}`;
  await sql`update bookshelves set deleted_at = now() where id = ${gone.id}`;

  expect(await find("can-tho")).toBeNull();
  expect(await find("ben-tre")).toBeNull();
});

test("it takes no more privilege than the directory does", async () => {
  // It runs as `olibra_public` (20260809_01_public_role.sql), which holds a
  // column-level `select` on five columns of `bookshelves` and no grant
  // anywhere else. Asserted here rather than assumed because this query is new
  // and the temptation with a "just one row" lookup is to reach for a wider
  // path to get it.
  await makeNamedShelf("dong-thap", "Tủ sách Đồng Tháp");

  const role = await runPublicQuery(sql, async (tx) => {
    await findPublicShelf(tx, { slug: "dong-thap" });
    const [who] = await tx<{ role: string }[]>`select current_user as role`;
    return who.role;
  });
  expect(role).toBe("olibra_public");
});
