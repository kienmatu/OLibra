import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import {
  runAdminCommand,
  runAdminQuery,
  runCommand,
  runQuery,
} from "../../../src/domain/kernel/unit-of-work";
import {
  archiveBookshelf,
  createBookshelf,
  updateBookshelfSettings,
} from "../../../src/domain/admin/commands/bookshelves";
import {
  assignManager,
  promoteSuperAdmin,
  revokeManager,
} from "../../../src/domain/admin/commands/managers";
import {
  updateSiteContact,
  updateSystemDefaults,
} from "../../../src/domain/admin/commands/system-settings";
import {
  getAdminOverview,
  getManagersList,
  getSiteContact,
  getSystemSettings,
} from "../../../src/domain/admin/queries/get-admin-overview";
import { loanDaysFor } from "../../../src/domain/circulation/settings";
import { getShelfSettings } from "../../../src/domain/shelf/queries/get-shelf-settings";
import { lendCopy } from "../../../src/domain/circulation/commands/lend-copy";
import { migrate } from "../../../src/db/migrate";
import {
  makeBookWithCopies,
  makeMember,
  makeShelf,
  makeUser,
} from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";
import { superAdminContext } from "../../support/scenarios";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const NOW = "2026-08-14T03:00:00Z";

async function codeThrownBy(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? null;
  }
}

/** A super_admin whose context holds no shelf — what `adminContextFor` builds. */
async function admin() {
  const { ctx } = await superAdminContext(sql, NOW);
  return ctx;
}

// ── Creating a shelf ───────────────────────────────────────────────────────

test("a new shelf inherits the system defaults, by value and not by reference", async () => {
  // The decision this slice most easily gets wrong in the other direction. If a
  // shelf *referenced* `system_settings`, editing a default here would change
  // every parish's lending policy at once, silently, weeks later.
  const ctx = await admin();
  await runAdminCommand(sql, ctx, updateSystemDefaults, {
    loanDays: 21,
    maxConcurrentLoans: 5,
    holdDays: 4,
  });

  const { bookshelfId, slug } = await runAdminCommand(sql, ctx, createBookshelf, {
    name: "Tủ sách Giáo xứ Vĩnh Long",
  });
  expect(slug).toBe("tu-sach-giao-xu-vinh-long");

  const shelfCtx: TenantContext = { ...ctx, bookshelfId };
  expect(await runQuery(sql, shelfCtx, (tx) => loanDaysFor(tx, bookshelfId))).toBe(
    21,
  );

  // Now move the default again. The shelf that already exists does not follow.
  await runAdminCommand(sql, ctx, updateSystemDefaults, {
    loanDays: 7,
    maxConcurrentLoans: 5,
    holdDays: 4,
  });
  expect(await runQuery(sql, shelfCtx, (tx) => loanDaysFor(tx, bookshelfId))).toBe(
    21,
  );
});

test("a slug already in use is refused by name, not by a raw 23505", async () => {
  const ctx = await admin();
  await makeShelf(sql, { slug: "dong-thap" });

  expect(
    await codeThrownBy(() =>
      runAdminCommand(sql, ctx, createBookshelf, {
        name: "Khác",
        slug: "dong-thap",
      }),
    ),
  ).toBe("slug_taken");
});

test("creating a shelf writes a global audit row", async () => {
  // It has to be global: the shelf did not exist when the decision was made,
  // and `runAdminCommand` refuses a shelf-scoped entry under an empty scope.
  const ctx = await admin();
  await runAdminCommand(sql, ctx, createBookshelf, { name: "Tủ sách mới" });

  const [row] = await sql<{ bookshelf_id: string | null; action: string }[]>`
    select bookshelf_id, action from audit_log where action = 'bookshelf.created'
  `;
  expect(row.bookshelf_id).toBeNull();
});

// ── Editing a shelf ────────────────────────────────────────────────────────

