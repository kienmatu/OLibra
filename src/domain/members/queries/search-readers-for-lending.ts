import type { Block } from "../../kernel/block";
import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
// Upwards into circulation, deliberately. See the paragraph on the block
// reason in the docstring below for why this file calls C1's predicate rather
// than composing INV-4 and INV-5 for itself.
import { memberMayBorrow } from "../../circulation/policy";
import { loadParishContext } from "../parish-context";
import { describeSelection } from "../parish-taxonomy";
import { requireManager } from "../policy";
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
 * **The block reason is `memberMayBorrow`'s, not this file's.** When B2a
 * shipped this query that predicate did not exist, so the composition —
 * `membershipAllowsNewLoan` for INV-4, then `activeLoans >=
 * maxConcurrentLoans` for INV-5 — was written out here. C1 put the same
 * composition in `../../circulation/policy.ts` because `lendCopy` needs it
 * too, and two implementations of INV-5's threshold are two things that can
 * disagree about a reader standing at the shelf: the screen would say
 * lendable and the command would refuse, which is precisely the failure BR
 * §16.3 is written to prevent. So this now *calls* it, and
 * `tests/domain/circulation/lending-queries.test.ts` asserts that what this
 * row carries is the very code `lendCopy` throws for the same reader.
 *
 * That makes the members domain import from circulation, which — with C1's
 * `policy.ts` importing `membershipAllowsNewLoan` from this domain — is a
 * cycle between the two *modules*. It is not a cycle between the two *files*
 * (`circulation/policy.ts → members/policy.ts`, `members/queries/… →
 * circulation/policy.ts`), so nothing loads before it is defined, and
 * `tests/architecture/boundaries.test.ts` constrains what `src/domain` may
 * import from *outside* it, not module-to-module edges inside — read, not
 * assumed. If the edge ever reads badly, the fix is to move `memberMayBorrow`
 * down beside `Block` in the kernel, never to keep a second copy of the
 * comparison here.
 *
 * `maxConcurrentLoans` stays a parameter: it is the shelf's own setting (BR
 * §5.5), which the *caller* reads and passes in, so this query is not a
 * second place that knows where policy configuration lives.
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
    // The one predicate `lendCopy` also applies, INV-4 and INV-5 together,
    // in the order that decides which single sentence a volunteer reads.
    // Blocked readers are returned, not filtered: see the docstring above.
    const block: Block = memberMayBorrow(
      { status: r.status as MembershipStatus, activeLoans },
      input.maxConcurrentLoans,
    );

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
