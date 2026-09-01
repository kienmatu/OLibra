<?php

namespace App\Queries\Admin;

use App\Enums\MembershipRole;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;

/**
 * OPS §3.4's `GetManagersList` — everyone who can do anything, anywhere.
 * Feeds `/admin/managers` (spec D5, D7), which is the one screen in the
 * installation that answers "who holds the keys, and to what".
 *
 * **Super administrators are in the list, holding no shelf.** They are the
 * people with the most power here, so a list of "who can act" that omitted
 * them would be the one list where the omission mattered most. They carry a
 * null membership id, which is also exactly what makes them unrevocable
 * from this screen: spec D5 ports the reference's omission of a demotion
 * command as an omission, and a row with nothing to revoke cannot offer a
 * control that has no command behind it.
 *
 * **`lastActiveAt` is the last thing a person DID, read from the audit log**
 * — OPS §3.4 asks for last-active recency, and the audit log is the only
 * record of doing rather than of being. A session would say somebody signed
 * in, which a phone left logged in also says.
 *
 * WHY THIS IS A QUERY AND NOT A CONTROLLER METHOD. `Membership` carries
 * `BelongsToBookshelf`, so its scope throws when nothing is bound, and the
 * `/admin` group binds nothing by design (spec D0). Widening is the
 * sanctioned way past that guard and `WideningArchitectureTest` confines it
 * to `app/Queries/Admin/` and `app/Actions/Admin/`.
 *
 * THE MEMBERSHIPS ARE REACHED THROUGH THE RELATION from each shelf, never
 * through a hand-written shelf-column predicate: under a widening the scope
 * adds no predicate at all, so the relation is what does the narrowing, and
 * `TenancyArchitectureTest` confines the hand-written spelling to a
 * four-file allow-list this directory is not on.
 *
 * **A SUSPENDED MANAGER IS STILL LISTED, with `status` saying so.** This
 * screen answers "who holds the keys", and a suspended grant is still a
 * grant somebody holds — hiding the row would make it invisible AND
 * unrevocable, since the revoke control lives on it. But
 * `AdminOverviewQuery`'s `managersMissing` counts ACTIVE memberships only,
 * so a shelf whose sole manager is suspended reads "no manager" on
 * `/admin/shelves` while that shelf is active, while this list shows the
 * person. (An ARCHIVED shelf is not flagged at all: `AdminOverviewQuery`
 * gates the flag on `BookshelfStatus::Active`, because an alarm no control
 * on the page can clear is noise.) Without `status` the two screens simply
 * contradict each other; with it, the row is where the volunteer finds out
 * WHY the other screen is raising the alarm. Pinned in
 * `AdminManagersTest`.
 *
 * **`isSuperAdmin` IS A FACT ABOUT THE PERSON, NOT ABOUT THE ROW.** A super
 * administrator who also manages a shelf legitimately appears twice — once
 * globally with nothing to revoke, once on the shelf whose keys they hold
 * and which is genuinely revocable. Neither row may be dropped. What the
 * membership row must NOT do is offer the promote control: pressing it
 * throws `already_super_admin`, so this flag is what lets the screen
 * suppress a button whose only outcome is a refusal.
 *
 * A SOFT-DELETED PERSON IS NOT LISTED, matching the reference's joins
 * (`old_next/src/domain/admin/queries/get-admin-overview.ts`, whose people
 * CTE joins users on a surviving row both above and below its union). A
 * membership whose person is gone is a grant nobody holds.
 */
final class ManagersListQuery
{
    public function __construct(
        private TenantContext $context,
    ) {}

