import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../../src/db/migrate";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { NotFound, RuleViolated } from "../../../src/domain/kernel/errors";
import {
  systemContext,
  type TenantContext,
} from "../../../src/domain/kernel/tenant";
import {
  runAdminCommand,
  runCommand,
  runQuery,
} from "../../../src/domain/kernel/unit-of-work";
import { approveProfileChange } from "../../../src/domain/members/commands/approve-profile-change";
import { cancelProfileChange } from "../../../src/domain/members/commands/cancel-profile-change";
import { proposeProfileChange } from "../../../src/domain/members/commands/propose-profile-change";
import { rejectProfileChange } from "../../../src/domain/members/commands/reject-profile-change";
import { getMyProfileChangeRequest } from "../../../src/domain/members/queries/get-my-profile-change-request";
import { PROPOSABLE_FIELDS } from "../../../src/domain/members/profile-proposals";
import { closeAll, resetDatabase, sql } from "../../support/db";
import {
  makeMember,
  makeShelf,
  makeParishUnits,
  makeUser,
} from "../../support/factories";
import { superAdminContext } from "../../support/scenarios";

/**
 * OPS §4.3's profile-change lifecycle: propose, approve, reject, cancel, and
 * the query a reader learns the outcome from.
 *
 * BR §7.4's four states, and the one thing every test here is really guarding:
 * a proposal is not an edit. `ProposeProfileChange` writes nothing to `users`,
 * which is master plan §7.2's acceptance clause and the half of the restated
 * INV-13 that a *reader* is still bound by.
 */

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-09T02:00:00Z");
const laterClock = fixedClock("2026-08-16T09:30:00Z");

async function shelfWithReader(slug = "dong-thap") {
  const shelf = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const reader = await makeMember(sql, shelf.id, { status: "active" });
  const ctxWith = (c: typeof clock): TenantContext => ({
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock: c,
  });
  const readerCtx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
    clock,
  };
  return { shelf, manager, reader, ctx: ctxWith(clock), ctxWith, readerCtx };
}

const personOf = (userId: string) =>
  sql<
    { full_name: string; phone: string | null; saint_name: string | null }[]
  >`select full_name, phone, saint_name from users where id = ${userId}`.then(
    (r) => r[0],
  );

const requestsOf = (userId: string) =>
  sql<
    {
      id: string;
      status: string;
      proposed_values: Record<string, unknown>;
      previous_values: Record<string, unknown>;
      rejection_reason: string | null;
      requested_at: Date;
      decided_at: Date | null;
      decided_by: string | null;
    }[]
  >`
    select id, status, proposed_values, previous_values, rejection_reason,
           requested_at, decided_at, decided_by
      from profile_change_requests where user_id = ${userId}
     order by requested_at
  `;

const actions = () =>
  sql<{ action: string; entity_id: string; actor_id: string | null }[]>`
    select action, entity_id, actor_id from audit_log order by occurred_at
  `;

// — proposing —

test("a proposal changes nothing about the person, and says so in the audit", async () => {
  // Master plan §7.2's acceptance clause, deferred here by B2a. BR §2: "Until
  // then the existing values stand — including the phone number, so a manager
  // never loses the means of contacting a family mid-change."
  const { readerCtx, reader } = await shelfWithReader();

  const { profileChangeRequestId } = await runCommand(
    sql,
    readerCtx,
    proposeProfileChange,
    { membershipId: reader.id, fields: { phone: "0912345678" } },
  );

  expect((await personOf(reader.userId)).phone).toBe("0900000000");

  const [request] = await requestsOf(reader.userId);
  expect(request.status).toBe("pending");
  expect(request.proposed_values).toEqual({ phone: "0912345678" });
  expect(request.previous_values).toEqual({ phone: "0900000000" });
  // From ctx.clock, never the column default — DATABASE.md §6.
  expect(request.requested_at.toISOString()).toBe("2026-08-09T02:00:00.000Z");

  const [entry] = await actions();
  expect(entry.action).toBe("profile_change.proposed");
  expect(entry.entity_id).toBe(profileChangeRequestId);
  expect(entry.actor_id).toBe(reader.userId);
});

