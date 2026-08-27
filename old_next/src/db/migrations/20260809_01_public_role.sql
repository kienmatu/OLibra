-- IMPORTANT 1 (fix-report, 2026-08-09-u2-shelf-and-portal). `runPublicQuery`
-- (src/domain/kernel/unit-of-work.ts) ran as `olibra_app` with the tenant
-- scope set to the empty string, on the premise — written into its own
-- docstring — that "every other table's `<table>_tenant` policy is
-- `bookshelf_id = <the GUC>`, which under the empty scope below is `null` and
-- therefore matches no row at all."
--
-- That premise was true of thirteen tables and false of five, and the five
-- were swept through the real pool inside that exact transaction:
--
--   users              no RLS at all — every account row: username, full_name,
--                      a child's date_of_birth, phone, email, is_super_admin,
--                      and the argon2 password_hash
--   sessions           no RLS at all — token_hash, user_id, expires_at,
--                      ip_address, user_agent
--   categories         no RLS
--   schema_migrations  no RLS
--   feedback           RLS enabled, but `feedback_tenant`'s USING is
--                      `(bookshelf_id = …) OR (bookshelf_id IS NULL)`, so every
--                      site-wide row is admitted under the empty scope
--
-- 0010_rls.sql leaves `users` and `categories` policy-less on purpose, and
-- 20260808_01_feedback_rls.sql admits site-wide feedback on purpose. Both
-- decisions were correct while **every caller was tenant-scoped**.
-- `runPublicQuery` is the first caller that is not, and it inherited a premise
-- that had stopped holding. `listPublicShelves` only ever touches
-- `bookshelves`, so nothing leaked — what leaked was the licence the *next*
-- public read would be written against. OPERATIONS.md §3.1 already specifies
-- `GetSiteContact` as guest-callable and Global; written to join `users` for
-- the administrator's name, it would have handed a stranger every account row
-- in the deployment, with a docstring and a test both saying it was safe.
--
-- **So the boundary moves from policies to privileges.** A policy that has to
-- be written for each new table fails open for the table nobody thought about;
-- a role with no grant fails closed for every table by default, because "no
-- privilege" is what `create role` already means. A public read that wanders
-- into `users` now raises
--
--   42501: permission denied for table users
--
-- which is an error a test asserts and a future author cannot talk themselves
-- past — as opposed to eleven rows and a green suite.
--
-- Modelled on 20260808_13_pool_role.sql, which created `olibra_pool` the same
-- way and for the same shape of reason. Three differences, each deliberate:
--
--   1. **No LOGIN and no password.** Nothing ever connects *as*
--      `olibra_public`; it is only ever reached through `set local role`, from
--      a connection already authenticated as `olibra_pool`. A role that cannot
--      log in is one fewer credential to rotate, and there is no
--      `__ENV_..._PASSWORD__` substitution here for `renderMigration`
--      (src/db/migrate.ts) to make.
--   2. **Not a member of `olibra_app`.** `olibra_pool` is a member of both, and
--      that is the point: the pool chooses which of the two a transaction runs
--      as, and the public path chooses the one that can see almost nothing.
--      Making `olibra_public` inherit from `olibra_app` would hand it back
--      exactly the grants this migration exists to withhold.
--   3. **Column-level grants on the one table it can read.** See below.
--
-- Guarded on `pg_roles` rather than a bare `create role`, exactly as
-- 0010_rls.sql and 20260808_13_pool_role.sql are, so this survives
-- tests/db/migrate.test.ts's `drop schema public cascade; create schema
-- public` — roles live at the cluster level, not inside `public`, so a second
-- run would otherwise fail with "role already exists" against a genuinely
-- fresh schema. The grants below are *not* guarded, and must not be: they name
-- objects inside `public`, which that reset destroys and this migration then
-- has to put back.
do $$
begin
  if not exists (select from pg_roles where rolname = 'olibra_public') then
    create role olibra_public;
  end if;
end $$;

-- `usage` only. Without it the role cannot name anything in the schema at all;
-- with it, it can name only what the grants below reach. Notably absent, and
-- absent by doing nothing: `users`, `sessions`, `schema_migrations`,
-- `categories`, `feedback`, and every one of the thirteen tenant tables. A
-- table added by a later migration is covered by the same nothing —
-- `tests/db/public-role-privileges.test.ts` discovers the relation list from
-- `pg_class` rather than from a list here, so a new table is checked without
-- anybody remembering to add it.
grant usage on schema public to olibra_public;

-- **Column-level, not `grant select on bookshelves`.** Row Level Security is
-- row-level: `bookshelves_public_read`
-- (20260808_12_bookshelves_public_read.sql) admits the whole row to any
-- caller, so until now the column surface was entirely the query's job —
-- DATABASE.md §4.2 says exactly that, and
-- `tests/db/bookshelves-public-columns.test.ts` is a regex over source text
-- standing in for a guarantee. A column grant makes the same boundary a fact
-- about the database: as `olibra_public`, `select keeper_phone from
-- bookshelves` and `select b.* from bookshelves b` both raise 42501, whatever
-- any regex did or did not match.
--
-- The five columns are the three BR §16.1 publishes to the portal (`slug`,
-- `name`, `location`) plus the two `listPublicShelves` names in its own
-- `where` clause. `status` and `deleted_at` are repeated in that query even
-- though `bookshelves_public_read`'s USING already says them — the query's
-- docstring explains why (`bookshelves_tenant` is a second permissive policy,
-- and Postgres ORs permissive policies together) — and a predicate the caller
-- writes needs the caller's own privilege on the column, unlike a policy's
-- USING expression, which the planner evaluates without one.
--
-- Deliberately **not** granted: `keeper_name`, `keeper_phone`, `settings`,
-- `created_by` — the four `WITHHELD_COLUMNS` the source guard names — and also
-- `id`, `address`, `opening_hours` and everything else on the table, which no
-- public read has needed yet. A future public read that genuinely needs one of
-- those gets a 42501 and a one-line migration, which is the conversation this
-- is meant to force.
grant select (slug, name, location, status, deleted_at)
  on bookshelves to olibra_public;

-- `with inherit false`, matching both grants in 20260808_13_pool_role.sql and
-- for the reason recorded there: without it, membership hands `olibra_pool`
-- the privileges the moment it connects, so a call site that *forgot* its
-- `set local role` would still work. Here that would be backwards in the more
-- interesting direction too — `olibra_pool` inheriting `olibra_public` costs
-- nothing, since `olibra_public` holds less than `olibra_app` does — but the
-- property worth keeping is that every role switch in this codebase is a
-- statement somebody wrote, not a flag on a GRANT nobody re-reads.
grant olibra_public to olibra_pool with inherit false;
