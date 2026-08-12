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
  getManagerCandidates,
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
    // QA remediation Task 23: these three joined the three above — all six
    // are exercised here, not just `loanDays`, since this test's own point
    // ("by value, not by reference") is exactly the property `createBookshelf`
    // could get wrong for a field it had just learned to copy.
    maxRenewals: 2,
    renewalDays: 10,
    holdDays: 4,
    dueSoonDays: 5,
  });

  const { bookshelfId, slug } = await runAdminCommand(sql, ctx, createBookshelf, {
    name: "Tủ sách Giáo xứ Vĩnh Long",
    // Task 3 fix round 1: `createBookshelf` now refuses a write with no
    // position-1 contact (`contact_position_1_required`) — see
    // `shelf-contacts.test.ts` for that rule's own coverage. This test is
    // about the lending-policy inheritance, so the contact here is the
    // minimum that satisfies the rule, not itself the point of the test.
    contacts: [
      { position: 1, name: "Maria Nguyễn Thị Lan", phone: null, roleLabel: null },
    ],
  });
  expect(slug).toBe("tu-sach-giao-xu-vinh-long");

  const shelfCtx: TenantContext = { ...ctx, bookshelfId };
  expect(await runQuery(sql, shelfCtx, (tx) => loanDaysFor(tx, bookshelfId))).toBe(
    21,
  );
  const inherited = await runQuery(sql, shelfCtx, (tx, c) =>
    getShelfSettings(tx, c),
  );
  expect(inherited.policy).toMatchObject({
    loanDays: 21,
    maxConcurrentLoans: 5,
    maxRenewals: 2,
    renewalDays: 10,
    holdDays: 4,
    dueSoonDays: 5,
  });

  // Now move the default again. The shelf that already exists does not follow.
  await runAdminCommand(sql, ctx, updateSystemDefaults, {
    loanDays: 7,
    maxConcurrentLoans: 5,
    maxRenewals: 9,
    renewalDays: 20,
    holdDays: 4,
    dueSoonDays: 15,
  });
  expect(await runQuery(sql, shelfCtx, (tx) => loanDaysFor(tx, bookshelfId))).toBe(
    21,
  );
  const unchanged = await runQuery(sql, shelfCtx, (tx, c) =>
    getShelfSettings(tx, c),
  );
  expect(unchanged.policy).toMatchObject({
    maxRenewals: 2,
    renewalDays: 10,
    dueSoonDays: 5,
  });
});

test("createBookshelf refuses a non-numeric contact phone", async () => {
  // Fix round 1: the refactor from `bookshelves.keeper_phone` to
  // `bookshelf_contacts` dropped `assertPhone` from this command, so
  // `khong-phai-so` reached the table unchecked. Restored per contact — see
  // `tests/domain/admin/shelf-contacts.test.ts` for the `updateBookshelfSettings`
  // half of this pin.
  const ctx = await admin();
  await expect(
    runAdminCommand(sql, ctx, createBookshelf, {
      name: "Tủ sách mới",
      contacts: [
        {
          position: 1,
          name: "Maria Nguyễn Thị Lan",
          phone: "khong-phai-so",
          roleLabel: null,
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "phone_invalid", field: "contact_1_phone" });
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
  await runAdminCommand(sql, ctx, createBookshelf, {
    name: "Tủ sách mới",
    // Task 3 fix round 1: see the note on the earlier `createBookshelf` call
    // in this file for why a position-1 contact is now required.
    contacts: [
      { position: 1, name: "Maria Nguyễn Thị Lan", phone: null, roleLabel: null },
    ],
  });

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
        contacts: [
          { position: 1, name: "Cô Lan", phone: "0912345678", roleLabel: null },
        ],
      },
      loanDays: 21,
    },
  );

  let settings = await runQuery(sql, managerCtx, (tx, c) =>
    getShelfSettings(tx, c),
  );
  expect(settings.profile.contacts).toEqual([
    { position: 1, name: "Cô Lan", phone: "0912345678", roleLabel: null },
  ]);
  expect(settings.policy.loanDays).toBe(21);
  expect(settings.policy.holdDays).toBe(3);

  // Policy only, no profile. The contact survives.
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
  expect(settings.profile.contacts).toEqual([
    { position: 1, name: "Cô Lan", phone: "0912345678", roleLabel: null },
  ]);
  expect(settings.policy.loanDays).toBe(21);
  expect(settings.policy.holdDays).toBe(5);

  // Profile only, with the phone cleared — the edit `coalesce` cannot express,
  // and `contacts` is a wholesale replace rather than a diff, so the whole
  // block is resent with `phone: null`.
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
        contacts: [{ position: 1, name: "Cô Lan", phone: null, roleLabel: null }],
      },
    },
  );
  settings = await runQuery(sql, managerCtx, (tx, c) => getShelfSettings(tx, c));
  expect(settings.profile.contacts[0].phone).toBeNull();
  expect(settings.policy.holdDays).toBe(5);
});

