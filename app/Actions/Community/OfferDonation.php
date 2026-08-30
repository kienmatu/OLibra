<?php

namespace App\Actions\Community;

use App\Exceptions\RuleViolated;
use App\Models\BookDonation;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\ConcurrencyRetry;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Tặng sách — a reader offers books they no longer want. BR §7.7's
 * pending, OPS §4.4's OfferDonation. Port of
 * old_next/src/domain/community/commands/donations.ts's offerDonation.
 *
 * book_donations.donor_membership_id REFERENCES memberships(id) — a
 * MEMBERSHIP id, which is the reverse of comments.author_id two tables
 * along, a users(id) written by this same phase. Neither direction is
 * inferable from a column name, both are 36-char uuid strings, and
 * OfferDonationTest asserts the stored value IS the membership's id and
 * IS NOT the user's, in two separate statements.
 *
 * THE DATABASE IS A BACKSTOP HERE, and saying what it is not matters as
 * much as saying what it is. The foreign key is composite —
 * `FOREIGN KEY (bookshelf_id, donor_membership_id) REFERENCES
 * memberships (bookshelf_id, id)`, read off the live table — so a
 * membership belonging to another shelf and a users(id) written into
 * this column are both refused by the server rather than stored. What
 * that refusal is worth is a 500 to a reader who just offered their
 * books, so it is a reason to keep the id coming from the bound
 * membership and never a licence to take it from somewhere looser.
 *
 * DELIBERATELY THIN. OPS §4.4 says why: free text and a rough count,
 * "because a child does not know a publisher or an ISBN, and book data
 * is only worth recording once a volunteer has the book in hand". The
 * reference's optional photo is not ported: plan divergence 11 settles
 * that, on the ground that a parameter no caller can supply is the
 * reachable-from-nowhere shape. photo_url stays null, and the column is
 * there for a later uploader to write.
 *
 * THIS TABLE IS THE OFFER, NEVER A COPY'S PROVENANCE. DB §4.8 draws the
 * line and the reference's file docblock quotes it. Provenance lives on
 * book_copies.acquired_from / acquired_from_membership_id, written by a
 * different command; App\Models\BookDonation's docblock carries the
 * information_schema reading that shows the server joins the two tables
 * by nothing at all. A bag of ten books offered here can become three
 * catalogued copies, duplicates, or nothing at all.
 *
 * The caller's membership is not an input (plan divergence 4): the
 * session already resolved one for the bound shelf. not_permitted is
 * still reachable — Gate::before grants every act-as-* ability to a
 * super admin, so a super admin with no membership of this shelf passes
 * the policy with a null membership and lands here. It fails closed and
 * OfferDonationTest posts that exact case over HTTP.
 *
 * THE DESCRIPTION IS NOT IN THE AUDIT PAYLOAD. It is free text a child
 * wrote, on a row that survives, and BR §14 asks the log to record what
 * changed rather than to duplicate it — a second copy is a second thing
 * to redact if they ever ask for theirs to be removed. The reference's
 * own payload is the status and the count.
 *
 * No lock: this command re-reads nothing and guards no uniqueness rule.
 * A reader may offer twice, and the port stays at what OPS §4.4 lists.
 * The transaction is here so the row and
 * its audit entry commit together, and it retries because every write
 * transaction in this phase does (plan divergence 1).
 */
final class OfferDonation
{
    public function __construct(
        private TenantContext $tenant,
        private AuditRecorder $audit,
    ) {}

    /** @return array{donationId: string} */
    public function execute(User $actor, string $description, ?int $estimatedCount = null): array
    {
        Gate::forUser($actor)->authorize('create', BookDonation::class);

        $membership = $this->tenant->membership();
        if ($membership === null || $membership->user_id !== $actor->id) {
            throw new RuleViolated('not_permitted');
        }

        // Trimmed, so a description of three spaces is the same as none.
        // The column is `description text NOT NULL` and would take the
        // whitespace happily.
        $trimmed = trim($description);
        if ($trimmed === '') {
            throw new RuleViolated('empty_description');
        }

        return DB::transaction(function () use ($membership, $trimmed, $estimatedCount): array {
            // bookshelf_id is absent on purpose: BelongsToBookshelf's
            // creating hook stamps it from the bound tenant, and naming
            // it here would be the hand-written scope this project bans.
            //
            // status is absent for a different reason: the column
            // defaults to 'pending' (`status varchar(20) NOT NULL
            // DEFAULT 'pending'`, read off the live table), so the INSERT
            // leaves where an offer starts to the schema. The literal
            // below in the audit payload is a second statement of the
            // same fact and is the reference's own shape; it describes
            // the state the row lands in rather than a value this method
            // wrote.
            $donation = BookDonation::query()->create([
                // A memberships(id). See the class docblock.
                'donor_membership_id' => $membership->id,
                'description' => $trimmed,
                'estimated_count' => $estimatedCount,
            ]);

            $this->audit->record('donation.offered', 'donation', $donation->id, null, [
                'status' => 'pending',
                'estimated_count' => $estimatedCount,
            ]);

            return ['donationId' => $donation->id];
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
