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
 * The photograph is the one proposable field that is a file, and the whole of
 * what that costs is visible here as two strings in a `jsonb` bag: the URL,
 * which is copied to `users.avatar_url` on approval like any other proposed
 * field, and the storage **key**, which is copied nowhere and exists only so
 * that a rejected or cancelled proposal can delete the object instead of leaving
 * it orphaned (OPS §4.3).
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

const upload = (n: number) => ({
  avatarUrl: `http://localhost:9000/olibra/avatars/anh-${n}.jpg`,
  avatarObject: `avatars/anh-${n}.jpg`,
});

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
  sql<{ avatar_url: string | null }[]>`
    select avatar_url from users where id = ${userId}
  `.then((r) => r[0].avatar_url);

const actions = () =>
  sql<{ action: string; after: Record<string, unknown> }[]>`
    select action, after from audit_log order by occurred_at
  `;

test("a proposed photograph is stored as a URL and a key, and changes nothing yet", async () => {
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
    avatar_url: image.avatarUrl,
    avatar_object: image.avatarObject,
  });
  expect(request.previous_values).toEqual({ avatar_url: null });

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
    avatar_url: second.avatarUrl,
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
  // The key: `pickProfileFields` drops `avatar_object` by design — it is not a
  // column of `users`. So a `ProposeProfileChange` that rebuilt
  // `proposed_values` from the profile patch alone would keep `avatar_url` and
  // **erase the key that names the same object**, leaving an image nothing can
  // ever delete. Nothing raises when that happens.
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
    avatar_url: image.avatarUrl,
    avatar_object: image.avatarObject,
    phone: "0912345678",
  });
  expect(request.previous_values).toEqual({
    avatar_url: null,
    phone: "0900000000",
  });
});

test("approval copies the URL onto the person and the key nowhere", async () => {
  // `pickProfileFields` drops `avatar_object`, so `applyProfileFields` never
  // sees it. `users` has eight writable columns and none of them is a storage
  // key.
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

  expect(await avatarOf(reader.userId)).toBe(image.avatarUrl);
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from users
     where id = ${reader.userId} and avatar_url = ${image.avatarObject}
  `;
  expect(row.n).toBe(0);
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

test("an empty URL or key is refused before anything is written", async () => {
  const { readerCtx, reader } = await shelfWithReader();
  await expect(
    runCommand(sql, readerCtx, proposeAvatarChange, {
      membershipId: reader.id,
      avatarUrl: "   ",
      avatarObject: "avatars/x.jpg",
    }),
  ).rejects.toMatchObject({ code: "validation_failed" });
  await expect(
    runCommand(sql, readerCtx, proposeAvatarChange, {
      membershipId: reader.id,
      avatarUrl: "http://localhost:9000/olibra/avatars/x.jpg",
      avatarObject: "",
    }),
  ).rejects.toMatchObject({ code: "validation_failed" });
  expect(await requestOf(reader.userId)).toBeUndefined();
});
