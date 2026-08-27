-- DATABASE.md §4.11 (profile change requests).

create type profile_change_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table profile_change_requests (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id)       on delete restrict,
  bookshelf_id      uuid not null references bookshelves(id) on delete restrict,  -- whose manager decides

  proposed_values   jsonb not null,          -- the fields being changed, and their proposed values
  previous_values   jsonb not null,          -- the same fields, as they stood when this was proposed

  status            profile_change_status not null default 'pending',
  requested_at      timestamptz not null default now(),

  decided_by        uuid references users(id),
  decided_at        timestamptz,
  rejection_reason  text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint profile_change_requests_rejected_has_reason
    check (status <> 'rejected' or rejection_reason is not null)
);

create unique index profile_change_requests_one_pending
  on profile_change_requests (user_id)
  where status = 'pending';