    /**
     * @return list<array{membershipId: ?string, userId: string, fullName: string, phone: ?string, role: string, isSuperAdmin: bool, status: ?string, shelfId: ?string, shelfName: ?string, shelfSlug: ?string, lastActiveAt: ?string}>
     */
    public function run(): array
    {
        return $this->context->systemWide(function (): array {
            $shelves = Bookshelf::query()->orderBy('name')->orderBy('id')->get();

            // Eager-loaded through the relation, which supplies its own
            // narrowing whatever the widening state. The role filter is the
            // reference's `role in ('manager', 'admin')`; a reader is not a
            // manager and belongs on the shelf's own members screen.
            $shelves->load(['memberships' => function ($query): void {
                $query->whereIn('role', [MembershipRole::Manager, MembershipRole::Admin])
                    ->with('user');
            }]);

            $superAdmins = User::query()
                ->where('is_super_admin', true)
                ->get();

            $lastActive = $this->lastActiveByActor();

            /** @var list<array{membershipId: ?string, userId: string, fullName: string, phone: ?string, role: string, isSuperAdmin: bool, status: ?string, shelfId: ?string, shelfName: ?string, shelfSlug: ?string, lastActiveAt: ?string}> $rows */
            $rows = [];

            foreach ($superAdmins as $person) {
                $rows[] = [
                    'membershipId' => null,
                    'userId' => $person->id,
                    'fullName' => $person->full_name,
                    'phone' => $person->phone,
                    // Not a MembershipRole case, and deliberately so: this
                    // is a column on the PERSON, not a membership anywhere.
                    'role' => 'super_admin',
                    'isSuperAdmin' => true,
                    // No membership, so no membership status. Null is
                    // "this row is not about a membership at all", which
                    // is a different fact from any of the five cases.
                    'status' => null,
                    'shelfId' => null,
                    'shelfName' => null,
                    'shelfSlug' => null,
                    'lastActiveAt' => $lastActive[$person->id] ?? null,
                ];
            }

            foreach ($shelves as $shelf) {
                foreach ($shelf->memberships as $membership) {
                    $person = $membership->user;

                    if ($person === null) {
                        continue;
                    }

                    $rows[] = [
                        'membershipId' => $membership->id,
                        'userId' => $person->id,
                        'fullName' => $person->full_name,
                        'phone' => $person->phone,
                        'role' => $membership->role->value,
                        // A fact about the PERSON, decided by the server so
                        // the screen never has to infer it by scanning the
                        // list for a second row with the same user id.
                        'isSuperAdmin' => (bool) $person->is_super_admin,
                        'status' => $membership->status->value,
                        'shelfId' => $shelf->id,
                        'shelfName' => $shelf->name,
                        'shelfSlug' => $shelf->slug,
                        'lastActiveAt' => $lastActive[$person->id] ?? null,
                    ];
                }
            }

            // Super administrators first, then by name, then by person id so
            // two people of the same name do not reorder between reads —
            // the reference's own ordering. The super-admin block is built
            // first above, so a stable sort on the remaining two keys keeps
            // it on top without a third comparison.
            usort($rows, function (array $a, array $b): int {
                $global = ($b['role'] === 'super_admin' ? 1 : 0) <=> ($a['role'] === 'super_admin' ? 1 : 0);

                return $global !== 0
                    ? $global
                    : ([$a['fullName'], $a['userId']] <=> [$b['fullName'], $b['userId']]);
            });

            return $rows;
        });
    }

    /**
     * The most recent audit row per actor, across every shelf and the
     * shelf-less administration rows alike.
     *
     * `AuditLog` is deliberately NOT a scoped model — its own docblock says
     * so, because a cross-shelf administration act lands here with no shelf
     * and a scope would hide those rows everywhere. So this read needs no
     * relation and no narrowing; it is a plain aggregate over one column.
     *
     * @return array<string, string>
     */
    private function lastActiveByActor(): array
    {
        $rows = AuditLog::query()
            ->groupBy('actor_id')
            ->selectRaw('actor_id, max(occurred_at) as last_at')
            ->whereNotNull('actor_id')
            ->get();

        $byActor = [];

        foreach ($rows as $row) {
            $actorId = $row->getAttribute('actor_id');
            $lastAt = $row->getAttribute('last_at');

            if (is_string($actorId) && is_string($lastAt)) {
                // UTC and ISO-8601, the shape AuditLogQuery already sends
                // its own instants in — `last_at` comes back as a raw
                // driver string because it is a computed column and so
                // carries none of the model's casts.
                $byActor[$actorId] = Carbon::parse($lastAt)->utc()->toIso8601String();
            }
        }

        return $byActor;
    }
}
