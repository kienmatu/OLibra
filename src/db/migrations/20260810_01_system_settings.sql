-- B4. OPS §3.4's `GetSystemSettings` / `UpdateSystemDefaults` / `UpdateSiteContact`
-- and §3.1's `GetSiteContact` — the deployment's own settings, belonging to no
-- shelf.
--
-- There was nowhere to put them. Every other setting in this system lives in
-- `bookshelves.settings`, which is per-shelf by construction; the
-- administration contact ("Liên hệ ban quản trị") and the defaults a *new*
-- shelf inherits are facts about the installation. `/lien-he` has rendered them
-- from `src/lib/fixtures.ts` since the first commit.
--
-- **One row, enforced by the primary key.** `id boolean primary key default
-- true check (id)` admits exactly one value, so a second row is a `23505`
-- rather than a silent duplicate that half the queries would miss. The
-- alternative — a key/value table — turns every read into a pivot and puts the
-- column types in the application.
create table system_settings (
  id                           boolean primary key default true check (id),

  -- BR §16.1's contact block. Nullable: a fresh installation has nobody to
  -- name yet, and `/lien-he` says so rather than printing an invented person.
  contact_name                 text,
  contact_phone                text,
  contact_hours                text,

  -- The values a shelf created without an explicit policy starts with. These
  -- are *defaults for creation*, not a fallback at read time: BR §5.5's
  -- per-shelf `coalesce(..., 14)` stays exactly where it is, in the commands
  -- that read it, because a shelf that has already opened must not silently
  -- change its lending policy the day an administrator edits this row.
  default_loan_days            integer not null default 14,
  default_max_concurrent_loans integer not null default 3,
  default_hold_days            integer not null default 3,

  -- **`changed_by` / `changed_at`, not `updated_by` / `updated_at`**, and the
  -- name is the whole point. Every other `updated_at` in this schema is written
  -- by the `set_updated_at()` trigger from SQL `now()` — the *database* host's
  -- clock (DATABASE.md §6, two clocks in one transaction) — and
  -- `tests/db/updated-at-trigger.test.ts` asserts set-equality between the
  -- columns and the triggers precisely so a table cannot quietly opt out.
  --
  -- This one is written explicitly from `ctx.clock`, because it is a timestamp
  -- the domain means: the screen shows when an administrator last changed these
  -- settings, and a test with a `fixedClock` must be able to move it. Calling it
  -- `updated_at` would either need the trigger — which would overwrite the
  -- injected value with `now()` — or an exception in a guard that deliberately
  -- has none. A different name is neither.
  changed_by                   uuid references users(id),
  changed_at                   timestamptz not null default now()
);

-- The row itself, so every read is a `select` rather than a `select` plus an
-- upsert. `on conflict do nothing` makes re-running this migration against a
-- database that already has it a no-op.
insert into system_settings (id) values (true) on conflict do nothing;

-- No RLS policy, deliberately, and the same treatment `sessions` gets: this
-- table belongs to no shelf, so a `<table>_tenant` policy keyed on
-- `olibra.bookshelf_id` has nothing to compare. Access is decided by grants
-- instead — which is the stronger of the two here, because absent is the
-- default for a grant and open is the default for a table with no policy.
--
-- Grants are not inherited from 0010_rls.sql: `grant all on all tables` applied
-- to the tables that existed then, so a new table has no privileges for any
-- role until a migration says so.
--
-- `olibra_app` gets **select and nothing else**. A manager's settings screen
-- shows the contact block, and no shelf-scoped command may write a fact about
-- the whole deployment; `UpdateSystemDefaults` and `UpdateSiteContact` run
-- through `runAdminCommand`, as `olibra_admin`.
grant select on system_settings to olibra_app;
grant all    on system_settings to olibra_admin;

-- `olibra_public` gets the three contact columns and nothing else. OPS §3.1
-- lists `GetSiteContact` as **guest-callable and Global**, and
-- `runPublicQuery`'s docstring names it as the exact read that would have
-- reached `users` under the old, policy-based reasoning. Column-level, so a
-- later column on this table is unreachable to a stranger by default rather
-- than by somebody remembering to exclude it.
grant select (contact_name, contact_phone, contact_hours)
  on system_settings to olibra_public;
