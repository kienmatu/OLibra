import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { fixedClock } from "../../src/domain/kernel/clock";
import type { TenantContext } from "../../src/domain/kernel/tenant";
import { runQuery } from "../../src/domain/kernel/unit-of-work";
import { isMemberlessSuperAdmin } from "../../src/lib/reader-area";
// The `[shelf]` segment is a literal directory name, not a glob — the same
// import shape `tests/lib/avatar-actions.test.ts` and
// `tests/lib/lending-actions.test.ts` already use for this app directory.
// `load-profile.ts` imports nothing from `next/*`, so — unlike those two
// files — no `vi.mock("next/headers", ...)` is needed to load it.
import { loadReaderProfile } from "../../src/app/tu-sach/[shelf]/ho-so/load-profile";
import { closeAll, resetDatabase, sql } from "../support/db";
import { makeMember, makeShelf, makeUser } from "../support/factories";

/**
 * 2026-08-10 QA remediation, task 10.
 *
 * `/tu-sach/<slug>/ho-so` used to read `membershipId: ctx.actor.membershipId
 * ?? ""`, and a super admin — who holds no membership anywhere by design
 * (`src/auth/guards.ts`'s `contextFor`) — turned that into an empty string
 * reaching `where m.id = ${input.membershipId}` in `getMyProfile`. Postgres
 * raised `22P02 invalid input syntax for type uuid: ""` from inside the
 * transaction: a bare 500, reproduced twice, from a link (`ReaderTabs`'s
 * "Hồ sơ") the app itself renders for exactly this viewer.
 *
 * This suite pins `src/lib/reader-area.ts`'s `isMemberlessSuperAdmin` and
 * `src/app/tu-sach/[shelf]/ho-so/load-profile.ts`'s `loadReaderProfile`,
 * which is what `/ho-so/page.tsx` now calls instead of the coercion above.
 * The fix-report for this task records a mutation test: `loadReaderProfile`
 * edited back to the coercion, rerun against this suite, fails with exactly
 * the `22P02` this docstring describes.
 */

const clock = fixedClock("2026-08-10T03:00:00Z");

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

async function superAdminCtx(bookshelfId: string): Promise<TenantContext> {
  const admin = await makeUser(sql, { fullName: "Quản Trị Viên" });
  return {
    bookshelfId,
    // The exact shape `contextFor` resolves for a super admin browsing a
    // shelf they hold no membership of: a real `userId`, `role:
    // "super_admin"`, `membershipId: null`.
    actor: { userId: admin.id, membershipId: null, role: "super_admin" },
    clock,
  };
}

test("isMemberlessSuperAdmin is true only for a super admin with no membership here", async () => {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const reader = await makeMember(sql, shelf.id);

  expect(isMemberlessSuperAdmin(await superAdminCtx(shelf.id))).toBe(true);

  // A signed-in reader — real membership, ordinary role — is not this case.
  expect(
    isMemberlessSuperAdmin({
      bookshelfId: shelf.id,
      actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
      clock,
    }),
  ).toBe(false);

  // A signed-in non-member also has `membershipId: null`, and is deliberately
  // NOT this case — `requireReader`/`requireManager` inside the ordinary
  // queries already refuse them, and `loadPage` already turns that into a
  // 404 (U2 §3.1). This predicate must not intercept that caller first and
  // quietly replace their 404 with this notice.
  expect(
    isMemberlessSuperAdmin({
      bookshelfId: shelf.id,
      actor: { userId: reader.userId, membershipId: null, role: "guest" },
      clock,
    }),
  ).toBe(false);
});

test("a memberless super admin's profile read resolves to 'not a member' — no query, no PostgresError", async () => {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const ctx = await superAdminCtx(shelf.id);

  // Before this task, the equivalent call (`getMyProfile` with
  // `ctx.actor.membershipId ?? ""`) rejected with a raw `PostgresError`
  // (`code: "22P02"`). This must not throw at all.
  const load = await runQuery(sql, ctx, (tx, c) => loadReaderProfile(tx, c));

  expect(load).toEqual({ member: false });
});

test("a reader with a real membership still gets their own profile — the regression this task risks", async () => {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const reader = await makeMember(sql, shelf.id, { status: "active" });
  const readerCtx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
    clock,
  };

  const load = await runQuery(sql, readerCtx, (tx, c) => loadReaderProfile(tx, c));

  expect(load.member).toBe(true);
  if (load.member) {
    expect(load.profile.membershipId).toBe(reader.id);
  }
});
