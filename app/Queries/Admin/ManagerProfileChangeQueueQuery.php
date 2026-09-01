<?php

declare(strict_types=1);

namespace App\Queries\Admin;

use App\Enums\MembershipRole;
use App\Enums\ProfileChangeStatus;
use App\Models\Membership;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Queries\Concerns\PresentsProfileChanges;
use App\Support\Members\AvatarStorage;
use App\Support\Members\ProfileFields;
use App\Support\TenantContext;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\ModelNotFoundException;

/**
 * BR:602's cross-shelf change queue — "every pending profile-change
 * proposal whose subject is a MANAGER OR SHELF ADMIN anywhere in the
 * system, the shelf named on each card" — and the badge beside it.
 *
 * THE OTHER HALF OF ONE PARTITION. App\Queries\ProfileChangeQueueQuery
 * holds the reader-subject half; between them every pending request has
 * exactly one home, because a subject's membership on the request's own
 * shelf has exactly one role. BR:602 gives the reason this half exists at
 * all: "This is where a manager's or admin's own proposed change is
 * decided, because nobody at their own shelf may decide it." A request that
 * fell out of both queues would be a request nobody could ever rule on,
 * which is why the tests assert the partition from BOTH sides rather than
 * asserting each list's contents alone.
 *
 * IT LIVES UNDER app/Queries/Admin/ BECAUSE OF THE FENCE.
 * tests/Feature/Architecture/WideningArchitectureTest confines
 * TenantContext::systemWide() to app/Queries/Admin/ and app/Actions/Admin/,
 * and its comment is explicit that "a controller still never calls
 * systemWide() itself" — a middleware is no more sanctioned than a
 * controller, so the badge's count is this object's too, resolved inside
 * HandleInertiaRequests::share()'s closure rather than widened there.
 *
 * WHY IT WIDENS AT ALL. ProfileChangeRequest and Membership both carry
 * BelongsToBookshelf, so BookshelfScope THROWS for the `/admin` caller,
 * which binds no tenant by design. Every read below is widened and then
 * re-narrowed BY THE ROW — the subject's membership is matched on the
 * request's own bookshelf_id, never on a shelf a caller sent. That pairing
 * is the reference's own hard-won fix, quoted in spec D10: a subject with
 * manager memberships at two parishes let an unqualified query pick an
 * arbitrary one, so the role the routing rule read could come from the
 * wrong shelf entirely.
 *
 * THE PAIRING IS DONE IN PHP, not in SQL, and that is a tenancy-fence
 * decision rather than a performance one: matching (user_id, bookshelf_id)
 * in the database means either a join condition naming bookshelf_id or a
 * where clause naming it, and TenancyArchitectureTest bans the second
 * outright while its own docblock records the first as a KNOWN BLIND SPOT
 * in its grep — "a join() condition naming the column". Writing the pairing
 * where the fence can see it costs one extra SELECT over a set bounded by
 * its own state (pending proposals by managers, system-wide) and keeps this
 * file out of a documented gap. DonationQueueQuery makes the same trade for
 * the same reason.
 *
 * THE BADGE AND THE LIST SHARE pending() below, exactly as the shelf-level
 * queue's do. Two predicates that agree today is the defect commit 8e81c82
 * already had to fix once.
 */
final class ManagerProfileChangeQueueQuery
{
    use PresentsProfileChanges;

    /**
     * AvatarStorage IS SAFE FOR THE UNBOUND CALLER, which is the one thing
     * worth checking before a widened query takes a dependency: it reads
     * `config('filesystems.disks.avatars')` and derives a URL from a key.
     * No tenant, no query, no scope to widen — so this queue can show the
     * photographs exactly as the reader's tenant-bound page does.
     */
    public function __construct(private TenantContext $context, private AvatarStorage $avatars) {}

    /**
     * The one place this class says what "in this queue" means — shared by
     * run() and countPending().
     *
     * @return Collection<int, ProfileChangeRequest>
     */
    private function pending(): Collection
    {
        return $this->context->systemWide(function (): Collection {
            /** @var Collection<int, ProfileChangeRequest> $requests */
            $requests = ProfileChangeRequest::query()
                ->where('status', ProfileChangeStatus::Pending)
                ->with('bookshelf')
                ->orderBy('requested_at')
                ->orderBy('id')
                ->get();

            $subjectIds = $requests->pluck('user_id')->unique()->values()->all();

            if ($subjectIds === []) {
                return $requests;
            }

            $elevated = Membership::query()
                ->whereIn('role', [MembershipRole::Manager, MembershipRole::Admin])
                ->whereIn('user_id', $subjectIds)
                ->get();

            $pairs = [];

            foreach ($elevated as $membership) {
                $pairs[self::pair($membership->user_id, $membership->bookshelf_id)] = true;
            }

            /** @var Collection<int, ProfileChangeRequest> $kept */
            $kept = $requests
                ->filter(fn (ProfileChangeRequest $request): bool => isset($pairs[self::pair($request->user_id, $request->bookshelf_id)]))
                ->values();

            return $kept;
        });
    }

