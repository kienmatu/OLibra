<?php

declare(strict_types=1);

namespace App\Queries;

use App\Enums\ProfileChangeStatus;
use App\Models\Membership;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Support\Members\AvatarStorage;
use App\Support\Members\ProfileFields;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Arr;

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
 * THE PHOTOGRAPH CROSSES THIS SEAM AS TWO ADDRESSES AND NEVER AS A KEY —
 * Phase 3c-i Task 8, spec D6. `avatar_object` is one of ProfileFields'
 * nine, so a proposal may name it and ProfileFields::pick would hand its
 * value straight to the browser: a raw storage key, which is meaningless to
 * a reader and is an internal fact about a bucket layout. Task 1 rendered a
 * bare label for that field and said in its own comment that the two
 * photographs side by side were the right rendering and were this task's;
 * this is that. The key is REMOVED from both bags and replaced by
 * `proposedAvatarUrl` and `previousAvatarUrl`, so the page has exactly what
 * BR:544 asks for — the current value with the pending one beside it — and
 * nothing it should not have.
 *
 * `avatarProposed` RIDES ALONG AS A FLAG rather than being inferred from
 * the URL being non-null, because a proposal that names the field is a
 * different thing from one whose image is readable: a discarded object, or
 * a disk misconfigured after a docroot change, would otherwise silently
 * turn "they proposed a new photograph" into "they proposed nothing".
 *
 * BOTH URLS ARE DERIVED ONLY WHILE THE REQUEST IS PENDING, and that is a
 * correctness rule rather than a saving. Spec D6 says the decide paths
 * DELETE one of the two objects: approve discards the superseded image
 * (`previous_values`' key), reject and cancel discard the proposed one
 * (`proposed_values`' key). Neither rewrites the JSON — there is nothing to
 * rewrite, the bag is the historical record of what was asked for — so the
 * KEY survives the object every time. Deriving a URL from a surviving key
 * after a decision hands the page an address for bytes that are gone, and
 * `AvatarFigure`'s "Chưa có ảnh" fallback cannot fire, because the fallback
 * asks whether the URL is null and the URL is a perfectly well-formed
 * string. What the reader would see is a broken image captioned "Ảnh chờ
 * duyệt" after a rejection, or "Ảnh hiện tại" after an approval.
 *
 * Nulling them here rather than only guarding the render is deliberate:
 * this class is the one that knows an address is derived from a key, and a
 * prop that is an address for something that does not exist is wrong
 * wherever it is read.
 *
 * TENANCY IS BookshelfScope's, on ProfileChangeRequest itself
 * (BelongsToBookshelf): no bookshelf_id is written here. It matters, because
 * the `user_id` predicate is not a tenant predicate — the same person can
 * hold memberships on two shelves and has ONE users row, so this WHERE on
 * its own would answer with a proposal filed at another parish.
 */
final class MyProfileChangeRequestQuery
{
    public function __construct(private AvatarStorage $avatars) {}

    /**
     * @return array{id: string, status: string, proposedValues: array<string, ?string>, previousValues: array<string, ?string>, avatarProposed: bool, proposedAvatarUrl: string|null, previousAvatarUrl: string|null, rejectionReason: string|null, requestedAt: string, decidedAt: string|null}|null
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

        $proposed = ProfileFields::pick($request->proposed_values);
        $previous = ProfileFields::pick($request->previous_values);
        $pending = $request->status === ProfileChangeStatus::Pending;

        return [
            'id' => $request->id,
            // ->status->value, never (string) on the attribute: the model
            // casts status to App\Enums\ProfileChangeStatus, so the cast
            // form would be (string) on an enum OBJECT — a fatal.
            'status' => $request->status->value,
            // The key never travels — see this class's header.
            'proposedValues' => Arr::except($proposed, ['avatar_object']),
            'previousValues' => Arr::except($previous, ['avatar_object']),
            // The flag is about the REQUEST, so it stays true at every
            // status — but note the page reads it ONLY behind a pending
            // guard, so on a decided request it is dead data and the reader
            // is told nothing about the photograph they proposed. That is
            // deliberate (the decided card carries no images because the
            // objects are gone), and an earlier version of this comment
            // claimed the page "says so in words". It does not.
            'avatarProposed' => array_key_exists('avatar_object', $proposed),
            // The addresses are about the OBJECTS, and after a decision one
            // of the two is deleted — see this class's header.
            'proposedAvatarUrl' => $pending ? $this->avatars->url($proposed['avatar_object'] ?? null) : null,
            'previousAvatarUrl' => $pending ? $this->avatars->url($previous['avatar_object'] ?? null) : null,
            'rejectionReason' => $request->rejection_reason,
            'requestedAt' => (string) $request->requested_at->toISOString(),
            'decidedAt' => $request->decided_at?->toISOString(),
        ];
    }
}
