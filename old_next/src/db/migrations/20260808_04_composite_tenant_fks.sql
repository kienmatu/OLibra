-- Foreign keys that cross tenant boundaries (BR §6, DATABASE.md §3).
--
-- Demonstrated live: as `olibra_app` scoped to Đồng Tháp, inserting a
-- membership whose `parish_unit_l1_id` names a unit belonging to Cần Thơ
-- succeeded — a plain `references parish_units(id)` only checks that the id
-- exists *somewhere*, never that it exists on *this* shelf. Reading the row
-- back, from the same session, shows a parish line that resolves to null:
-- RLS (0010_rls.sql) hides the Cần Thơ row from a Đồng Tháp session, but
-- the foreign key is not null, so nothing on that shelf can read it,
-- correct it, or even tell it apart from a membership that was never
-- assigned a unit.
--
-- The fix is the standard one for this shape: every shelf-scoped parent
-- table gets a `unique (bookshelf_id, id)` alongside its primary key, and
-- every foreign key between two shelf-scoped tables becomes a composite
-- `(bookshelf_id, x_id) references parent(bookshelf_id, id)` instead of a
-- plain `x_id references parent(id)`. A row can then only reference a
-- parent on its own shelf — the foreign key itself enforces what RLS could
-- only ever hide.
--
-- This is the full set of foreign keys where BOTH sides are shelf-scoped
-- tables (DATABASE.md §3's fourteen: bookshelves itself and the thirteen
-- carrying bookshelf_id). Converted, table by table:
--
--   parish_units.parent_id            -> parish_units(id)     (self)
--   memberships.parish_unit_l1_id     -> parish_units(id)
--   memberships.parish_unit_l2_id     -> parish_units(id)
--   book_copies.book_id               -> books(id)
--   book_copies.acquired_from_membership_id -> memberships(id)
--   loans.copy_id                     -> book_copies(id)
--   loans.book_id                     -> books(id)
--   loans.request_id                  -> borrow_requests(id)
--   borrow_requests.book_id           -> books(id)
--   borrow_requests.copy_id           -> book_copies(id)
--   borrow_requests.fulfilled_loan_id -> loans(id)
--   condition_assessments.copy_id     -> book_copies(id)
--   condition_assessments.loan_id     -> loans(id)
--   comments.book_id                  -> books(id)
--   book_donations.donor_membership_id -> memberships(id)
--
-- Deliberately left alone: every foreign key that points at `users(id)` —
-- `borrower_id`, `lent_by`, `author_id`, `member_id`, and the rest — because
-- `users` is a global table (§3), not a shelf-scoped one; there is no
-- second shelf-scoped column to pair it with. `books.category_id ->
-- categories(id)` is the same case: categories is global reference data.
-- `*.bookshelf_id -> bookshelves(id)` itself is the scoping column, not a
-- reference this migration's shape applies to.
--
-- Nullable referencing columns (parent_id, parish_unit_l1_id,
-- parish_unit_l2_id, acquired_from_membership_id, request_id, copy_id on
-- borrow_requests, fulfilled_loan_id, loan_id on condition_assessments)
-- keep working exactly as before: Postgres's default MATCH SIMPLE means a
-- composite foreign key is satisfied whenever *any* of its columns is null,
-- so "no parent yet" / "no donor account" / etc. still needs nothing extra
-- to stay valid. `bookshelf_id` itself is never null on any of these
-- tables, so the only column that can carry the null is the original one.

-- ── Step 1: give every referenced shelf-scoped table a compound key that a
-- composite foreign key can point at. ──────────────────────────────────
alter table parish_units     add constraint parish_units_bookshelf_id_id_key     unique (bookshelf_id, id);
alter table books            add constraint books_bookshelf_id_id_key            unique (bookshelf_id, id);
alter table book_copies      add constraint book_copies_bookshelf_id_id_key      unique (bookshelf_id, id);
alter table memberships      add constraint memberships_bookshelf_id_id_key      unique (bookshelf_id, id);
alter table loans            add constraint loans_bookshelf_id_id_key            unique (bookshelf_id, id);
alter table borrow_requests  add constraint borrow_requests_bookshelf_id_id_key  unique (bookshelf_id, id);