    /**
     * The cards, oldest first, each naming its shelf — BR:602's "the shelf
     * named on each card", which on a cross-shelf screen is not decoration:
     * two parishes may both have a manager called Nguyễn Văn A.
     *
     * @return list<array{requestId: string, subjectUserId: string, subjectName: string, saintName: string|null, subjectRole: string, shelfName: string, shelfSlug: string, requestedAt: string, fields: list<array{field: string, current: string|null, proposed: string|null}>, avatarProposed: bool, proposedAvatarUrl: string|null, currentAvatarUrl: string|null}>
     */
    public function run(): array
    {
        $requests = $this->pending();

        if ($requests->isEmpty()) {
            return [];
        }

        $subjectIds = $requests->pluck('user_id')->unique()->values()->all();

        // `users` is global — no widening needed for this read, the same
        // reason DecidesProfileChanges::lockSubject needs none.
        $people = User::query()->findMany($subjectIds)->keyBy('id');

        $roles = $this->context->systemWide(function () use ($subjectIds): array {
            $memberships = Membership::query()
                ->whereIn('role', [MembershipRole::Manager, MembershipRole::Admin])
                ->whereIn('user_id', $subjectIds)
                ->get();

            $byPair = [];

            foreach ($memberships as $membership) {
                $byPair[self::pair($membership->user_id, $membership->bookshelf_id)] = $membership->role->value;
            }

            return $byPair;
        });

        $rows = [];

        foreach ($requests as $request) {
            $person = $people->get($request->user_id);
            $shelf = $request->bookshelf;

            if ($person === null || $shelf === null) {
                continue;
            }

            $proposed = ProfileFields::pick($request->proposed_values);

            $rows[] = array_merge([
                'requestId' => $request->id,
                'subjectUserId' => $person->id,
                'subjectName' => $person->full_name,
                'saintName' => $person->saint_name,
                // THE FALLBACK IS A REAL ROLE, NOT ''. It is structurally
                // unreachable — pending() keeps a request only when the
                // (user, shelf) pair has a Manager-or-Admin membership, and
                // $roles above is built by the identical query over the
                // identical set — but it is a fallback a reader of this file
                // has to be able to trust. '' was not one: the screen maps
                // anything that is not "admin" to *Quản lý tủ sách*, so an
                // empty string did not read as "unknown", it read as a
                // confident and possibly wrong statement of rank on a
                // cross-shelf card whose whole job is saying which rank
                // routed the proposal here. Manager is the weaker of the two
                // claims and the one this queue's own predicate makes.
                'subjectRole' => $roles[self::pair($request->user_id, $request->bookshelf_id)] ?? MembershipRole::Manager->value,
                'shelfName' => $shelf->name,
                'shelfSlug' => $shelf->slug,
                'requestedAt' => (string) $request->requested_at->toISOString(),
                'fields' => self::sideBySide($person, $proposed),
                // The FLAG and the two ADDRESSES together — see the trait.
            ], self::avatarPair($this->avatars, $person, $proposed));
        }

        return $rows;
    }

    /**
     * The admin shell's badge number, counted through pending() — the same
     * object the list is built from, so the two cannot drift.
     *
     * Its caller is HandleInertiaRequests::share()'s
     * `pendingManagerProfileChanges` closure, which asks for the global
     * super-admin flag before it calls; the `/admin` group's own
     * `super-admin` middleware guards the screen.
     */
    public function countPending(): int
    {
        return $this->pending()->count();
    }

    /**
     * The row an `/admin` decision names, resolved the ONE way this caller
     * can resolve it.
     *
     * SPEC D10, STATED PLAINLY: the shelf comes from the ROW. The unbound
     * admin caller cannot resolve a ProfileChangeRequest through route
     * model binding at all — BookshelfScope throws with no tenant — so the
     * `/admin` routes carry a bare id and this method widens to look it up.
     * What it must never do, and does not, is take a shelf from the request
     * body: App\Actions\Admin\Concerns\DecidesProfileChanges::requestShelf
     * then reads the shelf off the row it is handed, on both paths.
     *
     * DELIBERATELY NOT NARROWED TO THIS QUEUE'S OWN PREDICATE. A super
     * administrator may decide a READER's proposal too — the routing rule
     * (spec D2) admits everybody at or above the subject's rank, and this
     * is the rank above all of them — so narrowing find() to elevated
     * subjects would refuse a decision the rule allows. The predicate says
     * which cards this SCREEN shows, not which rows this person may rule
     * on; the Action is where authority is decided, and it decides it the
     * same way for both callers.
     *
     * A missing row is a ModelNotFoundException and therefore a 404, which
     * is what implicit binding would have produced on the shelf-level path.
     * Spec §5.4's anti-enumeration rule wants that number and not a 403.
     */
    public function find(string $id): ProfileChangeRequest
    {
        $row = $this->context->systemWide(
            fn (): ?ProfileChangeRequest => ProfileChangeRequest::query()->whereKey($id)->first(),
        );

        if ($row === null) {
            throw new ModelNotFoundException()->setModel(ProfileChangeRequest::class, [$id]);
        }

        return $row;
    }

    /** The (subject, shelf) pair spec D10 requires the role to be read at. */
    private static function pair(string $userId, string $bookshelfId): string
    {
        return $userId.'|'.$bookshelfId;
    }
}
