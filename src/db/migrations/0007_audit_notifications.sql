-- DATABASE.md §4.9 (notifications), §4.10 (audit log).
--
-- The append-only grant revoke that backs INV-12, and Row Level Security
-- generally, are out of scope here: they belong to the RLS task, since the
-- revoke targets an application role this migration set does not create.

create table notifications (
  id           uuid primary key default gen_random_uuid(),
  bookshelf_id uuid not null references bookshelves(id) on delete restrict,
  user_id      uuid not null references users(id)       on delete restrict,
  kind         text not null,                 -- 'loan_due_soon', 'request_approved', …
  payload      jsonb not null default '{}'::jsonb,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index notifications_unread on notifications (user_id, created_at desc)
  where read_at is null;

-- INV-12 / G10: audit_log is append-only. No updated_at, no deleted_at —
-- there is nothing here that is ever changed after being written.
create table audit_log (
  id           bigint generated always as identity primary key,
  bookshelf_id uuid references bookshelves(id),   -- null for global actions
  actor_id     uuid references users(id),         -- null for system actions
  action       text not null,                     -- 'loan.lent', 'membership.approved', …
  entity_type  text not null,
  entity_id    uuid,
  before       jsonb,
  after        jsonb,
  context      jsonb not null default '{}'::jsonb, -- address, device, screen
  occurred_at  timestamptz not null default now()
);

create index audit_log_actor  on audit_log (actor_id, occurred_at desc);
create index audit_log_shelf  on audit_log (bookshelf_id, occurred_at desc);
create index audit_log_entity on audit_log (entity_type, entity_id, occurred_at desc);
