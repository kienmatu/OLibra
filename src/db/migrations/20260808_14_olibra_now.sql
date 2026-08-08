-- The clock the derived-state views read, as an injectable session setting.
--
-- DATABASE.md §6's two views compute overdue status, hold expiry and
-- availability on read, against the current clock — deliberately, and that
-- rule is not what changes here. What changes is *whose* clock. Until this
-- migration both views called SQL `now()` directly, so the clock the domain
-- already treats as an injected dependency (`src/domain/kernel/clock.ts`:
-- "every one of those rules is only testable if the clock can be moved")
-- could not be moved in SQL at all. A test holding a `fixedClock` could not
-- make `is_overdue` true, and could not make a hold expire, without waiting
-- real wall-clock time. `docs/superpowers/plans/2026-08-08-b2-members.md`
-- recorded that as a known gap (its Known gaps #14) and B2a worked around it
-- by moving `due_on` instead of the clock. This closes it.
--
-- The mechanism is the tenant one, unchanged in shape. `0010_rls.sql`'s
-- policies read `nullif(current_setting('olibra.bookshelf_id', true), '')`
-- and `unit-of-work.ts` sets that GUC transaction-locally at the top of
-- every command and every scoped query. `olibra.now` is set on the same
-- line, read back the same way, and inherits the same properties — above
-- all that `set_config(..., true)` is LOCAL, so one request's clock cannot
-- leak into the next request on the same pooled connection.
--
-- Three details, each of which is wrong in an obvious-looking alternative:
--
-- 1. `current_setting(name, true)` — the `true` is `missing_ok`. Without it,
--    a session that has never set `olibra.now` raises `unrecognized
--    configuration parameter` rather than returning null, which would break
--    every `psql` session, every migration, and every connection that never
--    went through the kernel. With it, an unset GUC is null and `coalesce`
--    falls back to `now()`.
--
-- 2. `nullif(..., '')` on top of that is not redundant with the `missing_ok`.
--    DATABASE.md §3 spells out the trap for `olibra.bookshelf_id` and it is
--    the same trap here: once *any* transaction on a connection has
--    `set_config`'d a GUC locally, it does not go back to unset when that
--    transaction ends — it reverts to the **empty string**. `''::timestamptz`
--    does not return null, it raises `invalid input syntax for type
--    timestamp with time zone: ""`. On a pooled connection that is not a
--    corner case, it is every second and subsequent transaction. `nullif`
--    turns the empty string back into null before the cast, so the fallback
--    to `now()` is reached instead of an error.
--
-- 3. STABLE, and it must not be IMMUTABLE. Both of the built-ins this is
--    built from are STABLE and PARALLEL SAFE in this cluster (verified with
--    `select provolatile, proparallel from pg_proc` on PostgreSQL 16.10:
--    `now` is `s`/`s`, `current_setting(text, boolean)` is `s`/`s`), so
--    STABLE is the strongest correct marking and PARALLEL SAFE carries over.
--    IMMUTABLE would be a lie that the planner acts on: it is licensed to
--    fold an immutable call on constant arguments to a constant at plan
--    time, which for a cached or reused plan means a clock frozen at
--    whenever the plan was built — the exact failure this migration exists
--    to prevent, reintroduced silently and only under load.
--
--    Contrast `olibra_fold` in `0002_folding.sql`, which genuinely is
--    IMMUTABLE and has to be: it feeds a generated column, and Postgres
--    refuses a STABLE function there. The two functions look alike and their
--    volatility markings are opposite for reasons that belong to each.
create or replace function olibra_now()
returns timestamptz
language sql
stable
parallel safe
as $$
  select coalesce(
    nullif(current_setting('olibra.now', true), '')::timestamptz,
    now()
  )
$$;

comment on function olibra_now() is
  'The current instant, or the instant injected into olibra.now for this '
  'transaction. STABLE, never IMMUTABLE — see 20260808_14_olibra_now.sql.';

-- Both views, recreated to read `olibra_now()` in all three places: two in
-- `loans_current` (`is_overdue` and `days_remaining`) and one in
-- `copies_borrowable` (the hold-expiry check).
--
-- `create or replace view`, not a drop-and-create, and not an edit to
-- `0011_views.sql` — the precedent is `20260808_05_copies_borrowable_
-- deleted_at.sql`, which corrected the same `copies_borrowable` the same
-- way: the column list and the `security_invoker` reloption are unchanged,
-- only the expressions, and DATABASE.md §9's "never edit a migration that
-- has run" is about migration *files*, not about database objects a later
-- migration is free to redefine.
--
-- `with (security_invoker = true)` is restated on both, deliberately, and
-- carries the whole of `0011_views.sql`'s reason for it: PostgreSQL's
-- default is that a view evaluates row security as its *owner*, and these
-- migrations run as a `bypassrls` superuser, so a view created without the
-- clause hands that bypass to every caller — verified live on this
-- project's test database, where `olibra_app` scoped to one shelf saw every
-- shelf's loans through such a view while the rest of the suite stayed
-- green. `security_invoker = true` makes each view apply the *invoking*
-- role's tenant policy (INV-10), which is what the two INV-10 tests in
-- `tests/db/derived-state.test.ts` assert. Losing it here would reopen that
-- hole as a side effect of a change about time.
create or replace view loans_current
  with (security_invoker = true)
as
select
  l.*,
  (l.status = 'active'
   and l.due_on < (olibra_now() at time zone 'Asia/Ho_Chi_Minh')::date) as is_overdue,
  (l.due_on - (olibra_now() at time zone 'Asia/Ho_Chi_Minh')::date)     as days_remaining
from loans l;

-- `at time zone 'Asia/Ho_Chi_Minh'` stays exactly where it was, on both
-- lines. DATABASE.md §2.2: `due_on` is a `date`, so the comparison has to be
-- made in the application timezone or a loan turns overdue seven hours early
-- every evening. Injecting the clock does not make that conversion
-- unnecessary — it makes it testable, which is what the boundary cases in
-- `tests/db/sql-clock.test.ts` now pin.
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
      and r.hold_expires_at > olibra_now()
      and r.deleted_at is null
  );
