import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runAdminCommand, runQuery } from "../../../src/domain/kernel/unit-of-work";
import { updateBookshelfSettings } from "../../../src/domain/admin/commands/bookshelves";
import { readShelfIdentity } from "../../../src/lib/shelf";
import { migrate } from "../../../src/db/migrate";
import { makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";
import { superAdminContext } from "../../support/scenarios";

/**
 * PO feedback round 1, Task 2: `readShelfIdentity` and `updateBookshelfSettings`
 * read and write `bookshelf_contacts` (Task 1) instead of the two
 * `bookshelves.keeper_*` columns and the free-text `opening_hours` column.
 *
 * Modelled on the neighbouring `tests/domain/admin/bookshelf-settings.test.ts`:
 * that file names no `readerTx`/`adminTx` helpers of its own — every one of
 * its tests goes through `runQuery`/`runAdminCommand` directly, alongside
 * `superAdminContext` for the actor — so this file does the same rather than
 * inventing a pair of names nothing else in the codebase uses.
 */

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const NOW = "2026-08-14T03:00:00Z";

async function admin() {
  const { ctx } = await superAdminContext(sql, NOW);
  return ctx;
}

/** A reader's own `TenantContext` for one shelf — the least role `readShelfIdentity` admits. */
async function readerContext(shelfId: string): Promise<TenantContext> {
  const reader = await makeMember(sql, shelfId);
  return {
    bookshelfId: shelfId,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
    clock: fixedClock(NOW),
  };
}

test("readShelfIdentity returns contacts in position order", async () => {
  const shelf = await makeShelf(sql);
  await sql`
    insert into bookshelf_contacts (bookshelf_id, position, name, phone, role_label)
    values
      (${shelf.id}, 2, 'Giuse Trần Minh', '0987654321', 'Quản lý tủ sách'),
      (${shelf.id}, 1, 'Maria Nguyễn Thị Lan', '0912345678', 'Người giữ chìa khoá')
  `;

  const ctx = await readerContext(shelf.id);
  const identity = await runQuery(sql, ctx, (tx, c) => readShelfIdentity(tx, c));

  expect(identity.contacts.map((c) => c.position)).toEqual([1, 2]);
  expect(identity.contacts[0].name).toBe("Maria Nguyễn Thị Lan");
  expect(identity.contacts[0].roleLabel).toBe("Người giữ chìa khoá");
  expect(identity.contacts[1].phone).toBe("0987654321");
});

test("a shelf with no contacts reads as an empty list, not a failure", async () => {
  const shelf = await makeShelf(sql);
  const ctx = await readerContext(shelf.id);
  const identity = await runQuery(sql, ctx, (tx, c) => readShelfIdentity(tx, c));
  expect(identity.contacts).toEqual([]);
});

test("a soft-deleted contact is not read", async () => {
  const shelf = await makeShelf(sql);
  await sql`
    insert into bookshelf_contacts (bookshelf_id, position, name, deleted_at)
    values (${shelf.id}, 1, 'Đã nghỉ', now())
  `;
  const ctx = await readerContext(shelf.id);
  const identity = await runQuery(sql, ctx, (tx, c) => readShelfIdentity(tx, c));
  expect(identity.contacts).toEqual([]);
});

test("updateBookshelfSettings replaces the contact list wholesale", async () => {
  const shelf = await makeShelf(sql);
  const ctx = await admin();
  const shelfCtx = { ...ctx, bookshelfId: shelf.id };

  await runAdminCommand(sql, shelfCtx, updateBookshelfSettings, {
    bookshelfId: shelf.id,
    profile: {
      name: "Tủ sách Đồng Tháp",
      location: "Nhà xứ Đồng Tháp",
      address: "12 Nguyễn Huệ",
      contacts: [
        {
          position: 1,
          name: "Maria Nguyễn Thị Lan",
          phone: "0912345678",
          roleLabel: "Người giữ chìa khoá",
        },
        { position: 2, name: "Giuse Trần Minh", phone: null, roleLabel: null },
      ],
    },
  });

  // A second save with one contact retires the second, and position 2 is free
  // again — the soft-delete-aware index is what makes that possible.
  await runAdminCommand(sql, shelfCtx, updateBookshelfSettings, {
    bookshelfId: shelf.id,
    profile: {
      name: "Tủ sách Đồng Tháp",
      location: "Nhà xứ Đồng Tháp",
      address: "12 Nguyễn Huệ",
      contacts: [
        {
          position: 1,
          name: "Têrêsa Lê Ngọc Ánh",
          phone: "0900111222",
          roleLabel: "Quản lý tủ sách",
        },
      ],
    },
  });

  const readCtx = await readerContext(shelf.id);
  const identity = await runQuery(sql, readCtx, (tx, c) =>
    readShelfIdentity(tx, c),
  );
  expect(identity.contacts).toEqual([
    {
      position: 1,
      name: "Têrêsa Lê Ngọc Ánh",
      phone: "0900111222",
      roleLabel: "Quản lý tủ sách",
    },
  ]);
});

test("a contact with a phone and no name is refused", async () => {
  const shelf = await makeShelf(sql);
  const ctx = await admin();
  const shelfCtx = { ...ctx, bookshelfId: shelf.id };

  await expect(
    runAdminCommand(sql, shelfCtx, updateBookshelfSettings, {
      bookshelfId: shelf.id,
      profile: {
        name: "Tủ sách Đồng Tháp",
        location: null,
        address: null,
        contacts: [{ position: 1, name: "", phone: "0912345678", roleLabel: null }],
      },
    }),
  ).rejects.toMatchObject({ code: "contact_name_required" });
});
