import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../../src/db/migrate";
import { fixedClock } from "../../../src/domain/kernel/clock";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runCommand, runQuery } from "../../../src/domain/kernel/unit-of-work";
import { proposeProfileChange } from "../../../src/domain/members/commands/propose-profile-change";
import { updateReaderProfile } from "../../../src/domain/members/commands/update-reader-profile";
import { getMyProfile } from "../../../src/domain/members/queries/get-my-profile";
import { getPendingProfileChanges } from "../../../src/domain/members/queries/get-pending-profile-changes";
import { closeAll, resetDatabase, sql } from "../../support/db";
import { makeMember, makeParishUnits, makeShelf } from "../../support/factories";

/**
 * Two of the three units B2b declared and did not build — `GetMyProfile` and
 * `GetPendingProfileChanges` (plan §1, §3.5, §5 tasks 4–5). The third,
 * `UpdateOwnProfile`, carried BR §16.2's leaderboard toggle and was retired
 * along with it (`docs/superpowers/specs/2026-08-12-po-feedback-design.md`
 * §13).
 *
 * The second of these two is the one that mattered most and is the reason this
 * file exists at
 * all: **§3.5's entire protection against `UpdateReaderProfile` making a pending
 * request's `previous_values` lie was `GetPendingProfileChanges` rendering the
 * current column live from `users`.** With no query there was no mechanism, and
 * the plan's own acceptance criterion was unmeetable. The last test here is that
 * criterion, word for word.
 */

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-09T02:00:00Z");

async function shelfWithReader(slug = "dong-thap") {
  const shelf = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const reader = await makeMember(sql, shelf.id, { status: "active" });
  const managerCtx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  const readerCtx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
    clock,
  };
  return { shelf, manager, reader, managerCtx, readerCtx };
}

// — GetMyProfile —

test("a reader's own profile carries the nine fields and the parish line", async () => {
  // OPS §3.2's return list. The parish line is rendered with *this shelf's*
  // labels rather than a hard-coded word — the same `describeSelection` the
  // manager's reader page uses, so the two cannot describe one child two ways.
  const { shelf, reader, readerCtx } = await shelfWithReader();
  const units = await makeParishUnits(
    sql,
    shelf.id,
    { levels: 2, nested: true, level1Label: "Giáo họ", level2Label: "Tổ" },
    [
      { level: 1, name: "Giáo họ Thánh Tâm" },
      { level: 2, name: "Tổ 2", parentName: "Giáo họ Thánh Tâm" },
    ],
  );
  await sql`
    update memberships
       set parish_unit_l1_id = ${units.get("Giáo họ Thánh Tâm")!},
           parish_unit_l2_id = ${units.get("Tổ 2")!}
     where id = ${reader.id}
  `;
  await sql`update users set saint_name = 'Maria' where id = ${reader.userId}`;

  const profile = await runQuery(sql, readerCtx, (tx, ctx) =>
    getMyProfile(tx, ctx, { membershipId: reader.id }),
  );

  expect(profile.fields.saint_name).toBe("Maria");
  expect(profile.fields.phone).toBe("0900000000");
  expect(Object.keys(profile.fields)).toHaveLength(9);
  expect(profile.parishUnitL1Name).toBe("Giáo họ Thánh Tâm");
  expect(profile.parishUnitL2Name).toBe("Tổ 2");
  expect(profile.parishLine).toContain("Tổ 2");
  expect(profile.pendingChange).toBeNull();
});

test("a reader's own profile carries the phone-missing reason on file, not a hardcoded null", async () => {
  // The assertion `toHaveLength(9)` above cannot make: a query that forgot to
  // select `phone_missing_reason` still returns a nine-key object (`row[f] ??
  // null` fills the gap with `null`), and a length check cannot tell that
  // apart from a query that genuinely read an empty reason. This stores a
  // real one and reads it back through the same command a manager actually
  // uses, then checks the exact string.
  const { reader, readerCtx, managerCtx } = await shelfWithReader();
  await runCommand(sql, managerCtx, updateReaderProfile, {
    membershipId: reader.id,
    fields: {
      phone: null,
      phone_missing_reason: "Em bé chưa có điện thoại, mẹ sẽ bổ sung sau",
    },
  });

  const profile = await runQuery(sql, readerCtx, (tx, ctx) =>
    getMyProfile(tx, ctx, { membershipId: reader.id }),
  );

  expect(profile.fields.phone_missing_reason).toBe(
    "Em bé chưa có điện thoại, mẹ sẽ bổ sung sau",
  );
});

test("a reader's own profile shows the pending proposal beside the values still in force", async () => {
  // BR §16.2: "the page shows the current value with the pending one beside it,
  // and says plainly that it is waiting". Both halves in one assertion, because
  // the failure this guards is that one of them starts showing the other.
  const { reader, readerCtx } = await shelfWithReader();
  await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0912345678" },
  });

  const profile = await runQuery(sql, readerCtx, (tx, ctx) =>
    getMyProfile(tx, ctx, { membershipId: reader.id }),
  );

  expect(profile.fields.phone).toBe("0900000000");
  expect(profile.pendingChange?.status).toBe("pending");
  expect(profile.pendingChange?.proposedValues).toEqual({ phone: "0912345678" });
});