test("a proposal that differs from nothing is refused", async () => {
  // OPS §4.3's `empty_proposal` is "nothing differs from the current values",
  // not "no fields were named" — so a form submitted unchanged is refused
  // rather than leaving a manager a decision that would change nothing.
  const { readerCtx, reader } = await shelfWithReader();
  const person = await personOf(reader.userId);
  await expect(
    runCommand(sql, readerCtx, proposeProfileChange, {
      membershipId: reader.id,
      fields: { phone: person.phone, full_name: person.full_name },
    }),
  ).rejects.toMatchObject({ code: "empty_proposal" });
  expect(await requestsOf(reader.userId)).toEqual([]);
});

test("the photograph is not proposable through this command", async () => {
  // `ProposeAvatarChange` is a later wave and the reason is not taxonomy: it is
  // the one proposable field that is a file, so its size and content-type
  // policy lives at the surface that received the bytes. Letting `avatar_url`
  // through here would be a way round that policy.
  const { readerCtx, reader } = await shelfWithReader();
  expect([...PROPOSABLE_FIELDS]).not.toContain("avatar_url");
  await expect(
    runCommand(sql, readerCtx, proposeProfileChange, {
      membershipId: reader.id,
      fields: { avatar_url: "https://vd.vn/anh.jpg" },
    }),
  ).rejects.toMatchObject({ code: "empty_proposal" });
});

test("proposing again replaces the portion named and keeps the rest", async () => {
  // The plan's reading of OPS §4.3:480, isolated in
  // `profile-proposals.ts`'s PROPOSAL_ON_SECOND_PROPOSE. Read strictly,
  // "replaces it" means a reader who corrects their phone number and then
  // their saint name silently loses the phone correction, on a screen showing
  // one pending card. Flipping that constant to "replace" turns this test red,
  // which is the whole design: the product owner can reverse the reading in one
  // line and see exactly what it costs.
  const { readerCtx, reader } = await shelfWithReader();

  const first = await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0912345678" },
  });
  const second = await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { saint_name: "Giuse" },
  });

  // INV-13a: one row, not two — replaced rather than added to.
  expect(second.profileChangeRequestId).toBe(first.profileChangeRequestId);
  const rows = await requestsOf(reader.userId);
  expect(rows).toHaveLength(1);
  expect(rows[0].proposed_values).toEqual({
    phone: "0912345678",
    saint_name: "Giuse",
  });
  expect(rows[0].previous_values).toEqual({
    phone: "0900000000",
    saint_name: "Maria",
  });
});

test("re-proposing the same field overwrites that field's proposal", async () => {
  const { readerCtx, reader } = await shelfWithReader();
  await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0912345678" },
  });
  await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0987654321" },
  });
  const rows = await requestsOf(reader.userId);
  expect(rows).toHaveLength(1);
  expect(rows[0].proposed_values).toEqual({ phone: "0987654321" });
  expect(rows[0].previous_values).toEqual({ phone: "0900000000" });
});

test("a reader with memberships at two shelves gets a sentence, never a 23505", async () => {
  // `profile_change_requests_one_pending` is `unique (user_id) where status =
  // 'pending'` — **global across shelves** — while the table is RLS-scoped per
  // shelf. So the second shelf's transaction cannot see the row that is about
  // to reject its insert. OPS §4.3's "replace" is achievable only within one
  // shelf; the catch is the only thing that keeps this a plain Vietnamese
  // sentence. B2a recorded this as the thing B2b "will not think to" handle.
  const a = await shelfWithReader("dong-thap");
  const b = await shelfWithReader("can-tho");

  // One person, two memberships.
  const [second] = await sql<{ id: string }[]>`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${b.shelf.id}, ${a.reader.userId}, 'reader', 'active')
    returning id
  `;
  const atB: TenantContext = {
    bookshelfId: b.shelf.id,
    actor: { userId: a.reader.userId, membershipId: second.id, role: "reader" },
    clock,
  };

  await runCommand(sql, a.readerCtx, proposeProfileChange, {
    membershipId: a.reader.id,
    fields: { phone: "0912345678" },
  });

  const failure = runCommand(sql, atB, proposeProfileChange, {
    membershipId: second.id,
    fields: { phone: "0987654321" },
  });
  await expect(failure).rejects.toBeInstanceOf(RuleViolated);
  await expect(failure).rejects.toMatchObject({ code: "change_already_pending" });
  // And not a driver error dressed up as one.
  await expect(failure).rejects.not.toMatchObject({ code: "23505" });
});

