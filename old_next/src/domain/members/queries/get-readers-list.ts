import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { loadParishContext } from "../parish-context";
import {
  describeSelection,
  type ParishTaxonomy,
  unitName,
} from "../parish-taxonomy";
import type { MembershipRole, MembershipStatus } from "../policy";
import { requireManager } from "../policy";

export interface ReaderRow {
  membershipId: string;
  userId: string;
  fullName: string;
  saintName: string | null;
  status: MembershipStatus;
  role: MembershipRole;
  /** "Tổ 3 · Giáo họ Thánh Tâm" — the shelf's own labels, never "Tổ" hard-coded. */
  parishLine: string;
  parishUnitL1Name: string;
  parishUnitL2Name: string;
  /** Live, from `loans_current`. Never a stored counter. */
  holdingCount: number;
}

export interface ReadersListInput {
  q?: string;
  status?: MembershipStatus;
  /**
   * Post-review fix wave, item 1. `undefined` (every caller but one) returns
   * every role, unfiltered — this query is not only the "Bạn đọc" roster:
   * `sach/moi/page.tsx` and `quan-ly/sach/[id]/page.tsx` both call it for the
   * donor picker, and a donor is any active member handing over a book, a
   * manager or admin included (`DonorFields`' own rule is `status: "active"`,
   * nothing about role). Only `nguoi-doc/page.tsx` passes `role: "reader"`,
   * to keep a manager's or admin's own record out of a list built to edit
   * reader profiles directly and without approval
   * (`../commands/update-reader-profile.ts`'s note 5) — narrowing this query
   * itself, rather than filtering its one caller's rows in TypeScript, so a
   * future caller cannot forget the same filter the way the donor pickers
   * would have been broken by narrowing it unconditionally.
   */
  role?: MembershipRole;
  parishUnitId?: string;
  page?: number;
  pageSize?: number;
}

export interface ReadersListPage {
  rows: ReaderRow[];
  page: number;
  pageCount: number;
  total: number;
  taxonomy: ParishTaxonomy;
}

/**
 * OPS §3.3's readers list — the manager-facing roster with the four fields
 * BR §5.3 and §16.3 name: the shelf's own parish line (never a hard-coded
 * "Tổ"), the live holding count, and the name/status/parish-unit filters a
 * manager actually uses.
 *
 * `holdingCount` is `count(loans_current.id)` filtered to `status = 'active'`
 * — Task 5 found the hard way that `loans_current` is every loan plus two
 * derived columns, not a pre-filtered "current" view, so an unfiltered count
 * would count returned loans too.
 *
 * **The order is `olibra_fold(u.full_name)` and then `m.id`, and both halves
 * are corrections** (U3 wave 1's reconciliation). This shipped as
 * `order by u.full_name`, which is the pair of defects U2 found in the two
 * reader-facing catalogue queries and then in `getBooksList`, on a fourth
 * query nobody had connected to them:
 *
 * - **Unfolded.** This cluster's collation is `C`, so byte order is the order.
 *   `Đ` encodes as two bytes beginning `0xC4`, above every ASCII letter, so
 *   every child called *Đặng* or *Đỗ* sorted after every *Vũ* — at the end of
 *   the roster, which on a shelf of a few hundred readers is a different page.
 *   `olibra_fold` maps it to `d`, and on `[a-z0-9 ]` byte order is alphabetical
 *   order. Folding is what the search on the line above already does to the
 *   same column, so the list and its search now agree about what a name is.
 * - **No unique tiebreak, on a paged query.** `full_name` is nowhere near
 *   unique — two children called "Nguyễn Văn An" is the ordinary case, and it
 *   is the case BR §5.3 requires parents' names precisely to disambiguate — so
 *   the sort was not a total order and `limit`/`offset` over it showed some
 *   rows twice and skipped others. U2 measured that on the catalogue: 304
 *   titles collected over a paged walk, 229 distinct. `m.id` is the primary
 *   key, so it ends the order and cannot tie.
 *
 * **The optional `role` filter, added in the post-review fix wave.** See
 * `ReadersListInput.role`'s own docstring for why this is a parameter rather
 * than a hardcoded `and m.role = 'reader'` — the donor picker on the two book
 * forms calls this same query for every active member, role and all.
 * `nguoi-doc/page.tsx` is the one caller that narrows it, because that screen
 * is titled *Người đọc* — readers — and every row used to include every
 * membership regardless of role, which put a shelf's own managers and admins
 * in a list built to edit them with no approval step
 * (`../commands/update-reader-profile.ts`, item 1 of that wave). Narrowing
 * there is the same move `/quan-ly/doi-thong-tin`'s queue already makes for
 * the identical reason (§9 of `docs/superpowers/specs/2026-08-12-po-feedback
 * -design.md`: "filters to reader subjects, so a manager's pending change
 * does not sit in a queue where nobody present can decide it") — a manager or
 * admin does not stop being a person with a shelf-scoped `users` row, but
 * this particular roster is not where their record belongs. Nothing here
 * hides them from the system: `getReaderDetail` still resolves a manager- or
 * admin-subject membership id typed directly into the URL, and the detail
 * page renders their edit control read-only rather than refusing a submit
 * (`nguoi-doc/[id]/page.tsx`), so a colleague who reaches the row by URL sees
 * an honest screen either way.
 */
