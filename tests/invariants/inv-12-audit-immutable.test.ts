import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

test("INV-12: an audit record cannot be updated or deleted", async () => {
  const shelf = await makeShelf(sql);
  const [entry] = await sql<{ id: string }[]>`
    insert into audit_log (bookshelf_id, action, entity_type, entity_id)
    values (${shelf.id}, 'book.created', 'book', gen_random_uuid())
    returning id
  `;

  await expect(
    sql`update audit_log set action = 'tampered' where id = ${entry.id}`,
  ).rejects.toThrow();
  await expect(sql`delete from audit_log where id = ${entry.id}`).rejects.toThrow();
});