test("a negative policy value is refused, by loan_days's own code", async () => {
  // QA remediation Task 15: this used to be the generic `validation_failed` —
  // "Vui lòng kiểm tra lại thông tin." names nothing a manager can act on for
  // six different numbers. `checkPolicyBound`
  // (`src/domain/admin/policy.ts`) is exercised exhaustively in
  // `tests/domain/admin/bookshelf-settings.test.ts`; this one stays here to
  // pin that the command reached in this file's own "editing the policy"
  // scenario is actually wired to it.
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
  ).toBe("loan_days_out_of_range");
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

// ── Task 5: the appoint form's candidate list ─────────────────────────────

test("a candidate is an active reader of this shelf, and only that", async () => {
  const ctx = await admin();
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const other = await makeShelf(sql, { slug: "can-tho" });

  const active = await makeMember(sql, shelf.id);
  await makeMember(sql, shelf.id, { role: "manager" }); // already running it
  await makeMember(sql, shelf.id, { status: "pending" }); // not yet a member
  await makeMember(sql, shelf.id, { status: "suspended" });
  await makeMember(sql, shelf.id, { status: "left" });
  await makeMember(sql, other.id); // a reader, but of the other shelf

  const rows = await runAdminQuery(sql, ctx, (tx, c) =>
    getManagerCandidates(tx, c, shelf.id),
  );

  expect(rows.map((r) => r.userId)).toEqual([active.userId]);
});

test("a shelf with no active reader has no candidates", async () => {
  const ctx = await admin();
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  await makeMember(sql, shelf.id, { role: "manager" });

  const rows = await runAdminQuery(sql, ctx, (tx, c) =>
    getManagerCandidates(tx, c, shelf.id),
  );
  expect(rows).toEqual([]);
});

test("assigning a listed candidate the manager role removes them from the list", async () => {
  // The round trip Task 5 exists for: `getManagerCandidates` names who
  // `assignManager` may act on, and appointing one is what takes them off
  // the picker again — the same "already running it" exclusion the first
  // test above checks from the other direction.
  const ctx = await admin();
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const reader = await makeMember(sql, shelf.id);

  let rows = await runAdminQuery(sql, ctx, (tx, c) =>
    getManagerCandidates(tx, c, shelf.id),
  );
  expect(rows.map((r) => r.userId)).toEqual([reader.userId]);

  await runAdminCommand(sql, { ...ctx, bookshelfId: shelf.id }, assignManager, {
    userId: reader.userId,
    bookshelfId: shelf.id,
    role: "manager",
  });

  rows = await runAdminQuery(sql, ctx, (tx, c) =>
    getManagerCandidates(tx, c, shelf.id),
  );
  expect(rows).toEqual([]);
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

test("a defaults value below one is refused, by loan_days's own code", async () => {
  // QA remediation Task 15: was the generic `validation_failed` — see the
  // sibling note on "a negative policy value is refused" above.
  const ctx = await admin();
  expect(
    await codeThrownBy(() =>
      runAdminCommand(sql, ctx, updateSystemDefaults, {
        loanDays: 0,
        maxConcurrentLoans: 3,
        maxRenewals: 1,
        renewalDays: 7,
        holdDays: 3,
        dueSoonDays: 3,
      }),
    ),
  ).toBe("loan_days_out_of_range");
});
