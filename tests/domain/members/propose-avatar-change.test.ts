import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../../src/db/migrate";
import { assertNoSecrets } from "../../../src/domain/kernel/audit";
import { fixedClock } from "../../../src/domain/kernel/clock";
import {
  systemContext,
  type TenantContext,
} from "../../../src/domain/kernel/tenant";
import { runCommand } from "../../../src/domain/kernel/unit-of-work";
import { approveProfileChange } from "../../../src/domain/members/commands/approve-profile-change";
import { cancelProfileChange } from "../../../src/domain/members/commands/cancel-profile-change";
import { proposeAvatarChange } from "../../../src/domain/members/commands/propose-avatar-change";
import { proposeProfileChange } from "../../../src/domain/members/commands/propose-profile-change";
import { rejectProfileChange } from "../../../src/domain/members/commands/reject-profile-change";
import { AVATAR_OBJECT } from "../../../src/domain/members/pending-proposal";
import { closeAll, resetDatabase, sql } from "../../support/db";
import { makeMember, makeShelf } from "../../support/factories";

/**
 * OPS §4.3's `ProposeAvatarChange`, at the domain layer — no bytes, no store.
 *
 * The photograph is the one proposable field that is a file, and since
 * 2026-08-13 the whole of what it costs is **one** string in a `jsonb` bag: the
 * storage key, copied to `users.avatar_object` on approval like any other
 * proposed field. It used to be two — a URL beside the key — and every
 * mechanism that kept the pair in step is gone with the URL column
 * (`20260813_02_avatar_object_only.sql`). The address a browser fetches is
 * derived from the key at read time, at the surface, in `src/lib/avatar-url.ts`.
 *
 * The key living in the pending row is also what lets a rejected or cancelled
 * proposal delete the object instead of leaving it orphaned (OPS §4.3).
 *
 * The key is named `avatar_object` and not `avatar_key`, and that is guarded
 * here rather than remembered: `kernel/audit.ts` forbids `key` as a whole token,
 * and this command audits the payload.
 */

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-09T05:00:00Z");

async function shelfWithReader(slug?: string) {
  const shelf = await makeShelf(sql, slug ? { slug } : {});
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const reader = await makeMember(sql, shelf.id, { status: "active" });
  const readerCtx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
    clock,
  };
  const managerCtx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  return { shelf, manager, reader, readerCtx, managerCtx };
}

const upload = (n: number) => ({ avatarObject: `avatars/anh-${n}.webp` });

const requestOf = (userId: string) =>
  sql<
    {
      id: string;
      status: string;
      proposed_values: Record<string, unknown>;
      previous_values: Record<string, unknown>;
    }[]
  >`
    select id, status, proposed_values, previous_values
      from profile_change_requests where user_id = ${userId}
  `.then((r) => r[0]);

const avatarOf = (userId: string) =>
  sql<{ avatar_object: string | null }[]>`
    select avatar_object from users where id = ${userId}
  `.then((r) => r[0].avatar_object);

const actions = () =>
  sql<{ action: string; after: Record<string, unknown> }[]>`
    select action, after from audit_log order by occurred_at
  `;

test("a proposed photograph is stored as a key, and changes nothing yet", async () => {
  const { readerCtx, reader } = await shelfWithReader();
  const image = upload(1);

  const { profileChangeRequestId, supersededAvatarObject } = await runCommand(
    sql,
    readerCtx,
    proposeAvatarChange,
    { membershipId: reader.id, ...image },
  );

  // The person is untouched — BR §2's "the existing values stand… until a
  // manager approves", which for the photograph means the old one keeps showing.
  expect(await avatarOf(reader.userId)).toBeNull();
  expect(supersededAvatarObject).toBeNull();

  const request = await requestOf(reader.userId);
  expect(request.id).toBe(profileChangeRequestId);
  expect(request.status).toBe("pending");
  expect(request.proposed_values).toEqual({
    avatar_object: image.avatarObject,
  });
  expect(request.previous_values).toEqual({ avatar_object: null });

  const [entry] = await actions();
  expect(entry.action).toBe("profile_change.proposed");
  expect(entry.after[AVATAR_OBJECT]).toBe(image.avatarObject);
});

