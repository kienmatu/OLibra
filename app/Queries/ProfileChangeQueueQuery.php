<?php

declare(strict_types=1);

namespace App\Queries;

use App\Enums\MembershipRole;
use App\Enums\ProfileChangeStatus;
use App\Models\Membership;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Queries\Concerns\PresentsProfileChanges;
use App\Support\Members\ProfileFields;
use Illuminate\Database\Eloquent\Builder;

/**
 * BR:580's shelf-level change queue — "One card per proposed change whose
 * subject is a READER of this shelf", and the badge beside it.
 *
 * THE ROLE PREDICATE IS THE POINT, not a filter added for tidiness. BR:580
 * says in the same sentence why a manager's or shelf admin's own proposal
 * is deliberately absent from this list: it "no longer sits in this queue,
 * where nobody present may decide it", and appears instead in the super
 * administrator's own queue (BR:602, App\Queries\Admin\
 * ManagerProfileChangeQueueQuery). The two predicates PARTITION the pending
 * set by the subject's role — the same axis App\Actions\Admin\Concerns\
 * DecidesProfileChanges decides on — which is why neither queue can hold a
 * request nobody looking at it may rule on.
 *
 * THE BADGE AND THE LIST CANNOT DISAGREE, structurally rather than by
 * happening to read alike: run() and countPending() both start from
 * pending() below, ONE builder holding the whole predicate, so there is no
 * second role clause in this file to drift from the first. That is
 * App\Queries\DonationQueueQuery's shape, and its docblock argues it at
 * length. It is also the defect Phase 3a had to fix once — commit 8e81c82,
 * "match the admin dashboard's predicates to the shelf's own queues" — so
 * the sharing is a repair kept, not a preference.
 *
 * TENANCY IS BookshelfScope's, on both models. ProfileChangeRequest and
 * Membership each carry BelongsToBookshelf, so the subquery below is
 * narrowed to the bound shelf on both sides of the whereIn: "a reader" and
 * "of this shelf" are one clause, not two. No bookshelf_id is written here
 * and no join carries one — tests/Feature/Architecture/
 * TenancyArchitectureTest's allow-list has no entry for this file and needs
 * none.
 *
 * WHY THE SUBJECT'S ROLE IS READ NOW rather than stored on the row: the
 * decision rule reads it at decision time (spec D2, part 1), so a queue
 * that read a column written at proposal time would show a manager a card
 * their own Action then refuses. Promote a reader mid-flight and the card
 * MOVES between the two queues, which is the behaviour both documents
 * describe.
 *
 * BR:580's "side by side" IS App\Queries\Concerns\PresentsProfileChanges,
 * shared with the cross-shelf queue because BR:602 asks for "the same
 * pattern the shelf-level queue already uses". That trait's docblock
 * carries why the current half is read off the PERSON rather than off
 * previous_values, and why avatar_object crosses this seam as a flag and
 * never as its storage key.
 */
final class ProfileChangeQueueQuery
{
    use PresentsProfileChanges;

    /**
     * The one place this class says what "in this queue" means — shared by
     * run() and countPending() so the badge and the list cannot answer two
     * different predicates.
     *
     * @return Builder<ProfileChangeRequest>
     */
    private function pending(): Builder
    {
        // A subquery, not a pluck: Eloquent applies its global scopes when
        // a builder is parsed into a subquery (toSql() is one of the
        // passthru methods, and passthru runs applyScopes()), so
        // BookshelfScope narrows the inner select to the bound shelf just
        // as it narrows the outer one. SoftDeletes narrows it again — a
        // trashed membership is not a reader of anywhere.
        $readersOfThisShelf = Membership::query()
            ->where('role', MembershipRole::Reader)
            ->select('user_id');

        return ProfileChangeRequest::query()
            ->where('status', ProfileChangeStatus::Pending)
            ->whereIn('user_id', $readersOfThisShelf);
    }

    /**
     * The cards, oldest first — a queue is worked, so it drains from the
     * end a reader has waited longest at. `id` beside `requested_at` for
     * the tie, DonationQueueQuery's habit.
     *
     * @return list<array{requestId: string, subjectUserId: string, subjectName: string, saintName: string|null, parishUnitL1Id: string|null, parishUnitL2Id: string|null, requestedAt: string, fields: list<array{field: string, current: string|null, proposed: string|null}>, avatarProposed: bool}>
     */
    public function run(): array
    {
        $requests = $this->pending()
            ->orderBy('requested_at')
            ->orderBy('id')
            ->get();

        if ($requests->isEmpty()) {
            return [];
        }

        $subjectIds = $requests->pluck('user_id')->unique()->values()->all();

        $people = User::query()->findMany($subjectIds)->keyBy('id');

        // The subject's CURRENT placement, so the approve form's two
        // selects open on where the person stands rather than on nothing.
        // BookshelfScope narrows this to the bound shelf, which is the
        // shelf the request belongs to — there is no other shelf in scope.
        $memberships = Membership::query()
            ->whereIn('user_id', $subjectIds)
            ->get()
            ->keyBy('user_id');

        $rows = [];

        foreach ($requests as $request) {
            $person = $people->get($request->user_id);

            if ($person === null) {
                // A soft-deleted identity is no reader — the shape
                // MyProfileChangeRequestQuery refuses outright. Here the
                // row is simply not a card: a manager cannot usefully
                // decide a change to somebody who has gone.
                continue;
            }

            $membership = $memberships->get($request->user_id);
            $proposed = ProfileFields::pick($request->proposed_values);

            $rows[] = [
                'requestId' => $request->id,
                'subjectUserId' => $person->id,
                'subjectName' => $person->full_name,
                'saintName' => $person->saint_name,
                'parishUnitL1Id' => $membership?->parish_unit_l1_id,
                'parishUnitL2Id' => $membership?->parish_unit_l2_id,
                'requestedAt' => (string) $request->requested_at->toISOString(),
                'fields' => self::sideBySide($person, $proposed),
                'avatarProposed' => array_key_exists('avatar_object', $proposed),
            ];
        }

        return $rows;
    }

    /**
     * The nav badge's number — counted from pending(), the same builder
     * run() selects its rows through, never a shorter statement that
     * happens to agree today.
     *
     * Its caller is App\Http\Middleware\HandleInertiaRequests::share()'s
     * `pendingProfileChanges` closure, which asks act-as-manager before it
     * calls; the route group's role:manager guards the screen. No inline
     * Gate here, the house shape DonationQueueQuery::countPending() has.
     */
    public function countPending(): int
    {
        return $this->pending()->count();
    }
}
