import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { hashPassword } from "../../src/auth/password";
import { signIn } from "../../src/auth/session";
import { fixedClock } from "../../src/domain/kernel/clock";
import { searchBooksForLending } from "../../src/domain/catalogue/queries/search-books-for-lending";
import { migrate } from "../../src/db/migrate";
import { SESSION_COOKIE } from "../../src/lib/session-cookie";
import { makeBookWithCopies, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";
import { testDatabaseUrl } from "../support/env";

/**
 * `loadPage` (U1 Task 2) — the seam forty-six pages will copy.
 *
 * Run against a real database on purpose. The interesting properties are not
 * "the function calls three other functions"; they are which shelf's rows come
 * back, and which of the ways a read can fail turn into a 404 rather than a
 * page. Both of those are only true if RLS really scoped the transaction, and
 * a mocked `runQuery` would assert neither.
 */

/**
 * `cookies()` is the one thing here with no meaning outside a request, so it
 * is the one thing mocked. `notFound()` is *not* mocked: it works standalone
 * and throws an error carrying `digest: "NEXT_HTTP_ERROR_FALLBACK;404"`, so
 * the assertions below check the real 404 signal Next.js would act on rather
 * than a stand-in that would agree with any implementation.
 *
 * `get` answers only for `SESSION_COOKIE`. A `loadPage` that read some other
 * cookie name would therefore see no session at all, fall through to `guest`,
 * and fail the manager tests — rather than passing because the mock handed a
 * token to whatever was asked for.
 */
const session = vi.hoisted(() => ({ token: null as string | null }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && session.token
        ? { name, value: session.token }
        : undefined,
  }),
}));

// Imported after the mock is declared; `vi.mock` is hoisted above it either
// way, but the ordering keeps the dependency readable.
const { loadPage } = await import("../../src/lib/page-data");
const { pool } = await import("../../src/db/client");

const clock = fixedClock("2026-08-07T10:00:00Z");

/** The digest Next.js's own `notFound()` throws, and what a 404 looks like here. */
const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";

let previousUrl: string | undefined;

beforeAll(async () => {
  // `loadPage` reaches the database through `pool()`, which reads
  // `DATABASE_URL` — the *development* database. Pointing it at the suite's
  // own database is not a workaround: it is the price of the seam being a
  // process-wide singleton, and stating it here is better than giving
  // `loadPage` an `sql` parameter that production would never pass.
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  delete (globalThis as { [k: symbol]: unknown })[Symbol.for("olibra.db.pool")];
  await migrate(sql);
});

beforeEach(async () => {
  session.token = null;
  await resetDatabase();
});

afterAll(async () => {
  // Production never closes this; a test process that leaves it open never
  // exits.
  await pool().end();
  delete (globalThis as { [k: symbol]: unknown })[Symbol.for("olibra.db.pool")];
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  await closeAll();
});

async function signInAs(shelfId: string, role: string, username: string) {
  const [user] = await sql<{ id: string }[]>`
    insert into users (full_name, father_name, mother_name, phone, username, password_hash)
    values ('Giuse Trần Minh', 'A', 'B', '0900000000', ${username},
            ${await hashPassword("x")})
    returning id
  `;
  await sql`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${shelfId}, ${user.id}, ${role}, 'active')
  `;
  const { token } = await signIn(sql, { username, password: "x", clock });
  session.token = token;
  return { userId: user.id };
}

test("a manager's page sees their own shelf and nothing else", async () => {
  // The property the whole seam exists for. Both shelves hold a title matching
  // the same search; only one of them is this manager's. If `loadPage` ever
  // stopped running the read through `runQuery` — or ran it with the wrong
  // `bookshelfId` — this is the test that says so, because the second shelf's
  // book would appear.
  const mine = await makeShelf(sql, { slug: "dong-thap" });
  const theirs = await makeShelf(sql, { slug: "can-tho" });
  const { bookId } = await makeBookWithCopies(sql, mine.id, 2);
  await makeBookWithCopies(sql, theirs.id, 2);
  await signInAs(mine.id, "manager", "quanly");

  const { rows, shelfId, role } = await loadPage("dong-thap", async (tx, ctx) => ({
    rows: await searchBooksForLending(tx, ctx, { q: "sach" }),
    shelfId: ctx.bookshelfId,
    role: ctx.actor.role,
  }));

  expect(shelfId).toBe(mine.id);
  expect(role).toBe("manager");
  expect(rows.map((r) => r.bookId)).toEqual([bookId]);
  expect(rows[0].copiesAvailable).toBe(2);
  expect(rows[0].blocked).toBe(false);
});