// — GetPendingProfileChanges —

test("the queue lists this shelf's pending proposals and nobody else's", async () => {
  const { reader, readerCtx, managerCtx } = await shelfWithReader();
  await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0912345678" },
  });

  // A second shelf with its own pending proposal, which must not appear.
  const other = await shelfWithReader("cao-lanh");
  await runCommand(sql, other.readerCtx, proposeProfileChange, {
    membershipId: other.reader.id,
    fields: { phone: "0977777777" },
  });

  const queue = await runQuery(sql, managerCtx, getPendingProfileChanges);

  expect(queue).toHaveLength(1);
  expect(queue[0].membershipId).toBe(reader.id);
  expect(queue[0].proposedValues).toEqual({ phone: "0912345678" });
});

test("a decided proposal leaves the queue", async () => {
  const { reader, readerCtx, managerCtx } = await shelfWithReader();
  await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0912345678" },
  });
  await sql`update profile_change_requests set status = 'rejected', rejection_reason = 'x'`;

  expect(await runQuery(sql, managerCtx, getPendingProfileChanges)).toHaveLength(0);
});

test("the queue hands back nothing the allowlist does not name", async () => {
  // `proposed_values` is `jsonb` with no check constraint behind it, so it may
  // hold a key nothing sanctioned — and a query handing back the raw column is
  // the place that would leak it. Filtered through the same allowlist on the
  // way out as on the way in. `avatar_object` survives: it is a `ProfileField`
  // as of 2026-08-13, and the screen turns it into an address with
  // `avatarUrl()` rather than reading one off the row.
  const { reader, managerCtx } = await shelfWithReader();
  await sql`
    insert into profile_change_requests
      (user_id, bookshelf_id, proposed_values, previous_values, status)
    values (${reader.userId}, ${managerCtx.bookshelfId},
            ${sql.json({
              avatar_object: "avatars/a.webp",
              password_hash: "$argon2id$stolen",
            })},
            ${sql.json({ avatar_object: null })}, 'pending')
  `;

  const [row] = await runQuery(sql, managerCtx, getPendingProfileChanges);
  expect(row.proposedValues).toEqual({ avatar_object: "avatars/a.webp" });
  expect(JSON.stringify(row)).not.toContain("argon2id");
});

test("a phone corrected by UpdateReaderProfile shows as current, and previous_values is untouched", async () => {
  // Plan §6's acceptance criterion, and §3.5's Drift 3 in full. A proposal is
  // made on Monday against phone A; a manager corrects the number to B on
  // Tuesday with `UpdateReaderProfile`, which deliberately does not touch the
  // pending request. On Wednesday the queue must show B as current — the value
  // approving would actually replace — while the row's own snapshot still says
  // A, because DATABASE.md §4.11 calls that a historical record.
  //
  // Rendering `previous_values` as "current" is the tidier-looking wrong version
  // a future reader will otherwise write: it needs no extra join and is right
  // until the day somebody uses the command this slice exists for.
  const { reader, readerCtx, managerCtx } = await shelfWithReader();
  await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0912345678" },
  });

  await runCommand(sql, managerCtx, updateReaderProfile, {
    membershipId: reader.id,
    fields: { phone: "0933333333" },
  });

  const [row] = await runQuery(sql, managerCtx, getPendingProfileChanges);

  expect(row.currentValues.phone).toBe("0933333333");
  expect(row.proposedValues).toEqual({ phone: "0912345678" });
  expect(row.previousValues.phone).toBe("0900000000");

  // And the request itself is still pending and still says what it always said.
  const [stored] = await sql<
    { status: string; previous_values: Record<string, string> }[]
  >`select status, previous_values from profile_change_requests`;
  expect(stored.status).toBe("pending");
  expect(stored.previous_values.phone).toBe("0900000000");
});

test("the queue's current values carry the phone-missing reason on file, not a hardcoded null", async () => {
  // The same property `getMyProfile`'s own test above proves, for
  // `currentValues` — read live from `users` in this query too, through the
  // same `PROFILE_FIELDS.map((f) => [f, row[f] ?? null])` idiom, and just as
  // silently wrong if the `select` list ever drifts from the array again.
  const { reader, readerCtx, managerCtx } = await shelfWithReader();
  await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0912345678" },
  });
  await runCommand(sql, managerCtx, updateReaderProfile, {
    membershipId: reader.id,
    fields: { phone: null, phone_missing_reason: "Chưa có, sẽ bổ sung sau" },
  });

  const [row] = await runQuery(sql, managerCtx, getPendingProfileChanges);

  expect(row.currentValues.phone_missing_reason).toBe("Chưa có, sẽ bổ sung sau");
});
