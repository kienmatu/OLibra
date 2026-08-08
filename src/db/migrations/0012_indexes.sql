-- DATABASE.md §8. Every index beyond the primary keys, unique constraints
-- and partial indexes already shipped alongside their tables (INV-1's
-- loans_one_active_per_copy in 0009, comments_public in 0006,
-- profile_change_requests_one_pending in 0008, book_donations_queue in
-- 0006, users_username_key / books unique / book_copies_code_unique in
-- their own creating migrations).
--
-- Categories' twelve-row seed (§4.3) is deliberately NOT here. 0004's own
-- comment already made that call for this branch — Task 7 owns it in
-- src/db/seed.ts — and the reason still holds: resetDatabase() (tests/
-- support/db.ts) truncates every table except schema_migrations before
-- each test, and a migration only ever runs once, so a row inserted here
-- would be destroyed by the first test run and never come back. A
-- migration file named "indexes" carrying seed data would also be a
-- surprise to the next person reading the migrations directory in order.

-- the manager's most frequent screens
create index loans_active_by_shelf on loans (bookshelf_id, due_on)
  where status = 'active';
create index loans_by_borrower     on loans (borrower_id, lent_at desc);
create index copies_by_book        on book_copies (book_id) where deleted_at is null;
create index copies_by_state       on book_copies (bookshelf_id, state)
  where deleted_at is null;

-- the queue, ordered by request time (§7.2)
create index requests_queue on borrow_requests (book_id, requested_at)
  where status = 'pending';
create index requests_holds on borrow_requests (hold_expires_at)
  where status = 'approved';

-- search (§5). pg_trgm is already created by 0001_extensions.sql.
create index books_title_folded  on books using gin (title_folded gin_trgm_ops);
create index books_author_folded on books using gin (author_folded gin_trgm_ops);

-- the public catalogue
create index books_public on books (bookshelf_id, title)
  where is_published and deleted_at is null;