test("one reader cannot propose on another reader's behalf", async () => {
  const { readerCtx, shelf } = await shelfWithReader();
  const other = await makeMember(sql, shelf.id, { status: "active" });
  await expect(
    runCommand(sql, readerCtx, proposeProfileChange, {
      membershipId: other.id,
      fields: { phone: "0912345678" },
    }),
  ).rejects.toBeInstanceOf(RuleViolated);
});

test("systemContext cannot propose, despite outranking everyone", async () => {
  const { shelf, reader } = await shelfWithReader();
  await expect(
    runCommand(sql, systemContext(shelf.id, clock), proposeProfileChange, {
      membershipId: reader.id,
      fields: { phone: "0912345678" },
    }),
  ).rejects.toMatchObject({ code: "not_permitted" });
  expect(await requestsOf(reader.userId)).toEqual([]);
});

// — approving —

test("approval writes the proposed values and audits against the person", async () => {
  const { ctxWith, readerCtx, reader, manager } = await shelfWithReader();
  await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0912345678", saint_name: "Giuse" },
  });
  const [request] = await requestsOf(reader.userId);

  await runCommand(sql, ctxWith(laterClock), approveProfileChange, {
    profileChangeRequestId: request.id,
  });

  const person = await personOf(reader.userId);
  expect(person.phone).toBe("0912345678");
  expect(person.saint_name).toBe("Giuse");

  const [after] = await requestsOf(reader.userId);
  expect(after.status).toBe("approved");
  expect(after.decided_by).toBe(manager.userId);
  // A week later on the manager's clock, not the database host's.
  expect(after.decided_at!.toISOString()).toBe("2026-08-16T09:30:00.000Z");

  const rows = await actions();
  expect(rows.map((r) => r.action)).toEqual([
    "profile_change.proposed",
    "profile_change.approved",
  ]);
  expect(rows[1].entity_id).toBe(reader.userId);
  expect(rows[1].actor_id).toBe(manager.userId);
});

// — PO feedback round 1, Task 8, and its own fix round 1: the rule moved to
// `ProposeProfileChange` — the screen with the reason box — with
// `ApproveProfileChange`'s own check kept as a backstop for a request that
// bypassed it entirely —

test("proposing to clear the phone with no reason on file is refused, before anything is written", async () => {
  // Reviewer-found critical: raising this only at approval put the refusal
  // on a screen (`doi-thong-tin`) whose form carries no phone or reason box
  // at all — a manager could never approve it, only reject it. `ho-so
  // /page.tsx` has the box; `ProposeProfileChange` is where the check now
  // lives, so the reader who submitted it is the one asked.
  const { readerCtx, reader } = await shelfWithReader();
  await expect(
    runCommand(sql, readerCtx, proposeProfileChange, {
      membershipId: reader.id,
      fields: { phone: null },
    }),
  ).rejects.toMatchObject({ code: "thieu-so-dien-thoai" });

  // Nothing was written — no pending request sits around half-answered.
  expect(await requestsOf(reader.userId)).toHaveLength(0);
  const person = await personOf(reader.userId);
  expect(person.phone).not.toBeNull();
});

test("ApproveProfileChange's own check is a backstop for a request ProposeProfileChange never touched", async () => {
  // `profile_change_requests.proposed_values` is `jsonb` with no check
  // constraint (DATABASE.md §4.11's own price for the design) — a row can
  // exist without ever going through `ProposeProfileChange`, the same fact
  // "approval re-validates the stored proposal rather than trusting it"
  // (above) already exercises for a blank `full_name`. `assertPhoneOrReason`
  // still runs inside `ApproveProfileChange` for exactly this reason.
  const { ctx, reader, shelf } = await shelfWithReader();
  await sql`
    insert into profile_change_requests
      (user_id, bookshelf_id, proposed_values, previous_values, status)
    values (${reader.userId}, ${shelf.id}, '{"phone":null}', '{}', 'pending')
  `;
  const [row] = await sql<
    { id: string }[]
  >`select id from profile_change_requests where user_id = ${reader.userId}`;

  await expect(
    runCommand(sql, ctx, approveProfileChange, {
      profileChangeRequestId: row.id,
    }),
  ).rejects.toMatchObject({ code: "thieu-so-dien-thoai" });

  // Refused before anything committed — the phone is exactly what it was,
  // and the request is still pending for a manager to reject or ask again.
  const person = await personOf(reader.userId);
  expect(person.phone).not.toBeNull();
  const [after] = await requestsOf(reader.userId);
  expect(after.status).toBe("pending");
});

