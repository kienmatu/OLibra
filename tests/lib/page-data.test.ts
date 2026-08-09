import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { hashPassword } from "../../src/auth/password";
import { signIn } from "../../src/auth/session";
import { fixedClock } from "../../src/domain/kernel/clock";
import { NotFound } from "../../src/domain/kernel/errors";
import { searchBooksForLending } from "../../src/domain/catalogue/queries/search-books-for-lending";
import { migrate } from "../../src/db/migrate";
import { REQUEST_PATH_HEADER, RETURN_TO_PARAM } from "../../src/lib/return-path";
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
const session = vi.hoisted(() => ({
  token: null as string | null,
  /**
   * What `src/proxy.ts` would have stamped on this request.
   *
   * Mocked for the same reason `cookies()` is — it has no meaning outside a
   * request — and answering only for `REQUEST_PATH_HEADER` for the same reason
   * `get` answers only for `SESSION_COOKIE`: a seam that read some other
   * header would see no path at all and produce a bare `/dang-nhap`, which the
   * assertions below would catch, rather than passing because the mock handed
   * a value to whatever was asked for.
   */
  path: null as string | null,
}));

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

// Imported after the mock is declared; `vi.mock` is hoisted above it either
// way, but the ordering keeps the dependency readable.
const { loadPage, loadPublicPage } = await import("../../src/lib/page-data");
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
  session.path = null;
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

async function signInAs(shelfId: string | null, role: string, username: string) {
  const [user] = await sql<{ id: string }[]>`
    insert into users (full_name, father_name, mother_name, phone, username, password_hash)
    values ('Giuse Trần Minh', 'A', 'B', '0900000000', ${username},
            ${await hashPassword("x")})
    returning id
  `;
  // `null` is a person with a real session and no membership of the shelf
  // under test — the case U2 §3.1 turns on, and the one `contextFor` reports
  // as `role: "guest"` while still carrying a `userId`.
  if (shelfId) {
    await sql`
      insert into memberships (bookshelf_id, user_id, role, status)
      values (${shelfId}, ${user.id}, ${role}, 'active')
    `;
  }
  const { token } = await signIn(sql, { username, password: "x", clock });
  session.token = token;
  return { userId: user.id };
}

/** The digest Next.js's own `redirect()` throws, and where it points. */
function redirectTarget(err: unknown): string | null {
  const digest = (err as { digest?: unknown }).digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT")) {
    return null;
  }
  // `NEXT_REDIRECT;<kind>;<url>;<status>;` — read positionally rather than by
  // regex over the whole string, so a URL containing a `;` cannot be silently
  // truncated into something that happens to match.
  return digest.split(";")[2] ?? null;
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

test("a stranger with no session is sent to sign in, and back to where they were going", async () => {
  // U2 §3.1. This shipped as a 404 identical to the reader's, on the reasoning
  // that any difference would disclose whether this shelf has a manager
  // screen. What that reasoning missed is that a *shelf's* existence is
  // already public — `bookshelves_public_read` makes it so, deliberately, so
  // the portal can list it by name and address and then link to it. A 404 from
  // a link the portal just displayed is a dead end for somebody who is almost
  // always a member who has not signed in yet.
  //
  // Nothing is disclosed by answering differently, because a guest is refused
  // by *every* page of the shelf: the redirect is the same answer everywhere,
  // so it distinguishes no page from any other.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  await makeBookWithCopies(sql, shelf.id, 1);
  session.path = "/tu-sach/dong-thap/quan-ly/cho-muon?q=de";

  const err = await loadPage("dong-thap", (tx, ctx) =>
    searchBooksForLending(tx, ctx, { q: "sach" }),
  ).catch((e) => e);

  expect(redirectTarget(err)).toBe(
    `/dang-nhap?${RETURN_TO_PARAM}=%2Ftu-sach%2Fdong-thap%2Fquan-ly%2Fcho-muon%3Fq%3Dde`,
  );
  // And it is a redirect rather than a 404, stated separately so that a
  // `redirectTarget` returning null for a 404 cannot pass this by matching
  // `null` against `null`.
  expect(err).not.toMatchObject({ digest: NOT_FOUND });
});

