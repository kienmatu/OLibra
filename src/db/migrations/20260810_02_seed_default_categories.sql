-- A fresh install had no categories and no way to make one, so the "Thể loại"
-- field on "Thêm sách mới" — which is `required` — could never be satisfied and
-- the catalogue could never be started. Task 2 adds the management screen; this
-- makes sure nobody has to use it before they can add their first book.
insert into categories (name, slug, sort_order) values
  ('Truyện thiếu nhi', 'truyen-thieu-nhi', 1),
  ('Giáo lý',          'giao-ly',          2),
  ('Kỹ năng sống',     'ky-nang-song',     3),
  ('Sách tham khảo',   'sach-tham-khao',   4),
  ('Lịch sử',          'lich-su',          5),
  ('Khác',             'khac',             6)
on conflict (slug) do nothing;
