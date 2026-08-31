<?php

namespace App\Queries;

use App\Models\BookDonation;
use App\Models\Membership;

/**
 * OPS §3.2's GetMyDonations — a reader's own offers, so §16.2's *Tặng
 * sách* screen can say what happened to each. Port of
 * old_next/src/domain/community/queries/get-my-donations.ts's
 * getMyDonations. Opened: that row of the §3.2 table gives `membershipId`
 * as the input and "Donation rows: description, estimated count, status,
 * decision note if declined" as the Returns.
 *
 * THE PARAMETER IS A MEMBERSHIP AND THAT IS THE GUARD.
 * book_donations.donor_membership_id references memberships(id) —
 * App\Models\BookDonation's donor() docblock quotes the live constraint —
 * and comments.author_id two tables along is a users(id), so neither
 * direction is inferable from a column name and both columns hold 36-char
 * uuid strings. The reference's docblock names what a wrong id costs
 * here: "Comparing a user id here matches nothing, which would read as
 * 'this reader has never offered anything' rather than as an error." A
 * typed Membership makes that mistake unwritable at the call site rather
 * than silent at the predicate, which is why run() does not take a string.
 *
 * NEWEST FIRST, with `id` beside `created_at`. This is the reader's own
 * page: the offer they just made is the one they came to look at. The id
 * is there because created_at carries no unique constraint. MEASURED,
 * `show index from book_donations` against olibra_testing (2026-08-30):
 * four indexes — PRIMARY on id, plus the non-unique
 * book_donations_decided_by_foreign, book_donations_queue over
 * (bookshelf_id, created_at) and book_donations_donor_membership_fk over
 * (bookshelf_id, donor_membership_id). Nothing unique carries created_at,
 * so two offers made in the same microsecond need a second key to land in
 * a fixed order.
 * DonationQueriesTest's first block pins the DIRECTION against three rows
 * at three instants. The id half needed a different kind of pin, and the
 * reason is measured rather than argued: deleting `->orderByDesc('id')`
 * below leaves all seven blocks that existed at that run green — of
 * which only two assert row order at all; the measured fact is that the
 * whole file stayed green, not that seven orderings were checked. Because
 * their fixtures use distinct instants and nothing in them ties. So it is
 * pinned in the compiled SQL instead — "my-donations' id tiebreak is in
 * the ORDER BY text" reads the statement's `order by` clause and reddens
 * on that deletion. What a same-instant pair would do on this engine was
 * not tested, and this file makes no claim about it.
 *
 * TENANCY IS BookshelfScope's, on BookDonation itself: no bookshelf_id is
 * written here. That matters more than usual because the donor predicate
 * is not a tenant predicate — a membership id is unique across shelves,
 * so this WHERE, on its own, would answer correctly for a foreign
 * membership. DonationQueriesTest's tenancy block — "another shelf's
 * offers appear in neither", not its last, which is a later-appended
 * ORDER BY pin — reads
 * with a foreign membership under this shelf's binding and gets an empty
 * list, which separates the two guards.
 *
 * NO deleted_at: App\Models\BookDonation carries no SoftDeletes and its
 * docblock records the `show create table` reading behind that.
 *
 * NO INLINE GATE, the house shape BorrowRequestQueueQuery's docblock
 * argues at length for its own file (opened).
 *
 * PHOTO URL RIDES THE ROW even though nothing writes the column yet:
 * App\Actions\Community\OfferDonation's docblock says "photo_url stays
 * null, and the column is there for a later uploader to write" (opened).
 * get-my-donations.ts returns it from `toRow`, the row builder both of
 * its two exported reads call, and a screen has to handle a null photo
 * either way.
 */
final class MyDonationsQuery
{
    /**
     * The reader's own offers, newest first.
     *
     * @return list<array{donationId: string, description: string, photoUrl: string|null, estimatedCount: int|null, status: string, decisionNote: string|null, offeredAt: string, decidedAt: string|null}>
     */
    public function run(Membership $membership): array
    {
        // array_values is a level-8 requirement rather than belt and
        // braces: ->values()->all() gives PHPStan array<int, ...>, not
        // list<...>.
        return array_values(BookDonation::query()
            ->where('donor_membership_id', $membership->id)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->get()
            ->map(fn (BookDonation $donation): array => [
                'donationId' => $donation->id,
                'description' => (string) $donation->description,
                'photoUrl' => $donation->photo_url,
                'estimatedCount' => $donation->estimated_count === null ? null : (int) $donation->estimated_count,
                // ->status->value, never (string) on the attribute:
                // App\Models\BookDonation casts status to
                // App\Enums\DonationStatus, so the cast form would be
                // (string) on an enum OBJECT — a fatal on every row.
                'status' => $donation->status->value,
                // The whole reason a decline requires a reason: the
                // reader reads it. The requirement is BR §5.4's
                // BookDonation entity line — "decision note (reason
                // required on decline, matching every other rejection
                // flow in this document)". CITED AS §7.7 IN A FIRST
                // DRAFT, and wrongly, with an "(opened)" beside it: §7.7
                // is the pending → received/declined lifecycle diagram
                // and its only wording is "manager declines, with a
                // reason". Named rather than silently corrected, because
                // the same wrong section reached two files in one
                // commit. docs/OPERATIONS.md already cites it as
                // "BR §5.4, BookDonation".
                'decisionNote' => $donation->decision_note,
                'offeredAt' => (string) $donation->created_at->toISOString(),
                'decidedAt' => $donation->decided_at?->toISOString(),
            ])
            ->values()
            ->all());
    }
}