test("a reason already on file answers it, even though the proposal names only the phone", async () => {
  const { readerCtx, ctx, ctxWith, reader } = await shelfWithReader();
  // The record already carries a reason, from an earlier, unrelated decision
  // — a manager's own direct correction, not this proposal.
  await runCommand(sql, ctxWith(clock), approveProfileChange, {
    profileChangeRequestId: (
      await runCommand(sql, readerCtx, proposeProfileChange, {
        membershipId: reader.id,
        fields: { phone: null, phone_missing_reason: "Chưa có, sẽ bổ sung sau" },
      })
    ).profileChangeRequestId,
  });

  // A second, unrelated proposal — the field it never mentions is
  // phone_missing_reason, so approving it must not ask the question again.
  await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { saint_name: "Anna" },
  });
  const [, second] = await requestsOf(reader.userId);

  await runCommand(sql, ctxWith(laterClock), approveProfileChange, {
    profileChangeRequestId: second.id,
  });

  const person = await personOf(reader.userId);
  expect(person.phone).toBeNull();
  expect(person.saint_name).toBe("Anna");
});

test("approval can set the parish placement in the same action, and validates it", async () => {
  // BR §5.6's rule, through the shared `validateSelection` — the only code path
  // this slice shares with B2a, and shared as an import rather than restated.
  const { ctx, readerCtx, reader, shelf } = await shelfWithReader();
  const units = await makeParishUnits(
    sql,
    shelf.id,
    { levels: 2, nested: true, level1Label: "Giáo họ", level2Label: "Tổ" },
    [
      { level: 1, name: "Giáo họ Thánh Tâm" },
      { level: 1, name: "Giáo họ Mân Côi" },
      { level: 2, name: "Tổ 1", parentName: "Giáo họ Thánh Tâm" },
    ],
  );
  const thanhTam = units.get("Giáo họ Thánh Tâm")!;
  const manCoi = units.get("Giáo họ Mân Côi")!;
  const to1 = units.get("Tổ 1")!;

  await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0912345678" },
  });
  const [request] = await requestsOf(reader.userId);

  await expect(
    runCommand(sql, ctx, approveProfileChange, {
      profileChangeRequestId: request.id,
      parishUnitL1Id: manCoi,
      parishUnitL2Id: to1, // a child of Thánh Tâm, not of Mân Côi
    }),
  ).rejects.toMatchObject({ code: "parish_unit_l2_not_in_l1" });

  // Nothing moved: the refusal rolled the whole transaction back.
  expect((await personOf(reader.userId)).phone).toBe("0900000000");
  expect((await requestsOf(reader.userId))[0].status).toBe("pending");

  await runCommand(sql, ctx, approveProfileChange, {
    profileChangeRequestId: request.id,
    parishUnitL1Id: thanhTam,
    parishUnitL2Id: to1,
  });
  const [m] = await sql<
    { parish_unit_l1_id: string; parish_unit_l2_id: string }[]
  >`select parish_unit_l1_id, parish_unit_l2_id from memberships where id = ${reader.id}`;
  expect(m.parish_unit_l1_id).toBe(thanhTam);
  expect(m.parish_unit_l2_id).toBe(to1);
});

