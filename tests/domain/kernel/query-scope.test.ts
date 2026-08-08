import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { runQuery } from "../../../src/domain/kernel/unit-of-work";
import { migrate } from "../../../src/db/migrate";
import { makeBookWithCopies, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-07T10:00:00Z");

test("a query sees only its own shelf, even with no where clause", async () => {
  // INV-10. The query below is the mistake — `select * from books` with no
  // filter. It must return one row, not two.
  const a = await makeShelf(sql);
  const b = await makeShelf(sql);
  await makeBookWithCopies(sql, a.id, 1);
  await makeBookWithCopies(sql, b.id, 1);

  const rows = await runQuery(
    sql,
    {
      bookshelfId: a.id,
      actor: { userId: null, membershipId: null, role: "reader" },
      clock,
    },
    (tx) => tx<{ bookshelf_id: string }[]>`select bookshelf_id from books`,
  );

  expect(rows).toHaveLength(1);
  expect(rows[0].bookshelf_id).toBe(a.id);
});

test("a query cannot write", async () => {
  // Queries never change state (OPS §1). The read-only transaction makes that
  // structural rather than a naming convention.
  const a = await makeShelf(sql);
  await expect(
    runQuery(
      sql,
      {
        bookshelfId: a.id,
        actor: { userId: null, membershipId: null, role: "reader" },
        clock,
      },
      (tx) => tx`insert into books (bookshelf_id, title, author, slug, is_published)
                 values (${a.id}, 'x', 'y', 'z', true)`,
    ),
  ).rejects.toThrow(/read-only/i);
});
