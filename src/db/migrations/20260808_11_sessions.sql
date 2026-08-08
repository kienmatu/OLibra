-- Database-backed sessions. See the note in the S3 plan for why not
-- in-process and not stateless cookies — the short version is that BR §2's
-- manager-sets-credentials power is only safe if sessions can be revoked, and
-- a signed cookie cannot be.
create table sessions (
  -- The token is stored hashed. A leaked database backup should not be a
  -- stack of usable sessions, for the same reason passwords are not stored
  -- in plaintext.
  token_hash   text        primary key,
  user_id      uuid        not null references users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  -- BR §5.4's context fields for AuditLog ("address, device, screen")
  -- borrowed for the same purpose here, so "who signed in from where" is
  -- answerable without a second store.
  user_agent   text,
  ip_address   inet
);

create index sessions_by_user on sessions (user_id);
-- Expiry is compared against now() at read time (G5). This index is for the
-- housekeeping sweep that deletes dead rows, which is tidying rather than
-- correctness: an expired session is already unusable without it.
create index sessions_expiry on sessions (expires_at);

-- Sessions are global, not shelf-scoped: a person's identity works across
-- every bookshelf (BR §5.1), and it is the *membership* that is scoped.
-- No RLS policy here, deliberately — the same treatment DATABASE.md §3's
-- "Global tables" gives `users` and `categories`: "not shelf-scoped and
-- carry no policy at all."
--
-- Grants are not inherited from 0010_rls.sql. `grant select, insert, update
-- on all tables in schema public to olibra_app` (0010_rls.sql) only ever
-- ran against the tables that existed at that point in the migration
-- sequence — every table created since (this one included) starts with no
-- privileges for either role until a migration grants them explicitly, the
-- same way `bookshelves`' missing `insert` grant turned out to need its own
-- migration rather than being covered retroactively
-- (20260808_08_revoke_bookshelves_insert_from_app.sql tells that story from
-- the opposite direction — a grant that *did* carry over and should not
-- have). Without the two lines below, every function in Task 3 starts
-- failing the moment the connection pool stops being a superuser (Task 4)
-- with a bare `permission denied for table sessions` (42501), not a named
-- domain error.
grant select, insert, delete on sessions to olibra_app;
grant all on sessions to olibra_admin;