test("the admin queue's approval scopes the subject to the request's own shelf, not any other membership the subject holds", async () => {
  // Fix round 1: `subjectOfProfileChange` (`../../../src/domain/members
  // /scoped-user.ts`) used to join `memberships` on `user_id` alone, no
  // `bookshelf_id` predicate, and relied on RLS to narrow it to one shelf.
  // `/quan-tri/actions.ts`'s admin queue reaches this same command through
  // `runAdminCommand`, which runs as `olibra_admin` with `bypassrls` — RLS
  // never narrows anything there — so a subject holding manager membership
  // at more than one parish (ordinary, per `../../../src/domain/admin
  // /commands/managers.ts`) could have this resolve to *either* membership.
  // Proven here the way the parish-placement write makes observable: the
  // manager holds a second, unrelated membership at shelf B, and approving
  // a request proposed at shelf A must move shelf A's placement, never
  // shelf B's — regardless of `ctx.bookshelfId`, since `subjectOfProfileChange`
  // takes no `ctx` at all and the join itself is what has to narrow it now.
  const a = await makeShelf(sql, { slug: "dong-thap-multi" });
  const b = await makeShelf(sql, { slug: "an-giang-multi" });
  const user = await makeUser(sql);
  // Which of the two rows an *unfiltered* join would have returned is a
  // Postgres planner detail this test does not try to control (verified: it
  // is not simply insertion order — an index on `memberships` can make the
  // unpatched query land on the right row by accident on any given run,
  // which is exactly the "arbitrary" this fix's own docstring names, not a
  // reliable one). What this test actually pins is the fix's real contract:
  // `m.bookshelf_id = r.bookshelf_id` excludes shelf B's row from the query
  // outright, not merely deprioritises it, so the assertions below hold
  // deterministically under the current code regardless of row order —
  // unlike the code before this fix, which could not make that promise.
  await sql`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${b.id}, ${user.id}, 'manager', 'active')
  `;
  const [aRow] = await sql<{ id: string }[]>`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${a.id}, ${user.id}, 'manager', 'active')
    returning id
  `;
  const manager = { id: aRow.id, userId: user.id };
  const managerCtx: TenantContext = {
    bookshelfId: a.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  await runCommand(sql, managerCtx, proposeProfileChange, {
    membershipId: manager.id,
    fields: { phone: "0912345678" },
  });
  const [request] = await requestsOf(manager.userId);

  const units = await makeParishUnits(
    sql,
    a.id,
    { levels: 1, nested: false, level1Label: "Giáo họ", level2Label: "Giáo họ" },
    [{ level: 1, name: "Giáo họ Thánh Tâm" }],
  );
  const thanhTam = units.get("Giáo họ Thánh Tâm")!;

  const { ctx: superCtx } = await superAdminContext(sql, "2026-08-09T02:00:00Z");
  await runAdminCommand(
    sql,
    { ...superCtx, bookshelfId: a.id },
    approveProfileChange,
    {
      profileChangeRequestId: request.id,
      parishUnitL1Id: thanhTam,
    },
  );

  const [rowA] = await sql<{ parish_unit_l1_id: string | null }[]>`
    select parish_unit_l1_id from memberships where id = ${manager.id}
  `;
  expect(rowA.parish_unit_l1_id).toBe(thanhTam);

  const [rowB] = await sql<{ parish_unit_l1_id: string | null }[]>`
    select parish_unit_l1_id from memberships
     where bookshelf_id = ${b.id} and user_id = ${manager.userId}
  `;
  expect(rowB.parish_unit_l1_id).toBeNull();
});

test("moving only the level-1 unit is checked against the level-2 unit already there", async () => {
  // The case a first draft of the test above could not see, and the reason the
  // command validates the **resulting** selection rather than the half that was
  // typed. Both stay optional here exactly as they are everywhere else (BR
  // §5.6), so "supplied neither leaves the existing placement untouched" means
  // an unsupplied field is still part of what the rule is about.
  //
  // Validating only what was typed passes this — `{ l1: Mân Côi, l2: null }` is
  // a perfectly good selection — and then writes `l2 = Tổ 1` back beside it,
  // persisting exactly the parent/child mismatch BR §5.6 exists to forbid.
  // Confirmed by planting that version: this test goes red and the one above
  // stays green.
  const { ctx, readerCtx, reader, shelf } = await shelfWithReader();
  const units = await makeParishUnits(
    sql,
    shelf.id,
    { levels: 2, nested: true, level1Label: "Giáo họ", level2Label: "Tổ" },
    [
      { level: 1, name: "Giáo họ Thánh Tâm" },
      { level: 1, name: "Giáo họ Mân Côi" },
      { level: 2, name: "Tổ 1", parentName: "Giáo họ Thánh Tâm" },
    ],
  );
  const thanhTam = units.get("Giáo họ Thánh Tâm")!;
  const manCoi = units.get("Giáo họ Mân Côi")!;
  const to1 = units.get("Tổ 1")!;
  await sql`
    update memberships set parish_unit_l1_id = ${thanhTam}, parish_unit_l2_id = ${to1}
    where id = ${reader.id}
  `;

  await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0912345678" },
  });
  const [request] = await requestsOf(reader.userId);

  await expect(
    runCommand(sql, ctx, approveProfileChange, {
      profileChangeRequestId: request.id,
      parishUnitL1Id: manCoi, // and nothing said about level 2
    }),
  ).rejects.toMatchObject({ code: "parish_unit_l2_not_in_l1" });

  const [m] = await sql<
    { parish_unit_l1_id: string; parish_unit_l2_id: string }[]
  >`select parish_unit_l1_id, parish_unit_l2_id from memberships where id = ${reader.id}`;
  expect(m.parish_unit_l1_id).toBe(thanhTam);
  expect(m.parish_unit_l2_id).toBe(to1);
});

