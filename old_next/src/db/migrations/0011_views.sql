-- DATABASE.md §6, derived state. BR §8 is explicit and this migration exists
-- solely to encode it: overdue status, hold expiry and availability are
-- computed on read, from stored data and the current clock. Nothing here is
-- ever written by a scheduled job — there is no `is_overdue` column on
-- `loans` and there must never be one (DATABASE.md §4.5).
--
-- security_invoker = true on both views, deliberately, not the PostgreSQL
-- default. These migrations run as the table-owning role (superuser in this
-- project's setup), and by default a view executes with the *owner's*
-- privileges for permission and row-level-security purposes, not the
-- querying role's — the same mechanism a SECURITY DEFINER function uses.
-- Confirmed directly against this project's test database: a view created
-- without `security_invoker` and queried by `olibra_app` scoped to one
-- shelf still returned every shelf's rows, because RLS was evaluated as the
-- superuser owner rather than as `olibra_app`. `security_invoker = true`
-- makes each view apply the tenant policy of the invoking role, so
-- `olibra_app` gets exactly what §3's `<table>_tenant` policies promise
-- (INV-10) and `olibra_admin` still bypasses deliberately via `bypassrls`.
-- Without it these views would be the one silent hole in an otherwise
-- structural guarantee.

create view loans_current
  with (security_invoker = true)
as
select
  l.*,
  (l.status = 'active'
   and l.due_on < (now() at time zone 'Asia/Ho_Chi_Minh')::date) as is_overdue,
  (l.due_on - (now() at time zone 'Asia/Ho_Chi_Minh')::date)     as days_remaining
from loans l;

create view copies_borrowable
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
  );

grant select on loans_current, copies_borrowable to olibra_app, olibra_admin;
