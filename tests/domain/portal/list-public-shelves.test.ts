import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runPublicQuery, runQuery } from "../../../src/domain/kernel/unit-of-work";
import { listPublicShelves } from "../../../src/domain/portal/queries/list-public-shelves";
import { migrate } from "../../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

/**
 * U2 Task 1. The project's first genuinely guest-callable read.
 *
 * Run against a real database, and it has to be: the whole question is what a
 * caller with no shelf and no session can see, and that is decided by Postgres
 * policies rather than by anything in TypeScript. A mocked `tx` would assert
 * that the function calls the function.
 */

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-09T03:00:00Z");

/**
 * A shelf with the two public columns actually filled in.
 *
 * `makeShelf` writes `address` and leaves `location` null, which is the
 * opposite of what `src/db/seed.ts` does and of what every screen in the app
 * reads — see `PublicShelf`'s docstring for why `location` is the column BR
 * §16.1's "address" means here. Rather than change a factory six other files
 * depend on, this fills it in.
 */
async function makePublicShelf(
  slug: string,
  name: string,
  location: string | null,
) {
  const shelf = await makeShelf(sql, { slug });
  await sql`
    update bookshelves set name = ${name}, location = ${location}
    where id = ${shelf.id}
  `;
  return shelf;
}

const directory = (q = "") =>
  runPublicQuery(sql, (tx) => listPublicShelves(tx, { q }));

test("it runs as olibra_public with no shelf scope, and every other table is refused outright", async () => {
  // The claim the whole slice rests on: this read is safe *without* a
  // membership. Three facts, all measured inside the one transaction the query
  // runs in: the role really is the least-privileged one, the tenant GUC really
  // is the fail-closed sentinel, and a table a public caller has no business
  // reading really does refuse — while `bookshelves` answers.
  //
  // **The role is `olibra_public`, and the third fact is a privilege error
  // rather than zero rows.** IMPORTANT 1 (fix-report, 2026-08-09-u2-shelf-and-
  // portal): this test used to assert `olibra_app` and `count(*) = 0` on
  // `books` and `memberships`, which was true and was not the question. Both
  // of those tables carry a `<table>_tenant` policy, so of course they answered
  // zero under the empty scope; `users`, `sessions`, `categories` and
  // `schema_migrations` carry no policy at all and answered *everything*, and
  // this test never looked at them. Sampling three tables is how a check comes
  // to agree with a false premise.
  //
  // So the fix is a role with no grant rather than a policy per table
  // (20260809_01_public_role.sql), and the assertion is `42501` rather than a
  // count — an error the next author cannot read as "safe, just empty".
  // `tests/db/public-role-privileges.test.ts` is the exhaustive half: it sweeps
  // every relation in the schema, discovered from `pg_class`. This one keeps
  // the two facts that belong beside the query itself.
  const a = await makePublicShelf("dong-thap", "Tủ sách Đồng Tháp", "Ấp Tân Hoà");
  const b = await makePublicShelf("can-tho", "Tủ sách Cần Thơ", "Phường An Bình");
  await makeBookWithCopies(sql, a.id, 2);
  await makeBookWithCopies(sql, b.id, 2);
  await makeMember(sql, a.id);

  const probe = await runPublicQuery(sql, async (tx) => {
    const [who] = await tx<
      { role: string; scope: string | null; bypasses: boolean }[]
    >`
      select
        current_user as role,
        current_setting('olibra.bookshelf_id', true) as scope,
        (select rolbypassrls from pg_roles where rolname = current_user) as bypasses
    `;
    const [counts] = await tx<{ shelves: string }[]>`
      select (select count(*) from bookshelves) as shelves
    `;
    return { who, counts };
  });

  expect(probe.who.role).toBe("olibra_public");
  expect(probe.who.bypasses).toBe(false);
  expect(probe.who.scope).toBe("");
  expect(Number(probe.counts.shelves)).toBe(2);

  // Both shelves hold books and members. A public read reaches neither, and it
  // is stopped before RLS is consulted at all.
  for (const table of ["books", "memberships", "users", "sessions"]) {
    // Caught outside `runPublicQuery`, not inside: a statement that raises
    // aborts the transaction it is in, so `sql.begin` rejects regardless of
    // what the callback does with the rejection. One transaction per probe.
    const code = await runPublicQuery(sql, (tx) =>
      tx.unsafe(`select 1 from "${table}" limit 1`),
    ).then(
      () => "ok",
      (err: { code?: string }) => err.code,
    );
    expect(code, `${table} should be refused`).toBe("42501");
  }
});

