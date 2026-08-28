<?php

namespace App\Support\Circulation;

use App\Models\BookCopy;
use Illuminate\Support\Collection;

/**
 * The quick-lend copy chooser — port of chooseCopyToLend
 * (old_next/src/lib/lending.ts:120). BR §16.3 sketched a copy selector;
 * the reference auto-picks the lowest-code lendable copy instead, so step
 * 2 and step 3 name the same physical book (plan divergence 9).
 *
 * heldForUserId is passed as null and forUserId as '' — '' is never a
 * users.id, so the held branch always refuses here: this screen can lend
 * a held copy to nobody (collecting a hold is Phase 2's HandoverRequest),
 * which is the conservative answer the reference gives for the same
 * reason.
 *
 * The no-copies case returns its own code, title_has_no_copies (settled
 * decision 4). The reference folded it into copy_not_available, whose
 * sentence names a loan and a hold that do not exist; the product owner
 * ruled the false sentence out. The reference's reason for folding —
 * step 1's aggregate and this screen must not disagree, the exact failure
 * BR §16.3 forbids — is honoured because SearchBooksForLendingQuery
 * carries the IDENTICAL three-way branch. Change one, change the other,
 * in the same commit.
 *
 * @param  Collection<int, BookCopy>  $copies  the title's live copies, any order
 * @return array{copy: ?BookCopy, reason: ?string}
 */
final class ChooseCopy
{
    /**
     * @param  Collection<int, BookCopy>  $copies
     * @return array{copy: ?BookCopy, reason: ?string}
     */
    public static function lowestLendable(Collection $copies): array
    {
        if ($copies->isEmpty()) {
            return ['copy' => null, 'reason' => 'title_has_no_copies'];
        }

        $sawReturnable = false;

        foreach ($copies->sortBy('code')->values() as $copy) {
            $reason = LoanRules::copyLendable($copy->state, null, '');
            if ($reason === null) {
                return ['copy' => $copy, 'reason' => null];
            }
            if ($reason === 'copy_not_available') {
                $sawReturnable = true;
            }
        }

        return [
            'copy' => null,
            'reason' => $sawReturnable ? 'copy_not_available' : 'copy_lost_or_retired',
        ];
    }
}
