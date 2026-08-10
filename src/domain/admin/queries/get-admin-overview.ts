import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireSuperAdmin } from "../../members/policy";

/**
 * OPS §3.4's cross-shelf reads — the administration surface's own queries.
 *
 * Every one of them runs through `runAdminQuery`, whose docstring holds the
 * argument for the escalation: OPS §2 names the cross-shelf administration
 * views as one of INV-10's three enumerated exceptions, and none of these can
 * be expressed under `runQuery`, whose scope is one shelf by construction.
 *
 * Each also calls `requireSuperAdmin` itself. That is not redundant with the
 * kernel's own check — see `requireSuperAdminActor` in `unit-of-work.ts` for
 * why the two answer different questions.
 *
 * **Every figure is computed live.** OPS §3.4 says so for the overview
 * ("overdue counts, pending-item counts per shelf, all live"), and it is the
 * same rule `getManagerBadgeCounts` follows one scope down. A cross-shelf
 * dashboard is exactly where a materialised counter would be believed longest.
 */

export interface ShelfOverviewRow {
  bookshelfId: string;
  slug: string;
  name: string;
  status: string;
  books: number;
  readers: number;
  activeLoans: number;
  overdue: number;
  pending: number;
}

/**
 * One row per shelf, archived ones included.
 *
 * **Archived shelves are listed and marked**, not hidden. An administrator is
 * the only person who can see one at all — `resolveShelfId` refuses its slug to
 * everybody, including its own admin — so a listing that dropped it would make
 * the shelf unreachable from every surface in the application at once.
 *
 * `deleted_at is null` still applies: a soft-deleted shelf is gone, and
 * archiving deliberately does not do that (see `archiveBookshelf`).
 */
export async function getAdminOverview(
  tx: Tx,
  ctx: TenantContext,
): Promise<ShelfOverviewRow[]> {
  requireSuperAdmin(ctx);

  const rows = await tx<
    {
      id: string;
      slug: string;
      name: string;
      status: string;
      books: number;
      readers: number;
      active_loans: number;
      overdue: number;
      pending: number;
    }[]
  >`
    select
      b.id, b.slug, b.name, b.status,
      (select count(*) from books
        where bookshelf_id = b.id and deleted_at is null)::int as books,
      (select count(*) from memberships
        where bookshelf_id = b.id and status = 'active'
          and deleted_at is null)::int as readers,
      (select count(*) from loans
        where bookshelf_id = b.id and status = 'active')::int as active_loans,
      -- Derived on read against olibra_now(), never a stored flag (BR §8).
      -- loans_current is security_invoker, so under olibra_admin it spans every
      -- shelf and the bookshelf_id here is what narrows it to this row.
      (select count(*) from loans_current
        where bookshelf_id = b.id and is_overdue)::int as overdue,
      -- "An attention list": everything waiting on a person at this shelf,
      -- added together. One number, because the overview links to the shelf
      -- and the shelf's own sidebar breaks it down.
      (
        (select count(*) from memberships
          where bookshelf_id = b.id and status = 'pending'
            and deleted_at is null)
      + (select count(*) from borrow_requests
          where bookshelf_id = b.id and status in ('pending', 'approved'))
      + (select count(*) from comments
          where bookshelf_id = b.id and status = 'pending'
            and deleted_at is null)
      + (select count(*) from book_donations
          where bookshelf_id = b.id and status = 'pending')
      )::int as pending
    from bookshelves b
    where b.deleted_at is null
    order by b.name asc, b.id asc
  `;

  return rows.map((r) => ({
    bookshelfId: r.id,
    slug: r.slug,
    name: r.name,
    status: r.status,
    books: r.books,
    readers: r.readers,
    activeLoans: r.active_loans,
    overdue: r.overdue,
    pending: r.pending,
  }));
}

export interface ManagerCandidateRow {
  userId: string;
  fullName: string;
}