test("the payload field is avatar_object because avatar_key is a forbidden audit token", async () => {
  // The landmine, named. `kernel/audit.ts`'s FORBIDDEN list matches `key` as a
  // whole token, and this command audits `proposed_values`. Had the obvious name
  // been used, every avatar proposal would have thrown `audit_forbidden_field`
  // at the audit insert — after the command body had already run.
  expect(AVATAR_OBJECT).toBe("avatar_object");

  const safe = {
    action: "profile_change.proposed",
    entityType: "profile_change_request",
    entityId: crypto.randomUUID(),
    after: { [AVATAR_OBJECT]: "avatars/x.jpg" },
  } as const;
  expect(() => assertNoSecrets(safe)).not.toThrow();

  expect(() =>
    assertNoSecrets({ ...safe, after: { avatar_key: "avatars/x.jpg" } }),
  ).toThrow();
});

test("a second photograph replaces the first and hands back the orphan", async () => {
  const { readerCtx, reader } = await shelfWithReader();
  const first = upload(1);
  const second = upload(2);

  await runCommand(sql, readerCtx, proposeAvatarChange, {
    membershipId: reader.id,
    ...first,
  });
  const { supersededAvatarObject } = await runCommand(
    sql,
    readerCtx,
    proposeAvatarChange,
    { membershipId: reader.id, ...second },
  );

  // The command cannot delete it — the domain may not touch bytes — so it
  // returns it, and the surface deletes it after the commit.
  expect(supersededAvatarObject).toBe(first.avatarObject);
  expect((await requestOf(reader.userId)).proposed_values).toEqual({
    avatar_object: second.avatarObject,
  });
});

test("re-proposing the same object supersedes nothing", async () => {
  // A retried action must not be told to delete the image the row it just wrote
  // still points at.
  const { readerCtx, reader } = await shelfWithReader();
  const image = upload(1);
  await runCommand(sql, readerCtx, proposeAvatarChange, {
    membershipId: reader.id,
    ...image,
  });
  const { supersededAvatarObject } = await runCommand(
    sql,
    readerCtx,
    proposeAvatarChange,
    { membershipId: reader.id, ...image },
  );
  expect(supersededAvatarObject).toBeNull();
});

test("a photograph and a phone number merge into one request, and the key survives", async () => {
  // Two things at once, and the second is the whole reason
  // `../pending-proposal.ts` exists.
  //
  // The merge: OPS §4.3 says a new proposal "replaces" the pending one, and
  // reading that literally would silently lose a reader's phone proposal the
  // moment they also sent a photograph. `PROPOSAL_ON_SECOND_PROPOSE` is the one
  // constant that reverses this reading.
  //
  // The key: this used to be the failure `carryAvatar` existed to prevent.
  // `pickProfileFields` dropped `avatar_object` — it was not a column of
  // `users` — so a `ProposeProfileChange` that rebuilt `proposed_values` from
  // the profile patch alone kept the URL and **erased the key that named the
  // same object**, leaving an image nothing could ever delete, and nothing
  // raised. The key is a `ProfileField` now, so it survives for the same
  // reason `email` does and there is no helper left to forget to call.
  const { readerCtx, reader } = await shelfWithReader();
  const image = upload(1);

  await runCommand(sql, readerCtx, proposeAvatarChange, {
    membershipId: reader.id,
    ...image,
  });
  await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0912345678" },
  });

  const request = await requestOf(reader.userId);
  expect(request.proposed_values).toEqual({
    avatar_object: image.avatarObject,
    phone: "0912345678",
  });
  expect(request.previous_values).toEqual({
    avatar_object: null,
    phone: "0900000000",
  });
});

test("approval copies the key onto the person, and no URL exists to disagree with it", async () => {
  // `applyProfileFields` writes `avatar_object` in an ordinary arm now. There
  // is no second column holding an address, so there is no pair to keep in
  // step and no way for a row to name two different objects.
  const { readerCtx, managerCtx, reader } = await shelfWithReader();
  const image = upload(1);
  const { profileChangeRequestId } = await runCommand(
    sql,
    readerCtx,
    proposeAvatarChange,
    { membershipId: reader.id, ...image },
  );

  await runCommand(sql, managerCtx, approveProfileChange, {
    profileChangeRequestId,
  });

  expect(await avatarOf(reader.userId)).toBe(image.avatarObject);
  // The column that used to hold an absolute URL is gone, not merely unused.
  const [col] = await sql<{ n: number }[]>`
    select count(*)::int as n from information_schema.columns
     where table_name = 'users' and column_name = 'avatar_url'
  `;
  expect(col.n).toBe(0);
});