test("it returns the shelf's name, address and slug — and no other key", async () => {
  // U2 §3.2's acceptance bullet, asserted on the returned object rather than
  // on the text of the query, because what reaches a stranger is the object.
  // The query returns the driver's rows unmapped for exactly this reason: a
  // `.map` rebuilding three fields by hand would satisfy this assertion no
  // matter what the `select` asked Postgres for, and OPS §3.1 is explicit that
  // joining the full row in and trimming it afterwards "still puts it on the
  // wire".
  //
  // The withheld facts are real on this row, so an over-selecting query has
  // something to leak: BR §16.1 names book counts, reader counts and keeper
  // contact.
  const shelf = await makePublicShelf(
    "dong-thap",
    "Tủ sách Đồng Tháp",
    "Nhà xứ Đồng Tháp, ấp Tân Hoà",
  );
  await sql`
    update bookshelves
    set keeper_name = 'Maria Nguyễn Thị Lan',
        keeper_phone = '0912 345 678',
        settings = '{"loan_days": 21}'::jsonb
    where id = ${shelf.id}
  `;
  await makeBookWithCopies(sql, shelf.id, 3);
  await makeMember(sql, shelf.id);

  const [row] = await directory();

  expect(Object.keys(row).sort()).toEqual(["location", "name", "slug"]);
  expect(row).toEqual({
    slug: "dong-thap",
    name: "Tủ sách Đồng Tháp",
    location: "Nhà xứ Đồng Tháp, ấp Tân Hoà",
  });
});

test("a shelf with no address is a row with a name, not a missing row", async () => {
  // `location` is nullable on the table. A directory that dropped such a shelf
  // would make a parish undiscoverable over a field BR §16.1 never made
  // required — and the one job of this page is that a parish can be found.
  await makePublicShelf("vinh-long", "Tủ sách Vĩnh Long", null);

  expect(await directory()).toEqual([
    { slug: "vinh-long", name: "Tủ sách Vĩnh Long", location: null },
  ]);
});

test("an archived or soft-deleted shelf is not in the directory", async () => {
  // `20260808_12_bookshelves_public_read.sql`: "an archived or soft-deleted
  // shelf has no business being discoverable by slug" — the portal is the
  // other half of that sentence. `guards.ts`'s `resolveShelfId` already
  // refuses to resolve one, so a directory that listed them would advertise
  // links that cannot resolve.
  await makePublicShelf("dong-thap", "Tủ sách Đồng Tháp", "Ấp Tân Hoà");
  const gone = await makePublicShelf("can-tho", "Tủ sách Cần Thơ", "An Bình");
  const archived = await makePublicShelf("ben-tre", "Tủ sách Bến Tre", "Phú Lợi");
  await sql`update bookshelves set deleted_at = now() where id = ${gone.id}`;
  await sql`update bookshelves set status = 'archived' where id = ${archived.id}`;

  expect((await directory()).map((s) => s.slug)).toEqual(["dong-thap"]);
});

test("an archived shelf stays out even for a caller scoped to it", async () => {
  // Why the `where` clause is not the duplicate of `bookshelves_public_read`
  // that it looks like. `bookshelves_tenant` is a second *permissive* policy
  // on the same table and Postgres ORs permissive policies together, so inside
  // a transaction that has `olibra.bookshelf_id` set, that policy admits the
  // caller's own row whatever its status. Delete the two lines from the query
  // and this is the test that fails; the four above stay green, because in a
  // public transaction the policy is doing the filtering.
  const archived = await makePublicShelf("ben-tre", "Tủ sách Bến Tre", "Phú Lợi");
  await sql`update bookshelves set status = 'archived' where id = ${archived.id}`;
  const ctx: TenantContext = {
    bookshelfId: archived.id,
    actor: { userId: null, membershipId: null, role: "guest" },
    clock,
  };

  const rows = await runQuery(sql, ctx, (tx) => listPublicShelves(tx, { q: "" }));

  expect(rows).toEqual([]);
});

