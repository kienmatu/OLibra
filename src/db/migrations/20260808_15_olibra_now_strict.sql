-- `olibra_now()` refuses what it cannot interpret unambiguously.
--
-- `20260808_14_olibra_now.sql` cast whatever string was in `olibra.now`
-- straight to `timestamptz` and trusted the caller to have sent something
-- sensible. Only `unit-of-work.ts` writes that GUC, and it writes
-- `.toISOString()`, so nothing was wrong in practice — but the function is
-- the *schema's* contract, reachable from `psql`, from a migration, and from
-- whatever slice next decides it needs to set a clock. Measured against the
-- shipped function, by setting `olibra.now` directly:
--
--   '2026-08-08 10:00:00'  accepted, and interpreted in the session's
--                          `TimeZone` — the same string is three different
--                          instants under UTC (10:00+00),
--                          Asia/Ho_Chi_Minh (10:00+07) and
--                          America/Los_Angeles (10:00-07). All three
--                          verified. This is precisely the hazard DB §2.2
--                          exists to warn about ("never rely on the session
--                          TimeZone setting for correctness"), and the only
--                          thing standing between the schema and it was one
--                          `.toISOString()` call in TypeScript that nothing
--                          in SQL required.
--   'now', 'epoch'         accepted, silently resolving to real time and to
--                          1970 respectively — a "frozen clock" that is not
--                          frozen, and a clock in the wrong decade.
--   'infinity'             accepted. `copies_borrowable` then hides every
--                          copy in the database (nothing is `> infinity`),
--                          and `loans_current` stops being queryable at all:
--                          `due_on - 'infinity'::date` raises `cannot
--                          subtract infinite dates`. A GUC value that makes
--                          a view raise is worse than one that makes it
--                          wrong, because it takes down reads that have
--                          nothing to do with the clock.
--
-- So: require an explicit offset, and require a finite value. The regex below
-- does both — a string that matches it has a four-digit year and a real
-- offset, and therefore cannot be `infinity`, `epoch`, `now`, `today`, or a
-- bare local time. There is deliberately no separate `isfinite()` check: it
-- would be unreachable behind the pattern, and an unreachable guard reads as
-- a guarantee somebody is entitled to weaken the pattern against.
--
-- Accepted:  2026-08-08T10:00:00.000Z   (what `Date.prototype.toISOString()`
--                                        produces — the only writer today)
--            2026-08-08T10:00:00Z
--            2026-08-08 10:00:00+07     (space or `T`, `Z` or `±hh[:mm]`)
--            2026-08-08T10:00:00.123456-05:30
-- Rejected:  2026-08-08 10:00:00        (no offset — ambiguous, the point)
--            2026-08-08                 (a date is not an instant)
--            now, epoch, today, infinity, -infinity
--            +275760-09-13T00:00:00.000Z  (`new Date(8.64e15).toISOString()`;
--                                          Postgres answers 22009 for it
--                                          anyway, less legibly)
--
-- Unset and the empty string are **not** errors and must never become ones —
-- that is `20260808_14`'s whole `coalesce`/`nullif` argument, and both cases
-- still fall back to `now()`. See that file: `missing_ok` for a connection
-- that never set the GUC (every `psql` session, every migration, `seed()`),
-- and `nullif(..., '')` for a pooled connection whose *previous* transaction
-- set it LOCAL, since a LOCAL setting reverts to `''` rather than to unset.
--
-- **plpgsql rather than SQL, and that is not only about `raise`.** A SQL
-- function this small is inlined by the planner, which sounded like the
-- cheaper option and measures as the more expensive one: inlining expands the
-- body into the qual, and the resulting `coalesce(nullif(current_setting(...)
-- ...), now())` is not something the planner will use as an index bound, so
-- `where t > olibra_now()` planned as a **Seq Scan**. The plpgsql function
-- stays opaque and STABLE, which is exactly the shape the planner treats as a
-- run-time constant — the same query planned as a parallel **Index Only
-- Scan** with `Index Cond: (t > olibra_now())`, and ran faster (11ms vs 15ms
-- over 200k rows, measured on this cluster). Volatility is unchanged and
-- still load-bearing for the reason `20260808_14` gives at length: STABLE,
-- never IMMUTABLE, because the planner is licensed to fold an immutable call
-- to a literal at plan time and would freeze the clock at whenever the plan
-- was built.
--
-- The views are not touched. They call `olibra_now()` by name and pick this
-- definition up as they are; `pg_get_viewdef` is unchanged by this migration.
create or replace function olibra_now()
returns timestamptz
language plpgsql
stable
parallel safe
as $fn$
declare
  raw text := nullif(current_setting('olibra.now', true), '');
begin
  if raw is null then
    return now();
  end if;

  if raw !~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$' then
    raise exception using
      errcode = '22007',  -- invalid_datetime_format
      message = format(
        'olibra.now must be an ISO-8601 instant with an explicit UTC offset '
        'and a four-digit year, e.g. 2026-08-08T10:00:00.000Z; got %L', raw),
      hint = 'The kernel sets this from ctx.clock via toISOString(); a value '
             'without an offset would mean a different instant under every '
             'session TimeZone (DATABASE.md 2.2).';
  end if;

  return raw::timestamptz;
end;
$fn$;

comment on function olibra_now() is
  'The current instant, or the instant injected into olibra.now for this '
  'transaction. Rejects a value without an explicit offset, and any '
  'non-finite value, rather than guessing — see '
  '20260808_15_olibra_now_strict.sql. STABLE, never IMMUTABLE — see '
  '20260808_14_olibra_now.sql.';
