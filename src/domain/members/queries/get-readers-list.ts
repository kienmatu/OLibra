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
    order by u.full_name
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
