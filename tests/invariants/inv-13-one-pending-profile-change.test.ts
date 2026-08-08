import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { makeShelf, makeUser } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const insertPending = (userId: string, shelfId: string) => sql`
  insert into profile_change_requests
    (user_id, bookshelf_id, proposed_values, previous_values, status)
  values (${userId}, ${shelfId}, '{"full_name":"New Name"}', '{"full_name":"Old Name"}', 'pending')
`;

test("INV-13: a second pending request for the same person collides", async () => {
  // DATABASE.md §7's first half of INV-13: at most one pending request per
  // person, so a manager never faces two competing versions of the same
  // fact (BR §7.4). The database's half — "only through an approved
  // request" is application discipline and is not tested here.
  const shelf = await makeShelf(sql);
  const user = await makeUser(sql);

  await insertPending(user.id, shelf.id);
  await expect(insertPending(user.id, shelf.id)).rejects.toMatchObject({
    code: "23505",
  });
});

test("INV-13: a decided request does not block a new pending one", async () => {
  // The index is partial on status = 'pending'. Once a request is approved,
  // rejected or cancelled, it is history — it must not permanently occupy
  // the one pending slot for that person.
  const shelf = await makeShelf(sql);
  const user = await makeUser(sql);

  const [decided] = await sql<{ id: string }[]>`
    insert into profile_change_requests
      (user_id, bookshelf_id, proposed_values, previous_values, status, decided_at)
    values (${user.id}, ${shelf.id}, '{"full_name":"New Name"}', '{"full_name":"Old Name"}', 'approved', now())
    returning id
  `;
  expect(decided.id).toBeDefined();

  await expect(insertPending(user.id, shelf.id)).resolves.toBeDefined();
});

test("INV-13: two different people may each have a pending request", async () => {
  const shelf = await makeShelf(sql);
  const userA = await makeUser(sql);
  const userB = await makeUser(sql);

  await insertPending(userA.id, shelf.id);
  await expect(insertPending(userB.id, shelf.id)).resolves.toBeDefined();
});
