import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { fixedClock } from "../../src/domain/kernel/clock";
import type { TenantContext } from "../../src/domain/kernel/tenant";
import { runCommand } from "../../src/domain/kernel/unit-of-work";
import { proposeAvatarChange } from "../../src/domain/members/commands/propose-avatar-change";
import { proposeProfileChange } from "../../src/domain/members/commands/propose-profile-change";
import { avatarUrl } from "../../src/lib/avatar-url";
import { closeAll, resetDatabase, sql } from "../support/db";
import { testS3Config } from "../support/env";
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

const s3 = testS3Config();

/**
 * `objectStore()` caches on `globalThis` behind `Symbol.for` — deliberately, so
 * a hot reload cannot strand a client nothing can look up again
 * (`src/lib/object-store.ts`). Clearing that key is what a process restart does
 * in production, which is the moment an operator's new `S3_PUBLIC_URL` actually
 * takes effect. Simulating the restart is the honest way to observe the
 * property below; weakening the assertion is not.
 */
const STORE_KEY = Symbol.for("olibra.storage.object-store");
const clearStore = () => {
  delete (globalThis as Record<symbol, unknown>)[STORE_KEY];
};

const previous: Record<string, string | undefined> = {};

function setEnv(name: string, value: string): void {
  if (!(name in previous)) previous[name] = process.env[name];
  process.env[name] = value;
}

/**
 * The seven the application reads, installed from the suite's own `TEST_S3_*`
 * pair — the same trade `tests/lib/avatar-actions.test.ts` makes, and here it is
 * a correctness requirement rather than a convenience.
 *
 * `avatarUrl()` reaches `s3ConfigFromEnv()`, which `required()`s all seven. This
 * file used to set `S3_PUBLIC_URL` alone and pass anyway, because
 * `vitest.config.ts` loads a developer's `.env` and the other six were sitting
 * there. CI creates no `.env` and sets **only** the seven `TEST_S3_*` names, on
 * purpose — its own comment says they mirror the application's variables "rather
 * than reusing them, so pointing the suite somewhere never touches the
 * application's own configuration". So this file was green locally and would
 * have thrown `S3_REGION is not set` in CI, which is exactly the failure
 * `tests/architecture/ci-supplies-required-env.test.ts` exists to prevent and
 * cannot see, because it only guards `TEST_`-prefixed names.
 */
beforeAll(async () => {
  setEnv("S3_ENDPOINT", s3.endpoint);
  setEnv("S3_REGION", s3.region);
  setEnv("S3_BUCKET", s3.bucket);
  setEnv("S3_ACCESS_KEY_ID", s3.accessKeyId);
  setEnv("S3_SECRET_ACCESS_KEY", s3.secretAccessKey);
  setEnv("S3_FORCE_PATH_STYLE", String(s3.forcePathStyle));
  setEnv("S3_PUBLIC_URL", s3.publicUrl);
  clearStore();
  await migrate(sql);
});

beforeEach(resetDatabase);

// The restore is a hook and not a line at the end of the test that moves the
// variable. A `finally`-less inline restore is skipped by any throw, and
// `fileParallelism: false` serialises files without giving them separate
// processes — so a leaked `S3_PUBLIC_URL=https://anh-mot.example.org` would
// reach every later file in this worker.
afterEach(() => {
  setEnv("S3_PUBLIC_URL", s3.publicUrl);
  clearStore();
});

afterAll(async () => {
  // `delete`, not `process.env.X = undefined`: assigning `undefined` to a
  // `process.env` key stores the six-character string "undefined", which
  // `required()` would then happily accept. `src/storage/s3.ts` records the
  // same hazard.
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  clearStore();
  await closeAll();
});

test("the rendered address follows S3_PUBLIC_URL, not the row", () => {
  const key = "avatars/9f2c1e3a-4b5d-4e6f-8a9b-0c1d2e3f4a5b.webp";

  process.env.S3_PUBLIC_URL = "https://anh-mot.example.org";
  clearStore();
  const first = avatarUrl(key);

  process.env.S3_PUBLIC_URL = "https://anh-hai.example.org";
  clearStore();
  const second = avatarUrl(key);

  expect(first).not.toBe(second);
  expect(first).toContain("anh-mot.example.org");
  expect(second).toContain("anh-hai.example.org");
  expect(second).toContain(key);
});

test("no key is no photograph", () => {
  expect(avatarUrl(null)).toBeNull();
});

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