test("editing the policy leaves the profile alone, and the reverse", async () => {
  // The asymmetry `updateBookshelfSettings` documents: the profile is
  // all-or-nothing because `null` is a value a person means, and the policy is
  // field-by-field because a `jsonb` merge leaves what it was not given.
  const ctx = await admin();
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const managerCtx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock: fixedClock(NOW),
  };

  await runAdminCommand(
    sql,
    { ...ctx, bookshelfId: shelf.id },
    updateBookshelfSettings,
    {
      bookshelfId: shelf.id,
      profile: {
        name: "Tủ sách Đồng Tháp",
        location: "Nhà xứ",
        address: "Đồng Tháp",
        keeperName: "Cô Lan",
        keeperPhone: "0912345678",
        openingHours: "Sau lễ Chúa nhật",
      },
      loanDays: 21,
    },
  );

  let settings = await runQuery(sql, managerCtx, (tx, c) =>
    getShelfSettings(tx, c),
  );
  expect(settings.profile.keeperName).toBe("Cô Lan");
  expect(settings.policy.loanDays).toBe(21);
  expect(settings.policy.holdDays).toBe(3);

  // Policy only, no profile. The keeper survives.
  await runAdminCommand(
    sql,
    { ...ctx, bookshelfId: shelf.id },
    updateBookshelfSettings,
    {
      bookshelfId: shelf.id,
      holdDays: 5,
    },
  );
  settings = await runQuery(sql, managerCtx, (tx, c) => getShelfSettings(tx, c));
  expect(settings.profile.keeperName).toBe("Cô Lan");
  expect(settings.policy.loanDays).toBe(21);
  expect(settings.policy.holdDays).toBe(5);

  // Profile only, with the phone cleared — the edit `coalesce` cannot express.
  await runAdminCommand(
    sql,
    { ...ctx, bookshelfId: shelf.id },
    updateBookshelfSettings,
    {
      bookshelfId: shelf.id,
      profile: {
        name: "Tủ sách Đồng Tháp",
        location: "Nhà xứ",
        address: "Đồng Tháp",
        keeperName: "Cô Lan",
        keeperPhone: null,
        openingHours: "Sau lễ Chúa nhật",
      },
    },
  );
  settings = await runQuery(sql, managerCtx, (tx, c) => getShelfSettings(tx, c));
  expect(settings.profile.keeperPhone).toBeNull();
  expect(settings.policy.holdDays).toBe(5);
});

test("a negative policy value is refused", async () => {
  const ctx = await admin();
  const shelf = await makeShelf(sql);
  expect(
    await codeThrownBy(() =>
      runAdminCommand(
        sql,
        { ...ctx, bookshelfId: shelf.id },
        updateBookshelfSettings,
        {
          bookshelfId: shelf.id,
          loanDays: -1,
        },
      ),
    ),
  ).toBe("validation_failed");
});

// ── Archiving ──────────────────────────────────────────────────────────────

test("archiving sets status and keeps everything, and twice is refused", async () => {
  const ctx = await admin();
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const reader = await makeMember(sql, shelf.id);
  await runCommand(
    sql,
    {
      bookshelfId: shelf.id,
      actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
      clock: fixedClock(NOW),
    },
    lendCopy,
    { copyId: copyIds[0], membershipId: reader.id },
  );

  await runAdminCommand(sql, ctx, archiveBookshelf, { bookshelfId: shelf.id });

  const [row] = await sql<{ status: string; deleted_at: Date | null }[]>`
    select status, deleted_at from bookshelves where id = ${shelf.id}
  `;
  expect(row.status).toBe("archived");
  // Not a soft delete: OPS §4.5 says archiving "retains everything".
  expect(row.deleted_at).toBeNull();
  expect(await sql`select id from loans`).toHaveLength(1);

  expect(
    await codeThrownBy(() =>
      runAdminCommand(sql, ctx, archiveBookshelf, { bookshelfId: shelf.id }),
    ),
  ).toBe("already_archived");
});

// ── Managers ───────────────────────────────────────────────────────────────