test("a decided request cannot be decided again, in any of the three ways", async () => {
  // The fourth `not_pending` collision, and this is the code that had to be
  // split off: `request_not_pending` carries the same sentence but is a
  // *borrow* request's.
  const { ctx, readerCtx, reader } = await shelfWithReader();
  await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0912345678" },
  });
  const [request] = await requestsOf(reader.userId);
  await runCommand(sql, ctx, approveProfileChange, {
    profileChangeRequestId: request.id,
  });

  for (const attempt of [
    runCommand(sql, ctx, approveProfileChange, {
      profileChangeRequestId: request.id,
    }),
    runCommand(sql, ctx, rejectProfileChange, {
      profileChangeRequestId: request.id,
      reason: "muộn rồi",
    }),
    runCommand(sql, readerCtx, cancelProfileChange, {
      membershipId: reader.id,
      profileChangeRequestId: request.id,
    }),
  ]) {
    await expect(attempt).rejects.toMatchObject({
      code: "profile_change_not_pending",
    });
  }
});

test("approval re-validates the stored proposal rather than trusting it", async () => {
  // `proposed_values` is `jsonb` with no check constraint behind it —
  // DATABASE.md §4.11 names that as the price of the design, and the price is
  // that a row is not proof of anything. A request written by an older version
  // of this application, by a later slice, or by hand can hold a whitespace
  // `full_name` or a date in a shape `::date` will misread.
  //
  // Both failure modes are **silent**, which is why this is re-validated rather
  // than left to the columns — measured by planting the trusting version:
  // `full_name = '   '` satisfies the `not null` constraint perfectly and
  // stores three spaces as a child's name, and `'02/04/2015'::date` stores
  // 2015-02-04 under `olibra_test`'s `ISO, MDY` DateStyle. Neither raises
  // anything at all.
  const { ctx, reader, shelf } = await shelfWithReader();
  const insert = (proposed: Record<string, string>) => sql`
    insert into profile_change_requests
      (user_id, bookshelf_id, proposed_values, previous_values, status)
    values (${reader.userId}, ${shelf.id}, ${sql.json(proposed)}, '{}', 'pending')
    returning id
  `;
  const idOf = () =>
    sql<{ id: string }[]>`
      select id from profile_change_requests
      where user_id = ${reader.userId} and status = 'pending'
    `.then((r) => r[0].id);

  await insert({ full_name: "   " });
  await expect(
    runCommand(sql, ctx, approveProfileChange, {
      profileChangeRequestId: await idOf(),
    }),
  ).rejects.toMatchObject({ code: "required_fields_missing" });

  await sql`delete from profile_change_requests where user_id = ${reader.userId}`;
  await insert({ date_of_birth: "02/04/2015" });
  await expect(
    runCommand(sql, ctx, approveProfileChange, {
      profileChangeRequestId: await idOf(),
    }),
  ).rejects.toMatchObject({ code: "validation_failed" });
  // And the ambiguous date really would have landed: `olibra_test`'s DateStyle
  // is `ISO, MDY`, so `'02/04/2015'::date` is 2015-02-04, not 2 April.
  const [person] = await sql<
    { date_of_birth: string | null }[]
  >`select date_of_birth::text as date_of_birth from users where id = ${reader.userId}`;
  expect(person.date_of_birth).toBeNull();
});

