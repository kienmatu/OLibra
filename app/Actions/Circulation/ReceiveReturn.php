<?php

namespace App\Actions\Circulation;

use App\Enums\CopyCondition;
use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\BookCopy;
use App\Models\BorrowRequest;
use App\Models\ConditionAssessment;
use App\Models\Loan;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Circulation\LendingSettings;
use App\Support\Circulation\LoanTerms;
use App\Support\Clock;
use App\Support\ConcurrencyRetry;
use App\Support\Notifications\NotificationKind;
use App\Support\Notifications\Notifier;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Closes a loan and records the copy's condition — OPS §5's walk, BR
 * §16.3's two-tap common case. RE-WIDENED in Phase 2a to the reference's
 * full shape (receive-return.ts), discharging 1c divergence 4: the
 * queued-reader decision is back, and it is NEVER automatic — OPS §5:
 * "the manager decides, because the next reader may not be standing
 * there." A pending request for this title is REPORTED
 * (queuedRequestId) and acted on only when the caller passes
 * $holdForRequestId. When they do, both facts commit in this one
 * transaction with two audit rows — a return that succeeded while its
 * hold failed would leave a book on the shelf the system believes is
 * with a reader (G3).
 *
 * Lock order (divergence 1): copy FIRST (from the route-bound loan's
 * own copy_id attribute, no query), then the loan, then — new here —
 * the PENDING hold-for request, a third lock the reference never took:
 * its resolveHold was a plain read a concurrent CancelOwnRequest could
 * invalidate mid-transaction. The phase's declared order is copy → loan
 * → membership → request; this command takes the first, the second and
 * the fourth, in that order.
 *
 * Where that puts this command in divergence 1's recorded AB–BA edge,
 * stated rather than left to be rediscovered: taking the request lock
 * AFTER the copy lock puts it on the SAME side as ApproveBorrowRequest
 * and LendCopy — holding the copy, wanting the request — opposite
 * CancelOwnRequest's documented residual window, which holds the
 * request and wants the copy. So this is a third participant on an edge
 * already recorded, not a new direction. That is a reading of the
 * lockForUpdate call sites and guarded UPDATEs under app/Actions, not a
 * reproduction: no cycle-freedom claim is made here, because this phase
 * has no two-OS-process harness to earn one. The loan lock adds no
 * pair of its own — every other command that locks a loan (VoidLoan,
 * ReportCopyLost) locks the copy first as this one does, and RenewLoan
 * locks the loan and nothing else.
 *
 * Kept from 1c because it is still true and still tested: copy-then-loan
 * is ReportCopyLost's order too, so a return racing "bạn đọc báo làm
 * mất" on the same copy serialises instead of deadlocking, and whichever
 * commits second sees the closed loan and refuses cleanly
 * (loan_not_active — the double-submit sentence, OPS §4.2's one
 * deliberate code for not-found, not-mine and already-processed alike).
 * ReceiveReturnTest's "divergence 2" test pins the counterparty.
 *
 * The copy moves in ONE statement to held-or-available — never
 * available then held. The transaction makes the intermediate state
 * unobservable anyway; one write is also one fewer state to reason
 * about, and the state-machine table is deliberately not consulted for
 * the composed arrow (the reference's on_loan → held note).
 *
 * hold_expires_at is written from the injected clock and compared
 * against the injected clock on every later read — the sharpest case of
 * the two-clocks rule (the reference's docblock).
 *
 * T27 (OPS §5): a worse condition never diverts the copy away from its
 * destination — held or available, the condition does not steer it.
 * condition_note moves with condition: one judgement, exactly as
 * AssessCondition writes them. loans_returned_has_condition: status and
 * return_condition are ONE update() — split writes raise the CHECK
 * mid-transaction.
 */
final class ReceiveReturn
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
        private Notifier $notifier,
        private TenantContext $tenant,
    ) {}

    /** @return array{loanId: string, queuedRequestId: ?string} */
    public function execute(
        User $actor,
        Loan $loan,
        CopyCondition $condition,
        ?string $note = null,
        ?string $photoUrl = null,
        ?string $holdForRequestId = null,
    ): array {
        Gate::forUser($actor)->authorize('receiveReturn', $loan);

        return DB::transaction(function () use ($actor, $loan, $condition, $note, $photoUrl, $holdForRequestId): array {
            // FIRST statement — copy_id is an in-memory attribute of the
            // route-bound model; reading it issues no query, so the copy
            // lock is genuinely the transaction's first statement.
            $copy = BookCopy::query()->lockForUpdate()->findOrFail($loan->copy_id);
            // SECOND — the loan, latest committed row, not the snapshot.
            $loan = Loan::query()->lockForUpdate()->findOrFail($loan->id);

            if ($loan->status !== LoanStatus::Active) {
                throw new RuleViolated('loan_not_active');
            }

            // THIRD — the hold-for request, when asked. Resolved before
            // anything is written, so a request_not_queued refusal costs
            // no write at all (the rollback is the guarantee either way —
            // the named test pins it — but this ordering spares a
            // reviewer reasoning about a partially-applied return).
            // request_not_queued covers both halves of OPS §4.2's wording
            // — the id "no longer points at a pending request FOR THIS
            // TITLE": the reader cancelled between page load and confirm,
            // or another manager approved them onto a different copy. A
            // request of another SHELF arrives as null too (the model's
            // bookshelf scope), which is the same answer for the same
            // reason spec §5.4 gives.
            $hold = null;
            if ($holdForRequestId !== null) {
                $hold = BorrowRequest::query()->lockForUpdate()->find($holdForRequestId);
                if ($hold === null || $hold->status !== RequestStatus::Pending || $hold->book_id !== $loan->book_id) {
                    throw new RuleViolated('request_not_queued');
                }
            }

            // ONE instant for the whole return — the injected Clock hands
            // back a fresh CarbonImmutable per call, so returned_at,
            // assessed_at, decided_at and hold_expires_at would otherwise
            // sit microseconds apart in production and identical under
            // setTestNow, which is the sort of difference no test sees.
            // (Named without its parentheses on purpose: this file's RAW
            // source, comments included, is grepped for a bare wall-clock
            // read by CirculationArchitectureTest — the same measured trap
            // ApproveBorrowRequest and LendCopy record.)
            $now = $this->clock->now();
            $trimmedNote = ($note === null || trim($note) === '') ? null : trim($note);
            // Captured BEFORE the $copy->update() below rewrites the row —
            // reading $copy->condition inside the audit call would yield the
            // NEW value, recording a transition that never happened.
            $previousCondition = $copy->condition->value;
            // Read once and STORED in both the audit row and the
            // notification payload (P1 §3.2a), so neither restates history
            // when UpdateBook later corrects the title.
            //
            // NULLABLE here, cast only at the notification below, and the
            // asymmetry is deliberate. $copy->book is null when the book
            // has been soft-deleted, and 1c's merged plain-return path
            // stored that null in the audit bag. Coercing it to "" would
            // silently change what a MERGED command records: the sentence
            // is unaffected (AuditSentences::str trims "" back to null)
            // but the audit expansion's payload row goes through
            // renderValue, which json_encodes with no trimming and would
            // render `""` where every earlier row reads `null`. The
            // notification takes the cast because Notifier's payload is
            // rendered as a string and a null title there has no reader —
            // ApproveBorrowRequest.php:154's shape exactly, where the cast
            // feeds a notification and never an audit row. Both spellings
            // are pinned by ReceiveReturnHoldTest's soft-deleted-book test.
            $title = $copy->book?->title;

            ConditionAssessment::query()->create([
                'copy_id' => $copy->id,
                'loan_id' => $loan->id,
                'assessed_by' => $actor->id,
                'condition' => $condition,
                'note' => $trimmedNote,
                'photo_url' => $photoUrl,
                'assessed_at' => $now,
            ]);

            $loan->update([
                'status' => LoanStatus::Returned,
                'returned_at' => $now,
                'received_by' => $actor->id,
                'return_condition' => $condition,
                'return_note' => $trimmedNote,
                'return_photo_url' => $photoUrl,
            ]);

            // ONE statement, held or available — see the class docblock.
            $copyState = $hold !== null ? CopyState::Held : CopyState::Available;
            $copy->update([
                'state' => $copyState,
                'condition' => $condition,
                'condition_note' => $trimmedNote,
            ]);

            $this->audit->record('loan.returned', 'loan', $loan->id,
                [
                    'status' => 'active',
                    'copy_state' => 'on_loan',
                    // Restored to the reference's shape (1d open question 3,
                    // owner-approved): the condition TRANSITION is what a
                    // damage-dispute investigation opens the expansion for.
                    // $previousCondition, NOT $copy->condition — the copy row
                    // was rewritten six lines up. Old rows lack the key and
                    // render an em dash, which is correct.
                    'condition' => $previousCondition,
                ],
                [
                    'status' => 'returned',
                    'copy_state' => $copyState->value,
                    'condition' => $condition->value,
                    'title' => $title,
                    'borrower_id' => $loan->borrower_id,
                ]);

            if ($hold !== null) {
                // The SHELF's hold_days, not the membership's — the same
                // read, for the same reason, ApproveBorrowRequest's
                // docblock argues at length.
                //
                // Unlike ApproveBorrowRequest's, THIS shelf_not_found is
                // unreachable, and saying so is better than implying a
                // sentence a manager can meet. MEASURED, not reasoned:
                // calling execute() with the tenant switched to
                // actSystemWide(), and again with it cleared, both refuse
                // at the Gate above with AuthorizationException before the
                // transaction opens. Two more backstops sit between there
                // and here — BookshelfScope fails closed on the copy lock
                // when nothing is bound, and AuditRecorder throws a
                // RuntimeException on the loan.returned row when
                // bookshelfId() (which is bookshelf()?->id) is null. The
                // check stays because bookshelf() returns ?Bookshelf and
                // LendingSettings::fromShelf takes a Bookshelf:
                // RuleViolated is the narrowing's exit, not a refusal a
                // manager reaches. The code keeps its rules.php sentence
                // either way — the census pins that.
                $shelf = $this->tenant->bookshelf();
                if ($shelf === null) {
                    throw new RuleViolated('shelf_not_found');
                }
                $holdExpiresAt = LoanTerms::holdExpiry($now, LendingSettings::fromShelf($shelf)->holdDays);

                $hold->update([
                    'status' => RequestStatus::Approved,
                    'copy_id' => $copy->id,
                    'hold_expires_at' => $holdExpiresAt,
                    'decided_by' => $actor->id,
                    'decided_at' => $now,
                ]);

                // The same payload shape ApproveBorrowRequest writes, so
                // ONE resolution rule covers both ways a hold is created
                // (divergence 6: userId from this door too — the reference
                // omits it here and leaves the second door's entry
                // subject-less in the audit browser).
                $this->audit->record('request.approved', 'request', $hold->id,
                    ['status' => 'pending', 'copy_id' => null],
                    [
                        'status' => 'approved',
                        'copy_id' => $copy->id,
                        'hold_expires_at' => $holdExpiresAt->toISOString(),
                        // A users(id) — member_id's name says membership,
                        // its FK says otherwise.
                        'userId' => $hold->member_id,
                    ]);

                // OPS §7: one kind from two doors — a child experiences
                // one event: their book is ready. Inside this transaction,
                // never after it, so the notification cannot outlive a
                // rolled-back hold. The date is the PARISH's day
                // (divergence 5).
                $this->notifier->notify($hold->member_id, NotificationKind::RequestApproved, [
                    'title' => (string) $title,
                    'hold_until' => $holdExpiresAt->timezone('Asia/Ho_Chi_Minh')->toDateString(),
                ]);
            }

            // Read AFTER the writes, so it answers "is anyone STILL
            // waiting?" — a just-held request is no longer pending, and
            // this is the next person along, or null. requested_at is the
            // ordering key; id breaks the tie deterministically, so two
            // requests written in the same instant still order the same
            // way on every read.
            $queuedRequestId = BorrowRequest::query()
                ->where('book_id', $loan->book_id)
                ->where('status', RequestStatus::Pending)
                ->orderBy('requested_at')->orderBy('id')
                ->value('id');

            return ['loanId' => $loan->id, 'queuedRequestId' => $queuedRequestId];
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
