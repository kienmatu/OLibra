-- 0011_views.sql's `copies_borrowable` checks `book_copies.deleted_at is
-- null` (the line right above) but not `borrow_requests.deleted_at` on the
-- hold it joins against, so a soft-deleted *approved* request keeps
-- blocking the copy it held forever — with nothing in the UI able to
-- explain why, since the request that's doing the blocking is invisible
-- everywhere else a soft-deleted row is filtered out. Same treatment
-- `book_copies` already gets one line above: exclude soft-deleted rows from
-- the check.
--
-- `create or replace view` rather than a new view: the shape (columns,
-- security_invoker) is unchanged, only the predicate — and DATABASE.md §9's
-- "never edit a migration that has run" is about migration *files*, not
-- about database objects a later migration is free to redefine.
create or replace view copies_borrowable
  with (security_invoker = true)
as
select c.*
from book_copies c
where c.state = 'available'
  and c.deleted_at is null
  and not exists (
    select 1 from borrow_requests r
    where r.copy_id = c.id
      and r.status = 'approved'
      and r.hold_expires_at > now()
      and r.deleted_at is null
  );
