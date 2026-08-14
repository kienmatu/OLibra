import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { fixedClock } from "../../src/domain/kernel/clock";
import type { TenantContext } from "../../src/domain/kernel/tenant";
import { runCommand } from "../../src/domain/kernel/unit-of-work";
import { proposeAvatarChange } from "../../src/domain/members/commands/propose-avatar-change";
import { proposeProfileChange } from "../../src/domain/members/commands/propose-profile-change";
import { avatarUrl } from "../../src/lib/avatar-url";
import { closeAll, resetDatabase, sql } from "../support/db";
import { makeMember, makeShelf } from "../support/factories";

/**
 * The assertion that would have caught the half-fix in `20260809_02`.
 *
 * That migration set out to make the storage key the stored fact and the URL
 * derived — and stopped after adding the column. `ObjectStore.url()` had
 * exactly one caller in the whole codebase, at *write* time, so every row kept
 * baking `S3_PUBLIC_URL` into itself and SDD §6.8's claim that changing
 * provider "is a change of environment variables … and nothing else" stayed
 * false. Nothing tested it, because a test that reads the same env var the
 * writer wrote agrees with any implementation.
 */

test("the rendered address follows S3_PUBLIC_URL, not the row", async () => {
  const key = "avatars/9f2c1e3a-4b5d-4e6f-8a9b-0c1d2e3f4a5b.webp";
  const before = process.env.S3_PUBLIC_URL;

  // `objectStore()` caches on `globalThis` behind `Symbol.for` — deliberately,
  // so a hot reload cannot strand a client nothing can look up again
  // (`src/lib/object-store.ts`). Clearing that key is what a process restart
  // does in production, which is the moment an operator's new `S3_PUBLIC_URL`
  // actually takes effect. Simulating the restart is the honest way to observe
  // the property; weakening the assertion is not.
  const cacheKey = Symbol.for("olibra.storage.object-store");
  const clearStore = () => {
    delete (globalThis as Record<symbol, unknown>)[cacheKey];
  };

  process.env.S3_PUBLIC_URL = "https://anh-mot.example.org";
  clearStore();
  const first = avatarUrl(key);

  process.env.S3_PUBLIC_URL = "https://anh-hai.example.org";
  clearStore();
  const second = avatarUrl(key);

  process.env.S3_PUBLIC_URL = before;
  clearStore();

  expect(first).not.toBe(second);
  expect(first).toContain("anh-mot.example.org");
  expect(second).toContain("anh-hai.example.org");
  expect(second).toContain(key);
});

test("no key is no photograph", () => {
  expect(avatarUrl(null)).toBeNull();
});

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-13T02:00:00Z");

const readerCtx = (
  bookshelfId: string,
  reader: { id: string; userId: string },
): TenantContext => ({
  bookshelfId,
  actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
  clock,
});

test("a proposal about a phone number leaves a pending photograph's key alone", async () => {
  // The `carryAvatar` failure mode, asserted after the function that prevented
  // it was deleted. `pickProfileFields` used to drop `avatar_object`, so a
  // second proposal rebuilt from its result erased the key while keeping the
  // URL — leaving an image nothing could ever delete. The key is an ordinary
  // ProfileField now, so it survives for the same reason `email` does.
  const shelf = await makeShelf(sql);
  const reader = await makeMember(sql, shelf.id, { status: "active" });
  const ctx = readerCtx(shelf.id, reader);
  const key = "avatars/9f2c1e3a-4b5d-4e6f-8a9b-0c1d2e3f4a5b.webp";

  await runCommand(sql, ctx, proposeAvatarChange, {
    avatarObject: key,
  });
  await runCommand(sql, ctx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0987654321" },
  });

  const [row] = await sql<{ proposed_values: Record<string, unknown> }[]>`
    select proposed_values from profile_change_requests
     where user_id = ${reader.userId} and status = 'pending'
  `;
  expect(row.proposed_values.avatar_object).toBe(key);
  expect(row.proposed_values.phone).toBe("0987654321");
});