test("assigning overwrites a role rather than adding a second membership", async () => {
  // §4 assumption 8: one role per person per shelf.
  const ctx = await admin();
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const member = await makeMember(sql, shelf.id, { status: "pending" });

  await runAdminCommand(sql, { ...ctx, bookshelfId: shelf.id }, assignManager, {
    userId: member.userId,
    bookshelfId: shelf.id,
    role: "manager",
  });

  const rows = await sql<{ role: string; status: string }[]>`
    select role, status from memberships where user_id = ${member.userId}
  `;
  expect(rows).toHaveLength(1);
  expect(rows[0].role).toBe("manager");
  // A person handed the keys is not still queued for approval.
  expect(rows[0].status).toBe("active");
});

test("assigning to somebody with no membership here creates one", async () => {
  const ctx = await admin();
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const stranger = await makeUser(sql, { fullName: "Người mới" });

  await runAdminCommand(sql, { ...ctx, bookshelfId: shelf.id }, assignManager, {
    userId: stranger.id,
    bookshelfId: shelf.id,
    role: "admin",
  });

  const rows = await sql<{ role: string }[]>`
    select role from memberships where user_id = ${stranger.id}
  `;
  expect(rows.map((r) => r.role)).toEqual(["admin"]);
});

test("revoking demotes to reader and keeps the membership", async () => {
  const ctx = await admin();
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });

  await runAdminCommand(sql, { ...ctx, bookshelfId: shelf.id }, revokeManager, {
    membershipId: manager.id,
  });

  const [row] = await sql<{ role: string; deleted_at: Date | null }[]>`
    select role, deleted_at from memberships where id = ${manager.id}
  `;
  expect(row.role).toBe("reader");
  expect(row.deleted_at).toBeNull();

  // Twice is refused: there is no manager left to demote.
  expect(
    await codeThrownBy(() =>
      runAdminCommand(sql, { ...ctx, bookshelfId: shelf.id }, revokeManager, {
        membershipId: manager.id,
      }),
    ),
  ).toBe("not_permitted");
});

test("promoting is idempotent by refusal, and is a global fact", async () => {
  const ctx = await admin();
  const person = await makeUser(sql, { fullName: "Người sẽ quản trị" });

  await runAdminCommand(sql, ctx, promoteSuperAdmin, { userId: person.id });
  const [row] = await sql<{ is_super_admin: boolean }[]>`
    select is_super_admin from users where id = ${person.id}
  `;
  expect(row.is_super_admin).toBe(true);

  expect(
    await codeThrownBy(() =>
      runAdminCommand(sql, ctx, promoteSuperAdmin, { userId: person.id }),
    ),
  ).toBe("already_super_admin");

  const [entry] = await sql<{ bookshelf_id: string | null }[]>`
    select bookshelf_id from audit_log
    where action = 'user.promoted_super_admin'
  `;
  expect(entry.bookshelf_id).toBeNull();
});

// ── The cross-shelf reads ──────────────────────────────────────────────────

test("the overview is one row per shelf, archived ones included and marked", async () => {
  const ctx = await admin();
  const a = await makeShelf(sql, { slug: "dong-thap" });
  const b = await makeShelf(sql, { slug: "vinh-long" });
  await makeBookWithCopies(sql, a.id, 2);
  await makeMember(sql, a.id, { status: "pending" });
  await runAdminCommand(sql, ctx, archiveBookshelf, { bookshelfId: b.id });

  const rows = await runAdminQuery(sql, ctx, (tx, c) => getAdminOverview(tx, c));
  expect(rows).toHaveLength(2);

  const dongThap = rows.find((r) => r.slug === "dong-thap")!;
  expect(dongThap.books).toBe(1);
  expect(dongThap.pending).toBe(1);
  expect(dongThap.status).toBe("active");

  // Archived and still listed. An administrator is the only person who can see
  // it at all — `resolveShelfId` refuses its slug to everybody.
  expect(rows.find((r) => r.slug === "vinh-long")?.status).toBe("archived");
});