// — rejecting —

test("rejection keeps the values, records the reason, and needs one", async () => {
  const { ctx, readerCtx, reader, manager } = await shelfWithReader();
  await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0912345678" },
  });
  const [request] = await requestsOf(reader.userId);

  await expect(
    runCommand(sql, ctx, rejectProfileChange, {
      profileChangeRequestId: request.id,
      reason: "   ",
    }),
  ).rejects.toMatchObject({ code: "reject_reason_required" });

  await runCommand(sql, ctx, rejectProfileChange, {
    profileChangeRequestId: request.id,
    reason: "  Số này của nhà hàng xóm.  ",
  });

  const [after] = await requestsOf(reader.userId);
  expect(after.status).toBe("rejected");
  // Trimmed once and stored once, so the row and the audit cannot disagree.
  expect(after.rejection_reason).toBe("Số này của nhà hàng xóm.");
  expect(after.decided_by).toBe(manager.userId);
  expect((await personOf(reader.userId)).phone).toBe("0900000000");
});

// — cancelling —

test("a reader withdraws their own proposal; another reader cannot", async () => {
  const { readerCtx, reader, shelf } = await shelfWithReader();
  await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0912345678" },
  });
  const [request] = await requestsOf(reader.userId);

  const other = await makeMember(sql, shelf.id, { status: "active" });
  const otherCtx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: other.userId, membershipId: other.id, role: "reader" },
    clock,
  };
  await expect(
    runCommand(sql, otherCtx, cancelProfileChange, {
      membershipId: other.id,
      profileChangeRequestId: request.id,
    }),
  ).rejects.toMatchObject({ code: "not_own_request" });

  await runCommand(sql, readerCtx, cancelProfileChange, {
    membershipId: reader.id,
    profileChangeRequestId: request.id,
  });
  const [after] = await requestsOf(reader.userId);
  expect(after.status).toBe("cancelled");
  expect(after.decided_at!.toISOString()).toBe("2026-08-09T02:00:00.000Z");
  // The manager who ruled on it — and a withdrawal has none.
  expect(after.decided_by).toBeNull();
});

test("a cancelled request frees the one pending slot", async () => {
  // INV-13a's partial index is on `status = 'pending'`, so cancelling must
  // genuinely release it rather than leaving the person unable to propose again.
  const { readerCtx, reader } = await shelfWithReader();
  await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0912345678" },
  });
  const [request] = await requestsOf(reader.userId);
  await runCommand(sql, readerCtx, cancelProfileChange, {
    membershipId: reader.id,
    profileChangeRequestId: request.id,
  });
  await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0987654321" },
  });
  const rows = await requestsOf(reader.userId);
  expect(rows.map((r) => r.status).sort()).toEqual(["cancelled", "pending"]);
});

// — cross-shelf, on every command that takes a request id —

test("INV-10: another shelf's request is not found, rather than refused", async () => {
  // Because RLS filtered the select to zero rows, not because anyone compared
  // two shelf ids. `write_target_not_found` is the interim OPS §4.3 does not
  // name (plan §8, item 3) and it is also the honest answer: as far as this
  // shelf is concerned there is no such request.
  const a = await shelfWithReader("dong-thap");
  const b = await shelfWithReader("can-tho");
  await runCommand(sql, a.readerCtx, proposeProfileChange, {
    membershipId: a.reader.id,
    fields: { phone: "0912345678" },
  });
  const [request] = await requestsOf(a.reader.userId);

  await expect(
    runCommand(sql, b.ctx, approveProfileChange, {
      profileChangeRequestId: request.id,
    }),
  ).rejects.toBeInstanceOf(NotFound);
  await expect(
    runCommand(sql, b.ctx, rejectProfileChange, {
      profileChangeRequestId: request.id,
      reason: "không phải của tôi",
    }),
  ).rejects.toBeInstanceOf(NotFound);

  expect((await personOf(a.reader.userId)).phone).toBe("0900000000");
  expect((await requestsOf(a.reader.userId))[0].status).toBe("pending");
});

