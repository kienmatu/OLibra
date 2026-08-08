-- Diacritic- and case-insensitive folding, identical to fold() in
-- src/lib/search.ts. BR §12 requires the two to be the same normalisation;
-- tests/db/folding.test.ts is what stops them drifting.
--
-- Two traps, both named in DATABASE.md §5:
--
-- 1. unaccent() is STABLE, not IMMUTABLE, in a default installation, because
--    it depends on a rules file that could in principle change. A STABLE
--    function cannot be used in a generated column or a functional index. The
--    IMMUTABLE below is a promise, and it holds as long as nobody edits that
--    rules file.
--
-- 2. unaccent() does not reliably fold đ to d — đ is a distinct Vietnamese
--    letter, not a d with a diacritic. The translate() is what handles it and
--    must not be removed.
create or replace function olibra_fold(value text)
returns text
language sql
immutable
parallel safe
as $$
  select trim(regexp_replace(
    lower(translate(unaccent(value), 'đĐ', 'dD')),
    '[^a-z0-9]+', ' ', 'g'
  ))
$$;
