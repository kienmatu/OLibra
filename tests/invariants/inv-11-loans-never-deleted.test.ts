import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

test("INV-11: a loan cannot be deleted, only voided", async () => {
  // BR §6 / DATABASE.md §7: mistakes are recorded as *voided* with a reason
  // (loans_voided_has_reason, 0005_circulation.sql), never erased. There is
  // no deleted_at column on loans (schema.test.ts covers that half); this
  // test covers the other half — that a plain SQL DELETE is refused outright,
  // not merely unmodeled by the application.
  const shelf = await makeShelf(sql);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);

  const [loan] = await sql<{ id: string }[]>`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status)
    values (${shelf.id}, ${copyIds[0]}, ${bookId}, ${reader.userId}, ${reader.userId}, current_date + 14, 'active')
    returning id
  `;

  await expect(sql`delete from loans where id = ${loan.id}`).rejects.toThrow();

  const stillThere = await sql`select 1 from loans where id = ${loan.id}`;
  expect(stillThere).toHaveLength(1);
});

test("INV-11: voiding a loan (an update) is unaffected", async () => {
  // The rule forbids deletion, not correction. A manager who lent to the
  // wrong person must still be able to void the mistake in place.
  const shelf = await makeShelf(sql);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);

  const [loan] = await sql<{ id: string }[]>`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status)
    values (${shelf.id}, ${copyIds[0]}, ${bookId}, ${reader.userId}, ${reader.userId}, current_date + 14, 'active')
    returning id
  `;

  await expect(sql`
    update loans set status = 'voided', voided_at = now(), void_reason = 'wrong borrower'
    where id = ${loan.id}
  `).resolves.toBeDefined();
});
