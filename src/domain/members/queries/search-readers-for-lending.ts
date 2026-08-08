import type { Block } from "../../kernel/block";
import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { loadParishContext } from "../parish-context";
import { describeSelection } from "../parish-taxonomy";
import { membershipAllowsNewLoan, requireManager } from "../policy";
import type { MembershipStatus } from "../policy";

export interface LendableReaderRow {
  membershipId: string;
  userId: string;
  fullName: string;
  parishLine: string;
  activeLoans: number;
  block: Block;
}

/**
 * The quick-lend search a manager types a reader's name into (OPS §3.3),
 * `searchBooksForLending`'s twin on the reader side.
 *
 * **Never filters a blocked reader out.** BR §16.3: "Blocking conditions
 * (reader at loan limit, copy already lent, membership not active) surface
 * as a clear message *before* the confirm step, never as an error
 * afterwards." A reader silently missing from the results would send the
 * volunteer searching again, wondering why; a row with "Tài khoản đang tạm
 * khoá" tells them what to do instead.
 *
 * The block reason is computed from `membershipAllowsNewLoan` — Task 1's own
 * predicate, not a second copy of INV-4's status list — composed with
 * INV-5's loan-count check against `input.maxConcurrentLoans`, the shelf's
 * own setting (BR §5.5) which the *caller* reads and passes in, so this
 * query is not a second place that knows where policy configuration lives.
 */
export async function searchReadersForLending(
  tx: Tx,
  ctx: TenantContext,
  input: { q: string; maxConcurrentLoans: number },
): Promise<LendableReaderRow[]> {
  requireManager(ctx);

  if (input.q.trim() === "") return [];

  const rows = await tx<
    {
      membership_id: string;
      user_id: string;
      full_name: string;
      status: string;
      parish_unit_l1_id: string | null;
      parish_unit_l2_id: string | null;
      active_loans: number;
    }[]
  >`
    select
      m.id as membership_id,
      m.user_id,
      u.full_name,
      m.status,
      m.parish_unit_l1_id, m.parish_unit_l2_id,
      -- G5, DB §6: loans_current is every loan plus two derived columns, not
      -- pre-filtered to active ones (Task 5's own lesson) — the explicit
      -- status = 'active' filter is what makes this INV-5's count.
      count(l.id) filter (where l.status = 'active') as active_loans
    from memberships m
    join users u on u.id = m.user_id and u.deleted_at is null
    left join loans_current l on l.borrower_id = u.id
    where m.deleted_at is null
      -- users has no folded column (verified): fold at query time, and
      -- guard the empty result the way get-books-list.ts already does, or a
      -- query of pure punctuation matches every reader (the garbage-query
      -- guard B1's M7 learned the hard way).
      and olibra_fold(${input.q}) <> ''
      and olibra_fold(u.full_name) like '%' || olibra_fold(${input.q}) || '%'
    group by m.id, u.id
    order by u.full_name
  `;

  const { taxonomy, units } = await loadParishContext(tx, ctx);

  return rows.map((r) => {
    const activeLoans = Number(r.active_loans);
    // INV-4 from the members domain, INV-5 from the shelf's own limit (BR
    // §5.5). Blocked readers are returned, not filtered: see the docstring
    // above.
    const status = membershipAllowsNewLoan({
      status: r.status as MembershipStatus,
    });
    const block: Block = status.blocked
      ? status
      : activeLoans >= input.maxConcurrentLoans
        ? { blocked: true, reason: "loan_limit_reached" }
        : { blocked: false };

    return {
      membershipId: r.membership_id,
      userId: r.user_id,
      fullName: r.full_name,
      parishLine: describeSelection(taxonomy, units, {
        l1: r.parish_unit_l1_id,
        l2: r.parish_unit_l2_id,
      }),
      activeLoans,
      block,
    };
  });
}