test("search folds diacritics, case and punctuation, over the name and the address", async () => {
  // BR §12, on the portal: "Không cần gõ dấu" is what the page tells a
  // visitor, and this is that promise. `olibra_fold()` is the SQL half of the
  // one folding rule `tests/db/folding.test.ts` holds in agreement with
  // `src/domain/kernel/fold.ts`; `đ`/`Đ` is the case that a plain `unaccent()`
  // gets wrong (DATABASE.md §5), which is why "dong thap" is the term here.
  await makePublicShelf("dong-thap", "Tủ sách Đồng Tháp", "Ấp Tân Hoà, Tân Phú");
  await makePublicShelf("can-tho", "Tủ sách Cần Thơ", "Phường An Bình");

  expect((await directory("dong thap")).map((s) => s.slug)).toEqual(["dong-thap"]);
  expect((await directory("ĐỒNG THÁP")).map((s) => s.slug)).toEqual(["dong-thap"]);
  // The address is searchable too: a visitor who knows where the shelf is but
  // not what it is called is exactly who this page is for.
  expect((await directory("an binh")).map((s) => s.slug)).toEqual(["can-tho"]);
  expect(await directory("khong co o dau")).toEqual([]);
});

test("a term made only of punctuation shows the directory, and never acts as a wildcard", async () => {
  // `searchCatalogue` guards against a term that folds to `''` because for a
  // catalogue, "match every row" is the wrong answer. For the directory it is
  // the right one — the portal with nothing typed into it is the whole list —
  // so this query carries no such guard, and its docstring says so rather than
  // leaving a condition no test could make fail.
  //
  // What that leaves worth asserting is the part that would be a defect: `%`
  // is `like`'s wildcard and `_` matches a single character, and neither may
  // survive folding into the pattern. The last assertion is the one that
  // fails if they do.
  await makePublicShelf("dong-thap", "Tủ sách Đồng Tháp", "Ấp Tân Hoà");
  await makePublicShelf("can-tho", "Tủ sách Cần Thơ", "Phường An Bình");

  expect((await directory("")).map((s) => s.slug)).toEqual([
    "can-tho",
    "dong-thap",
  ]);
  expect((await directory("   ")).map((s) => s.slug)).toEqual([
    "can-tho",
    "dong-thap",
  ]);
  expect((await directory("%")).map((s) => s.slug)).toEqual([
    "can-tho",
    "dong-thap",
  ]);
  // A term with real letters *and* metacharacters folds the metacharacters
  // away to spaces rather than passing them through: "c%n th_" would match
  // "Cần Thơ" as a `like` pattern, and matches nothing once folded.
  expect(await directory("c%n th_")).toEqual([]);
});

test("the directory is in Vietnamese alphabetical order, not byte order", async () => {
  // Postgres makes no promise about row order without an `order by`, and a
  // directory whose rows moved between renders is a page a person cannot scan.
  //
  // The order itself is the part worth pinning. This database's collation is
  // `C` (verified on the cluster: `datcollate = 'C'`), which sorts by byte
  // value — and `Đ` is a two-byte sequence starting `0xC4`, so a plain
  // `order by name` puts Đồng Tháp *after* Vĩnh Long. Measured directly, in
  // psql, before the query was changed to sort by `olibra_fold(name)`. This
  // test was written expecting alphabetical order and failed exactly that way.
  await makePublicShelf("vinh-long", "Tủ sách Vĩnh Long", null);
  await makePublicShelf("dong-thap", "Tủ sách Đồng Tháp", "Ấp Tân Hoà");
  await makePublicShelf("can-tho", "Tủ sách Cần Thơ", "An Bình");

  expect((await directory()).map((s) => s.name)).toEqual([
    "Tủ sách Cần Thơ",
    "Tủ sách Đồng Tháp",
    "Tủ sách Vĩnh Long",
  ]);
});
