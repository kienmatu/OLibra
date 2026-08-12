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
 * **`dueSoonDays` joined the other five as a real per-shelf column in QA
 * remediation Task 23.** Until then it was reported as a bare constant —
 * `sweepDueNotifications` takes it as a parameter defaulting to 3 and nothing
 * wrote a shelf-level override — which was the shape of a second defect this
 * task closed alongside it: `/quan-ly/cai-dat` showed "Báo sắp đến hạn trước —
 * 3 ngày" as if it were a policy like the other five, and no admin form had
 * the field to change it. It is now `coalesce((settings->>'due_soon_days')
 * ::int, 3)`, the identical shape the other five already use, writable
 * through `updateBookshelfSettings`. **At the time, `sweepDueNotifications`
 * itself was left unchanged** — it still took `dueInDays` as a parameter and
 * still defaulted to 3 system-wide; wiring the nightly sweep to read this per
 * shelf was named explicitly as a separate piece of work that task did not
 * do. What Task 23 fixed was narrower and prior to that: that a number a
 * screen already claims to be a shelf's own policy is now actually one.
 *
 * **QA remediation Task 24 did the separate piece.** `sweepDueNotifications`
 * (`src/domain/notifications/sweep.ts`) now joins `bookshelves` in its
 * due-soon query and reads this identical `coalesce`, so the value this
 * function reports and the value the nightly sweep enforces are the same
 * `coalesce` expression rather than two numbers that happened to agree while
 * nothing read the second one. See that module's own note for why reading a
 * per-shelf value this way does not reopen the "no tenant to scope to"
 * argument the sweep's docstring makes elsewhere.
 */

/**
 * A shelf may name up to three people at `bookshelves_contacts.position`
 * 1-3, replacing the single `keeper_name`/`keeper_phone` pair PO feedback
 * round 1's Task 1 dropped from `bookshelves` itself.
 *
 * **Declared here, in the domain, and not in `src/lib/shelf.ts`.**
 * `tests/architecture/boundaries.test.ts` draws no line against `src/domain`
 * importing `src/lib`, but nothing in `src/domain` does today, and the
 * existing direction is the other way — `src/lib/shelf.ts`'s own docstring
 * calls itself "the surface side of the boundary" and reads from the domain,
 * never the reverse. This command (`bookshelves.ts`) and this query both need
 * the type; `src/lib/shelf.ts` needs it too, for `ShelfIdentity`, and
 * re-exports it from here rather than declaring a second copy a domain file
 * would then have to reach past its own boundary to use.
 */
export interface ShelfContact {
  /** 1, 2 or 3. Position 1 is the mandatory contact. */
  position: number;
  name: string;
  phone: string | null;
  /** Free text — "Người giữ chìa khoá", "Quản lý tủ sách". A parish names its own jobs. */
  roleLabel: string | null;
}

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
  /**
   * PO feedback round 1, Task 2. Replaces `openingHours`/`keeperName`/
   * `keeperPhone`, which lived directly on `bookshelves` and admitted only
   * one keeper. Ordered by position; empty for a shelf nobody has filled in
   * yet.
   */
  contacts: ShelfContact[];
  /** Read-only after creation (OPS §3.4), and shown so a manager can quote it. */
  slug: string;
}

export interface LendingPolicy {
  loanDays: number;
  maxConcurrentLoans: number;
  maxRenewals: number;
  renewalDays: number;
  holdDays: number;
  /**
   * The sweep's reminder window, defaulting to 3 — and, since QA remediation
   * Task 24, the same value `sweepDueNotifications` itself reads per shelf.
   * See the module note above for how the two stayed in agreement.
   */
  dueSoonDays: number;
  commentsEnabled: boolean;
  commentsRequireApproval: boolean;
}

export interface ShelfSettings {
  profile: ShelfProfile;
  policy: LendingPolicy;
}

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
      slug: string;
      loan_days: number;
      max_concurrent_loans: number;
      max_renewals: number;
      renewal_days: number;
      hold_days: number;
      due_soon_days: number;
      comments_enabled: boolean;
      comments_require_approval: boolean;
    }[]
  >`
    select
      name, location, address, slug,
      coalesce((settings->>'loan_days')::int, 14) as loan_days,
      coalesce((settings->>'max_concurrent_loans')::int, 3)
        as max_concurrent_loans,
      coalesce((settings->>'max_renewals')::int, 1) as max_renewals,
      coalesce((settings->>'renewal_days')::int, 7) as renewal_days,
      coalesce((settings->>'hold_days')::int, 3) as hold_days,
      coalesce((settings->>'due_soon_days')::int, 3) as due_soon_days,
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

  // `bookshelf_contacts` carries its own plain `<table>_tenant` policy and no
  // grant to `olibra_public` at all (Task 1), so this second `select` needs no
  // `where` beyond the ordinary tenant scope this transaction already runs
  // under — unlike `bookshelves` above, there is no competing permissive
  // policy to narrow past.
  const contactRows = await tx<
    {
      position: number;
      name: string;
      phone: string | null;
      role_label: string | null;
    }[]
  >`
    select position, name, phone, role_label
      from bookshelf_contacts
     where bookshelf_id = ${ctx.bookshelfId} and deleted_at is null
     order by position
  `;

  return {
    profile: {
      name: row.name,
      location: row.location,
      address: row.address,
      contacts: contactRows.map((c) => ({
        position: Number(c.position),
        name: c.name,
        phone: c.phone,
        roleLabel: c.role_label,
      })),
      slug: row.slug,
    },
    policy: {
      loanDays: row.loan_days,
      maxConcurrentLoans: row.max_concurrent_loans,
      maxRenewals: row.max_renewals,
      renewalDays: row.renewal_days,
      holdDays: row.hold_days,
      dueSoonDays: row.due_soon_days,
      commentsEnabled: row.comments_enabled,
      commentsRequireApproval: row.comments_require_approval,
    },
  };
}
