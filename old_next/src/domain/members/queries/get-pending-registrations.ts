import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { loadParishContext } from "../parish-context";
import { describeSelection, unitName } from "../parish-taxonomy";
import type { MembershipRole, MembershipStatus } from "../policy";
import { requireManager } from "../policy";
import type { ReaderRow } from "./get-readers-list";

export interface PendingRegistrationRow extends ReaderRow {
  dateOfBirth: string | null;
  fatherName: string;
  motherName: string;
  phone: string | null;
  requestedAt: string;
  /** BR §16.3's duplicate catch. Null when nothing is close. */
  similarTo: { membershipId: string; fullName: string; similarity: number } | null;
}

/**
 * OPS §3.3's registration queue — every `pending` application on this shelf,
 * carrying the fields a manager needs to decide (BR §5.3) plus BR §16.3's
 * similar-name warning.
 *
 * The warning is `pg_trgm`'s `similarity`, at 0.6, compared on folded names
 * (so "Trần Minh" and "Tran Minh" read as close) against *active* members
 * only — a pending applicant is not yet a duplicate risk against another
 * pending one, only against someone already on the roster. It is a warning
 * to a human and never an action: nothing here merges, rejects or links on
 * its strength, which is also why the identity-match rule elsewhere in this
 * slice is exact rather than fuzzy.
 */
export async function getPendingRegistrations(
  tx: Tx,
  ctx: TenantContext,
): Promise<PendingRegistrationRow[]> {
  requireManager(ctx);

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
      date_of_birth: string | null;
      father_name: string;
      mother_name: string;
      phone: string | null;
      requested_at: string;
      similar_id: string | null;
      similar_name: string | null;
      similar_score: number | null;
    }[]
  >`
    select
      m.id                  as membership_id,
      m.user_id,
      m.status, m.role,
      m.parish_unit_l1_id, m.parish_unit_l2_id,
      u.full_name, u.saint_name,
      u.date_of_birth::text as date_of_birth,
      u.father_name, u.mother_name, u.phone,
      m.created_at::text as requested_at,
      dup.id as similar_id,
      dup.full_name as similar_name,
      dup.sim as similar_score
    from memberships m
    join users u on u.id = m.user_id and u.deleted_at is null
    -- pg_trgm 1.6, verified installed. similarity('tran minh',
    -- 'tran minh duc') -> 0.714, verified. Folded on both sides so "Trần
    -- Minh" and "Tran Minh" are seen as close (BR §16.3's duplicate catch).
    -- A warning to a human, never an action: nothing merges or rejects on it.
    -- Aliased dup, not similar -- SIMILAR is a reserved word (SIMILAR TO).
    left join lateral (
      select am.id, au.full_name,
             similarity(olibra_fold(au.full_name), olibra_fold(u.full_name)) as sim
      from memberships am
      join users au on au.id = am.user_id and au.deleted_at is null
      where am.status = 'active' and am.deleted_at is null and am.id <> m.id
        and similarity(olibra_fold(au.full_name), olibra_fold(u.full_name)) >= 0.6
      order by sim desc
      limit 1
    ) dup on true
    where m.status = 'pending' and m.deleted_at is null
    order by m.created_at
  `;

  const { taxonomy, units } = await loadParishContext(tx, ctx);

  return rows.map((r) => ({
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
    // A pending application has never borrowed anything through this
    // shelf's membership yet, but this row shape is shared with the readers
    // list — 0 rather than a second, absent field.
    holdingCount: 0,
    dateOfBirth: r.date_of_birth,
    fatherName: r.father_name,
    motherName: r.mother_name,
    phone: r.phone,
    requestedAt: r.requested_at,
    similarTo:
      r.similar_id === null
        ? null
        : {
            membershipId: r.similar_id,
            fullName: r.similar_name!,
            similarity: Number(r.similar_score),
          },
  }));
}
