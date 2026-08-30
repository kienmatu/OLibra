<?php

namespace App\Actions\Community;

use App\Enums\DonationStatus;
use App\Exceptions\RuleViolated;
use App\Models\BookDonation;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use App\Support\ConcurrencyRetry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A manager accepts an offer of books — BR §7.7's pending -> received,
 * OPS §4.4's ReceiveDonation. Port of
 * old_next/src/domain/community/commands/donations.ts's receiveDonation.
 *
 * IT WRITES NO `books` ROW AND NO `book_copies` ROW. The reference's own
 * docblock for this command, quoted because the sentence is the point:
 * "This is the decision most likely to be 'improved' later by somebody
 * who reasons that a received donation ought to create its own catalogue
 * entry. It must not." OPS §4.4 gives the reason in its own words — the
 * manager "separately runs `CreateBook` or `AddCopies` (§4.1, above) with
 * `donorMembershipId` set to this donor, which the queue screen
 * pre-fills: §16.3 describes Duyệt as opening the add-book form with
 * Người tặng pre-filled with that member." Both sections were opened for
 * this. Inventing rows here would put a book on the shelf that nobody has
 * looked at, with a title nobody typed: a bag of ten books can become
 * three catalogued copies, duplicates, or nothing at all.
 *
 * So the convenience fails rather than ships:
 * tests/Feature/Community/DonationDecisionsTest.php's "receiving writes
 * no books row and no book_copies row" counts zero of each, without
 * global scopes, after this method returns.
 *
 * WHAT LINKS THE TWO TABLES IS THE DONOR'S MEMBERSHIP ID, CARRIED BY
 * HAND from the queue into that form's pre-fill. Re-measured for this
 * command against information_schema.key_column_usage on this schema:
 * the query returns four rows for book_donations, all of them its own
 * outbound keys (bookshelf_id -> bookshelves, decided_by -> users, and
 * the composite donor key -> memberships), and it returns nothing at all
 * with book_donations as the REFERENCED table.
 *
 * decided_by IS A users(id) — `CONSTRAINT
 * book_donations_decided_by_foreign FOREIGN KEY (decided_by) REFERENCES
 * users (id)`, read off the live table — while donor_membership_id five
 * columns earlier is a memberships(id). (Fix round 1 corrected "three
 * columns along": donor_membership_id is ordinal 3 and decided_by is
 * ordinal 8, re-read off information_schema.columns for this schema.)
 * Two uuid columns, two directions, one table, and neither is inferable
 * from a column name.
 * DonationDecisionsTest asserts the stored value IS the manager's user id
 * and IS NOT their membership id, in two separate statements.
 *
 * ONE CODE FOR "no such offer" AND "already decided" IS NOT WHAT THIS
 * PORT DOES. The reference's pendingDonation folds both into
 * `donation_not_pending`; plan divergence 3 puts "missing" on route-model
 * binding and BookshelfScope instead — a 404 — and leaves only
 * wrong-status on the caller's own shelf for the RuleViolated below.
 *
 * BOTH HALVES OF THAT DIVERGENCE ARE NOW PINNED. This paragraph used to
 * read "THE BINDING HALF HAS NOTHING TO BIND YET. routes/web.php was
 * grepped for this and names no address reaching either decision command
 * — the queue screen is Task 19's — so route-model binding cannot be
 * exercised here." That was true when Task 16 wrote it and Task 19 is the
 * arrival it named: routes/web.php (opened) now declares
 * `shelves.manage.donations.receive` and its decline twin, and
 * tests/Feature/Community/ManagerDonationsScreenTest.php's "another
 * shelf's offer id 404s under this shelf's manage URL" runs both of them
 * with shelf B's offer id under shelf A's URL and requires 404 with the
 * row still pending. The scope half is pinned without a route, as it
 * always was:
 * tests/Feature/Community/DonationDecisionsTest.php's "another shelf's
 * offer is not found rather than refused" hands this method and
 * DeclineDonation's a row seeded on a second shelf and requires
 * ModelNotFoundException, which Laravel renders 404. Folding the missing
 * case back in — findOrFail() replaced by find() and a null lumped into
 * donation_not_pending, applied to both commands together — reddens that
 * block on both of its dataset rows, on the toThrow line.
 *
 * FIX ROUND 1 RETRACTED THE SENTENCE THAT STOOD HERE: "what holds the
 * divergence today is the shape of the code below". It was wrong when
 * written — that fold left the suite unchanged only because no block
 * asked either command for another shelf's id — while
 * tests/Feature/Community/AnnouncementStateTest.php's cross-shelf
 * dataset, opened for this, was already requiring
 * ModelNotFoundException of four announcement commands with no route
 * either.
 *
 * The lock is the transaction's first statement, and
 * CommunityArchitectureTest's FOR-UPDATE record states which side of its
 * line this command falls on: the refusal reads status off the same
 * locked row, so two managers pressing Duyệt at once cannot both find the
 * offer pending. The transaction retries because every write transaction
 * in this phase does (plan divergence 1), and the row and its audit entry
 * commit together.
 */
final class ReceiveDonation
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    /** @return array{donationId: string} */
    public function execute(User $actor, BookDonation $donation): array
    {
        Gate::forUser($actor)->authorize('receive', $donation);

        return DB::transaction(function () use ($actor, $donation): array {
            // FIRST statement — the only lock this command takes. No
            // shelf predicate is written here and there must not be one:
            // BookshelfScope on the model confines the re-read, so
            // another shelf's row is not found rather than refused.
            $locked = BookDonation::query()->lockForUpdate()->findOrFail($donation->id);

            if ($locked->status !== DonationStatus::Pending) {
                throw new RuleViolated('donation_not_pending');
            }

            $locked->update([
                'status' => DonationStatus::Received,
                'decided_by' => $actor->id,
                'decided_at' => $this->clock->now(),
            ]);

            $this->audit->record('donation.received', 'donation', $locked->id,
                ['status' => 'pending'],
                ['status' => 'received'],
            );

            return ['donationId' => $locked->id];
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