/**
 * Task 5 (QA remediation). Who the appoint form at `/quan-tri/quan-ly-vien`
 * may offer for *this* shelf — the read `assignManagerAction` had a command
 * for (`assignManager`, `../commands/managers.ts`) and no screen ever called.
 *
 * **`role = 'reader'` and `status = 'active'`, both, and only those.** A
 * `manager`/`admin` here is already running the shelf and `assignManager`
 * would just overwrite their own role — not a second grant, so not a
 * candidate. A `pending`/`suspended`/`left`/`rejected` reader is not yet, or
 * no longer, a member in good standing; `assignManager` itself does not
 * refuse them (it only checks the shelf and the person exist, per its own
 * docstring), but a fresh registration nobody has approved is not who this
 * screen means to surface as "hand them the keys". Narrower than the command
 * on purpose — the command stays permissive for a caller who names a
 * `userId` directly, e.g. a future search-based picker; this query is the
 * one screen that does not have that and lists people instead.
 *
 * **One shelf, not every shelf.** OPS §3.4 lists no `GetManagerCandidates`,
 * so there is no catalogue wording to match; this is shaped by its one
 * caller, which never needs more than the shelf a volunteer just chose from
 * `?tu-sach=` (`quan-ly-vien/page.tsx`'s GET companion, the same mechanism
 * `tu-sach/page.tsx` already uses to select one row for its own detail
 * panel). A query returning every shelf's candidates at once would be
 * answering a question this screen never asks, for the cost of scanning
 * `memberships` shelves nobody selected.
 *
 * **`requireSuperAdmin`, not RLS.** `memberships` carries a tenant policy
 * (`0010_rls.sql`) that would ordinarily scope a read to one shelf on its
 * own — but this runs inside `loadAdminPage`'s `runAdminQuery`, which sets
 * `olibra.bookshelf_id` to the empty sentinel and switches to `olibra_admin`
 * (bypassrls) precisely so a cross-shelf administration screen can name
 * whichever shelf it needs (see that function's docstring, and
 * `getManagersList` just above, which narrows the identical way with its own
 * `input.shelfId` filter). So the shelf comes from an explicit `where`, the
 * same as every other query in this file, and the super_admin check is
 * restated here rather than assumed from the caller, the same as every
 * other query in this file.
 */
export async function getManagerCandidates(
  tx: Tx,
  ctx: TenantContext,
  bookshelfId: string,
): Promise<ManagerCandidateRow[]> {
  requireSuperAdmin(ctx);

  const rows = await tx<{ user_id: string; full_name: string }[]>`
    select u.id as user_id, u.full_name
      from memberships m
      join users u on u.id = m.user_id and u.deleted_at is null
     where m.bookshelf_id = ${bookshelfId}
       and m.role = 'reader'
       and m.status = 'active'
       and m.deleted_at is null
     order by u.full_name asc, u.id asc
  `;

  return rows.map((r) => ({ userId: r.user_id, fullName: r.full_name }));
}

export interface ManagerRow {
  membershipId: string | null;
  userId: string;
  fullName: string;
  phone: string | null;
  /** `super_admin` for a global administrator, otherwise the shelf role. */
  role: string;
  shelfName: string | null;
  shelfSlug: string | null;
  lastActiveAt: Date | null;
}

/**
 * OPS §3.4's `GetManagersList` — "every manager/admin across every shelf".
 *
 * **Super administrators are in the list, with no shelf.** They are the people
 * with the most power in the installation, and a list of "who can do things
 * here" that omitted them would be the one list where that matters most.
 * `membershipId` is null for them, which is also what makes them unrevocable
 * through `revokeManager` — correct, since OPS §4.5 has no demotion command.
 *
 * **`lastActiveAt` is the last thing they did, read from the audit log.** OPS
 * §3.4 asks for "last-active recency (flags e.g. '32 ngày trước' as stale)", and
 * the audit log is the only record of *doing* rather than of *being*: a session
 * says somebody signed in, which a phone left logged in also says.
 */
export async function getManagersList(
  tx: Tx,
  ctx: TenantContext,
  input: { shelfId?: string | null; q?: string | null } = {},
): Promise<ManagerRow[]> {
  requireSuperAdmin(ctx);

  const rows = await tx<
    {
      membership_id: string | null;
      user_id: string;
      full_name: string;
      phone: string | null;
      role: string;
      shelf_name: string | null;
      shelf_slug: string | null;
      last_active_at: Date | null;
    }[]
  >`
    with people as (
      select m.id as membership_id, u.id as user_id, u.full_name, u.phone,
             m.role::text as role, b.name as shelf_name, b.slug as shelf_slug,
             b.id as shelf_id
        from memberships m
        join users u on u.id = m.user_id and u.deleted_at is null
        join bookshelves b on b.id = m.bookshelf_id and b.deleted_at is null
       where m.role in ('manager', 'admin') and m.deleted_at is null
      union all
      select null, u.id, u.full_name, u.phone, 'super_admin', null, null, null
        from users u
       where u.is_super_admin and u.deleted_at is null
    )
    select p.membership_id, p.user_id, p.full_name, p.phone, p.role,
           p.shelf_name, p.shelf_slug,
           (select max(a.occurred_at) from audit_log a
             where a.actor_id = p.user_id) as last_active_at
      from people p
     where (${input.shelfId ?? null}::uuid is null
            or p.shelf_id = ${input.shelfId ?? null}::uuid)
       and (${input.q ?? null}::text is null
            or p.full_name ilike '%' || ${input.q ?? null}::text || '%')
     -- A super_admin first, then by name. id last so a tie between two people
     -- of the same name does not reorder between reads.
     order by (p.role = 'super_admin') desc, p.full_name asc, p.user_id asc
  `;

  return rows.map((r) => ({
    membershipId: r.membership_id,
    userId: r.user_id,
    fullName: r.full_name,
    phone: r.phone,
    role: r.role,
    shelfName: r.shelf_name,
    shelfSlug: r.shelf_slug,
    lastActiveAt: r.last_active_at,
  }));
}

