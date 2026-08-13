-- QR labels per copy. Design:
-- docs/superpowers/specs/2026-08-13-qr-labels-design.md
--
-- Two columns, one fact each: when this copy's label was last printed, and how
-- many times it has been printed at all.
--
-- The count is not redundant with the timestamp. The "Chưa in nhãn" filter has
-- to tell a copy that has never been labelled from one whose sticker fell off
-- and was reprinted, and a single boolean — or a timestamp read as one —
-- conflates exactly those two. A manager reprinting DT-0143 must not thereby
-- lose the fact that DT-0144 still has no sticker at all.
--
-- No composite tenant foreign key applies (DATABASE.md §4.4): these are scalar
-- columns, not a reference between two shelf-scoped tables, so there is no
-- second shelf-scoped column to pair a key with.
--
-- No backfill, and none is missing. Every copy that exists today is correctly
-- described by "never printed", which is exactly what the null and the default
-- already say — unlike a backfill that would have to invent a date.
alter table book_copies
  add column qr_printed_at  timestamptz,
  add column qr_print_count integer not null default 0;
