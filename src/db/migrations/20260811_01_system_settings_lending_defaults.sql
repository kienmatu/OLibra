-- QA remediation Task 23. `system_settings` carried three of the six
-- per-shelf lending-policy numbers a newly created shelf inherits —
-- `default_loan_days`, `default_max_concurrent_loans`, `default_hold_days`
-- (`20260810_01_system_settings.sql`) — and not the other three:
-- `max_renewals`, `renewal_days`, `due_soon_days`. `/quan-tri/cai-dat`'s own
-- "Mặc định cho tủ sách mới" form could not offer them because there was
-- nowhere to save them; `createBookshelf` could not copy them into a new
-- shelf's `settings` bag for the same reason.
--
-- The three defaults below mirror the coalesce literals `circulation
-- /settings.ts`'s `renewalSettingsFor` (`max_renewals` 1, `renewal_days` 7)
-- and `get-shelf-settings.ts`'s own `due_soon_days` (3) already use for a
-- shelf that has never set an override — so a fresh install's system row
-- states, in one place an administrator can read and change, exactly the
-- policy every shelf already lends under implicitly.
--
-- No column-level grant changes: `olibra_app` already holds table-level
-- `select` and `olibra_admin` already holds `all` on this table
-- (`20260810_01_system_settings.sql`), and `olibra_public`'s grant is
-- column-level on the three contact fields alone — these three new columns
-- are not in that list, so they stay unreachable to a stranger by default,
-- the same property `tests/db/public-role-privileges.test.ts` already
-- asserts generically over every column on this table.
alter table system_settings
  add column default_max_renewals   integer not null default 1,
  add column default_renewal_days   integer not null default 7,
  add column default_due_soon_days  integer not null default 3;

comment on column system_settings.default_max_renewals is
  'The max_renewals a newly created shelf''s settings bag starts with. '
  'Mirrors circulation/settings.ts''s own coalesce default (1) — see that '
  'module for why 0 is a real policy and not the QA-remediation defect this '
  'shares its bound table with (src/domain/admin/policy.ts).';

comment on column system_settings.default_renewal_days is
  'The renewal_days a newly created shelf''s settings bag starts with. '
  'Mirrors circulation/settings.ts''s own coalesce default (7).';

comment on column system_settings.default_due_soon_days is
  'The due_soon_days a newly created shelf''s settings bag starts with. '
  'Mirrors get-shelf-settings.ts''s own coalesce default (3) — the sweep''s '
  'reminder window, per shelf, from the moment a shelf is created rather '
  'than only as sweepDueNotifications''s own global fallback.';
