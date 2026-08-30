<?php

namespace App\Queries;

use App\Enums\DonationStatus;
use App\Models\BookDonation;

/**
 * OPS §3.3's GetDonationQueue — the manager's pending offers, oldest
 * first, so §16.3's *Tặng sách* queue drains like a queue rather than
 * sitting like a pile. Port of
 * old_next/src/domain/community/queries/get-my-donations.ts's
 * getDonationQueue (both reads live in one reference file).
 *
 * WHY THE DONOR'S NAME AND ID BOTH RIDE THE ROW. BR §16.3's Donation
 * queue paragraph, opened: "**Duyệt** opens the add-book form with
 * **Người tặng** pre-filled with that member and moves the donation to
 * `received` (§7.7)". The screen needs the name to show and the
 * membership id to hand to that form. donorMembershipId is a
 * memberships(id) — App\Models\BookDonation's donor() docblock quotes the
 * live constraint — and OPS §4.1's `CreateBook` entry (opened) names the
 * same spelling on the receiving end: "**Người tặng** accepts either an
 * existing member found by search (`donorMembershipId`) or a typed name
 * for someone with no account (`donorName`)". So both ends of the
 * hand-off agree on which table the id came from.
 *
 * THE DONOR IS EAGER-LOADED THROUGH donor()/user(), NOT JOINED. A join()
 * condition naming bookshelf_id is a documented blind spot of
 * tests/Feature/Architecture/TenancyArchitectureTest's filter grep
 * (opened — its pattern comment names "a join() condition naming the
 * column" as one of two gaps left open on purpose). What the relation
 * costs is two extra SELECTs per read instead of one statement, on a set
 * bounded by its own state; what it buys is staying out of that gap.
 *
 * IT ALSO CHANGES WHAT HAPPENS TO A DONATION WHOSE DONOR HAS GONE, and
 * that is a divergence from the reference worth recording rather than
 * discovering. get-my-donations.ts's getDonationQueue inner-joins
 * memberships and users, so a donation whose membership row had vanished
 * would drop out of the queue entirely. App\Models\Membership and
 * App\Models\User both use SoftDeletes (opened), which puts a
 * `deleted_at is null` on the eager loads, so a trashed donor comes back
 * as a null relation rather than removing the donation from the list —
 * the nullsafe chain below is what turns that into an empty name, and the
 * row STAYS. NOT MEASURED against a trashed donor: no block in
 * DonationQueriesTest seeds one, and this paragraph is reasoning from the
 * trait, not from a run. Keeping the row is deliberate either way: it is
 * exactly the offer a manager needs to be able to clear, and
 * BorrowRequestQueueQuery's docblock makes the same argument for its own
 * outward join ("an inner join would drop every request whose reader has
 * left, precisely the row a manager needs in order to clear it").
 *
 * OLDEST FIRST, with `id` beside `created_at` for the tie — the mirror
 * of MyDonationsQuery's newest-first ordering over the same two columns,
 * and the reason each states its own: an archive is browsed, a queue is
 * worked. The id half is pinned in the compiled SQL rather than by row
 * order, on the same measurement its twin records: deleting
 * `->orderBy('id')` below left every row-order block in
 * DonationQueriesTest green, and "the queue's id tiebreak is in the ORDER
 * BY text" is what reddens on it.
 *
 * THE EIGHT SHARED KEYS ARE WRITTEN OUT AGAIN rather than extracted, and
 * that is a decision this task's file list forced rather than one weighed
 * on its merits: sharing the row builder with MyDonationsQuery means a
 * third file (a trait under app/Queries/Concerns, or a presenter), and
 * the brief for this task allows two query classes and one test file.
 * This row adds donorName and donorMembershipId on top of the eight keys
 * MyDonationsQuery also builds, each written as the same expression in
 * both places — a drift-capable pair, recorded as one rather than left to
 * be found. Whoever adds the third read, or the count badge below, should
 * extract it then.
 *
 * TENANCY IS BookshelfScope's, on BookDonation itself. No bookshelf_id is
 * written here and no join carries one.
 *
 * NO INLINE GATE, the house shape BorrowRequestQueueQuery's docblock
 * argues at length for its own file (opened).
 *
 * THERE IS NO COUNT METHOD HERE YET, and the reason is that nothing calls
 * one — not that nothing asks for one. Both documents ask: BR §16.3's
 * Donation queue paragraph opens "Reachable from the sidebar nav with a
 * count badge", and OPS §3.3's GetDonationQueue row gives "Queue count
 * for the badge" in its *Derived on read* column (both opened). What BR
 * §16.3 refuses in the same sentence is something else — "deliberately
 * **not** a fifth dashboard stat card". So the badge is a live
 * requirement waiting on the nav that renders it, and whoever builds that
 * nav should add the count here, delegating to the same predicate this
 * read uses, the way CommentModerationQuery::countPending() and
 * BorrowRequestQueueQuery::countWaiting() already do for their screens
 * (both opened).
 *
 * TASK 19 BUILT THAT NAV AND STILL DID NOT ADD THE COUNT, which is an
 * answer to the paragraph above rather than an oversight, so it is
 * recorded here rather than left for the next reader to re-derive.
 * resources/js/layouts/manage-layout.tsx (opened, and edited in that same
 * commit) builds its sidebar from a list of name/href pairs and is handed
 * one prop, `shelf` — so the badge is not a number this file is missing,
 * it is a channel that layout does not have. Adding countPending() first
 * would have shipped a method with no caller. The requirement stays open;
 * whoever gives that layout a counts prop is the caller this method is
 * waiting for.
 */
final class DonationQueueQuery
{
    /**
     * Pending offers, oldest first, with the donor.
     *
     * @return list<array{donationId: string, description: string, photoUrl: string|null, estimatedCount: int|null, status: string, decisionNote: string|null, offeredAt: string, decidedAt: string|null, donorName: string, donorMembershipId: string}>
     */
    public function run(): array
    {
        // array_values is a level-8 requirement rather than belt and
        // braces: ->values()->all() gives PHPStan array<int, ...>, not
        // list<...>.
        return array_values(BookDonation::query()
            ->with('donor.user')
            ->where('status', DonationStatus::Pending)
            ->orderBy('created_at')
            ->orderBy('id')
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
                'decisionNote' => $donation->decision_note,
                'offeredAt' => (string) $donation->created_at->toISOString(),
                'decidedAt' => $donation->decided_at?->toISOString(),
                // Nullsafe and cast to string: donor and user reach
                // Larastan as possibly-null belongsTo accessors even
                // though donor_membership_id and user_id are non-nullable
                // columns, and the SoftDeletes paragraph above is the
                // case where the null is real rather than notional.
                'donorName' => (string) $donation->donor?->user?->full_name,
                'donorMembershipId' => (string) $donation->donor_membership_id,
            ])
            ->values()
            ->all());
    }
}