export interface SystemSettings {
  contactName: string | null;
  contactPhone: string | null;
  contactHours: string | null;
  defaultLoanDays: number;
  defaultMaxConcurrentLoans: number;
  /**
   * QA remediation Task 23. `20260811_01_system_settings_lending_defaults
   * .sql` added this alongside `defaultRenewalDays` and `defaultDueSoonDays`
   * — `/quan-tri/cai-dat` carried only three of the six per-shelf policy
   * numbers a new shelf inherits, and these three are the ones it was
   * missing. Same shape as the three above: `createBookshelf` copies it into
   * the jsonb bag a new shelf's own row carries, at creation, and nothing
   * else ever reads it.
   */
  defaultMaxRenewals: number;
  defaultRenewalDays: number;
  defaultHoldDays: number;
  defaultDueSoonDays: number;
  /** Read-only facts OPS §3.4 asks this screen to state. */
  timezone: string;
  locale: string;
}

/** OPS §3.4's `GetSystemSettings`. */
export async function getSystemSettings(
  tx: Tx,
  ctx: TenantContext,
): Promise<SystemSettings> {
  requireSuperAdmin(ctx);

  const [row] = await tx<
    {
      contact_name: string | null;
      contact_phone: string | null;
      contact_hours: string | null;
      default_loan_days: number;
      default_max_concurrent_loans: number;
      default_max_renewals: number;
      default_renewal_days: number;
      default_hold_days: number;
      default_due_soon_days: number;
    }[]
  >`
    select contact_name, contact_phone, contact_hours,
           default_loan_days, default_max_concurrent_loans,
           default_max_renewals, default_renewal_days, default_hold_days,
           default_due_soon_days
      from system_settings where id
  `;

  return {
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactHours: row.contact_hours,
    defaultLoanDays: row.default_loan_days,
    defaultMaxConcurrentLoans: row.default_max_concurrent_loans,
    defaultMaxRenewals: row.default_max_renewals,
    defaultRenewalDays: row.default_renewal_days,
    defaultHoldDays: row.default_hold_days,
    defaultDueSoonDays: row.default_due_soon_days,
    // Constants, and stated as such: `bookshelves.timezone` and `.locale` carry
    // per-shelf defaults nothing in this application varies, and OPS §3.4 lists
    // the timezone as read-only in as many words.
    timezone: "Asia/Ho_Chi_Minh",
    locale: "vi",
  };
}

export interface SiteContact {
  name: string | null;
  phone: string | null;
  hours: string | null;
}

/**
 * OPS §3.1's `GetSiteContact` — **guest-callable and Global**, the read behind
 * `/lien-he`.
 *
 * **It takes no `TenantContext` and calls no policy**, which is the signature
 * carrying the meaning, exactly as `runPublicQuery`'s callback does. There is
 * nobody to check: a stranger whose parish has no shelf yet is the person this
 * page exists for.
 *
 * The three columns are the whole of what `olibra_public` may select from
 * `system_settings` (`20260810_01_system_settings.sql`), so this is not merely
 * a query that happens to ask for little — a version of it that asked for the
 * lending defaults would be refused by the database with `42501`.
 */
export async function getSiteContact(tx: Tx): Promise<SiteContact> {
  const [row] = await tx<
    {
      contact_name: string | null;
      contact_phone: string | null;
      contact_hours: string | null;
    }[]
  >`
    select contact_name, contact_phone, contact_hours from system_settings
  `;

  return {
    name: row?.contact_name ?? null,
    phone: row?.contact_phone ?? null,
    hours: row?.contact_hours ?? null,
  };
}
