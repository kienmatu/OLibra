import type { Tx } from "../../kernel/unit-of-work";

/**
 * One row of the portal directory: everything a stranger may know about a
 * shelf they are not a member of, and nothing else.
 *
 * Three fields, and each one has to earn its place, because BR §16.1 is a
 * disclosure boundary rather than a layout preference — "Book counts, reader
 * counts and keeper contact are not shown, because a person with no membership
 * has no business knowing them."
 *
 * - `name` and `location` are the "name and address" BR §16.1 and OPS §3.1
 *   both specify. DATABASE.md §4.2 names the pair in schema terms while
 *   describing what `bookshelves_public_read` stopped protecting: "once a
 *   policy admits a `bookshelves` row, every column on it is readable through
 *   that same query, not only `name` and `location`." `bookshelves` also has
 *   an `address` column, and it is not this one: `0003_identity.sql:46`
 *   annotates `location` as "physical location, shown publicly" and leaves
 *   `address` unannotated, `src/db/seed.ts` writes `location` and never
 *   `address`, and all four fixture shelves carry an address-shaped string in
 *   `location` ("Nhà xứ Đồng Tháp, ấp Tân Hoà, xã Tân Phú"). Every screen in
 *   the app that shows a shelf's address today reads the fixtures' `location`.
 * - `slug` is the URL segment (BR:179, "fixed after creation"). It is not a
 *   fact about the shelf that could be withheld — it is how the portal links
 *   to the shelf at all, and it is in the address bar of every page of that
 *   shelf. Withholding it would leave a directory nobody can act on.
 *
 * `location` is nullable because the column is. A shelf onboarded without one
 * is a directory entry with a name and no address, which is a thinner row and
 * not an error; the portal renders the name alone.
 */
export interface PublicShelf {
  slug: string;
  name: string;
  location: string | null;
}

