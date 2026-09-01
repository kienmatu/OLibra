<?php

declare(strict_types=1);

namespace App\Queries;

use App\Models\Membership;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Support\Members\ProfileFields;
use Illuminate\Database\Eloquent\ModelNotFoundException;

/**
 * OPS §3.3's `GetMyProfileChangeRequest` (docs/OPERATIONS.md:68) — what a
 * reader sees about their own proposal. Port of
 * old_next/src/domain/members/queries/get-my-profile-change-request.ts.
 *
 * IT READS THE MOST RECENT REQUEST OF ANY STATUS, NOT ONLY A PENDING ONE,
 * and that is spec D7 rather than an oversight.
 * App\Queries\ReaderDetailQuery — the MANAGER's view of the same table —
 * filters `status = 'pending'`, because all that page needs is whether
 * there is something waiting. This page is different: it is where a reader
 * learns they were REJECTED and reads the manager's sentence, and a query
 * shaped like the manager's would make that sentence unreachable the
 * instant it was written. Ordered by requested_at descending; INV-13's
 * generated `pending_user_id` unique index guarantees at most one of them
 * is pending, so "the most recent" is never ambiguous about which pending
 * row it meant.
 *
 * THE ORDER CARRIES `id` BESIDE `requested_at` for MyDonationsQuery's
 * reason, applied to this table: `requested_at` has a microsecond
 * precision and a default of CURRENT_TIMESTAMP(6), and nothing unique
 * carries it, so two rows written in the same microsecond would otherwise
 * come back in whatever order the engine chose. This is a reader's own
 * page and the request they just made is the one they came to look at.
 *
 * The spec's D7 note on WHY the reference reads any status is worth not
 * repeating verbatim: it says BR §15 lists no notification for a
 * profile-change decision, and that is FALSE —
 * docs/BUSINESS-REQUIREMENTS.md:490 names both of them. This phase's
 * Task 6 adds the pair. The shape stays either way, because a
 * notification is a nudge and this page is the record.
 *
 * NULL RATHER THAN A THROW when there is no request at all: a reader who
 * has never proposed anything is the ordinary case, not a failure.
 *
 * NO INLINE GATE — the house shape (BorrowRequestQueueQuery's docblock
 * argues it at length, and MyDonationsQuery follows it). The self-or-
 * manager check is MembershipPolicy::viewSelf and it is applied by the
 * controller, once, for both this query and MyProfileQuery.
 *
 * TENANCY IS BookshelfScope's, on ProfileChangeRequest itself
 * (BelongsToBookshelf): no bookshelf_id is written here. It matters, because
 * the `user_id` predicate is not a tenant predicate — the same person can
 * hold memberships on two shelves and has ONE users row, so this WHERE on
 * its own would answer with a proposal filed at another parish.
 */
final class MyProfileChangeRequestQuery
{
    /**
     * @return array{id: string, status: string, proposedValues: array<string, ?string>, previousValues: array<string, ?string>, rejectionReason: string|null, requestedAt: string, decidedAt: string|null}|null
     */
    public function run(Membership $membership): ?array
    {
        $person = User::query()->find($membership->user_id);

        if ($person === null) {
            throw new ModelNotFoundException;   // a soft-deleted identity is no reader
        }

        $request = ProfileChangeRequest::query()
            ->where('user_id', $person->id)
            ->orderByDesc('requested_at')
            ->orderByDesc('id')
            ->first();

        if ($request === null) {
            return null;
        }

        return [
            'id' => $request->id,
            // ->status->value, never (string) on the attribute: the model
            // casts status to App\Enums\ProfileChangeStatus, so the cast
            // form would be (string) on an enum OBJECT — a fatal.
            'status' => $request->status->value,
            'proposedValues' => ProfileFields::pick($request->proposed_values),
            'previousValues' => ProfileFields::pick($request->previous_values),
            'rejectionReason' => $request->rejection_reason,
            'requestedAt' => (string) $request->requested_at->toISOString(),
            'decidedAt' => $request->decided_at?->toISOString(),
        ];
    }
}
