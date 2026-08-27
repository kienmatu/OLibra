-- DATABASE.md §2 claims, for every table: "created_at ... and updated_at
-- where the row is mutable". Nothing in the schema ever wrote to
-- `updated_at` after insert — it was set once by the column default and
-- never touched again, so the claim was a column, not a fact. A manager
-- looking at "last updated" on a book or a membership was looking at its
-- creation time no matter how many edits it had since had.
--
-- One trigger function, attached to every table that both is shelf-mutable
-- (i.e. rows are ever updated, not just inserted and read) and carries an
-- `updated_at` column: users, bookshelves, parish_units, memberships,
-- categories, books, book_copies, loans, borrow_requests, comments,
-- announcements, book_donations, profile_change_requests.
--
-- Excluded, deliberately: `condition_assessments`, `notifications`,
-- `audit_log` and `feedback` carry no `updated_at` column at all — each is
-- either a point-in-time record or, for audit_log, append-only by design
-- (INV-12).
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end $$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array[
    'users', 'bookshelves', 'parish_units', 'memberships', 'categories',
    'books', 'book_copies', 'loans', 'borrow_requests', 'comments',
    'announcements', 'book_donations', 'profile_change_requests'
  ]
  loop
    execute format(
      'create trigger %I_set_updated_at before update on %I
         for each row execute function set_updated_at()',
      t, t
    );
  end loop;
end $$;
