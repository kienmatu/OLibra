-- DATABASE.md §4.3 (categories), §4.4 (books and copies).
--
-- Categories are global reference data, not tenant data (§4.3) — no
-- bookshelf_id, no RLS policy. Seeding the fixed list is Task 7's job
-- (src/db/seed.ts), not this migration's: a row inserted by a migration
-- would be wiped by every test's resetDatabase() and never come back, since
-- an already-applied migration is never re-run.
--
-- books.title_folded / author_folded are GENERATED columns over
-- olibra_fold() (§5), defined directly in the create table rather than as
-- plain columns a trigger maintains, or as the separate `alter table ...
-- add column` §5 shows — folding this way requires olibra_fold to be
-- IMMUTABLE, which Task 2 made it. author is nullable, so author_folded
-- folds coalesce(author, '') rather than author directly, to keep the
-- not-null promise §4.4 makes for it (a generated column cannot carry a
-- literal `default ''` the way §4.4's plain-column version did).

create table categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table books (
  id             uuid primary key default gen_random_uuid(),
  bookshelf_id   uuid not null references bookshelves(id) on delete restrict,
  category_id    uuid references categories(id) on delete set null,
  title          text not null,
  title_folded   text not null generated always as (olibra_fold(title)) stored,
  slug           text not null,
  author         text,
  author_folded  text not null generated always as (olibra_fold(coalesce(author, ''))) stored,
  publisher      text,
  published_year integer,
  isbn           text,
  page_count     integer,
  description    text,
  cover_url      text,
  language       text not null default 'vi',
  is_published   boolean not null default true,   -- hides drafts from the public
  added_by       uuid references users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (bookshelf_id, slug)
);

create type copy_state     as enum ('available', 'held', 'on_loan', 'lost', 'retired');
create type copy_condition as enum
  ('perfect', 'slightly_worn', 'worn', 'torn', 'missing_pages', 'written_on');

create table book_copies (
  id              uuid primary key default gen_random_uuid(),
  bookshelf_id    uuid not null references bookshelves(id) on delete restrict,
  book_id         uuid not null references books(id)       on delete cascade,
  code            text not null,             -- 'DT-0142', intended to become a QR label
  state           copy_state not null default 'available',
  condition       copy_condition not null default 'perfect',
  condition_note  text,
  acquired_on     date,
  acquired_from   text,
  acquired_from_membership_id uuid references memberships(id),  -- donor with an account; nullable, see below
  retired_at      timestamptz,
  retired_reason  text,
  lost_reported_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,

  constraint book_copies_code_unique unique (bookshelf_id, code),
  constraint book_copies_retired_has_reason
    check (state <> 'retired' or retired_reason is not null)
);
