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
 * A manager turns away an offer of books, with a reason the donor reads —
 * BR §7.7's pending -> declined, OPS §4.4's DeclineDonation. Port of
 * old_next/src/domain/community/commands/donations.ts's declineDonation.
 *
 * THE REASON IS REQUIRED AND TRIMMED, and the code is 1b's
 * `reject_reason_required` reused rather than minted again. OPS §4.4 was
 * opened for this: its DeclineDonation lists the failure mode
 * `reason_required` — "Vui lòng ghi lý do từ chối." — which is character
 * for character the sentence lang/vi/rules.php already carries under
 * reject_reason_required. §4.4 also gives the reason the rule exists at
 * all: the decline is "reason required — matching every other rejection
 * flow in this catalogue (`RejectMembership`, `RejectComment`,
 * `RejectProfileChange`)". The reason is the message: OPS §3.2's
 * GetMyDonations returns it to the donor as the "decision note if
 * declined", so a decline with nothing in it is a screen telling a child
 * no and not why.
 *
 * THE CHECK RUNS BEFORE THE TRANSACTION, so a blank reason never opens
 * one.
 *
 * STATUS AND NOTE GO IN ONE update(), NEVER TWO, and this is a database
 * constraint rather than a preference. Read off the live table:
 *
 *     CONSTRAINT book_donations_declined_has_reason
 *       CHECK (`status` <> 'declined' or `decision_note` is not null)
 *
 * so a write that moved the status first would be refused between the
 * steps and the sentence a volunteer read would be a database error
 * rather than OPS's. MEASURED on this method, by splitting the update()
 * below into a STATUS write followed by a note write: blocks of
 * tests/Feature/Community/DonationDecisionsTest.php fail on the status
 * write, with
 *
 *     SQLSTATE[23000]: Integrity constraint violation: 4025 CONSTRAINT
 *     `book_donations_declined_has_reason` failed for
 *     `olibra_testing`.`book_donations` (… SQL: update `book_donations`
 *     set `status` = declined, `decided_by` = …, `decided_at` = … where
 *     `id` = …)
 *
 * and the exception exits execute() rather than reaching an assertion —
 * what the split costs is the whole Pest method, so the "together" those
 * blocks are titled for is never examined. That is the constraint
 * answering before the test can. (Fix round 1 removed the pass/fail
 * counts that were quoted here: they went stale the moment an eleventh
 * block landed. They belong to the task's report, which carries them.)
 *
 * THE OTHER SPLIT — NOTE FIRST, THEN STATUS — IS NOT REFUSED BY THE
 * DATABASE AT ALL. Both statements satisfy the CHECK on their way
 * through, the committed row is identical, and measured at the parent
 * commit it left every block in that file green. What refuses it is a
 * test rather than the schema: fix round 1 added "the decline leaves ONE
 * update statement, carrying the status and the note together", which
 * reads the query log and requires exactly one update of book_donations
 * carrying both columns. Under the note-first split it fails on that
 * count line, with both statements in the failure message.
 *
 * decided_by IS A users(id) — `CONSTRAINT
 * book_donations_decided_by_foreign FOREIGN KEY (decided_by) REFERENCES
 * users (id)`, read off the live table — while donor_membership_id five
 * columns earlier is a memberships(id). (Fix round 1 corrected "three
 * columns along": ordinal 3 against decided_by's ordinal 8, re-read off
 * information_schema.columns.) Two uuid columns, two directions, one
 * table. ReceiveDonation's docblock carries the same reading, and
 * DonationDecisionsTest asserts the direction against both ids there.
 *
 * ONE CODE FOR "no such offer" AND "already decided" IS NOT WHAT THIS
 * PORT DOES — see ReceiveDonation's docblock for plan divergence 3 and
 * for what it is worth at this commit.
 *
 * The lock is the transaction's first statement, on the ground
 * CommunityArchitectureTest's FOR-UPDATE record states: the refusal reads
 * status off the same locked row, so two managers deciding at once cannot
 * both find the offer pending. For THIS command that ordering is read
 * rather than merely claimed — the query-log block named above also
 * requires the log's first statement to be a FOR UPDATE select against
 * book_donations, and a plain read placed in front of the lock reddens
 * it. The transaction retries because every write transaction in this
 * phase does (plan divergence 1), and the row and its audit entry commit
 * together.
 */
final class DeclineDonation
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    /** @return array{donationId: string} */
    public function execute(User $actor, BookDonation $donation, string $reason): array
    {
        Gate::forUser($actor)->authorize('decline', $donation);

        // Before the transaction, so three spaces never opens one.
        $trimmed = trim($reason);
        if ($trimmed === '') {
            throw new RuleViolated('reject_reason_required');
        }

        return DB::transaction(function () use ($actor, $donation, $trimmed): array {
            // FIRST statement — the only lock this command takes. No
            // shelf predicate is written here and there must not be one:
            // BookshelfScope on the model confines the re-read, so
            // another shelf's row is not found rather than refused.
            $locked = BookDonation::query()->lockForUpdate()->findOrFail($donation->id);

            if ($locked->status !== DonationStatus::Pending) {
                throw new RuleViolated('donation_not_pending');
            }

            // ONE update(), carrying the status and the note together.
            // Splitting it is refused by book_donations_declined_has_reason
            // with errno 4025 — see the docblock for the measured message.
            $locked->update([
                'status' => DonationStatus::Declined,
                'decision_note' => $trimmed,
                'decided_by' => $actor->id,
                'decided_at' => $this->clock->now(),
            ]);

            $this->audit->record('donation.declined', 'donation', $locked->id,
                ['status' => 'pending'],
                ['status' => 'declined', 'reason' => $trimmed],
            );

            return ['donationId' => $locked->id];
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
