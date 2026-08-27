-- docs/DATABASE.md §4.1 already named this problem and its fix, for
-- `parish_units_name_unique_in_scope`: "The constraint does not exclude
-- soft-deleted rows, so soft-deleting Tổ 1 on a flat shelf blocks creating a
-- live Tổ 1 there afterwards. That is the wrong trade... Add `where
-- deleted_at is null` when this becomes a real index." This branch shipped
-- the constraint (0003_identity.sql) without ever taking that step.
-- Reproduced directly against the seed data: the fixture's soft-deleted
-- "Tổ 3" (src/lib/fixtures.ts) blocks re-inserting a live unit of that name
-- in the same scope.
--
-- A plain UNIQUE *constraint* cannot carry a predicate — only an index can
-- — so this has to become a partial unique *index*, not a same-named
-- constraint with a `where` bolted on. `nulls not distinct` carries over
-- unchanged (§4.1's reasoning for it — every level-1 unit shares a null
-- parent_id — is unaffected by adding the soft-delete predicate).
alter table parish_units drop constraint parish_units_name_unique_in_scope;

create unique index parish_units_name_unique_in_scope
  on parish_units (bookshelf_id, level, parent_id, name)
  nulls not distinct
  where deleted_at is null;

-- The same class of bug, on `bookshelves.slug`: a plain `unique` blocks
-- ever reusing a slug once the bookshelf that held it is soft-deleted, and
-- a soft-deleted bookshelf is exactly the kind of history §11 keeps around
-- rather than a reservation on the name. Same one-line shape as
-- parish_units above — plain unique constraint, deleted_at column already
-- present, no NULLS NOT DISTINCT needed since slug is not-null.
alter table bookshelves drop constraint bookshelves_slug_key;

create unique index bookshelves_slug_unique
  on bookshelves (slug)
  where deleted_at is null;
