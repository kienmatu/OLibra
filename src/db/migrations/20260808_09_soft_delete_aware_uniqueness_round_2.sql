-- IMPORTANT 5 (20260808_03_soft_delete_aware_uniqueness.sql) converted
-- `parish_units_name_unique_in_scope` and `bookshelves_slug_unique` from
-- plain unique constraints to partial unique indexes scoped to `where
-- deleted_at is null`, so a soft-deleted row stops permanently reserving
-- its name. The S1 re-review found four more constraints with the
-- identical shape, never converted, each confirmed live against the seed
-- database:
--
--   memberships_one_per_shelf           (bookshelf_id, user_id)
--   books_bookshelf_id_slug_key         (bookshelf_id, slug)
--   book_copies_code_unique             (bookshelf_id, code)
--   announcements_bookshelf_id_slug_key (bookshelf_id, slug)
--
-- `memberships_one_per_shelf` is the worst of the four: it does not merely
-- reserve a name, it locks out a *person*. A soft-deleted membership
-- permanently prevents that same person from ever rejoining that
-- bookshelf — reproduced live by soft-deleting a membership and attempting
-- to re-insert one for the same (bookshelf_id, user_id), which fails with
-- 23505 against the plain constraint. A family that leaves the parish and
-- later comes back cannot be re-registered, with nothing in the interface
-- explaining why — the row blocking them is invisible everywhere else a
-- soft-deleted row is filtered out.
--
-- None of these four needs the select-then-insert upsert helper
-- `upsertParishUnit` (src/db/seed.ts) required for parish units: only the
-- parish-unit fixture is soft-deleted anywhere in src/lib/fixtures.ts
-- (the one "Tổ 3" row), so the three ON CONFLICT arbiters in seed.ts that
-- target these tables (books, book_copies, memberships) only ever need
-- `where deleted_at is null` appended to keep matching their new partial
-- indexes — none of them upserts a soft-deleted fixture row the way
-- parish units do.
--
-- `categories_slug_key` has the identical shape and is deliberately left
-- alone: categories are global reference data (DATABASE.md §4.3), and
-- nothing in this codebase soft-deletes one — src/lib/fixtures.ts carries
-- no soft-deleted category, and there is no admin flow yet that removes
-- one. The trade this migration exists to fix (a name staying reserved by
-- a row nobody can see) does not arise there today. If categories ever
-- become soft-deletable in practice, the same one-line conversion applies.
alter table memberships drop constraint memberships_one_per_shelf;
create unique index memberships_one_per_shelf
  on memberships (bookshelf_id, user_id)
  where deleted_at is null;

alter table books drop constraint books_bookshelf_id_slug_key;
create unique index books_bookshelf_id_slug_key
  on books (bookshelf_id, slug)
  where deleted_at is null;

alter table book_copies drop constraint book_copies_code_unique;
create unique index book_copies_code_unique
  on book_copies (bookshelf_id, code)
  where deleted_at is null;

alter table announcements drop constraint announcements_bookshelf_id_slug_key;
create unique index announcements_bookshelf_id_slug_key
  on announcements (bookshelf_id, slug)
  where deleted_at is null;
