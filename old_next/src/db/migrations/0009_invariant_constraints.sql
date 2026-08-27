-- Structural invariants (BR §6, DATABASE.md §7) that are not yet backed by a
-- real constraint. Several of the fourteen already are, shipped alongside
-- the tables they govern rather than deferred here:
--
--   INV-9  comments_public              partial index    0006_community.sql
--   INV-13 (first half) profile_change_requests_one_pending
--                                        partial index    0008_profile_changes.sql
--   INV-14 users_credentials_paired     check constraint 0003_identity.sql
--
-- and parish_units_name_unique_in_scope / parish_units_l1_has_no_parent
-- (§4.1, carried across from the parish-taxonomy slice) likewise already
-- exist. This migration adds the ones that do not: INV-1, INV-11, INV-12.

-- INV-1. A partial unique index is the whole mechanism. The second
-- transaction to commit fails with 23505, which the application translates
-- into "Bản sách này vừa được mượn" (BR §2: one of them "must fail cleanly
-- and see a plain message, never a silently corrupted record").
--
-- Partial, not plain: a plain unique index on copy_id would make a copy
-- unlendable forever after its first return.
create unique index loans_one_active_per_copy
  on loans (copy_id)
  where status = 'active';

-- INV-11 and INV-12. Loans are voided, never deleted; audit records are
-- append-only.
--
-- DATABASE.md §7 documents these as `revoke`, and the revokes below match
-- that — they matter once Task 5 introduces a non-superuser application
-- role, and they cost nothing to have in place now. But `revoke` alone
-- would be exactly the kind of constraint G12 warns about: every role this
-- project's migrations run under so far (see docker compose's
-- POSTGRES_USER, and tests/support/db.ts's connection) is a Postgres
-- superuser, and superusers — along with a table's own owner — bypass
-- GRANT/REVOKE entirely. A `revoke` checked in without ever being exercised
-- against the role that actually runs migrations would read as enforcement
-- and enforce nothing against the one role most likely to run a hurried
-- `DELETE` by hand. A trigger has no such escape hatch: it fires for every
-- role, ownership and superuser status included, so it is the mechanism
-- these tests actually exercise. errcode 42501 (insufficient_privilege)
-- keeps the error shape the same as the documented `revoke` design, so
-- application error-handling written against that design still matches.
revoke delete on loans from public;
revoke update, delete on audit_log from public;

create function forbid_row_mutation() returns trigger as $$
begin
  raise exception 'rows in % cannot be %d directly', tg_table_name, lower(tg_op)
    using errcode = '42501';
end;
$$ language plpgsql;

create trigger loans_no_delete
  before delete on loans
  for each row execute function forbid_row_mutation();

create trigger audit_log_no_update
  before update on audit_log
  for each row execute function forbid_row_mutation();

create trigger audit_log_no_delete
  before delete on audit_log
  for each row execute function forbid_row_mutation();
