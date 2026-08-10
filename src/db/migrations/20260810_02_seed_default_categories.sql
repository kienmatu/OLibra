-- A fresh install had no categories and no way to make one, so the "Thể loại"
-- field on "Thêm sách mới" — which is `required` — could never be satisfied and
-- the catalogue could never be started. Task 2 adds the management screen; this
-- makes sure nobody has to use it before they can add their first book.
--
-- `on conflict (slug) do nothing` is evaluated per row, not per statement, so
-- this is not a no-op wherever `src/db/seed.ts` has already run. That script's
-- own `CATEGORIES` list overlaps this one on exactly three slugs — `lich-su`,
-- `ky-nang-song`, `khac` — which conflict and are skipped here; the other
-- three concepts it seeds under different slugs (`van-hoc-thieu-nhi`,
-- `sach-dao`, `tu-dien-tra-cuu`) do not conflict with this migration's
-- `truyen-thieu-nhi`, `giao-ly`, `sach-tham-khao`, so those three rows insert
-- for real. On an already-seeded development database, running this migration
-- genuinely adds three categories — a count going from twelve to fifteen is
-- this migration working as intended, not a bug.
insert into categories (name, slug, sort_order) values
  ('Truyện thiếu nhi', 'truyen-thieu-nhi', 1),
  ('Giáo lý',          'giao-ly',          2),
  ('Kỹ năng sống',     'ky-nang-song',     3),
  ('Sách tham khảo',   'sach-tham-khao',   4),
  ('Lịch sử',          'lich-su',          5),
  ('Khác',             'khac',             6)
on conflict (slug) do nothing;