export async function getReadersList(
  tx: Tx,
  ctx: TenantContext,
  input: ReadersListInput,
): Promise<ReadersListPage> {
  requireManager(ctx);

  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 24));
  const q = (input.q ?? "").trim();

  const rows = await tx<
    {
      membership_id: string;
      user_id: string;
      full_name: string;
      saint_name: string | null;
      status: string;
      role: string;
      parish_unit_l1_id: string | null;
      parish_unit_l2_id: string | null;
      holding_count: number;
      total_count: number;
    }[]
  >`
    select
      m.id                  as membership_id,
      m.user_id,
      m.status, m.role,
      m.parish_unit_l1_id, m.parish_unit_l2_id,
      u.full_name, u.saint_name,
      -- G5, DB §6: the live loan set, from the view DB §6 names as the
      -- access path. loans_current.borrower_id references users(id), not
      -- the membership, so the join key is u.id -- verified with \d
      -- loans_current. loans_current is every loan plus two derived
      -- columns, never pre-filtered to active ones (Task 5's own lesson),
      -- so the filter below is what makes this a holding count.
      count(l.id) filter (where l.status = 'active') as holding_count,
      count(*) over ()::int as total_count
    from memberships m
    join users u on u.id = m.user_id and u.deleted_at is null
    left join loans_current l on l.borrower_id = u.id
    where m.deleted_at is null
      and (${input.role ?? null}::membership_role is null or m.role = ${input.role ?? null})
      and (${input.status ?? null}::membership_status is null or m.status = ${input.status ?? null})
      and (
        ${input.parishUnitId ?? null}::uuid is null
        or m.parish_unit_l1_id = ${input.parishUnitId ?? null}
        or m.parish_unit_l2_id = ${input.parishUnitId ?? null}
      )
      and (
        ${q} = ''
        -- The garbage-query guard B1 learned the hard way (M7): users has
        -- no folded column (verified against information_schema.columns), so
        -- this folds at query time — and olibra_fold reduces a query of pure
        -- punctuation to '', which without the extra guard would degenerate
        -- the LIKE pattern into matching every reader.
        or (olibra_fold(${q}) <> '' and olibra_fold(u.full_name) like '%' || olibra_fold(${q}) || '%')
      )
    group by m.id, u.id
    -- olibra_fold(full_name), then the primary key. See this function's
    -- docstring: unfolded, every Đ name sorted last; untie-broken, a paged
    -- walk lost readers between pages.
    order by olibra_fold(u.full_name), m.id
    limit ${pageSize} offset ${(page - 1) * pageSize}
  `;

  const { taxonomy, units } = await loadParishContext(tx, ctx);
  const total = rows[0]?.total_count ?? 0;

  return {
    rows: rows.map((r) => ({
      membershipId: r.membership_id,
      userId: r.user_id,
      fullName: r.full_name,
      saintName: r.saint_name,
      status: r.status as MembershipStatus,
      role: r.role as MembershipRole,
      parishLine: describeSelection(taxonomy, units, {
        l1: r.parish_unit_l1_id,
        l2: r.parish_unit_l2_id,
      }),
      parishUnitL1Name: unitName(units, r.parish_unit_l1_id),
      parishUnitL2Name: unitName(units, r.parish_unit_l2_id),
      holdingCount: Number(r.holding_count),
    })),
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    total,
    taxonomy,
  };
}
