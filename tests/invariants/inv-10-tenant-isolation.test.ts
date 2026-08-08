import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

test("INV-10: a query scoped to shelf A cannot see shelf B's books", async () => {
  const a = await makeShelf(sql, { slug: "dong-thap" });
  const b = await makeShelf(sql, { slug: "an-giang" });
  await makeBookWithCopies(sql, a.id, 1);
  await makeBookWithCopies(sql, b.id, 1);

  const visible = await sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${a.id}, true)`;
    await tx`set local role olibra_app`;
    return tx<{ bookshelf_id: string }[]>`select bookshelf_id from books`;
  });

  expect(visible).toHaveLength(1);
  expect(visible[0].bookshelf_id).toBe(a.id);
});

test("INV-10: a query with no shelf set sees nothing at all", async () => {
  // The failure mode this prevents: a developer forgets the where clause.
  // BR §6 requires that to return nothing, not another parish's readers.
  const a = await makeShelf(sql);
  await makeBookWithCopies(sql, a.id, 1);

  const visible = await sql.begin(async (tx) => {
    await tx`set local role olibra_app`;
    return tx`select bookshelf_id from books`;
  });

  expect(visible).toHaveLength(0);
});

test("INV-10: the super-admin role bypasses policies deliberately", async () => {
  // BR §13 permits cross-shelf views for super_admin. The point of this test
  // is that the bypass is a *named role*, so using it is a visible choice
  // rather than something a query falls into.
  const a = await makeShelf(sql);
  const b = await makeShelf(sql);
  await makeBookWithCopies(sql, a.id, 1);
  await makeBookWithCopies(sql, b.id, 1);

  const visible = await sql.begin(async (tx) => {
    await tx`set local role olibra_admin`;
    return tx`select bookshelf_id from books`;
  });

  expect(visible).toHaveLength(2);
});

test("INV-10: bookshelves is scoped by its own id, not a bookshelf_id column", async () => {
  // The one table this migration's loop cannot touch: a bookshelf's tenant
  // key is its own primary key, so its policy compares `id`, not
  // `bookshelf_id` (which the table does not have).
  const a = await makeShelf(sql, { slug: "dong-thap-2" });
  const b = await makeShelf(sql, { slug: "an-giang-2" });

  const visible = await sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${a.id}, true)`;
    await tx`set local role olibra_app`;
    return tx<{ id: string }[]>`select id from bookshelves`;
  });

  expect(visible).toHaveLength(1);
  expect(visible[0].id).toBe(a.id);
  void b;
});

