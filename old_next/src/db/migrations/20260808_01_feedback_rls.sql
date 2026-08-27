-- Closes the tenant-isolation gap on `feedback` (docs/DATABASE.md §3,
-- corrected alongside this migration).
--
-- 0010_rls.sql's loop skipped `feedback` on the strength of a sentence in
-- DATABASE.md §3 — "users, categories and site-wide feedback are not
-- shelf-scoped and carry no policy" — read as covering the whole table. It
-- does not: `feedback.bookshelf_id` is nullable (0006_community.sql), and a
-- row with a non-null value is exactly as much tenant data as any other
-- shelf-scoped row. Demonstrated live: `olibra_app` scoped to shelf A could
-- read shelf B's guest names and phone numbers off `feedback` and run
-- `update feedback set status='resolved'` against shelf B's row. BR §13
-- makes "view feedback / resolve feedback" a per-shelf manager permission,
-- so that is a real cross-tenant leak and mutation, not a cosmetic gap.
--
-- The policy shape matches every other tenant table (see 0010_rls.sql), with
-- one deliberate difference: a null `bookshelf_id` is let through rather
-- than hidden the way audit_log's null rows are. audit_log's null means
-- "system action, restricted to olibra_admin" (BR §13.2); feedback's null
-- means "sent through the contact page with no shelf selected" — genuinely
-- site-wide, meant to be visible (and insertable) from any session,
-- scoped or not. Folding the two together would have hidden legitimate
-- site-wide messages from every shelf's manager.
create policy feedback_tenant on feedback
  using (
    bookshelf_id = nullif(current_setting('olibra.bookshelf_id', true), '')::uuid
    or bookshelf_id is null
  )
  with check (
    bookshelf_id = nullif(current_setting('olibra.bookshelf_id', true), '')::uuid
    or bookshelf_id is null
  );

alter table feedback enable row level security;
-- force, matching every other table in 0010_rls.sql: the table owner
-- (migrations, admin scripts) is subject to the policy too, so a bypass
-- always goes through olibra_admin's bypassrls, deliberately.
alter table feedback force row level security;