/**
 * The portal directory, and the search over it — OPS §3.1's `GetPortalDirectory`
 * and `SearchBookshelves`, which are the same statement with and without a
 * term.
 *
 * **The project's first genuinely guest-callable read, and the signature says
 * so.** Every other query in `src/domain/` takes a `TenantContext` and opens
 * with `requireReader` or `requireManager`. This one takes neither, because
 * there is nobody to check and no shelf to check them against: a stranger
 * looking for their parish holds no membership anywhere, which is the whole
 * reason the portal exists (BR §1.2 — "someone who has no account yet must be
 * able to find their parish's shelf in order to register for it"). It runs
 * through `runPublicQuery` (`src/domain/kernel/unit-of-work.ts`), as
 * `olibra_app` with the tenant scope explicitly empty; that function's
 * docstring carries why that is safe and what it deliberately is not (the
 * `bypassrls` role). No `requireReader` was removed or weakened anywhere to
 * make this possible — `bookshelves_public_read` already existed for
 * `contextFor`'s slug lookup, and this is the second read it was written for.
 *
 * **The column list is the disclosure boundary, and it is the only thing
 * standing there.** Row Level Security is row-level: `bookshelves_public_read`
 * admits the whole row, so what a stranger learns is decided here and nowhere
 * else (DATABASE.md §4.2, and `tests/db/bookshelves-public-columns.test.ts`,
 * which is the guard). This file deliberately takes **no** exemption from that
 * guard — it names three columns, none of them withheld, and it is the one
 * query in the codebase where a future `select` of the shelf keeper's contact
 * details would matter most. The test's docstring records the same decision
 * from its own side. BR:179 does describe the keeper's name and phone as
 * "shown publicly", and BR §16.1 places them on the shelf's own page, which is
 * member-only; where the two readings differ for a field, the portal shows
 * less. `tests/domain/portal/list-public-shelves.test.ts` asserts it on the
 * keys of the returned object rather than on the text of this query, because
 * what reaches a stranger is the object, not the SQL.
 *
 * **`status = 'active' and deleted_at is null` is repeated here even though
 * `bookshelves_public_read`'s `using` clause already says it.** Not
 * redundancy: `bookshelves_tenant` is a second permissive policy on the same
 * table, and Postgres ORs permissive policies together — so inside a
 * transaction that *does* have `olibra.bookshelf_id` set, that policy admits
 * the caller's own shelf row regardless of its status. Without this clause a
 * caller who ran the directory query from inside a scoped transaction would
 * see their own archived shelf in a list that is supposed to contain only
 * active ones. The test pins that case directly, because it is the one a
 * reviewer would otherwise delete as duplication.
 *
 * **Folding happens in SQL, through `olibra_fold()`.** BR §12's requirement is
 * that the normalisation applied to the stored text and to the search term can
 * never drift, and `src/domain/kernel/fold.ts` is the single rule the SQL
 * function is held in agreement with by `tests/db/folding.test.ts`. So the
 * portal's search folds the same way the catalogue's does, by calling the same
 * function, rather than by a second implementation that happens to agree
 * today. Unlike `books`, `bookshelves` has no generated folded columns — a few
 * dozen directory rows per deployment, so `olibra_fold()` is evaluated per row
 * rather than read off an index, the same trade-off DB §5 already accepts for
 * the catalogue's `like '%…%'`.
 *
 * **`searchCatalogue`'s garbage-query guard is deliberately absent, and the
 * absence is the interesting half.** That query carries an explicit
 * `olibra_fold(q) <> ''` because `olibra_fold('%')` is `''`, `'%' || '' || '%'`
 * matches every row, and revealing the whole shelf to a query made of
 * punctuation is not what a catalogue search should do. Here the whole
 * directory *is* the right answer for a term with nothing in it — it is what a
 * visitor sees before typing anything, and what BR §16.1 calls the portal
 * directory — and `'%' || '' || '%'` already produces exactly that. Writing
 * the guard anyway would have been a condition no test could make fail, which
 * `20260808_15_olibra_now_strict.sql` names the cost of: "an unreachable guard
 * reads as a guarantee somebody is entitled to weaken the pattern against".
 * Said out loud because a reviewer who knows the catalogue's guard would
 * otherwise read this as having forgotten it.
 *
 * The folded term cannot carry `like` metacharacters into the pattern:
 * `olibra_fold` replaces every run of non-`[a-z0-9]` with a space, so `%` and
 * `_` do not survive it. Worth stating because the pattern is assembled by
 * concatenation, and the reason it is safe is the folding rather than the
 * concatenation.
 *
 * **Ordered by the folded name, not the name.** This database's collation is
 * `C` — `datcollate = 'C'`, `datlocprovider = 'c'`, checked on the running
 * cluster — which sorts by byte value. `Đ` is two bytes beginning `0xC4`, so
 * under a plain `order by name` "Tủ sách Đồng Tháp" sorts *after* "Tủ sách
 * Vĩnh Long", and a Vietnamese directory reads as unsorted to the only people
 * who will ever read it. `olibra_fold` maps `Đ` to `d` and strips every
 * diacritic, leaving `[a-z0-9 ]`, on which byte order and alphabetical order
 * are the same thing — so the sort key is the rule this file already depends
 * on rather than a collation the deployment would have to be created with.
 * `slug` breaks ties, because two shelves can fold to the same name and a list
 * that reordered them between renders is a list nobody can scan.
 *
 * **The driver's rows are returned as they are, and that is the one place in
 * this codebase where not mapping is the safer choice.** Every other query here
 * maps snake_case columns onto a domain shape; there is nothing to rename (all
 * three columns are already the field names), and a `.map` that rebuilt the
 * three fields by hand would make the returned keys agree with `PublicShelf`
 * no matter what the `select` above asked Postgres for. A driver row carries
 * exactly the columns the statement selected — verified — so returning it
 * unmapped is what lets the key assertion in the test cover the SQL as well as
 * the type, which is what OPS §3.1 asks for when it forbids joining the full
 * row in and trimming it afterwards: that "still puts it on the wire".
 */
export async function listPublicShelves(
  tx: Tx,
  input: { q: string },
): Promise<PublicShelf[]> {
  return tx<PublicShelf[]>`
    with term as (select olibra_fold(${input.q}) as folded)
    select b.slug, b.name, b.location
    from bookshelves b, term
    where b.status = 'active'
      and b.deleted_at is null
      and (
        olibra_fold(b.name) like '%' || term.folded || '%'
        or olibra_fold(coalesce(b.location, '')) like '%' || term.folded || '%'
      )
    order by olibra_fold(b.name), b.slug
  `;
}