test("rejecting and cancelling each hand the orphaned key back", async () => {
  // OPS §4.3: "a rejected or cancelled proposal's image is deleted rather than
  // left orphaned in storage." Neither command performs the deletion — the
  // domain may not import the store, and a delete inside the transaction would
  // destroy an image a still-live request points at if the commit then failed.
  const a = await shelfWithReader("dong-thap");
  const rejected = upload(1);
  const first = await runCommand(sql, a.readerCtx, proposeAvatarChange, {
    membershipId: a.reader.id,
    ...rejected,
  });
  const rejection = await runCommand(sql, a.managerCtx, rejectProfileChange, {
    profileChangeRequestId: first.profileChangeRequestId,
    reason: "Ảnh bị mờ quá.",
  });
  expect(rejection.avatarObject).toBe(rejected.avatarObject);

  const b = await shelfWithReader("can-tho");
  const cancelled = upload(2);
  const second = await runCommand(sql, b.readerCtx, proposeAvatarChange, {
    membershipId: b.reader.id,
    ...cancelled,
  });
  const withdrawal = await runCommand(sql, b.readerCtx, cancelProfileChange, {
    membershipId: b.reader.id,
    profileChangeRequestId: second.profileChangeRequestId,
  });
  expect(withdrawal.avatarObject).toBe(cancelled.avatarObject);
});

test("a request with no photograph hands back null", async () => {
  // The ordinary case, and the reason `discardAvatarObject(null)` is a no-op
  // rather than a check every call site has to write.
  const { readerCtx, managerCtx, reader } = await shelfWithReader();
  const { profileChangeRequestId } = await runCommand(
    sql,
    readerCtx,
    proposeProfileChange,
    { membershipId: reader.id, fields: { phone: "0912345678" } },
  );

  const { avatarObject } = await runCommand(sql, managerCtx, rejectProfileChange, {
    profileChangeRequestId,
    reason: "Số này không đúng.",
  });
  expect(avatarObject).toBeNull();
});

test("a rank with nobody behind it cannot propose a photograph", async () => {
  // `systemContext` is `super_admin` with `userId: null`, so
  // `requireSelfOrManager` passes it on rank alone and the audit row would name
  // no actor — `voidLoan`'s defect.
  const { shelf, reader } = await shelfWithReader();
  await expect(
    runCommand(sql, systemContext(shelf.id, clock), proposeAvatarChange, {
      membershipId: reader.id,
      ...upload(1),
    }),
  ).rejects.toMatchObject({ code: "not_permitted" });
  expect(await requestOf(reader.userId)).toBeUndefined();
});

test("another shelf's membership is not found, because RLS filtered it", async () => {
  // `users` has no row-level security at all, so this join through `memberships`
  // is the whole of what stands between a caller and any person in the system.
  const a = await shelfWithReader("dong-thap");
  const b = await shelfWithReader("can-tho");

  await expect(
    runCommand(sql, b.managerCtx, proposeAvatarChange, {
      membershipId: a.reader.id,
      ...upload(1),
    }),
  ).rejects.toMatchObject({ code: "membership_not_found" });
  expect(await avatarOf(a.reader.userId)).toBeNull();
});

test("an empty key is refused before anything is written", async () => {
  const { readerCtx, reader } = await shelfWithReader();
  await expect(
    runCommand(sql, readerCtx, proposeAvatarChange, {
      membershipId: reader.id,
      avatarObject: "   ",
    }),
  ).rejects.toMatchObject({ code: "validation_failed" });
  await expect(
    runCommand(sql, readerCtx, proposeAvatarChange, {
      membershipId: reader.id,
      avatarObject: "",
    }),
  ).rejects.toMatchObject({ code: "validation_failed" });
  expect(await requestOf(reader.userId)).toBeUndefined();
});

test("B6: approving a photograph keeps its storage key, so it can be deleted", async () => {
  // The defect this closes: `users` held only a URL, so no code path knew the
  // key `src/storage/s3.ts`'s `delete` takes, and a family asking for their
  // child's photograph to be removed had no answer. `proposed_values` carried
  // the key all along and approval threw it away — the one moment it was in
  // hand.
  //
  // It also un-bakes `S3_PUBLIC_URL` from the row. SDD §6.8 claims changing
  // provider is "a change of environment variables and nothing else"; a stored
  // absolute URL made that false for every avatar already written.
  const { reader, readerCtx, managerCtx } = await shelfWithReader();

  await runCommand(sql, readerCtx, proposeAvatarChange, upload(7));

  const [request] = await sql<{ id: string }[]>`
    select id from profile_change_requests where status = 'pending'
  `;
  await runCommand(sql, managerCtx, approveProfileChange, {
    profileChangeRequestId: request.id,
  });

  const [person] = await sql<{ avatar_object: string | null }[]>`
    select avatar_object from users where id = ${reader.userId}
  `;

  // The half that was missing, and the half that makes deletion possible.
  expect(person.avatar_object).toBe(upload(7).avatarObject);
});
