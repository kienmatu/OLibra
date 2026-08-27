-- docs/DATABASE.md §4.2 documents `forbid_slug_change()` and states
-- "`slug` is immutable after creation (§16.4) because it appears in links
-- people have already shared", but no migration ever created the function
-- or attached it as a trigger — confirmed live: `update bookshelves set
-- slug = ...` returned `UPDATE 1`. BR §16.4's stated reason is that the
-- slug is already out in the world by the time anyone would want to change
-- it: printed QR labels on the shelf, a link dropped in a parish Zalo
-- group. A silent rename 404s every one of those with nothing telling
-- anyone why.
create or replace function forbid_slug_change() returns trigger as $$
begin
  if new.slug is distinct from old.slug then
    raise exception 'bookshelf slug is immutable once created';
  end if;
  return new;
end $$ language plpgsql;

create trigger bookshelves_no_slug_change
  before update on bookshelves
  for each row execute function forbid_slug_change();
