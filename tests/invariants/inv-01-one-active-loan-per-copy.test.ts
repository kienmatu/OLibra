import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql, withTwoConnections } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

test("INV-1: two managers lending the same copy — exactly one succeeds", async () => {
  // BR §2 states the scenario plainly: two managers, two phones, one physical
  // shelf, the same second. BR INV-1 requires the datastore to guarantee this,
  // not application checks, because a read-then-write has a race window that
  // no amount of care closes.
  const shelf = await makeShelf(sql);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const readerA = await makeMember(sql, shelf.id);
  const readerB = await makeMember(sql, shelf.id);
  const copyId = copyIds[0];

  const outcomes = await withTwoConnections(async (a, b) => {
    const insert = (conn: typeof a, borrower: string) => conn`
      insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status)
      values (${shelf.id}, ${copyId}, ${bookId}, ${borrower}, ${borrower}, current_date + 14, 'active')
    `;
    return Promise.allSettled([
      insert(a, readerA.userId),
      insert(b, readerB.userId),
    ]);
  });

  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(1);

  const active = await sql`
    select 1 from loans where copy_id = ${copyId} and status = 'active'
  `;
  expect(active).toHaveLength(1);
});

test("INV-1: the loser fails with a unique violation, distinguishably", async () => {
  // SDD §10.3 — the application must be able to tell a unique violation from
  // any other database error, so it can render "Bản sách này vừa được mượn"
  // rather than a 500.
  const shelf = await makeShelf(sql);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);

  const insert = () => sql`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status)
    values (${shelf.id}, ${copyIds[0]}, ${bookId}, ${reader.userId}, ${reader.userId}, current_date + 14, 'active')
  `;

  await insert();
  await expect(insert()).rejects.toMatchObject({ code: "23505" });
});

test("INV-1: a returned loan frees the copy for a new one", async () => {
  // The partial index must be partial. A plain unique index on copy_id would
  // pass the first test and make a book unlendable forever after its first
  // return, which is a far worse bug than the one being prevented.
  const shelf = await makeShelf(sql);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);

  await sql`
    insert into loans (
      bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status, return_condition
    )
    values (
      ${shelf.id}, ${copyIds[0]}, ${bookId}, ${reader.userId}, ${reader.userId},
      current_date + 14, 'returned', 'perfect'
    )
  `;
  await expect(sql`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status)
    values (${shelf.id}, ${copyIds[0]}, ${bookId}, ${reader.userId}, ${reader.userId}, current_date + 14, 'active')
  `).resolves.toBeDefined();
});