test("a slug that resolves to no shelf is a 404, and the read never runs", async () => {
  // `contextFor` throws `NotFound("shelf_not_found")` before there is a tenant
  // to scope anything to. A typo'd URL is a 404; an error page would be the
  // wrong answer, and a `bookshelfId` of `""` — which `runQuery` accepts as
  // "fail closed to zero rows" — would be worse: an empty page that looks like
  // a shelf with no books.
  await makeShelf(sql, { slug: "dong-thap" });
  let ran = false;

  await expect(
    loadPage("khong-co-tu-sach-nay", async () => {
      ran = true;
      return null;
    }),
  ).rejects.toMatchObject({ digest: NOT_FOUND });

  expect(ran).toBe(false);
});

test("a reader who reaches a manager screen gets a 404, not a refusal page", async () => {
  // U1 §3.4. The domain decides permission — `searchBooksForLending` opens
  // with `requireManager` and throws `RuleViolated("not_permitted")`. The page
  // decides visibility, and the answer is a 404: a "you may not" screen would
  // confirm both that the page exists and that this shelf has one.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  await makeBookWithCopies(sql, shelf.id, 1);
  await signInAs(shelf.id, "reader", "bandoc");

  await expect(
    loadPage("dong-thap", (tx, ctx) =>
      searchBooksForLending(tx, ctx, { q: "sach" }),
    ),
  ).rejects.toMatchObject({ digest: NOT_FOUND });
});

test("a stranger with no session gets the same 404 as a reader", async () => {
  // No cookie at all, so `contextFor` returns the `guest` context and the same
  // `requireManager` refuses. Identical outcome on purpose: a 404 that differed
  // between "signed in but not allowed" and "not signed in" would answer the
  // question of whether this shelf has a manager screen to a caller who has no
  // business asking.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  await makeBookWithCopies(sql, shelf.id, 1);

  await expect(
    loadPage("dong-thap", (tx, ctx) =>
      searchBooksForLending(tx, ctx, { q: "sach" }),
    ),
  ).rejects.toMatchObject({ digest: NOT_FOUND });
});

test("a real fault is not swallowed into a 404", async () => {
  // U1 §3.3, and the reason it says this distinction is "the one worth a
  // test": the tempting implementation is a bare `catch` that turns everything
  // into a friendly outcome. A `PostgresError` reaching this seam means the
  // database is wrong, not that the caller is — and a 404 for it would tell a
  // volunteer their URL was mistyped while the shelf's data was unreachable.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  await signInAs(shelf.id, "manager", "quanly");

  const failure = loadPage(
    "dong-thap",
    (tx) => tx`select * from bang_khong_ton_tai`,
  );

  await expect(failure).rejects.toThrow(/bang_khong_ton_tai/);
  await expect(failure).rejects.not.toMatchObject({ digest: NOT_FOUND });
});

test("a plain thrown error from the read reaches the caller unchanged", async () => {
  // The same rule as above, for the half of it a database error cannot show:
  // an ordinary bug inside a page's own read — a `TypeError`, a bad
  // assumption — must not become a 404 either. `RuleViolated("not_permitted")`
  // is the *only* refusal this seam translates, matched on its code and not on
  // its class.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  await signInAs(shelf.id, "manager", "quanly");

  await expect(
    loadPage("dong-thap", async () => {
      throw new TypeError("đọc nhầm trường");
    }),
  ).rejects.toThrow(TypeError);
});
