-- The key is the only stored fact. `users.avatar_url` is dropped.
--
-- `20260809_02_avatar_object.sql` set out to do exactly this — "The storage key
-- becomes the stored fact; the URL is derived from it" — and stopped after
-- adding the column, because dropping the URL then would have stranded existing
-- rows, and because `avatar_url` was kept deliberately to represent "a
-- photograph this system did not upload and cannot delete".
--
-- Two things changed on 2026-08-13:
--
--   1. **The database is reset.** The product owner's explicit instruction, the
--      same standing assumption as the 2026-08-12 spec. So there are no rows to
--      strand, and the backfill that migration refused to write — parsing a key
--      back out of a URL, "a guess that quietly stops matching the day
--      S3_PUBLIC_URL changes" — is still not written and now never needs to be.
--   2. **Nothing supplies an external URL.** `RegistrationInput.avatarUrl`
--      existed, but no caller ever passed a value: every reference to it under
--      src/app and src/lib was a comment explaining that it existed and took no
--      key. The state this column was preserved to represent never occurred.
--
-- What this deletes in application code, all of it machinery that existed only
-- to keep two facts in step: `carryAvatar` and the erasure it defended against
-- (pending-proposal.ts), the carry-across at approval, the coupled write arms
-- in applyProfileFields, and `avatarObjectBehind` — which recovered a settled
-- photograph's key by matching an old request's proposed URL, and whose own
-- docstring called that the price of `users` keeping only the URL.
--
-- B6 · Avatar retention (master plan §7.14) closes with it: a photograph set at
-- registration now arrives as a key like any other, so "nothing in this
-- codebase can remove it" stops being true.

alter table users drop column avatar_url;

comment on column users.avatar_object is
  'Object storage key (src/storage/s3.ts objectKey). The only stored fact '
  'about a photograph; every URL is derived from it with url() at read time, '
  'so no row carries S3_PUBLIC_URL and changing provider stays what SDD 6.8 '
  'says it is: a change of environment variables.';
