import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { hashPassword } from "../../src/auth/password";
import { migrate } from "../../src/db/migrate";
import { RETURN_TO_PARAM } from "../../src/lib/return-path";
import { SIGN_IN_FAILED } from "../../src/lib/session-cookie";
import { makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";
import { testDatabaseUrl } from "../support/env";

/**
 * `signInAction`'s half of U2 §3.1's round trip, and the open redirect it is
 * the last thing standing in front of.
 *
 * `dang-nhap/page.tsx` also validates the return path, before rendering it
 * into a hidden field — but that is a courtesy to a visitor, not a control. A
 * form can be posted without ever loading the page that renders it, so
 * `?tiep=` reaching this function is arbitrary input from an attacker who
 * sends somebody a link. This file is where the refusal has to hold:
 * `tests/lib/return-path.test.ts` enumerates what `safeReturnPath` rejects,
 * and this asserts the action actually asks it before handing a value to
 * `redirect`.
 *
 * `redirect()` is deliberately not mocked, for the reason
 * `lending-actions.test.ts` gives: it throws a real digest, so the assertions
 * read the signal Next.js would act on rather than a stand-in that would agree
 * with any implementation.
 */

const jar = vi.hoisted(() => ({
  set: vi.fn(),
  delete: vi.fn(),
  get: () => undefined,
}));

vi.mock("next/headers", () => ({
  cookies: async () => jar,
  headers: async () => ({ get: () => null }),
}));

const { signInAction } = await import("../../src/app/dang-nhap/actions");
const { pool } = await import("../../src/db/client");

let previousUrl: string | undefined;

beforeAll(async () => {
  // Same trade as `page-data.test.ts`: the action reaches Postgres through
  // `pool()`, which reads `DATABASE_URL`.
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  delete (globalThis as { [k: symbol]: unknown })[Symbol.for("olibra.db.pool")];
  await migrate(sql);
});

beforeEach(async () => {
  jar.set.mockClear();
  await resetDatabase();
});

afterAll(async () => {
  await pool().end();
  delete (globalThis as { [k: symbol]: unknown })[Symbol.for("olibra.db.pool")];
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  await closeAll();
});

/** Where `redirect()` was pointed, from the digest it threw. */
function redirectTarget(err: unknown): string | null {
  const digest = (err as { digest?: unknown }).digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT")) {
    return null;
  }
  return digest.split(";")[2] ?? null;
}

async function seedMember(shelfSlug: string) {
  const shelf = await makeShelf(sql, { slug: shelfSlug });
  const [user] = await sql<{ id: string }[]>`
    insert into users (saint_name, full_name, father_name, mother_name, phone, username, password_hash)
    values ('Maria', 'Maria Nguyễn Thị Lan', 'A', 'B', '0900000000', 'lan.nguyen',
            ${await hashPassword("olibra-dev")})
    returning id
  `;
  await sql`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${shelf.id}, ${user.id}, 'manager', 'active')
  `;
  return shelf;
}

/**
 * A super admin with no membership anywhere — the shape `landingShelfFor`
 * cannot tell apart from an ordinary reader belonging to nothing, and the
 * reason Task 6 (2026-08-10 QA remediation) exists: a fresh install's only
 * administrator signed in this way and landed on the empty portal, with no
 * route into `/quan-tri` short of a hand-typed URL.
 */
async function seedSuperAdmin(username: string) {
  await sql<{ id: string }[]>`
    insert into users (
      saint_name, full_name, father_name, mother_name, phone, username, password_hash,
      is_super_admin
    )
    values (
      '', 'Quản trị viên hệ thống', 'A', 'B', '0900000001', ${username},
      ${await hashPassword("olibra-dev")}, true
    )
    returning id
  `;
}