test("a request whose subject holds no membership of this shelf is not approvable", async () => {
  // The structural gap the plan names: `profile_change_requests.user_id`
  // references the global `users` table, and RLS's `with check` guarantees only
  // that `bookshelf_id` matches the session. A row naming a person with no
  // membership here is representable, so the `join memberships` is what refuses
  // it — and without that join this would be a `users` write authorised by a
  // column rather than by a policy.
  const { ctx, shelf } = await shelfWithReader();
  const stranger = await makeMember(sql, (await makeShelf(sql)).id, {});
  await sql`
    insert into profile_change_requests
      (user_id, bookshelf_id, proposed_values, previous_values, status)
    values (${stranger.userId}, ${shelf.id}, '{"phone":"0912345678"}',
            '{"phone":"0900000000"}', 'pending')
  `;
  const [row] = await sql<
    { id: string }[]
  >`select id from profile_change_requests where user_id = ${stranger.userId}`;

  await expect(
    runCommand(sql, ctx, approveProfileChange, {
      profileChangeRequestId: row.id,
    }),
  ).rejects.toMatchObject({ code: "write_target_not_found" });
  expect((await personOf(stranger.userId)).phone).toBe("0900000000");
});

// — what the reader sees afterwards —

test("GetMyProfileChangeRequest survives the decision, so a rejection reason is readable", async () => {
  // BR §15 lists no notification for a profile-change decision and OPS §4.3
  // records that gap without inventing one — "a reader only learns the outcome
  // by revisiting GetMyProfileChangeRequest". A query returning only pending
  // rows would make the reason unreachable the moment it was written.
  const { ctx, readerCtx, reader } = await shelfWithReader();
  const none = await runQuery(sql, readerCtx, (tx, c) =>
    getMyProfileChangeRequest(tx, c, { membershipId: reader.id }),
  );
  expect(none).toBeNull();

  await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0912345678" },
  });
  const [request] = await requestsOf(reader.userId);
  await runCommand(sql, ctx, rejectProfileChange, {
    profileChangeRequestId: request.id,
    reason: "Số này của nhà hàng xóm.",
  });

  const seen = await runQuery(sql, readerCtx, (tx, c) =>
    getMyProfileChangeRequest(tx, c, { membershipId: reader.id }),
  );
  expect(seen).toMatchObject({
    status: "rejected",
    rejectionReason: "Số này của nhà hàng xóm.",
    proposedValues: { phone: "0912345678" },
    previousValues: { phone: "0900000000" },
  });
});

test("GetMyProfileChangeRequest hands back no storage key it happens to hold", async () => {
  // The avatar wave stores `avatar_object` — an object-store key — alongside
  // `avatar_url` in the same jsonb. A screen has no use for it, and a query
  // returning the raw column would be the place it leaked.
  const { readerCtx, reader, shelf } = await shelfWithReader();
  await sql`
    insert into profile_change_requests
      (user_id, bookshelf_id, proposed_values, previous_values, status)
    values (${reader.userId}, ${shelf.id},
            '{"avatar_url":"https://vd.vn/a.jpg","avatar_object":"avatars/a.jpg"}',
            '{"avatar_url":null}', 'pending')
  `;
  const seen = await runQuery(sql, readerCtx, (tx, c) =>
    getMyProfileChangeRequest(tx, c, { membershipId: reader.id }),
  );
  expect(seen!.proposedValues).toEqual({ avatar_url: "https://vd.vn/a.jpg" });
});

test("one reader cannot read another reader's proposal", async () => {
  const { readerCtx, shelf } = await shelfWithReader();
  const other = await makeMember(sql, shelf.id, { status: "active" });
  await expect(
    runQuery(sql, readerCtx, (tx, c) =>
      getMyProfileChangeRequest(tx, c, { membershipId: other.id }),
    ),
  ).rejects.toBeInstanceOf(RuleViolated);
});
