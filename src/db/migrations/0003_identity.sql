-- DATABASE.md §4.1 (identity and membership) and §4.2 (the shelf).
--
-- Table order here departs from the document's own section order.
-- DATABASE.md's prose runs users -> parish_units -> memberships (§4.1) with
-- bookshelves not appearing until §4.2, but parish_units.bookshelf_id and
-- memberships.bookshelf_id both reference bookshelves, and bookshelves
-- itself references users (created_by). So: users, then bookshelves, then
-- parish_units, then memberships — every forward reference resolved before
-- it is needed, in one transaction.

create table users (
  id              uuid primary key default gen_random_uuid(),
  username        text,                    -- optional; see the note below
  password_hash   text,
  saint_name      text,                    -- tên thánh
  full_name       text not null,
  date_of_birth   date,
  father_name     text not null,
  mother_name     text not null,
  phone           text,
  email           text,                    -- optional; §4 assumption 2, no outbound email in v1
  display_name    text,
  locale          text not null default 'vi',
  avatar_url      text,
  is_super_admin  boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create unique index users_username_key on users (lower(username))
  where deleted_at is null and username is not null;

-- INV-14: a person may have neither a username nor a password (most readers
-- are children who never sign in, §1.3) but never only one of the two.
alter table users add constraint users_credentials_paired
  check ((username is null) = (password_hash is null));

create type bookshelf_status as enum ('active', 'archived');

create table bookshelves (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  description   text,
  location      text,                      -- physical location, shown publicly
  address       text,
  keeper_name   text,
  keeper_phone  text,                      -- shown publicly, tappable
  opening_hours text,                      -- free text: "Mở sau lễ Chúa nhật · 9:00 đến 11:00"
  cover_url     text,
  timezone      text not null default 'Asia/Ho_Chi_Minh',
  locale        text not null default 'vi',
  status        bookshelf_status not null default 'active',
  settings      jsonb not null default '{}'::jsonb,
  established_on date,
  created_by    uuid references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create table parish_units (
  id            uuid primary key default gen_random_uuid(),
  bookshelf_id  uuid not null references bookshelves(id) on delete restrict,
  level         smallint not null check (level in (1, 2)),
  parent_id     uuid references parish_units(id),
  name          text not null,
  sort_order    int  not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  constraint parish_units_l1_has_no_parent
    check (level = 2 or parent_id is null),
  constraint parish_units_name_unique_in_scope
    unique nulls not distinct (bookshelf_id, level, parent_id, name)
);

create type membership_role   as enum ('reader', 'manager', 'admin');
create type membership_status as enum ('pending', 'active', 'suspended', 'left', 'rejected');

create table memberships (
  id                uuid primary key default gen_random_uuid(),
  bookshelf_id      uuid not null references bookshelves(id) on delete restrict,
  user_id           uuid not null references users(id)       on delete restrict,
  role              membership_role   not null default 'reader',
  status            membership_status not null default 'pending',

  -- parish facts: true of this person *here*, not everywhere. References, not
  -- free text (BR §5.3, §5.6) — both nullable, always, not merely until the
  -- shelf finishes configuring its units.
  parish_unit_l1_id uuid references parish_units(id),
  parish_unit_l2_id uuid references parish_units(id),

  approved_by       uuid references users(id),
  approved_at       timestamptz,
  rejection_reason  text,
  suspension_reason text,
  manager_notes     text,                  -- private to managers
  leaderboard_opt_in boolean not null default true,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,

  constraint memberships_one_per_shelf unique (bookshelf_id, user_id),
  constraint memberships_rejected_has_reason
    check (status <> 'rejected' or rejection_reason is not null)
);