test("INV-10: olibra_app can neither read nor write a global (null-shelf) audit row", async () => {
  // BR §13.2 makes cross-shelf audit visibility a super_admin permission.
  // audit_log carries the same tenant policy as the other twelve tables, and
  // a null bookshelf_id never equals the session's shelf under plain
  // equality — so a global entry is invisible, and unwritable, to olibra_app.
  const a = await makeShelf(sql);

  const globalEntry = await sql.begin(async (tx) => {
    await tx`set local role olibra_admin`;
    const [row] = await tx<{ id: string }[]>`
      insert into audit_log (bookshelf_id, action, entity_type, entity_id)
      values (null, 'system.migration', 'system', null)
      returning id
    `;
    return row;
  });

  const visible = await sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${a.id}, true)`;
    await tx`set local role olibra_app`;
    return tx`select id from audit_log where id = ${globalEntry.id}`;
  });
  expect(visible).toHaveLength(0);

  await expect(
    sql.begin(async (tx) => {
      await tx`select set_config('olibra.bookshelf_id', ${a.id}, true)`;
      await tx`set local role olibra_app`;
      return tx`
        insert into audit_log (bookshelf_id, action, entity_type, entity_id)
        values (null, 'system.migration', 'system', null)
      `;
    }),
  ).rejects.toThrow();
});

test("INV-10: olibra_admin can both read and write a global (null-shelf) audit row", async () => {
  const written = await sql.begin(async (tx) => {
    await tx`set local role olibra_admin`;
    const [row] = await tx<{ id: string }[]>`
      insert into audit_log (bookshelf_id, action, entity_type, entity_id)
      values (null, 'system.migration', 'system', null)
      returning id
    `;
    return row;
  });

  const visible = await sql.begin(async (tx) => {
    await tx`set local role olibra_admin`;
    return tx`select id from audit_log where id = ${written.id}`;
  });
  expect(visible).toHaveLength(1);
});

test("the revoke genuinely binds olibra_app, isolated from the forbid_row_mutation trigger", async () => {
  // Task 4 found `revoke ... from public` inert against the test's
  // superuser table owner, and proved it with has_table_privilege rather
  // than by attempting the mutation — an attempt would fail either way,
  // because forbid_row_mutation() (0009) fires for every role regardless of
  // grants. has_table_privilege asks the grant system directly, with the
  // trigger nowhere in the path, so this is the one query that can actually
  // tell the two mechanisms apart. olibra_app is a genuine non-superuser
  // table (not owner), so if this comes back false, the revoke is doing
  // real work for the first time in this project.
  const [loanDelete] = await sql<{ can_delete: boolean }[]>`
    select has_table_privilege('olibra_app', 'loans', 'DELETE') as can_delete
  `;
  const [auditUpdate] = await sql<{ can_update: boolean }[]>`
    select has_table_privilege('olibra_app', 'audit_log', 'UPDATE') as can_update
  `;
  const [auditDelete] = await sql<{ can_delete: boolean }[]>`
    select has_table_privilege('olibra_app', 'audit_log', 'DELETE') as can_delete
  `;

  expect(loanDelete.can_delete).toBe(false);
  expect(auditUpdate.can_update).toBe(false);
  expect(auditDelete.can_delete).toBe(false);
});

test("INV-10/INV-11: olibra_app cannot delete a loan", async () => {
  const shelf = await makeShelf(sql);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const [reader] = await sql<{ id: string }[]>`
    insert into users (full_name, father_name, mother_name)
    values ('Người đọc', 'Giuse Trần Văn A', 'Maria Nguyễn Thị B')
    returning id
  `;

  const [loan] = await sql<{ id: string }[]>`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status)
    values (${shelf.id}, ${copyIds[0]}, ${bookId}, ${reader.id}, ${reader.id}, current_date + 14, 'active')
    returning id
  `;

  await expect(
    sql.begin(async (tx) => {
      await tx`select set_config('olibra.bookshelf_id', ${shelf.id}, true)`;
      await tx`set local role olibra_app`;
      return tx`delete from loans where id = ${loan.id}`;
    }),
  ).rejects.toMatchObject({ code: "42501" });
});

test("INV-10: feedback is shelf-scoped — shelf A cannot read or resolve shelf B's messages", async () => {
  // CRITICAL 1: `feedback` carries a `bookshelf_id` (nullable, for
  // genuinely site-wide messages) but 0010_rls.sql's loop skipped it on the
  // strength of a DATABASE.md §3 sentence that, read literally, covers the
  // whole table rather than just its null rows. Demonstrated live before
  // the fix: `olibra_app` scoped to shelf A could read shelf B's guest
  // names/phone numbers and resolve shelf B's message.
  const a = await makeShelf(sql);
  const b = await makeShelf(sql);
  const [msgB] = await sql<{ id: string }[]>`
    insert into feedback (bookshelf_id, subject, body, guest_name, guest_contact)
    values (${b.id}, 'Xin chào', 'Nội dung', 'Người B', '0900000001')
    returning id
  `;

  const visible = await sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${a.id}, true)`;
    await tx`set local role olibra_app`;
    return tx`select id from feedback where id = ${msgB.id}`;
  });
  expect(visible).toHaveLength(0);

  await expect(
    sql.begin(async (tx) => {
      await tx`select set_config('olibra.bookshelf_id', ${a.id}, true)`;
      await tx`set local role olibra_app`;
      return tx`update feedback set status = 'resolved' where id = ${msgB.id}`;
    }),
  ).resolves.toBeDefined(); // the UPDATE itself does not error...

  // ...but RLS's `using` clause filters shelf B's row out of the update's
  // candidate set entirely, so it silently affects zero rows rather than
  // shelf B's, and the row is untouched.
  const [row] = await sql<{ status: string }[]>`
    select status from feedback where id = ${msgB.id}
  `;
  expect(row.status).toBe("new");
});

test("INV-10: a genuinely site-wide feedback row (null bookshelf_id) is visible from any shelf session", async () => {
  const a = await makeShelf(sql);
  const [siteWide] = await sql<{ id: string }[]>`
    insert into feedback (bookshelf_id, subject, body, guest_name, guest_contact)
    values (null, 'Góp ý chung', 'Nội dung', 'Khách', '0900000002')
    returning id
  `;

  const visible = await sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${a.id}, true)`;
    await tx`set local role olibra_app`;
    return tx`select id from feedback where id = ${siteWide.id}`;
  });
  expect(visible).toHaveLength(1);
});

test("INV-10/INV-12: olibra_app cannot update an audit row", async () => {
  const shelf = await makeShelf(sql);
  const [entry] = await sql<{ id: string }[]>`
    insert into audit_log (bookshelf_id, action, entity_type, entity_id)
    values (${shelf.id}, 'book.created', 'book', gen_random_uuid())
    returning id
  `;

  await expect(
    sql.begin(async (tx) => {
      await tx`select set_config('olibra.bookshelf_id', ${shelf.id}, true)`;
      await tx`set local role olibra_app`;
      return tx`update audit_log set action = 'tampered' where id = ${entry.id}`;
    }),
  ).rejects.toMatchObject({ code: "42501" });
});
