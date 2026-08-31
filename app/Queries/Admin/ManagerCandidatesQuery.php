<?php

namespace App\Queries\Admin;

use App\Enums\BookshelfStatus;
use App\Enums\MembershipRole;
use App\Enums\MembershipStatus;
use App\Models\Bookshelf;
use App\Support\TenantContext;

/**
 * Who the appoint form on `/admin/managers` may offer, per shelf.
 *
 * **`role = reader` and `status = active`, both, and only those** — the
 * reference's own predicate (`get-admin-overview.ts`'s
 * `getManagerCandidates`). A manager or shelf admin here is already running
 * the shelf, so appointing them would only overwrite their own role; a
 * pending, suspended, left or rejected reader is not yet, or no longer, a
 * member in good standing, and a registration nobody has approved is not
 * who this screen means by "hand them the keys". `AssignManager` itself
 * stays more permissive than this on purpose: it accepts any surviving
 * person, for a future caller that finds one by search rather than by list.
 *
 * **Only ACTIVE shelves are offered.** An archived shelf is never a choice
 * here, not merely a labelled one — `BookshelfPolicy::assignManager()`
 * refuses one too, so offering it would be offering a control whose only
 * outcome is a 404. The manager list beside this form still shows archived
 * shelves' managers, because that list exists so they can be seen and
 * revoked; "what already exists" and "where may a NEW grant go" are
 * different questions.
 *
 * The whole set is returned at once, one entry per appointable shelf, and
 * the screen narrows it as the shelf select changes. The reference reloaded
 * the page for each shelf because it ran with no client JavaScript at all;
 * this port renders through Inertia and React, so the second select can be
 * filtered in the browser and the round trip is not needed.
 *
 * Widened and reached through the relation, for the reasons
 * `ManagersListQuery` states at length.
 */
final class ManagerCandidatesQuery
{
    public function __construct(
        private TenantContext $context,
    ) {}

    /**
     * @return list<array{shelfId: string, slug: string, name: string, candidates: list<array{userId: string, fullName: string}>}>
     */
    public function run(): array
    {
        return $this->context->systemWide(function (): array {
            $shelves = Bookshelf::query()
                ->where('status', BookshelfStatus::Active)
                ->orderBy('name')
                ->orderBy('id')
                ->get();

            $shelves->load(['memberships' => function ($query): void {
                $query->where('role', MembershipRole::Reader)
                    ->where('status', MembershipStatus::Active)
                    ->with('user');
            }]);

            // Built with plain loops rather than a collection pipeline: at
            // Larastan level 8 a mapped collection widens to array<int,
            // mixed> and stops satisfying the list shape declared above,
            // and a shape this screen's props depend on is worth keeping
            // checked.
            /** @var list<array{shelfId: string, slug: string, name: string, candidates: list<array{userId: string, fullName: string}>}> $rows */
            $rows = [];

            foreach ($shelves as $shelf) {
                /** @var list<array{userId: string, fullName: string}> $candidates */
                $candidates = [];

                foreach ($shelf->memberships as $membership) {
                    $person = $membership->user;

                    // A membership can outlive its person; a grant nobody
                    // holds is nobody to offer.
                    if ($person === null) {
                        continue;
                    }

                    $candidates[] = ['userId' => $person->id, 'fullName' => $person->full_name];
                }

                // By name, then by id so two people of the same name do not
                // reorder between reads.
                usort(
                    $candidates,
                    fn (array $a, array $b): int => [$a['fullName'], $a['userId']] <=> [$b['fullName'], $b['userId']],
                );

                $rows[] = [
                    'shelfId' => $shelf->id,
                    // THE SLUG IS WHAT THE ROUTE TAKES, not the id:
                    // Bookshelf::getRouteKeyName returns 'slug', so a form
                    // that built its action URL from the id would post to a
                    // path that binds nothing and 404s every appointment.
                    'slug' => $shelf->slug,
                    'name' => $shelf->name,
                    'candidates' => $candidates,
                ];
            }

            return $rows;
        });
    }
}