test("the managers list spans shelves and includes super administrators", async () => {
  const ctx = await admin();
  const a = await makeShelf(sql, { slug: "dong-thap" });
  const b = await makeShelf(sql, { slug: "vinh-long" });
  const one = await makeMember(sql, a.id, { role: "manager" });
  await makeMember(sql, b.id, { role: "admin" });
  // A plain reader is not a manager and must not appear.
  await makeMember(sql, a.id);

  const rows = await runAdminQuery(sql, ctx, (tx, c) => getManagersList(tx, c));

  expect(rows.map((r) => r.role).sort()).toEqual([
    "admin",
    "manager",
    "super_admin",
  ]);
  // The super_admin holds no membership, which is what makes them unrevocable
  // through `revokeManager` — correct, since OPS §4.5 has no demotion command.
  expect(rows.find((r) => r.role === "super_admin")?.membershipId).toBeNull();
  expect(rows.find((r) => r.membershipId === one.id)?.shelfSlug).toBe("dong-thap");

  // And the shelf filter narrows.
  const justB = await runAdminQuery(sql, ctx, (tx, c) =>
    getManagersList(tx, c, { shelfId: b.id }),
  );
  expect(justB.map((r) => r.role)).toEqual(["vinh-long"].map(() => "admin"));
});

test("last-active comes from the audit log, and is null for somebody who has done nothing", async () => {
  const ctx = await admin();
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const idle = await makeMember(sql, shelf.id, { role: "manager" });

  let rows = await runAdminQuery(sql, ctx, (tx, c) => getManagersList(tx, c));
  expect(rows.find((r) => r.membershipId === idle.id)?.lastActiveAt).toBeNull();

  // One act, through a real command, so the audit row is the product's own.
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);
  await runCommand(
    sql,
    {
      bookshelfId: shelf.id,
      actor: { userId: idle.userId, membershipId: idle.id, role: "manager" },
      clock: fixedClock(NOW),
    },
    lendCopy,
    { copyId: copyIds[0], membershipId: reader.id },
  );

  rows = await runAdminQuery(sql, ctx, (tx, c) => getManagersList(tx, c));
  expect(rows.find((r) => r.membershipId === idle.id)?.lastActiveAt).toEqual(
    new Date(NOW),
  );
});

// ── System settings ────────────────────────────────────────────────────────

test("the site contact round-trips, and a guest reads only the three columns", async () => {
  const ctx = await admin();
  await runAdminCommand(sql, ctx, updateSiteContact, {
    contactName: "Ban quản trị OLibra",
    contactPhone: "0909111222",
    contactHours: "Sáng thứ Hai đến thứ Sáu",
  });

  const settings = await runAdminQuery(sql, ctx, (tx, c) =>
    getSystemSettings(tx, c),
  );
  expect(settings.contactName).toBe("Ban quản trị OLibra");
  expect(settings.timezone).toBe("Asia/Ho_Chi_Minh");

  // `getSiteContact` takes no context and calls no policy — the signature
  // carrying the meaning, exactly as `runPublicQuery`'s callback does.
  const contact = await runQuery(sql, ctx, (tx) => getSiteContact(tx));
  expect(contact).toEqual({
    name: "Ban quản trị OLibra",
    phone: "0909111222",
    hours: "Sáng thứ Hai đến thứ Sáu",
  });
});

test("the audit row for a contact change carries no telephone number", async () => {
  // BR §14 asks the log to record what changed rather than duplicate it, and
  // this is the one field on the row a person could be identified by.
  const ctx = await admin();
  await runAdminCommand(sql, ctx, updateSiteContact, {
    contactName: "Ban quản trị",
    contactPhone: "0909111222",
    contactHours: null,
  });

  const [row] = await sql<{ after: unknown }[]>`
    select after from audit_log where action = 'site_contact.updated'
  `;
  expect(JSON.stringify(row.after)).not.toContain("0909111222");
});

test("a defaults value below one is refused", async () => {
  const ctx = await admin();
  expect(
    await codeThrownBy(() =>
      runAdminCommand(sql, ctx, updateSystemDefaults, {
        loanDays: 0,
        maxConcurrentLoans: 3,
        holdDays: 3,
      }),
    ),
  ).toBe("validation_failed");
});
