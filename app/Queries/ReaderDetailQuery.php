<?php

namespace App\Queries;

use App\Enums\LoanStatus;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Support\Clock;
use App\Support\Members\ParishUnits;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\ModelNotFoundException;

/**
 * GetReaderDetail (OPS §3.3): the full BR §5.3 manager view — the
 * manager-only person fields, credentials as a boolean plus the username
 * (never the hash: the username travels only so "Đặt lại mật khẩu" can
 * resubmit it unchanged in a hidden field), the membership's own facts,
 * the loans currently out, and the pending profile change as a
 * display-only stub (its lifecycle is Phase 3's).
 *
 * days-remaining / overdue are derived from Clock::today() at read time
 * (BR §8). 1c will centralise this math in app/Support/Circulation and
 * this query switches to it then — known-gaps carries the hand-off.
 */
final class ReaderDetailQuery
{
    public function __construct(
        private Clock $clock,
        private ParishContextQuery $parish,
    ) {}

    /** @return array<string, mixed> */
    public function run(Membership $membership): array
    {
        $person = User::query()->find($membership->user_id);
        if ($person === null) {
            throw new ModelNotFoundException;   // a soft-deleted identity is no reader
        }

        $context = $this->parish->run();
        $today = CarbonImmutable::parse($this->clock->today());

        $loans = Loan::query()
            ->where('borrower_id', $person->id)
            ->where('status', LoanStatus::Active)
            ->orderBy('due_on')->orderBy('id')
            ->get();

        // withTrashed: a soft-deleted book or copy still leaves the loan
        // on the reader's list — the loan is a fact about the world.
        $books = Book::query()->withTrashed()->whereIn('id', $loans->pluck('book_id'))->get()->keyBy('id');
        $copies = BookCopy::query()->withTrashed()->whereIn('id', $loans->pluck('copy_id'))->get()->keyBy('id');

        $currentLoans = $loans->map(function (Loan $loan) use ($books, $copies, $today): array {
            $due = CarbonImmutable::parse((string) $loan->due_on);

            return [
                'loanId' => $loan->id,
                'bookId' => $loan->book_id,
                'title' => $books[$loan->book_id]->title ?? '',
                'coverUrl' => $books[$loan->book_id]->cover_url ?? null,
                'copyCode' => $copies[$loan->copy_id]->code ?? '',
                'dueOn' => $due->toDateString(),
                'isOverdue' => $due->lessThan($today),
                'daysRemaining' => (int) $today->diffInDays($due, false),
            ];
        })->all();

        $pending = ProfileChangeRequest::query()
            ->where('user_id', $person->id)
            ->where('status', 'pending')
            ->first();

        return [
            'membershipId' => $membership->id,
            'userId' => $person->id,
            'fullName' => $person->full_name,
            'saintName' => $person->saint_name,
            'status' => $membership->status->value,
            'role' => $membership->role->value,
            'dateOfBirth' => $person->date_of_birth?->toDateString(),
            'fatherName' => $person->father_name,
            'motherName' => $person->mother_name,
            'phone' => $person->phone,
            'phoneMissingReason' => $person->phone_missing_reason,
            'email' => $person->email,
            'avatarObject' => $person->avatar_object,
            'hasCredentials' => $person->username !== null,
            'username' => $person->username,
            'managerNotes' => $membership->manager_notes,
            'rejectionReason' => $membership->rejection_reason,
            'suspensionReason' => $membership->suspension_reason,
            'approvedAt' => $membership->approved_at?->toIso8601String(),
            'parishUnitL1Id' => $membership->parish_unit_l1_id,
            'parishUnitL2Id' => $membership->parish_unit_l2_id,
            'parishLine' => ParishUnits::describeSelection(
                $context['taxonomy'], $context['units'],
                $membership->parish_unit_l1_id, $membership->parish_unit_l2_id,
            ),
            'parishUnitL1Name' => ParishUnits::unitName($context['units'], $membership->parish_unit_l1_id),
            'parishUnitL2Name' => ParishUnits::unitName($context['units'], $membership->parish_unit_l2_id),
            'holdingCount' => count($currentLoans),
            'currentLoans' => $currentLoans,
            'pendingProfileChange' => $pending === null
                ? null
                : ['id' => $pending->id, 'requestedAt' => $pending->created_at->toIso8601String()],
        ];
    }
}
