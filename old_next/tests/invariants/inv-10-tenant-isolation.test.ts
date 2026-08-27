import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../support/factories";
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

test("INV-10: memberships_tenant itself blocks a cross-shelf read, with no application-level filter to lean on", async () => {
  // M7: tests/auth/guards.test.ts's "a valid session for shelf A grants
  // nothing on shelf B" passes even with memberships_tenant (0010_rls.sql)
  // dropped entirely, because membershipFor's own join names the shelf
  // explicitly (`m.bookshelf_id = ${bookshelfId}`) — that test proves the
  // application layer, not the database one. Both layers are real (DB §3's
  // "Option A, with Option B's scoping layer on top of it"), so both need a
  // test that can fail on its own. This one runs a query with no
  // `bookshelf_id` filter in the SQL at all — if RLS is doing nothing, it
  // returns both shelves' rows; the policy is what has to narrow it to one.
  const a = await makeShelf(sql, { slug: "dong-thap" });
  const b = await makeShelf(sql, { slug: "an-giang" });
  await makeMember(sql, a.id);
  await makeMember(sql, b.id);

  const visible = await sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${a.id}, true)`;
    await tx`set local role olibra_app`;
    return tx<{ bookshelf_id: string }[]>`select bookshelf_id from memberships`;
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
  //
  // Shelf B is archived, deliberately, not active like every other shelf
  // this file's tests create. `bookshelves_public_read`
  // (20260808_12_bookshelves_public_read.sql) is a second, OR'd permissive
  // policy that admits any *active* shelf to a plain `select` regardless of
  // the session's GUC — a real product requirement (the public portal
  // directory), not a bug — so an active shelf B would now be visible here
  // too, for a reason that has nothing to do with `bookshelves_tenant`'s
  // own id-scoping. Archiving B keeps this test isolating exactly the
  // property its name claims: only `bookshelves_tenant`'s `id = <GUC>`
  // decides visibility for a row the public-read policy does not admit.
  const a = await makeShelf(sql, { slug: "dong-thap-2" });
  const [b] = await sql<{ id: string }[]>`
    insert into bookshelves (slug, name, address, status)
    values ('an-giang-2', 'Tủ sách an-giang-2', 'Đồng Tháp', 'archived')
    returning id
  `;

  const visible = await sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${a.id}, true)`;
    await tx`set local role olibra_app`;
    return tx<{ id: string }[]>`select id from bookshelves`;
  });

  expect(visible).toHaveLength(1);
  expect(visible[0].id).toBe(a.id);
  void b;
});

test("INV-10: bookshelves_public_read widens select to any active shelf, regardless of the session's GUC — deliberately, for the public portal directory", async () => {
  // Postgres ORs together permissive policies covering the same command
  // (`for select`), so bookshelves_public_read only ever adds visibility on
  // top of bookshelves_tenant, never subtracts from it. A session scoped to
  // shelf A can now also see shelf B's row through this policy, as long as B
  // is active and undeleted — that is the point (BUSINESS-REQUIREMENTS.md's
  // Portal section), not a regression of tenant isolation, since the
  // *write* path (`with check`) is untouched and still governed exclusively
  // by bookshelves_tenant.
  const a = await makeShelf(sql, { slug: "dong-thap-3" });
  const b = await makeShelf(sql, { slug: "an-giang-3" });

  const visible = await sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${a.id}, true)`;
    await tx`set local role olibra_app`;
    return tx<{ id: string }[]>`select id from bookshelves order by id`;
  });

  expect(visible.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
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
    insert into users (saint_name, full_name, father_name, mother_name)
    values ('Maria', 'Người đọc', 'Giuse Trần Văn A', 'Maria Nguyễn Thị B')
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

test("INV-10: bookshelf_contacts is shelf-scoped — shelf A cannot read shelf B's contact", async () => {
  // Fix round 1: `bookshelf_contacts` (PO feedback round 1, Task 1/2) carries
  // its own `enable`/`force row level security` and `bookshelf_contacts_tenant`
  // policy (20260812_01_contacts_profile_and_hours.sql), same shape as every
  // other shelf-scoped table this file already exercises, but nothing had
  // proven it live. Modelled directly on the `feedback` pair above: a plain
  // `sql` insert (the test superuser bypasses RLS regardless of `force`,
  // exactly as that file's contact rows are seeded in
  // `tests/domain/admin/shelf-contacts.test.ts`), then a scoped `olibra_app`
  // session for the read/write halves.
  const a = await makeShelf(sql, { slug: "dong-thap-contacts" });
  const b = await makeShelf(sql, { slug: "an-giang-contacts" });
  const [contactB] = await sql<{ id: string }[]>`
    insert into bookshelf_contacts (bookshelf_id, position, name, phone, role_label)
    values (${b.id}, 1, 'Maria Nguyễn Thị Lan', '0912345678', 'Người giữ chìa khoá')
    returning id
  `;

  const visible = await sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${a.id}, true)`;
    await tx`set local role olibra_app`;
    return tx`select id from bookshelf_contacts where id = ${contactB.id}`;
  });
  expect(visible).toHaveLength(0);
});

test("INV-10: a write scoped to shelf A cannot plant a contact under shelf B", async () => {
  // The write half of the pair above: `bookshelf_contacts_tenant`'s `with
  // check` has to refuse this, not merely the `using` clause hiding it from
  // a read — the same distinction `contactB` above exercises from the read
  // side.
  const a = await makeShelf(sql, { slug: "dong-thap-contacts-2" });
  const b = await makeShelf(sql, { slug: "an-giang-contacts-2" });

  await expect(
    sql.begin(async (tx) => {
      await tx`select set_config('olibra.bookshelf_id', ${a.id}, true)`;
      await tx`set local role olibra_app`;
      return tx`
        insert into bookshelf_contacts (bookshelf_id, position, name)
        values (${b.id}, 1, 'Maria Nguyễn Thị Lan')
      `;
    }),
  ).rejects.toThrow();

  const rows = await sql<{ id: string }[]>`
    select id from bookshelf_contacts where bookshelf_id = ${b.id}
  `;
  expect(rows).toHaveLength(0);
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
