import { RuleViolated, ValidationFailed } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command, Tx } from "../../kernel/unit-of-work";
import { requireManager, requireReader } from "../../catalogue/policy";

/**
 * Tặng sách — a reader offers books they no longer want, a manager decides.
 * BR §7.7's `pending → received | declined`, OPS §4.4.
 *
 * **`book_donations.donor_membership_id` references `memberships(id)`**
 * (`0006_community.sql:68`) — a **membership** id, which is the *reverse* of
 * this codebase's recurring trap and the only table in the slice that works this
 * way. `decided_by` two lines below it is a `users(id)`, like every other actor
 * column in the schema. Both directions are in one insert here, and neither is
 * inferable from the column name.
 *
 * **Deliberately thin.** OPS §4.4 says why: free text, an optional photograph, a
 * rough count, "because a child does not know a publisher or an ISBN, and book
 * data is only worth recording once a volunteer has the book in hand".
 */

export interface OfferDonationInput {
  /** The caller's own membership — checked against the context, not trusted. */
  membershipId: string;
  description: string;
  photo?: string | null;
  estimatedCount?: number | null;
}

export const offerDonation: Command<
  OfferDonationInput,
  { donationId: string }
> = async (tx, ctx, input) => {
  requireReader(ctx);
  requireIdentifiedActor(ctx);

  if (input.membershipId !== ctx.actor.membershipId) {
    throw new RuleViolated("not_permitted");
  }

  const description = input.description.trim();
  if (!description) {
    throw new ValidationFailed("empty_description", "description");
  }

  const [row] = await tx<{ id: string }[]>`
      insert into book_donations
        (bookshelf_id, donor_membership_id, description, photo_url,
         estimated_count)
      values
        (${ctx.bookshelfId}, ${ctx.actor.membershipId}, ${description},
         ${input.photo ?? null}, ${input.estimatedCount ?? null})
      returning id
    `;

  return {
    result: { donationId: row.id },
    audit: {
      action: "donation.offered",
      entityType: "donation",
      entityId: row.id,
      before: null,
      after: { status: "pending", estimated_count: input.estimatedCount ?? null },
    },
  };
};

async function pendingDonation(tx: Tx, id: string): Promise<{ id: string }> {
  const [row] = await tx<{ id: string; status: string }[]>`
    select id, status from book_donations where id = ${id}
  `;
  // One code for "no such offer" and "already decided" — the reasoning every
  // command in this codebase records for the same shape. OPS §4.4 lists no
  // `donation_not_found`, and RLS has already filtered another shelf's row out.
  if (!row || row.status !== "pending") {
    throw new RuleViolated("donation_not_pending");
  }
  return row;
}

/**
 * `pending → received`, and **it writes no book and no copy row**.
 *
 * This is the decision most likely to be "improved" later by somebody who
 * reasons that a received donation ought to create its own catalogue entry. It
 * must not. OPS §4.4: the manager "separately runs `CreateBook` or `AddCopies`
 * with `donorMembershipId` set to this donor, which the queue screen pre-fills"
 * — because a bag of books is not a catalogue entry, and only a person holding
 * them knows what they are. Inventing rows here would put a book on the shelf
 * that nobody has looked at, with a title nobody typed.
 *
 * `tests/domain/community/donations.test.ts` asserts no `books` or
 * `book_copies` row appears, so the convenience fails rather than shipping.
 */
export const receiveDonation: Command<{ donationId: string }, void> = async (
  tx,
  ctx,
  input,
) => {
  requireManager(ctx);
  requireIdentifiedActor(ctx);

  const donation = await pendingDonation(tx, input.donationId);

  await tx`
    update book_donations
       set status = 'received',
           decided_by = ${ctx.actor.userId},
           decided_at = ${ctx.clock.now()}
     where id = ${donation.id}
  `;

  return {
    result: undefined,
    audit: {
      action: "donation.received",
      entityType: "donation",
      entityId: donation.id,
      before: { status: "pending" },
      after: { status: "received" },
    },
  };
};

export const declineDonation: Command<
  { donationId: string; reason: string },
  void
> = async (tx, ctx, input) => {
  requireManager(ctx);
  requireIdentifiedActor(ctx);

  // Required and trimmed, matching `RejectMembership`, `RejectComment` and
  // `RejectProfileChange`. `book_donations_declined_has_reason`
  // (`0006_community.sql:83`) catches null and says nothing about whitespace,
  // and would surface as a 23514 rather than as OPS's sentence.
  const reason = input.reason.trim();
  if (!reason) throw new ValidationFailed("reject_reason_required", "reason");

  const donation = await pendingDonation(tx, input.donationId);

  // `status` and `decision_note` in one statement, never two — the constraint
  // above is `check (status <> 'declined' or decision_note is not null)`, so an
  // update that moved the status first would raise 23514.
  await tx`
    update book_donations
       set status = 'declined',
           decision_note = ${reason},
           decided_by = ${ctx.actor.userId},
           decided_at = ${ctx.clock.now()}
     where id = ${donation.id}
  `;

  return {
    result: undefined,
    audit: {
      action: "donation.declined",
      entityType: "donation",
      entityId: donation.id,
      before: { status: "pending" },
      after: { status: "declined", reason },
    },
  };
};