test("a signed-in non-member gets a 404, and following the sign-in loop does not restart it", async () => {
  // The failure mode nobody notices until a real person is stuck in it, so it
  // is walked rather than asserted at the branch.
  //
  // Step 1: a guest follows a portal link to a parish they do not belong to,
  // and is sent to sign in — correctly, since nothing yet knows who they are.
  // Step 2: they sign in, `signInAction` honours the return path, and they
  // arrive back on the same page with a session and still no membership.
  //
  // If step 2 redirected again there would be no exit: `/dang-nhap` would send
  // them straight back, because they are already signed in. The distinction
  // that prevents it is `userId`, not `role` — `contextFor` reports *both*
  // callers as `role: "guest"`, and keying on the role is the edit that turns
  // this test red.
  const mine = await makeShelf(sql, { slug: "dong-thap" });
  const theirs = await makeShelf(sql, { slug: "can-tho" });
  await makeBookWithCopies(sql, theirs.id, 1);
  session.path = "/tu-sach/can-tho/quan-ly/cho-muon";

  const step1 = await loadPage("can-tho", (tx, ctx) =>
    searchBooksForLending(tx, ctx, { q: "sach" }),
  ).catch((e) => e);
  expect(redirectTarget(step1)).toBe(
    `/dang-nhap?${RETURN_TO_PARAM}=%2Ftu-sach%2Fcan-tho%2Fquan-ly%2Fcho-muon`,
  );

  await signInAs(mine.id, "manager", "quanly");

  const step2 = await loadPage("can-tho", (tx, ctx) =>
    searchBooksForLending(tx, ctx, { q: "sach" }),
  ).catch((e) => e);
  expect(step2).toMatchObject({ digest: NOT_FOUND });
  expect(redirectTarget(step2)).toBeNull();
});

test("a signed-in person with no membership anywhere also gets the 404, not the loop", async () => {
  // The same rule, for the other shape of non-member: a registration that has
  // not been approved yet holds a session and belongs to nothing. `contextFor`
  // gives them the same `role: "guest"` with a `userId`, and a redirect would
  // loop for them just as hard — this is the one whose loop nobody would think
  // to look for, because on paper they have no shelf to be sent back to.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  await makeBookWithCopies(sql, shelf.id, 1);
  session.path = "/tu-sach/dong-thap/danh-muc";
  await signInAs(null, "reader", "chua-duyet");

  const err = await loadPage("dong-thap", (tx, ctx) =>
    searchBooksForLending(tx, ctx, { q: "sach" }),
  ).catch((e) => e);

  expect(err).toMatchObject({ digest: NOT_FOUND });
  expect(redirectTarget(err)).toBeNull();
});

test("a return path pointing off-site is dropped, not followed", async () => {
  // The seam builds the sign-in URL from a request header, and a header is
  // input — `src/proxy.ts` overwrites it, but a route the matcher does
  // not cover would carry whatever the client sent. `safeReturnPath` is what
  // makes that uninteresting, and `tests/lib/return-path.test.ts` is where its
  // refusals are enumerated; this asserts the seam actually asks it.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  await makeBookWithCopies(sql, shelf.id, 1);

  for (const hostile of [
    "https://evil.example/pay",
    "//evil.example",
    "khong-phai-duong-dan",
  ]) {
    session.path = hostile;
    const err = await loadPage("dong-thap", (tx, ctx) =>
      searchBooksForLending(tx, ctx, { q: "sach" }),
    ).catch((e) => e);

    expect(redirectTarget(err), hostile).toBe("/dang-nhap");
  }
});

