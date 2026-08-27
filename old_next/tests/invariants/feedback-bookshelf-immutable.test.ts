import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

// S1 re-review, item 3: feedback_tenant's `using`/`with check` let a null
// bookshelf_id row through symmetrically, so any shelf session could
// re-assign a site-wide message onto its own shelf (removing it from every
// other shelf's view, one-way and unlogged) or push one of its own rows to
// null (exposing that guest's name and phone to every shelf). Both
// reproduced live before 20260808_10_feedback_bookshelf_immutable.sql
// attached forbid_feedback_reassignment() as a trigger. Cross-shelf
// reassignment to a *third* shelf's id was never possible — the existing
// with check already required the new bookshelf_id to be the session's own
// shelf or null — only the null <-> shelf transitions were open.
//
// The call made (documented in the migration and DATABASE.md §3): a
// site-wide message is addressed to the administrator, not to any one
// shelf, so a shelf reading — and resolving — it stays allowed (kept,
// tested below), but changing *who it is addressed to* is a routing
// decision no ordinary shelf session should make unilaterally.

test("a shelf session cannot re-assign a site-wide message onto its own shelf", async () => {
  const shelf = await makeShelf(sql);
  const [siteWide] = await sql<{ id: string }[]>`
    insert into feedback (bookshelf_id, subject, body, guest_name, guest_contact)
    values (null, 'Góp ý chung', 'Nội dung', 'Khách', '0900000001')
    returning id
  `;

  await expect(
    sql.begin(async (tx) => {
      await tx`select set_config('olibra.bookshelf_id', ${shelf.id}, true)`;
      await tx`set local role olibra_app`;
      return tx`update feedback set bookshelf_id = ${shelf.id} where id = ${siteWide.id}`;
    }),
  ).rejects.toThrow(/bookshelf_id is immutable/);

  const [row] = await sql<{ bookshelf_id: string | null }[]>`
    select bookshelf_id from feedback where id = ${siteWide.id}
  `;
  expect(row.bookshelf_id).toBeNull();
});

test("a shelf session cannot push its own feedback row to null", async () => {
  const shelf = await makeShelf(sql);
  const [own] = await sql<{ id: string }[]>`
    insert into feedback (bookshelf_id, subject, body, guest_name, guest_contact)
    values (${shelf.id}, 'Góp ý riêng', 'Nội dung', 'Khách nhà', '0900000002')
    returning id
  `;

  await expect(
    sql.begin(async (tx) => {
      await tx`select set_config('olibra.bookshelf_id', ${shelf.id}, true)`;
      await tx`set local role olibra_app`;
      return tx`update feedback set bookshelf_id = null where id = ${own.id}`;
    }),
  ).rejects.toThrow(/bookshelf_id is immutable/);

  const [row] = await sql<{ bookshelf_id: string | null }[]>`
    select bookshelf_id from feedback where id = ${own.id}
  `;
  expect(row.bookshelf_id).toBe(shelf.id);
});

test("a shelf session can still resolve a site-wide message — only bookshelf_id is frozen", async () => {
  const shelf = await makeShelf(sql);
  const [siteWide] = await sql<{ id: string }[]>`
    insert into feedback (bookshelf_id, subject, body, guest_name, guest_contact)
    values (null, 'Góp ý chung', 'Nội dung', 'Khách', '0900000003')
    returning id
  `;

  await sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${shelf.id}, true)`;
    await tx`set local role olibra_app`;
    return tx`update feedback set status = 'resolved' where id = ${siteWide.id}`;
  });

  const [row] = await sql<{ status: string; bookshelf_id: string | null }[]>`
    select status, bookshelf_id from feedback where id = ${siteWide.id}
  `;
  expect(row.status).toBe("resolved");
  expect(row.bookshelf_id).toBeNull();
});

test("bookshelf_id is frozen for every role, including olibra_admin", async () => {
  // A trigger, not a narrower RLS with check, precisely so bypassrls does
  // not reopen this — deliberate, matching forbid_slug_change()'s shape for
  // bookshelves.slug.
  const shelfA = await makeShelf(sql);
  const shelfB = await makeShelf(sql);
  const [own] = await sql<{ id: string }[]>`
    insert into feedback (bookshelf_id, subject, body, guest_name, guest_contact)
    values (${shelfA.id}, 'Góp ý', 'Nội dung', 'Khách', '0900000004')
    returning id
  `;

  await expect(
    sql.begin(async (tx) => {
      await tx`set local role olibra_admin`;
      return tx`update feedback set bookshelf_id = ${shelfB.id} where id = ${own.id}`;
    }),
  ).rejects.toThrow(/bookshelf_id is immutable/);
});
