<?php

namespace App\Actions\Catalogue;

use App\Exceptions\RuleViolated;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Catalogue\Donor;
use App\Support\Clock;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Adds physical copies to an already-catalogued title — port of
 * add-copies.ts. Separate from CreateBook for BR §16.3's reason: "a second
 * donated copy of a popular book arrives months after the first, and
 * editing the title is not where a volunteer would look for that." Its
 * donor fields are its own, not the title's.
 *
 * One audit entry PER COPY (OPS §4.1: "the record affected is singular per
 * entry, so a batch of five new copies is five audit rows"), deliberately
 * unlike CreateBook's single book.created — there the copies are part of
 * the one cataloguing event; here the copies ARE the fact.
 *
 * Same ordering contract as CreateBook (see that class's docblock):
 * AllocateCopyCodes::execute() must be the FIRST statement inside the
 * transaction, before any read — including the donor-membership lookup
 * below, which therefore happens only after the lock, same as CreateBook's
 * own membership check.
 */
final class AddCopies
{
    public function __construct(
        private AllocateCopyCodes $codes,
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array{count: int, donor_membership_id?: ?string, donor_name?: ?string, acquired_on?: ?string}  $input
     * @return Collection<int, BookCopy>
     */
    public function execute(User $actor, Book $book, array $input): Collection
    {
        Gate::forUser($actor)->authorize('addCopies', [BookCopy::class, $book]);
        Donor::assertSingle($input['donor_membership_id'] ?? null, $input['donor_name'] ?? null);

        // The domain does not trust a transport (OPS §2) — the Form
        // Request guards the HTTP path, this guards every path. Without
        // this check, execute(..., 0) would reach range(1, 0), which is
        // [1, 0] in PHP — two codes allocated for a zero-copy request.
        if ($input['count'] < 1) {
            throw new RuleViolated('copy_count_invalid');
        }

        return DB::transaction(function () use ($book, $input): Collection {
            // FIRST statement, before ANY read — see AllocateCopyCodes's
            // and CreateBook's docblocks. The donor-membership check below
            // is a read and must stay below this line.
            $codes = $this->codes->execute($input['count']);

            $donorMembershipId = isset($input['donor_membership_id']) && trim((string) $input['donor_membership_id']) !== ''
                ? trim((string) $input['donor_membership_id']) : null;

            if ($donorMembershipId !== null) {
                // Bypass-path twin of AddCopiesRequest's own scoped
                // existence check — see CreateBook's identical comment.
                // Membership::query() carries BookshelfScope, so a
                // membership belonging to another shelf is invisible here
                // exactly as a nonexistent one is.
                if (! Membership::query()->whereKey($donorMembershipId)->exists()) {
                    throw new RuleViolated('donor_membership_invalid');
                }
            }

            $acquiredOn = $input['acquired_on'] ?? $this->clock->today();
            $donorName = isset($input['donor_name']) && trim((string) $input['donor_name']) !== ''
                ? trim((string) $input['donor_name']) : null;

            $copies = collect();

            foreach ($codes as $code) {
                $copy = BookCopy::query()->create([
                    'book_id' => $book->id,
                    'code' => $code,
                    'state' => 'available',
                    'condition' => 'perfect',
                    'acquired_on' => $acquiredOn,
                    'acquired_from' => $donorName,
                    'acquired_from_membership_id' => $donorMembershipId,
                ]);

                $this->audit->record('copy.added', 'copy', $copy->id, null, [
                    'code' => $code,
                    'bookId' => $book->id,
                    'state' => 'available',
                    'acquiredOn' => $acquiredOn,
                    'acquiredFrom' => $donorName,
                    'acquiredFromMembershipId' => $donorMembershipId,
                ]);

                $copies->push($copy);
            }

            return $copies;
        });
    }
}