test("a request with no path header still redirects, to the bare sign-in form", async () => {
  // The proxy's matcher does not cover everything, and a test does not
  // run one at all. A missing header must degrade to `/dang-nhap` — where
  // `landingShelfFor` still takes a member of one parish to that parish —
  // rather than to a crash inside a render, or to a 404 that would silently
  // reinstate the behaviour this slice replaced.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  await makeBookWithCopies(sql, shelf.id, 1);
  session.path = null;

  const err = await loadPage("dong-thap", (tx, ctx) =>
    searchBooksForLending(tx, ctx, { q: "sach" }),
  ).catch((e) => e);

  expect(redirectTarget(err)).toBe("/dang-nhap");
});

/**
 * The `Viewer` the seam resolves and hands the page (U2 Task 5).
 *
 * A read that never touches the domain, on purpose: the interesting property
 * is what the *seam* resolves, and running a gated query beside it would mean
 * a broken `viewerFor` could still be masked by the refusal path.
 */
const viewerOf = (slug: string) =>
  loadPage(slug, async (_tx, _ctx, viewer) => viewer);

test("the header is handed the name of the person actually signed in", async () => {
  // The defect this replaces: `ShelfHeader` had `reader = "Giuse Trần Minh"` as
  // a *default*, so every shelf page in the app rendered real books under one
  // fixture reader's name and looked entirely correct doing it. Asserted
  // against a name written into this test rather than the fixture one, so a
  // regression to a hardcoded default cannot pass by coincidence.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  await signInAs(shelf.id, "reader", "bandoc");
  await sql`update users set full_name = 'Maria Nguyễn Thị Lan' where username = 'bandoc'`;

  expect(await viewerOf("dong-thap")).toEqual({
    name: "Maria Nguyễn Thị Lan",
    role: "reader",
  });
});

test("a display name the reader chose wins over their full name", async () => {
  // BR §5.3 (`BUSINESS-REQUIREMENTS.md:165`) lists `display_name` among the
  // facts held on the person rather than on a membership. This is the
  // viewer looking at their own header, so it is not the
  // `public_name_display` question `get-book-detail.ts` answers about *other*
  // people — that setting is what a shelf discloses to third parties.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  await signInAs(shelf.id, "reader", "bandoc");
  await sql`update users set display_name = 'Lan' where username = 'bandoc'`;

  expect(await viewerOf("dong-thap")).toEqual({ name: "Lan", role: "reader" });
});

test("an empty display name falls back to the full name rather than emptying the header", async () => {
  // `users.display_name` is nullable and nothing stops a form writing ''. A
  // bare `coalesce` would then render a header with an avatar circle, no
  // letter in it and no name beside it — which reads as a bug rather than as a
  // person, and `nullif` is one word.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  await signInAs(shelf.id, "reader", "bandoc");
  await sql`update users set display_name = '' where username = 'bandoc'`;

  expect(await viewerOf("dong-thap")).toEqual({
    name: "Giuse Trần Minh",
    role: "reader",
  });
});

test("a guest has no name, and the header renders signed-out from exactly that", async () => {
  // `null` is the only thing that can mean "nobody is signed in", because
  // `users.full_name` is `not null`. `ShelfHeader` keys its whole
  // signed-in/signed-out branch on it, which is what makes /dang-nhap and
  // /dang-ky — where this same header renders — honest.
  await makeShelf(sql, { slug: "dong-thap" });

  expect(await viewerOf("dong-thap")).toEqual({ name: null, role: "guest" });
});

test("the viewer's role is the one the seam resolved, not one the page decided", async () => {
  // U3 §3.3. The manager shell printed "Quản lý" under a hard-coded name on
  // every manager page, including the six C1 wired — so it said "Quản lý" to
  // whoever was looking, correct by luck rather than by reading. Asserted for
  // a *manager* specifically, because `viewerFor` returning `ctx.actor.role`
  // and returning the constant `"reader"` are indistinguishable on every other
  // test in this file.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  await signInAs(shelf.id, "manager", "quanly");
  await sql`update users set full_name = 'Maria Nguyễn Thị Lan' where username = 'quanly'`;

  expect(await viewerOf("dong-thap")).toEqual({
    name: "Maria Nguyễn Thị Lan",
    role: "manager",
  });
});

