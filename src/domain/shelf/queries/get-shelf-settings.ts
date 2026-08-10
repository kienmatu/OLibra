import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireManager } from "../../members/policy";

/**
 * OPS §3.4's `GetShelfSettings` — "view this shelf's profile and lending
 * policy", read-only, `manager`.
 *
 * **Every default is spelled the same way the command that reads it spells
 * it.** BR §5.5's policy lives in `bookshelves.settings`, a `jsonb` bag with no
 * schema, so each value has a default and the default is part of the rule:
 * `loanDaysFor` answers 14 for a shelf that has never set one, and this screen
 * must say 14 rather than "chưa đặt". A screen that showed the raw absence
 * would be describing the storage instead of the policy, and a manager reading
 * "chưa đặt" beside a fourteen-day due date has been told the software is
 * broken.
 *
 * The defaults are therefore **copied from `../../circulation/settings.ts` and
 * `../../community/policy.ts` deliberately, and `tests/domain/shelf/
 * shelf-settings.test.ts` asserts the two agree** — because the alternative,
 * calling those four functions, is four more round trips on a page that shows
 * six numbers, and because a wrong number here is silent while a failing test
 * is not.
 *
 * **`dueSoonDays` is the sweep's window and is not in `settings` at all.**
 * `sweepDueNotifications` takes it as a parameter defaulting to 3, and nothing
 * writes a shelf-level value yet — so it is reported as the constant it is,
 * rather than read from a key that does not exist and rendered as a default
 * indistinguishable from a configured one.
 */

export interface ShelfProfile {
  name: string;
  location: string | null;
  /**
   * `bookshelves.address` — BR:179 names it as its own field, separate from
   * `location`: "physical location, address, keeper's name and phone".
   *
   * QA remediation Task 22: until this task, nothing in this application
   * rendered it — an administrator could type a street address into
   * `/quan-tri/tu-sach` and it would reach exactly nowhere a reader or
   * manager could read it back, because the only reason it was carried here
   * at all was that the administrator's editor writes the whole profile in
   * one statement (see `updateBookshelfSettings`), and a form that omitted
   * this field would have cleared it on every save. It is now also read by
   * `readShelfIdentity` (`src/lib/shelf.ts`) for the shelf's own home page,
   * under "Địa chỉ", below "Địa điểm" (`location`) — and relabelled correctly
   * on this page's own manager-facing counterpart, `/quan-ly/cai-dat`, which
   * used to print `location`'s value under the label "Địa chỉ".
   */
  address: string | null;
  openingHours: string | null;
  keeperName: string | null;
  keeperPhone: string | null;
  /** Read-only after creation (OPS §3.4), and shown so a manager can quote it. */
  slug: string;
}

export interface LendingPolicy {
  loanDays: number;
  maxConcurrentLoans: number;
  maxRenewals: number;
  renewalDays: number;
  holdDays: number;
  /** The sweep's reminder window. A constant today — see the module note. */
  dueSoonDays: number;
  commentsEnabled: boolean;
  commentsRequireApproval: boolean;
}

export interface ShelfSettings {
  profile: ShelfProfile;
  policy: LendingPolicy;
}

/** The window `sweepDueNotifications` uses when nobody passes one. */
export const DEFAULT_DUE_SOON_DAYS = 3;

export async function getShelfSettings(
  tx: Tx,
  ctx: TenantContext,
): Promise<ShelfSettings> {
  requireManager(ctx);

  const [row] = await tx<
    {
      name: string;
      location: string | null;
      address: string | null;
      opening_hours: string | null;
      keeper_name: string | null;
      keeper_phone: string | null;
      slug: string;
      loan_days: number;
      max_concurrent_loans: number;
      max_renewals: number;
      renewal_days: number;
      hold_days: number;
      comments_enabled: boolean;
      comments_require_approval: boolean;
    }[]
  >`
    select
      name, location, address, opening_hours, keeper_name, keeper_phone, slug,
      coalesce((settings->>'loan_days')::int, 14) as loan_days,
      coalesce((settings->>'max_concurrent_loans')::int, 3)
        as max_concurrent_loans,
      coalesce((settings->>'max_renewals')::int, 1) as max_renewals,
      coalesce((settings->>'renewal_days')::int, 7) as renewal_days,
      coalesce((settings->>'hold_days')::int, 3) as hold_days,
      coalesce((settings->>'comments_enabled')::boolean, true)
        as comments_enabled,
      coalesce((settings->>'comments_require_approval')::boolean, true)
        as comments_require_approval
    from bookshelves
    where id = ${ctx.bookshelfId}
  `;
  // RLS already scopes this to one shelf; the `where` is what names *which* row
  // of the one the policy admits, since `bookshelves_public_read` also admits
  // every other active shelf for a `select`.

  return {
    profile: {
      name: row.name,
      location: row.location,
      address: row.address,
      openingHours: row.opening_hours,
      keeperName: row.keeper_name,
      keeperPhone: row.keeper_phone,
      slug: row.slug,
    },
    policy: {
      loanDays: row.loan_days,
      maxConcurrentLoans: row.max_concurrent_loans,
      maxRenewals: row.max_renewals,
      renewalDays: row.renewal_days,
      holdDays: row.hold_days,
      dueSoonDays: DEFAULT_DUE_SOON_DAYS,
      commentsEnabled: row.comments_enabled,
      commentsRequireApproval: row.comments_require_approval,
    },
  };
}
