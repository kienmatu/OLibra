-- contextFor (src/auth/guards.ts) resolves a bookshelf slug to an id before
-- any shelf is known — that is the whole point of the lookup. bookshelves_
-- tenant (0010_rls.sql) scopes every read by `id = <the session's already-
-- set shelf GUC>`, which this step cannot satisfy: the id is what is being
-- discovered. Verified live: as olibra_app with no GUC set on the
-- connection, `select id from bookshelves where slug = 'an-giang'` returns
-- zero rows for a slug that exists.
--
-- A second, additional PERMISSIVE policy, not a replacement for
-- bookshelves_tenant. Postgres ORs together permissive policies that cover
-- the same command, so this only ever widens what `select` can see — it
-- plays no part in an insert/update's `with check`, which stays governed
-- exclusively by bookshelves_tenant, unchanged. Restricted to active,
-- undeleted rows: an archived or soft-deleted shelf has no business being
-- discoverable by slug.
--
-- This is also a real product requirement, not only a fix for a database
-- quirk. BUSINESS-REQUIREMENTS.md's Portal section: "Searchable directory
-- of bookshelves — name and address only. Public, because someone who has
-- no account yet must be able to find their parish's shelf in order to
-- register for it." OPERATIONS.md §2: "only the landing page, the portal
-- directory, and the sign-in and registration forms are public." A
-- bookshelf row is a directory entry, not confidential tenant data the way
-- a row in books or loans is; bookshelves_tenant's job was always to stop
-- one shelf's session from *writing* another shelf's row, never to hide
-- that the other shelf exists.
create policy bookshelves_public_read on bookshelves
  for select
  using (status = 'active' and deleted_at is null);