test("a signed-in non-member is a guest to the chrome, exactly as they are to the domain", async () => {
  // `contextFor` reports `role: "guest"` for a real session with no membership
  // here (its own `if (!membership?.id)` branch), and the chrome must not
  // invent a role from the fact that somebody is signed in *somewhere*. This
  // is also the case `loadPage`'s redirect branch below deliberately does not
  // key on role — see its docstring for the loop that produces.
  await makeShelf(sql, { slug: "dong-thap" });
  await signInAs(null, "reader", "nguoila");

  expect(await viewerOf("dong-thap")).toEqual({
    name: "Giuse Trần Minh",
    role: "guest",
  });
});

test("a NotFound from the read is a 404, not a bare 500", async () => {
  // U2 Task 4. `getBookDetail` throws `NotFound("book_not_found")` for a slug
  // naming no published book, and this seam translated only `shelf_not_found`
  // — so /tu-sach/dong-thap/sach/khong-co rendered an HTTP 500 for a mistyped
  // address. OPERATIONS.md:33 puts *not found* on a 404 page, and names a bare
  // 500 as the outcome that sentence exists to forbid. `submitCommand` made the
  // same correction on the write path.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  await signInAs(shelf.id, "reader", "bandoc");

  await expect(
    loadPage("dong-thap", async () => {
      throw new NotFound("book_not_found");
    }),
  ).rejects.toMatchObject({ digest: NOT_FOUND });
});

test("the kernel's zero-row write guard is still a fault, not a 404", async () => {
  // The one `NotFound` code that must keep propagating, matched on the code
  // exactly as `submitCommand` matches it: `write_target_not_found` is
  // `unit-of-work.ts`'s own guard firing on an `update` that matched nothing,
  // which is a bug inside a command, not a URL naming nothing. A read cannot
  // raise it — `runQuery` opens a read-only transaction — so this pins the
  // symmetry rather than a live case, and symmetry is the point when somebody
  // copies one branch from the other.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  await signInAs(shelf.id, "reader", "bandoc");

  const failure = loadPage("dong-thap", async () => {
    throw new NotFound("write_target_not_found");
  });

  await expect(failure).rejects.toBeInstanceOf(NotFound);
  await expect(failure).rejects.not.toMatchObject({ digest: NOT_FOUND });
});

test("loadPublicPage reads with no shelf and no session, and sees nothing else", async () => {
  // U2 Task 1's seam half, exercised on the production path — `pool()`, not
  // the suite's own connection — because that is what a page actually calls.
  // The directory comes back for a caller who named no shelf and holds no
  // cookie, which is the whole point; and in the same transaction `books` is
  // unreachable, which is what says the read is least-privileged rather than
  // merely scoped. `tests/domain/portal/list-public-shelves.test.ts` carries
  // the full argument, and `tests/db/public-role-privileges.test.ts` sweeps
  // every relation in the schema rather than this one sample.
  //
  // IMPORTANT 1 (fix-report, 2026-08-09-u2-shelf-and-portal): `books` used to
  // be asserted as `count(*) = 0`, which was true because `books_tenant`
  // filtered it, and which said nothing about the four tables that carry no
  // policy at all. `runPublicQuery` now runs as `olibra_public`, which holds
  // no grant on `books`, so the honest assertion is a refusal.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  await makeBookWithCopies(sql, shelf.id, 2);
  await makeShelf(sql, { slug: "can-tho" });

  const slugs = await loadPublicPage(async (tx) => {
    const shelves = await tx<{ slug: string }[]>`select slug from bookshelves`;
    return shelves.map((s) => s.slug).sort();
  });
  expect(slugs).toEqual(["can-tho", "dong-thap"]);

  // A separate transaction: a statement that raises aborts the one it is in.
  const books = await loadPublicPage(
    (tx) => tx`select count(*) as n from books`,
  ).then(
    () => "ok",
    (err: { code?: string }) => err.code,
  );
  expect(books).toBe("42501");
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