-- ── Step 2: parish_units.parent_id (self-referencing) ──────────────────
alter table parish_units drop constraint parish_units_parent_id_fkey;
alter table parish_units
  add constraint parish_units_parent_id_fkey
    foreign key (bookshelf_id, parent_id) references parish_units (bookshelf_id, id);

-- ── Step 3: memberships.parish_unit_l1_id / l2_id — the exact bug the
-- reviewer demonstrated. ────────────────────────────────────────────────
alter table memberships drop constraint memberships_parish_unit_l1_id_fkey;
alter table memberships
  add constraint memberships_parish_unit_l1_id_fkey
    foreign key (bookshelf_id, parish_unit_l1_id) references parish_units (bookshelf_id, id);

alter table memberships drop constraint memberships_parish_unit_l2_id_fkey;
alter table memberships
  add constraint memberships_parish_unit_l2_id_fkey
    foreign key (bookshelf_id, parish_unit_l2_id) references parish_units (bookshelf_id, id);

-- ── Step 4: book_copies ─────────────────────────────────────────────────
alter table book_copies drop constraint book_copies_book_id_fkey;
alter table book_copies
  add constraint book_copies_book_id_fkey
    foreign key (bookshelf_id, book_id) references books (bookshelf_id, id)
    on delete cascade;

alter table book_copies drop constraint book_copies_acquired_from_membership_id_fkey;
alter table book_copies
  add constraint book_copies_acquired_from_membership_id_fkey
    foreign key (bookshelf_id, acquired_from_membership_id) references memberships (bookshelf_id, id);

-- ── Step 5: loans ────────────────────────────────────────────────────────
alter table loans drop constraint loans_copy_id_fkey;
alter table loans
  add constraint loans_copy_id_fkey
    foreign key (bookshelf_id, copy_id) references book_copies (bookshelf_id, id)
    on delete restrict;

alter table loans drop constraint loans_book_id_fkey;
alter table loans
  add constraint loans_book_id_fkey
    foreign key (bookshelf_id, book_id) references books (bookshelf_id, id)
    on delete restrict;

alter table loans drop constraint loans_request_id_fkey;
alter table loans
  add constraint loans_request_id_fkey
    foreign key (bookshelf_id, request_id) references borrow_requests (bookshelf_id, id);

-- ── Step 6: borrow_requests ──────────────────────────────────────────────
alter table borrow_requests drop constraint borrow_requests_book_id_fkey;
alter table borrow_requests
  add constraint borrow_requests_book_id_fkey
    foreign key (bookshelf_id, book_id) references books (bookshelf_id, id)
    on delete cascade;

alter table borrow_requests drop constraint borrow_requests_copy_id_fkey;
alter table borrow_requests
  add constraint borrow_requests_copy_id_fkey
    foreign key (bookshelf_id, copy_id) references book_copies (bookshelf_id, id);

alter table borrow_requests drop constraint borrow_requests_fulfilled_loan_id_fkey;
alter table borrow_requests
  add constraint borrow_requests_fulfilled_loan_id_fkey
    foreign key (bookshelf_id, fulfilled_loan_id) references loans (bookshelf_id, id);

-- ── Step 7: condition_assessments ────────────────────────────────────────
alter table condition_assessments drop constraint condition_assessments_copy_id_fkey;
alter table condition_assessments
  add constraint condition_assessments_copy_id_fkey
    foreign key (bookshelf_id, copy_id) references book_copies (bookshelf_id, id)
    on delete restrict;

alter table condition_assessments drop constraint condition_assessments_loan_id_fkey;
alter table condition_assessments
  add constraint condition_assessments_loan_id_fkey
    foreign key (bookshelf_id, loan_id) references loans (bookshelf_id, id);

-- ── Step 8: comments ──────────────────────────────────────────────────────
alter table comments drop constraint comments_book_id_fkey;
alter table comments
  add constraint comments_book_id_fkey
    foreign key (bookshelf_id, book_id) references books (bookshelf_id, id)
    on delete cascade;

-- ── Step 9: book_donations ────────────────────────────────────────────────
alter table book_donations drop constraint book_donations_donor_membership_id_fkey;
alter table book_donations
  add constraint book_donations_donor_membership_id_fkey
    foreign key (bookshelf_id, donor_membership_id) references memberships (bookshelf_id, id)
    on delete restrict;
