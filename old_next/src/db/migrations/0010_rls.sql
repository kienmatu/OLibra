-- INV-10, the highest-consequence property in the system. BR §6 requires it
-- to be structural — impossible to forget — not a matter of anyone
-- remembering to filter.
--
-- Two roles, and the difference between them is the whole design:
--   olibra_app   — every ordinary request. Policies apply.
--   olibra_admin — cross-shelf super-admin views and migrations. Bypasses.
-- Using the bypass is therefore a visible, deliberate act.
--
-- Guarded by `pg_roles`, not a bare `create role`: roles live at the cluster
-- level, not inside `public`, so they survive anything that resets the
-- schema (tests/db/migrate.test.ts rebuilds `public` from scratch with
-- `drop schema ... cascade; create schema public` to exercise migrate()
-- idempotently, and a bare `create role` would fail the second time with
-- "role already exists" even though the schema is genuinely fresh).
do $$
begin
  if not exists (select from pg_roles where rolname = 'olibra_app') then
    create role olibra_app;
  end if;
  if not exists (select from pg_roles where rolname = 'olibra_admin') then
    create role olibra_admin bypassrls;
  end if;
end $$;

grant usage on schema public to olibra_app, olibra_admin;
grant select, insert, update on all tables in schema public to olibra_app;
grant all on all tables in schema public to olibra_admin;

-- Re-apply the append-only guarantees after the grants above, since `grant
-- all` would otherwise hand back what 0009 revoked.
revoke delete on loans from olibra_app, olibra_admin;
revoke update, delete on audit_log from olibra_app, olibra_admin;

do $$
declare t text;
begin
  -- Every shelf-scoped table. DB §3 names three things this loop must not
  -- touch: users, categories and site-wide feedback are global reference or
  -- cross-tenant data and carry no policy. schema_migrations isn't tenant
  -- data at all, so it was never a candidate.
  --
  -- audit_log IS included here, deliberately, unlike the note this loop
  -- used to carry: its bookshelf_id is nullable for global/system actions,
  -- and under this plain-equality policy a null bookshelf_id never equals
  -- the session's shelf (null = x is null, never true) — so a global entry
  -- is invisible to olibra_app and its `with check` rejects any olibra_app
  -- insert of one. That is correct, not a gap: BR §13.2 makes "view audit
  -- log across all shelves" a super_admin permission, and a command writing
  -- a global audit entry runs as olibra_admin, deliberately and visibly,
  -- which bypasses the policy via bypassrls rather than needing a
  -- null-aware USING clause here.
  --
  -- parish_units and book_donations both carry a not-null bookshelf_id and
  -- are tenant data from the row's first moment ("At a glance"'s own diagram
  -- has "BOOKSHELVES  ||--o{ PARISH_UNITS  : scopes"; §4.8 says as much
  -- explicitly for book_donations: "Row Level Security applies exactly as it
  -- does to every other table in this section"), so they get the same
  -- policy as everything else here rather than a bespoke one.
  foreach t in array array[
    'memberships', 'parish_units', 'books', 'book_copies',
    'loans', 'borrow_requests', 'condition_assessments', 'comments',
    'announcements', 'book_donations', 'notifications',
    'profile_change_requests', 'audit_log'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    -- force, so the table owner is subject to the policy too. Without this a
    -- migration or an admin script silently sees everything.
    execute format('alter table %I force row level security', t);
    -- `nullif(..., '')` rather than a bare cast: a custom GUC that has been
    -- set via `set_config(..., true)` (LOCAL) at least once on a connection
    -- reverts to '' — not NULL — once that transaction ends, not "unset" the
    -- way it was before it was ever touched. Verified directly:
    --   begin; select set_config('olibra.bookshelf_id', 'x', true); commit;
    --   select current_setting('olibra.bookshelf_id', true); -- '' , not null
    -- A bare `''::uuid` cast raises "invalid input syntax for type uuid"
    -- instead of failing closed, which matters wherever a connection is
    -- reused across transactions — every pooled connection, and every test
    -- in this suite sharing tests/support/db.ts's single connection. Without
    -- `nullif`, a transaction with no shelf set would error out rather than
    -- see zero rows, the first time it ran on a connection that had
    -- previously set the variable.
    execute format($p$
      create policy %I_tenant on %I
        using (bookshelf_id = nullif(current_setting('olibra.bookshelf_id', true), '')::uuid)
        with check (bookshelf_id = nullif(current_setting('olibra.bookshelf_id', true), '')::uuid)
    $p$, t, t);
  end loop;
end $$;

-- bookshelves is scoped by its own id, not a bookshelf_id column — the one
-- table in this migration a plain loop over "bookshelf_id = ..." cannot
-- express, so it gets its own statements rather than being folded into the
-- array above. Same `nullif` reasoning as the loop above.
alter table bookshelves enable row level security;
alter table bookshelves force row level security;

create policy bookshelves_tenant on bookshelves
  using (id = nullif(current_setting('olibra.bookshelf_id', true), '')::uuid)
  with check (id = nullif(current_setting('olibra.bookshelf_id', true), '')::uuid);
