-- DATABASE.md §4.5 (loans), §4.6 (requests and holds), §4.7 (condition
-- assessments).
--
-- loans and borrow_requests reference each other: loans.request_id ->
-- borrow_requests(id), and borrow_requests.fulfilled_loan_id -> loans(id).
-- Neither table can be created first with both foreign keys inline, so
-- loans.request_id is added as a plain column here and given its foreign
-- key afterwards, once borrow_requests exists — the same kind of forward
-- reference 0003_identity.sql resolves by reordering, except here the cycle
-- means one direction has to be a follow-up `alter table` rather than a
-- reordering.

create type loan_status as enum ('active', 'returned', 'lost', 'voided');

create table loans (
  id                uuid primary key default gen_random_uuid(),
  bookshelf_id      uuid not null references bookshelves(id) on delete restrict,
  copy_id           uuid not null references book_copies(id) on delete restrict,
  book_id           uuid not null references books(id)       on delete restrict,
  borrower_id       uuid not null references users(id)       on delete restrict,
  request_id        uuid,                    -- fk added below, once borrow_requests exists

  lent_by           uuid not null references users(id),
  lent_at           timestamptz not null default now(),
  due_on            date not null,

  status            loan_status not null default 'active',

  returned_at       timestamptz,
  received_by       uuid references users(id),
  return_condition  copy_condition,
  return_note       text,
  return_photo_url  text,

  renewals_used     integer not null default 0,

  lost_reported_at  timestamptz,
  lost_reported_by  uuid references users(id),

  voided_at         timestamptz,
  voided_by         uuid references users(id),
  void_reason       text,

  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint loans_voided_has_reason
    check (status <> 'voided' or void_reason is not null),
  constraint loans_returned_has_condition
    check (status <> 'returned' or return_condition is not null)
);

create type request_status as enum
  ('pending', 'approved', 'rejected', 'fulfilled', 'expired', 'cancelled');

create table borrow_requests (
  id               uuid primary key default gen_random_uuid(),
  bookshelf_id     uuid not null references bookshelves(id) on delete restrict,
  book_id          uuid not null references books(id)       on delete cascade,
  copy_id          uuid references book_copies(id),          -- assigned on approval

  member_id        uuid not null references users(id),

  status           request_status not null default 'pending',
  requested_at     timestamptz not null default now(),       -- the queue ordering key

  decided_by       uuid references users(id),
  decided_at       timestamptz,
  decision_note    text,
  hold_expires_at  timestamptz,

  fulfilled_loan_id uuid references loans(id),
  cancelled_at     timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

alter table loans
  add constraint loans_request_id_fkey
    foreign key (request_id) references borrow_requests(id);

create table condition_assessments (
  id           uuid primary key default gen_random_uuid(),
  bookshelf_id uuid not null references bookshelves(id) on delete restrict,
  copy_id      uuid not null references book_copies(id) on delete restrict,
  loan_id      uuid references loans(id),                  -- null if assessed outside a return
  assessed_by  uuid not null references users(id),
  condition    copy_condition not null,
  note         text,
  photo_url    text,
  assessed_at  timestamptz not null default now()
);
