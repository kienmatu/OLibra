import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { hashPassword } from "../../src/auth/password";
import { signIn } from "../../src/auth/session";
import { migrate } from "../../src/db/migrate";
import { fixedClock } from "../../src/domain/kernel/clock";
import type { TenantContext } from "../../src/domain/kernel/tenant";
import { REQUEST_PATH_HEADER } from "../../src/lib/return-path";
import { SESSION_COOKIE } from "../../src/lib/session-cookie";
import { closeAll, resetDatabase, sql } from "../support/db";
import { makeMember, makeShelf } from "../support/factories";
import { testDatabaseUrl } from "../support/env";

/**
 * `/tu-sach/<slug>/ho-so`, rendered — for a reader whose profile-change
 * request has already been decided.
 *
 * **The bug this pins was a 500 on a page a reader reaches from their own
 * nav, and no query test could have seen it.** `getMyProfileChangeRequest`
 * selects `decided_at::text`, and `decided_at` is a `timestamptz`
 * (`0008_profile_changes.sql:17`), so Postgres hands back
 * `2026-08-13 12:57:55.697401+00` — an instant, space-separated, with an
 * offset. The page then passed it to `formatDate`, which is documented for a
 * `date` column and builds `new Date(`${isoDate}T00:00:00Z`)`; the
 * concatenation produced `…+00T00:00:00Z`, an Invalid Date, and
 * `Intl.DateTimeFormat.format` threw `RangeError: Invalid time value`. The
 * fix is one word — `formatInstant`, the sibling in the same module that
 * exists for exactly this column type — and `src/lib/dates.ts`'s header
 * explains at length why the two are not interchangeable.
 *
 * Every part of that failure lived in JSX, between a correct query and a
 * correct formatter, which is why this file renders the page component rather
 * than asserting on `getMyProfileChangeRequest`'s return. `approved_at` on the
 * manager's reader page (`nguoi-doc/[id]/page.tsx:772`) already carries a
 * comment warning about this exact mismatch; this is the same hazard, caught
 * one call site later.
 *
 * The whole page is rendered, not the one paragraph, and that is the point:
 * it makes any *other* render-time crash on this screen fail here too.
 */

const session = vi.hoisted(() => ({
  token: null as string | null,
  path: null as string | null,
}));

// The same two seams `tests/lib/page-data.test.ts` mocks, for its reason: a
// cookie jar and a request header have no meaning outside a request. Each
// answers for one name only, so a page that read some other cookie or header
// would see nothing rather than being handed a value for whatever it asked.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && session.token
        ? { name, value: session.token }
        : undefined,
  }),
  headers: async () => ({
    get: (name: string) =>
      name === REQUEST_PATH_HEADER.toLowerCase() ? session.path : null,
  }),
}));

const { default: ReaderProfilePage } =
  await import("../../src/app/tu-sach/[shelf]/(doc-gia)/ho-so/page");
const { runCommand } = await import("../../src/domain/kernel/unit-of-work");
const { proposeProfileChange } =
  await import("../../src/domain/members/commands/propose-profile-change");
const { rejectProfileChange } =
  await import("../../src/domain/members/commands/reject-profile-change");
const { approveProfileChange } =
  await import("../../src/domain/members/commands/approve-profile-change");
const { pool } = await import("../../src/db/client");

const POOL_KEY = Symbol.for("olibra.db.pool");

/** The instant every decision below is stamped with, and the day it falls on. */
const clock = fixedClock("2026-08-13T12:57:55Z");
/** 12:57 UTC is 19:57 in `Asia/Ho_Chi_Minh` — the same calendar day, either way. */
const DECIDED_ON = "13/08/2026";

let previousUrl: string | undefined;

beforeAll(async () => {
  // The page reaches the database through `pool()`, a process-wide singleton
  // reading `DATABASE_URL`. Pointing it at the suite's database is the price
  // of that seam, stated here rather than smuggled in — `page-data.test.ts`
  // and `avatar-actions.test.ts` pay it the same way.
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  delete (globalThis as { [k: symbol]: unknown })[POOL_KEY];
  await migrate(sql);
});

beforeEach(async () => {
  session.token = null;
  session.path = null;
  await resetDatabase();
});

afterAll(async () => {
  await pool().end();
  delete (globalThis as { [k: symbol]: unknown })[POOL_KEY];
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  await closeAll();
});

/**
 * A shelf, a reader signed in for real, a manager to decide, and one
 * profile-change request sitting in `pending`.
 */
async function shelfWithAPendingRequest(slug: string, username: string) {
  const shelf = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const reader = await makeMember(sql, shelf.id, { status: "active" });

  // `makeMember` builds a person, not a sign-in; the page needs a real session
  // cookie, so the reader gets credentials and `signIn` mints the token
  // `cookies()` above will hand back.
  await sql`
    update users set username = ${username}, password_hash = ${await hashPassword("x")}
     where id = ${reader.userId}
  `;
  const { token } = await signIn(sql, { username, password: "x", clock });
  session.token = token;
  session.path = `/tu-sach/${slug}/ho-so`;

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

  const { profileChangeRequestId } = await runCommand(
    sql,
    readerCtx,
    proposeProfileChange,
    { membershipId: reader.id, fields: { phone: "0912345678" } },
  );

  return { shelf, profileChangeRequestId, managerCtx };
}

/** The page as Next would invoke it: two promises in, markup out. */
const render = (slug: string) =>
  ReaderProfilePage({
    params: Promise.resolve({ shelf: slug }),
    searchParams: Promise.resolve({}),
  }).then(renderToStaticMarkup);

test("a reader whose request was rejected can load /ho-so", async () => {
  const { shelf, profileChangeRequestId, managerCtx } =
    await shelfWithAPendingRequest("dong-thap", "docgia1");

  await runCommand(sql, managerCtx, rejectProfileChange, {
    profileChangeRequestId,
    reason: "Số điện thoại chưa khớp với sổ giáo xứ.",
  });

  // Before the fix this threw `RangeError: Invalid time value` out of
  // `Intl.DateTimeFormat.format` — a bare 500, on the reader's own page.
  const html = await render(shelf.slug);

  expect(html).toContain(`được xử lý ngày ${DECIDED_ON}`);
  // The rejection reason is the reason this query returns decided rows at all
  // (BR §15 lists no notification for the outcome), so the crash was hiding
  // the one thing revisiting the page is for.
  expect(html).toContain("Số điện thoại chưa khớp với sổ giáo xứ.");
});

test("a reader whose request was approved can load /ho-so", async () => {
  const { shelf, profileChangeRequestId, managerCtx } =
    await shelfWithAPendingRequest("can-tho", "docgia2");

  await runCommand(sql, managerCtx, approveProfileChange, {
    profileChangeRequestId,
  });

  const html = await render(shelf.slug);

  expect(html).toContain(`được xử lý ngày ${DECIDED_ON}`);
});

test("a reader with an undecided request loads /ho-so with no decision line", async () => {
  // The other side of `decidedAt`: `null` must stay off the screen rather than
  // rendering as an empty or epoch date. This is also the case that would keep
  // passing if the fix were "guard the paragraph out" instead of formatting
  // the value correctly — it is here so the two tests above carry the weight.
  const { shelf } = await shelfWithAPendingRequest("my-tho", "docgia3");

  const html = await render(shelf.slug);

  expect(html).not.toContain("được xử lý ngày");
  expect(html).toContain("Đang chờ quản lý duyệt");
});
