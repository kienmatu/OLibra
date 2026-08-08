-- CRITICAL 2: the application's connection pool has authenticated as
-- `olibra` — a Postgres superuser, `rolsuper = t` — for the whole project so
-- far (compose.yaml, .env.example). A superuser bypasses Row Level Security
-- unconditionally, regardless of which role it then `set local role`s to
-- (DATABASE.md §3, "The application role is not wired to a login role
-- yet" / "What is *not* closed by this"). `set local role olibra_app`
-- (guards.ts, session.ts, unit-of-work.ts) has always run correctly and has
-- never once mattered: every RLS guarantee 0010_rls.sql and everything built
-- on it promises has been inert on the real connection path, the whole time.
--
-- `olibra_pool` is the role the connection pool authenticates as from here
-- on (.env.example, compose.yaml). Two properties make it the role Task 4's
-- acceptance bullet asked for:
--
--   1. Granted membership in `olibra_app` (every ordinary request) and
--      `olibra_admin` (only the deliberate, explicitly-named cross-shelf
--      paths — `runGlobalCommand`, `seed()`, `landingShelfFor` — that
--      already `set local role olibra_admin` themselves).
--   2. Not a superuser and not `bypassrls`. Both are Postgres defaults for a
--      freshly `create role`d login role, and neither is touched below.
--
-- `with inherit false` on both grants closes a gap DATABASE.md §3 named but
-- left open: "relying instead on that role *inheriting* the grant without
-- ever naming it here would make every query in this file quietly depend on
-- a GRANT's INHERIT flag nobody re-checks". Without it, a role granted
-- membership in `olibra_app`/`olibra_admin` automatically carries their
-- table privileges the moment it connects, with no `set local role` needed
-- — so a call site that *forgot* the switch would still work, silently,
-- until the day someone relies on RLS actually narrowing a query that never
-- named `olibra_app` at all. `with inherit false` (PostgreSQL 16+) means
-- membership grants nothing until `set local role` names it explicitly,
-- which is exactly how every call site in this codebase already reads.
--
-- The password is supplied by environment, not hard-coded here:
-- `__ENV_OLIBRA_POOL_PASSWORD__` is substituted by `migrate()`
-- (`renderMigration`, src/db/migrate.ts) from `process.env
-- .OLIBRA_POOL_PASSWORD` before this file ever reaches Postgres — the same
-- value `.env`/`.env.example` set once per environment and `compose.yaml`'s
-- `app` service's `DATABASE_URL` is built from.
--
-- Guarded the same way 0010_rls.sql guards `olibra_app`/`olibra_admin`:
-- `pg_roles` existence, not a bare `create role`, so this survives
-- tests/db/migrate.test.ts's `drop schema public cascade; create schema
-- public` (roles live at the cluster level, not inside `public`) without
-- failing "role already exists" on a second run. The `else alter role`
-- branch is what lets a rotated password actually take effect on a database
-- that already has this migration recorded — `migrate()` never reruns an
-- applied migration, so this file has to be safe to run again by hand
-- (`bun run db:migrate` cannot do it once `schema_migrations` has this row,
-- but a direct `psql` invocation, or a small future `db:rotate-pool-password`
-- script built the same way, can).
do $$
begin
  if not exists (select from pg_roles where rolname = 'olibra_pool') then
    create role olibra_pool login password '__ENV_OLIBRA_POOL_PASSWORD__';
  else
    alter role olibra_pool password '__ENV_OLIBRA_POOL_PASSWORD__';
  end if;
end $$;

grant olibra_app to olibra_pool with inherit false;
grant olibra_admin to olibra_pool with inherit false;
