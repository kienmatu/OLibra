-- B6 · Avatar retention. The storage key becomes the stored fact; the URL is
-- derived from it.
--
-- `users.avatar_url` held a full public URL, which had two consequences nobody
-- chose:
--
--   1. **Nothing could delete a photograph.** `src/storage/s3.ts`'s `delete`
--      takes a key, and a row that holds only a URL does not know one. A family
--      asking for their child's photograph to be removed had no answer, and
--      `src/storage/s3.ts` argues at length that a child's face is the most
--      identifying thing this system stores.
--   2. **It baked `S3_PUBLIC_URL` into every row.** SDD §6.8's whole claim is
--      that changing provider "is a change of environment variables — endpoint,
--      region, bucket, credentials — and nothing else". A stored absolute URL
--      makes that false: moving to R2, or putting a CDN in front, would strand
--      every avatar already written. `url()` exists precisely so a caller can
--      build the address from a key at read time, and until now nothing used it
--      for avatars.
--
-- So the key is what a row keeps, and the URL is rebuilt on read. That is the
-- product owner's own suggestion (2026-08-09) and it is a better answer than
-- either option offered — deletion falls out for free, and the portability
-- claim becomes true rather than aspirational.
--
-- `avatar_url` is **kept, not dropped**, and this is not indecision. B2b's
-- `RegisterMembership` takes "an object already in storage" as a URL and B5's
-- store is not the only thing that could ever have put an image somewhere; a
-- row whose key is null and whose URL is set is a photograph this system did
-- not upload and cannot delete, which is a state worth being able to
-- represent and to find. `src/lib/avatar.ts` writes both from now on, and
-- anything with a key can be deleted.
--
-- No backfill. Every existing row's URL was written by the seed or by a
-- development upload; parsing a key back out of a URL is exactly the coupling
-- to URL shape this migration exists to remove, and doing it once "just for the
-- old rows" leaves the parser in the codebase for somebody to reuse.

alter table users
  add column avatar_object text;

comment on column users.avatar_object is
  'Object storage key (src/storage/s3.ts objectKey). The URL is derived from '
  'this with url(); avatar_url is a legacy absolute URL kept for rows written '
  'before B6 and for images this system did not upload. A row with a key can '
  'be deleted; a row with only a URL cannot.';