/** A reader with no active membership of any shelf, and no admin flag either. */
async function seedUnaffiliatedReader(username: string) {
  await sql<{ id: string }[]>`
    insert into users (saint_name, full_name, father_name, mother_name, phone, username, password_hash)
    values ('Maria', 'Maria Nguyễn Thị Lan', 'A', 'B', '0900000000', ${username},
            ${await hashPassword("olibra-dev")})
    returning id
  `;
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

async function submit(fields: Record<string, string>) {
  return signInAction(
    form({ username: "lan.nguyen", password: "olibra-dev", ...fields }),
  ).then(
    () => null,
    (e: unknown) => e,
  );
}

test("a valid return path wins over the landing shelf", async () => {
  // The round trip U2 §3.1 asks for: a member sent to sign in from a page
  // lands back on that page, not on whatever `landingShelfFor` would have
  // picked. IMPORTANT 6 is not contradicted — it answers "where when nothing
  // else says", and this is something else saying.
  await seedMember("dong-thap");

  const err = await submit({
    [RETURN_TO_PARAM]: "/tu-sach/dong-thap/danh-muc?q=de",
  });

  expect(redirectTarget(err)).toBe("/tu-sach/dong-thap/danh-muc?q=de");
  expect(jar.set).toHaveBeenCalledOnce();
});

test("an off-site return path is refused, and sign-in still works", async () => {
  // The attack: send somebody `/dang-nhap?tiep=https://evil.example`, they
  // sign in on the real site with real credentials and are handed to somebody
  // else's. Refusing must not also break signing in — a session is still
  // established and `landingShelfFor` still answers.
  await seedMember("dong-thap");

  for (const hostile of [
    "https://evil.example/pay",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
  ]) {
    jar.set.mockClear();
    const err = await submit({ [RETURN_TO_PARAM]: hostile });

    expect(redirectTarget(err), hostile).toBe("/tu-sach/dong-thap");
    expect(jar.set, hostile).toHaveBeenCalledOnce();
  }
});

test("a failed attempt keeps the destination, alongside the failure marker", async () => {
  // Otherwise a mistyped password quietly turns "back to where you were going"
  // into "back to the front door", which reads as the link having been wrong
  // rather than the password.
  await seedMember("dong-thap");

  const err = await submit({
    password: "sai-mat-khau",
    [RETURN_TO_PARAM]: "/tu-sach/dong-thap/danh-muc",
  });

  const target = new URL(redirectTarget(err) ?? "", "http://olibra.invalid");
  expect(target.pathname).toBe("/dang-nhap");
  expect(target.searchParams.get("loi")).toBe(SIGN_IN_FAILED);
  expect(target.searchParams.get("ten")).toBe("lan.nguyen");
  expect(target.searchParams.get(RETURN_TO_PARAM)).toBe(
    "/tu-sach/dong-thap/danh-muc",
  );
  expect(jar.set).not.toHaveBeenCalled();
});

test("a failed attempt does not carry an off-site destination either", async () => {
  // The failure redirect is a second place a hostile value could reach a URL:
  // `?tiep=https://evil.example` bounced back into the form would be rendered
  // as a hidden field on the next attempt if it were not refused here too.
  await seedMember("dong-thap");

  const err = await submit({
    password: "sai-mat-khau",
    [RETURN_TO_PARAM]: "https://evil.example",
  });

  const target = new URL(redirectTarget(err) ?? "", "http://olibra.invalid");
  expect(target.searchParams.get(RETURN_TO_PARAM)).toBeNull();
});

test("no return path at all still lands a single-shelf member on their shelf", async () => {
  // IMPORTANT 6, unchanged. The return path is additive: everything that
  // worked before it existed still works when it is absent.
  await seedMember("dong-thap");

  expect(redirectTarget(await submit({}))).toBe("/tu-sach/dong-thap");
});

test("a super admin with no shelf lands on /quan-tri, not the empty portal", async () => {
  // Task 6 (2026-08-10 QA remediation): the finding itself, reproduced.
  await seedSuperAdmin("sa.test");

  const err = await submit({ username: "sa.test" });

  expect(redirectTarget(err)).toBe("/quan-tri");
});

test("an ordinary reader with no shelf still lands on the portal", async () => {
  // The falsification for the test above: if `/quan-tri` were the destination
  // for anybody `landingShelfFor` sends to the portal rather than for a super
  // admin specifically, this would redirect there too, and it must not.
  await seedUnaffiliatedReader("no.shelf");

  const err = await submit({ username: "no.shelf" });

  expect(redirectTarget(err)).toBe("/tu-sach");
});

test("a return path still wins over the super admin's own destination", async () => {
  // The same precedence IMPORTANT 6 already had, extended to the branch Task
  // 6 added: `?tiep=` is answered before either `landingShelfFor` or the
  // super-admin check ever gets a vote.
  await seedSuperAdmin("sa.test");

  const err = await submit({
    username: "sa.test",
    [RETURN_TO_PARAM]: "/lien-he",
  });

  expect(redirectTarget(err)).toBe("/lien-he");
});
