-- Product owner feedback, round one. Design:
-- docs/superpowers/specs/2026-08-12-po-feedback-design.md
--
-- Five changes, one file, because they are one product decision each and a
-- half-applied set would leave the application unable to render a shelf.

-- ── 1. Three contacts per shelf, replacing the single keeper ──────────────
--
-- `position` rather than a free `sort_order`: the product decision is one
-- mandatory contact and two optional ones, and a column constrained to 1..3
-- says so in the schema instead of leaving it to a form. Position 1 is the
-- mandatory one; that it *exists* is a domain rule, not a constraint, because
-- shelves onboarded before this migration may have no keeper at all and
-- inventing a volunteer for them is worse than an incomplete row.
create table bookshelf_contacts (
  id            uuid primary key default gen_random_uuid(),
  bookshelf_id  uuid not null references bookshelves(id) on delete restrict,
  position      smallint not null check (position between 1 and 3),
  name          text not null,
  phone         text,
  role_label    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- Soft-delete-aware, the shape 20260808_03 and _09 established for every
-- other uniqueness rule in this schema: a retired contact must not block the
-- position it used to hold.
create unique index bookshelf_contacts_position
  on bookshelf_contacts (bookshelf_id, position)
  where deleted_at is null;

create index bookshelf_contacts_by_shelf
  on bookshelf_contacts (bookshelf_id)
  where deleted_at is null;

-- The same tenant policy 0010_rls.sql applies to every shelf-scoped table.
-- `force`, so the table owner is subject to it too. `nullif(..., '')` because
-- a GUC set with `set_config(..., true)` reverts to '' rather than NULL once
-- its transaction ends — 0010_rls.sql carries the full account.
alter table bookshelf_contacts enable row level security;
alter table bookshelf_contacts force row level security;

create policy bookshelf_contacts_tenant on bookshelf_contacts
  using (bookshelf_id = nullif(current_setting('olibra.bookshelf_id', true), '')::uuid)
  with check (bookshelf_id = nullif(current_setting('olibra.bookshelf_id', true), '')::uuid);

grant select, insert, update on bookshelf_contacts to olibra_app;
grant all on bookshelf_contacts to olibra_admin;

-- **No grant to olibra_public.** BR §16.1: "a person with no membership has
-- no business knowing them." The portal and the two auth screens run as
-- olibra_public, and a role with no privilege fails closed with 42501 rather
-- than relying on a policy somebody remembers to write —
-- 20260809_01_public_role.sql is where that argument was made and won.

create trigger bookshelf_contacts_set_updated_at
  before update on bookshelf_contacts
  for each row execute function set_updated_at();

-- The keeper becomes contact 1. A shelf with no keeper name gets no row and
-- is flagged as incomplete in /quan-tri/tu-sach instead.
insert into bookshelf_contacts (bookshelf_id, position, name, phone, role_label)
select id, 1, keeper_name, keeper_phone, 'Người giữ chìa khoá'
  from bookshelves
 where keeper_name is not null and keeper_name <> '' and deleted_at is null;

alter table bookshelves drop column keeper_name;
alter table bookshelves drop column keeper_phone;

-- ── 2. Opening hours are gone ─────────────────────────────────────────────
alter table bookshelves drop column opening_hours;

-- ── 3. The leaderboard shows everyone ─────────────────────────────────────
alter table memberships drop column leaderboard_opt_in;

-- ── 4. Saint name is required ─────────────────────────────────────────────
--
-- No backfill: the development database is dropped and reseeded, and writing
-- a placeholder saint name into a real parish register is the outcome that
-- decision exists to avoid.
alter table users alter column saint_name set not null;

-- ── 5. Why a phone is missing, when one is ────────────────────────────────
--
-- `phone` stays nullable — some readers are children with no phone, and a
-- placeholder number is a tap that dials a stranger. The interface requires
-- one and takes a typed reason when it is left empty; this is where that
-- reason lives, so the next volunteer to open the record reads why instead of
-- assuming an oversight.
alter table users add column phone_missing_reason text;
