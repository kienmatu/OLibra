import type { Tx } from "../../kernel/unit-of-work";
import type { PublicShelf } from "./list-public-shelves";

/**
 * One shelf of the portal directory, by slug — `listPublicShelves` narrowed to
 * the row a visitor has already chosen, and deliberately nothing more.
 *
 * **Why this exists** (IMPORTANT 3, fix-report, 2026-08-09-u2-shelf-and-portal).
 * The sign-in form is a front-door page that a visitor reaches from exactly two
 * places: a portal link, which carries `?tu-sach=<slug>`, and `loadPage`'s
 * redirect off a shelf page, which carries `?tiep=/tu-sach/<slug>/…`. Both name
 * a parish. The page rendered neither, and instead took a shelf's name from
 * `src/lib/fixtures.ts` — so a parent from Vĩnh Long following the portal's own
 * link landed on a form headed "Tủ sách Đồng Tháp". `ShelfHeader`'s docstring
 * asserts the opposite ("it is how a visitor arriving from the portal knows
 * which parish they are signing in to"), which is the behaviour this query
 * makes true rather than aspirational.
 *
 * **Not a new disclosure.** It returns `PublicShelf` — the same three fields
 * `listPublicShelves` returns, under the same `status = 'active' and deleted_at
 * is null` restriction, through the same `runPublicQuery`, as the same
 * `olibra_public` role, which holds a column-level `select` on five columns of
 * `bookshelves` and no grant anywhere else (`20260809_01_public_role.sql`).
 * OPS §3.1 defines `GetPortalDirectory` and `SearchBookshelves` and no
 * `GetPortalShelf`; this is those operations' row shape addressed by its key
 * rather than a third operation, which is why it lives beside them and shares
 * their return type instead of declaring one of its own. A visitor who can list
 * every shelf can already read this row — the difference is one round trip, not
 * one fact.
 *
 * **`null` rather than a throw for a slug that names nothing.** The caller is a
 * page whose whole job is to render a sign-in form, and a hand-typed
 * `?tu-sach=` is not a reason to refuse to let somebody sign in. It falls back
 * to the front-door header — see `src/app/dang-nhap/page.tsx`. `NotFound` would
 * make `loadPublicPage` propagate (that seam catches nothing, deliberately) and
 * turn a mistyped query parameter into a 500.
 *
 * The `where` clause repeats `bookshelves_public_read`'s own predicate for the
 * reason `listPublicShelves`' docstring sets out at length: `bookshelves_tenant`
 * is a second permissive policy and Postgres ORs permissive policies together,
 * so a caller running this from inside a scoped transaction would otherwise see
 * their own archived shelf.
 */
export async function findPublicShelf(
  tx: Tx,
  input: { slug: string },
): Promise<PublicShelf | null> {
  // Returned unmapped, exactly as `listPublicShelves` returns its rows and for
  // the same reason: a `.map` rebuilding the three fields by hand would make
  // the returned keys agree with `PublicShelf` whatever the `select` asked
  // Postgres for, and it is the object that reaches a stranger, not the SQL.
  const [row] = await tx<PublicShelf[]>`
    select b.slug, b.name, b.location
    from bookshelves b
    where b.slug = ${input.slug}
      and b.status = 'active'
      and b.deleted_at is null
  `;
  return row ?? null;
}
