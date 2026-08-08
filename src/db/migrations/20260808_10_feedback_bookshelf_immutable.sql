-- CRITICAL 1 (20260808_01_feedback_rls.sql) gave `feedback` a `feedback_tenant`
-- policy that lets a null `bookshelf_id` row through symmetrically in both
-- `using` and `with check`, so it is visible from any shelf session — a
-- deliberate choice, documented in DATABASE.md §3, because a null row is a
-- genuinely site-wide message rather than restricted system data the way
-- `audit_log`'s null rows are.
--
-- The re-review found the write side looser than intended. Because the
-- `with check` is symmetric, an `olibra_app` session scoped to any shelf
-- could, before this migration, run either of these against `feedback` and
-- succeed:
--
--   update feedback set bookshelf_id = <own shelf>  where bookshelf_id is null;
--   update feedback set bookshelf_id = null         where bookshelf_id = <own shelf>;
--
-- Both reproduced live. The first re-assigns a site-wide message onto the
-- session's own shelf, removing it from every other shelf's view — one-way
-- and unlogged, with nothing to undo it. The second pushes one of the
-- shelf's own rows to null, exposing that guest's name and phone number to
-- every other shelf that can now see it as "site-wide". Cross-shelf
-- reassignment to a *third* shelf's id was never possible — the existing
-- `with check` already requires the new `bookshelf_id` to equal the
-- session's own shelf or be null — only the null <-> shelf transitions were
-- open.
--
-- The call made here: a site-wide message is addressed to whoever manages
-- the site, not to any one shelf, so a shelf reading it is defensible (kept,
-- unchanged) and a shelf marking it read/resolved is also kept — feedback
-- is already a shared inbox once it is visible to every shelf, and BR §13's
-- "resolve feedback" manager permission naturally extends to whatever a
-- manager can see. What is not defensible is *changing who a message is
-- addressed to* from an ordinary shelf session — that is a routing decision,
-- not a triage action, and one shelf silently taking a message away from
-- every other shelf (or exposing a guest's contact details shelf-wide) is
-- exactly the kind of one-way, unlogged mutation this review flags.
--
-- So `bookshelf_id` becomes immutable after a feedback row is created, for
-- every role — the same shape `forbid_slug_change()` already gives
-- `bookshelves.slug` (20260808_02_bookshelf_slug_immutable.sql). A trigger
-- rather than a narrower RLS `with check`, because a trigger fires
-- regardless of role: `olibra_admin`'s `bypassrls` skips row-level security
-- policies but never triggers, so this guarantee holds even for the
-- deliberate cross-shelf admin path, not only for `olibra_app`. Every other
-- column — status, handled_by, handled_at — is untouched by this trigger
-- and stays freely updatable under the existing policy.
create or replace function forbid_feedback_reassignment() returns trigger as $$
begin
  if new.bookshelf_id is distinct from old.bookshelf_id then
    raise exception 'feedback bookshelf_id is immutable once created';
  end if;
  return new;
end $$ language plpgsql;

create trigger feedback_no_reassignment
  before update on feedback
  for each row execute function forbid_feedback_reassignment();
