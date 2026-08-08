-- DATABASE.md §4.8 (community: comments, announcements, feedback, book
-- donations). book_donations joins this file rather than getting its own:
-- DATABASE.md documents it alongside comments/announcements/feedback, and
-- its foreign keys — bookshelves and memberships — are already satisfied by
-- 0003_identity.sql.

create type comment_status as enum ('pending', 'approved', 'rejected', 'hidden');

create table comments (
  id            uuid primary key default gen_random_uuid(),
  bookshelf_id  uuid not null references bookshelves(id) on delete restrict,
  book_id       uuid not null references books(id)       on delete cascade,
  author_id     uuid not null references users(id)       on delete restrict,
  body          text not null,                -- plain text; rendered escaped
  status        comment_status not null default 'pending',
  moderated_by  uuid references users(id),
  moderated_at  timestamptz,
  moderation_note text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- INV-9: a comment is publicly visible only when approved — the partial
-- index encodes that in the access path itself.
create index comments_public on comments (book_id, created_at desc)
  where status = 'approved' and deleted_at is null;

create table announcements (
  id            uuid primary key default gen_random_uuid(),
  bookshelf_id  uuid not null references bookshelves(id) on delete restrict,
  title         text not null,
  slug          text not null,
  body          text not null,               -- rich
  body_text     text not null,               -- plain derivation, for excerpts and search
  is_pinned     boolean not null default false,
  published_at  timestamptz,                 -- null means draft
  expires_at    timestamptz,
  author_id     uuid references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (bookshelf_id, slug)
);

create type feedback_status as enum ('new', 'read', 'resolved');

create table feedback (
  id            uuid primary key default gen_random_uuid(),
  bookshelf_id  uuid references bookshelves(id),   -- null for site-wide
  member_id     uuid references users(id),
  guest_name    text,
  guest_contact text,
  guest_hash    text,                              -- rate limiting
  subject       text not null,
  body          text not null,
  status        feedback_status not null default 'new',
  handled_by    uuid references users(id),
  handled_at    timestamptz,
  created_at    timestamptz not null default now()
);

create type donation_status as enum ('pending', 'received', 'declined');

create table book_donations (
  id                   uuid primary key default gen_random_uuid(),
  bookshelf_id         uuid not null references bookshelves(id) on delete restrict,
  donor_membership_id  uuid not null references memberships(id) on delete restrict,

  description     text not null,             -- free text; a child does not know an ISBN
  photo_url       text,
  estimated_count integer,

  status          donation_status not null default 'pending',

  decided_by      uuid references users(id),
  decided_at      timestamptz,
  decision_note   text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint book_donations_declined_has_reason
    check (status <> 'declined' or decision_note is not null)
);

create index book_donations_queue on book_donations (bookshelf_id, created_at)
  where status = 'pending';
