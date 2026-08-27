import { requireIdentifiedActor } from "../../kernel/tenant";
import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireManager, requireReader } from "../../catalogue/policy";

export interface DonationRow {
  donationId: string;
  description: string;
  photoUrl: string | null;
  estimatedCount: number | null;
  status: string;
  decisionNote: string | null;
  offeredAt: Date;
  decidedAt: Date | null;
}

export interface QueuedDonationRow extends DonationRow {
  donorName: string;
  donorMembershipId: string;
}

/**
 * OPS §3.2 — a reader's own offers, so the *Tặng sách* screen can say what
 * happened to each.
 *
 * **Scoped by `donor_membership_id`, which is a `memberships(id)`** — the
 * reverse of this codebase's recurring trap, and the only table in the
 * community slice that works that way (`0006_community.sql:68`). Comparing a
 * user id here matches nothing, which would read as "this reader has never
 * offered anything" rather than as an error.
 *
 * A declined offer keeps its `decision_note`, because that note is the whole
 * reason a decline requires a reason: the reader reads it. Nothing else in this
 * row is worth showing them that they did not write themselves.
 */
export async function getMyDonations(
  tx: Tx,
  ctx: TenantContext,
): Promise<DonationRow[]> {
  requireReader(ctx);
  requireIdentifiedActor(ctx);

  const rows = await tx<
    {
      id: string;
      description: string;
      photo_url: string | null;
      estimated_count: number | null;
      status: string;
      decision_note: string | null;
      created_at: Date;
      decided_at: Date | null;
    }[]
  >`
    select id, description, photo_url, estimated_count, status, decision_note,
           created_at, decided_at
      from book_donations
     where donor_membership_id = ${ctx.actor.membershipId}
     order by created_at desc, id desc
  `;

  return rows.map(toRow);
}

/**
 * The manager's queue — pending offers, oldest first, so it drains like a queue
 * rather than a pile.
 *
 * The donor's name is joined because BR §16.3 makes *Duyệt* open the add-book
 * form with **Người tặng** pre-filled: the screen needs the name to show and
 * the membership id to pass on. `donor_membership_id` is returned for exactly
 * that hand-off, and `receiveDonation` writes no book itself.
 */
export async function getDonationQueue(
  tx: Tx,
  ctx: TenantContext,
): Promise<QueuedDonationRow[]> {
  requireManager(ctx);

  const rows = await tx<
    {
      id: string;
      description: string;
      photo_url: string | null;
      estimated_count: number | null;
      status: string;
      decision_note: string | null;
      created_at: Date;
      decided_at: Date | null;
      donor_name: string;
      donor_membership_id: string;
    }[]
  >`
    select d.id, d.description, d.photo_url, d.estimated_count, d.status,
           d.decision_note, d.created_at, d.decided_at,
           u.full_name as donor_name, d.donor_membership_id
      from book_donations d
      join memberships m on m.id = d.donor_membership_id
      join users u on u.id = m.user_id
     where d.status = 'pending'
     order by d.created_at asc, d.id asc
  `;

  return rows.map((r) => ({
    ...toRow(r),
    donorName: r.donor_name,
    donorMembershipId: r.donor_membership_id,
  }));
}

function toRow(r: {
  id: string;
  description: string;
  photo_url: string | null;
  estimated_count: number | null;
  status: string;
  decision_note: string | null;
  created_at: Date;
  decided_at: Date | null;
}): DonationRow {
  return {
    donationId: r.id,
    description: r.description,
    photoUrl: r.photo_url,
    estimatedCount: r.estimated_count,
    status: r.status,
    decisionNote: r.decision_note,
    offeredAt: r.created_at,
    decidedAt: r.decided_at,
  };
}
