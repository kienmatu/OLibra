import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

// IMPORTANT 3: docs/DATABASE.md §4.2 has documented `forbid_slug_change()`
// since before this branch, but no migration ever created the function or
// attached it as a trigger — confirmed live, `update bookshelves set
// slug = ...` returned `UPDATE 1`. BR §16.4: the slug is immutable because
// it is already out in the world by the time anyone wants to change it —
// printed QR labels, a link shared in a parish Zalo group — and a silent
// rename 404s every one of those with nothing telling anyone why.

test("BR §16.4: a bookshelf's slug cannot be changed once created", async () => {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });

  await expect(
    sql`update bookshelves set slug = 'dong-thap-moi' where id = ${shelf.id}`,
  ).rejects.toThrow(/slug is immutable/);
});

test("updating any other column on bookshelves still succeeds", async () => {
  const shelf = await makeShelf(sql, { slug: "an-giang" });

  await sql`update bookshelves set name = 'Tủ sách An Giang mới' where id = ${shelf.id}`;

  const [row] = await sql<{ name: string; slug: string }[]>`
    select name, slug from bookshelves where id = ${shelf.id}
  `;
  expect(row.name).toBe("Tủ sách An Giang mới");
  expect(row.slug).toBe("an-giang");
});
