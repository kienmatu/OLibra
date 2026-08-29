<?php

namespace App\Queries;

use App\Enums\LoanStatus;
use App\Models\Loan;
use App\Models\Membership;
use App\Support\Circulation\LendingSettings;
use App\Support\Circulation\LoanRules;
use App\Support\Fold;
use App\Support\Members\ParishUnits;
use App\Support\TenantContext;

/**
 * Quick-lend step 2 — port of search-readers-for-lending.ts. Never filters
 * a blocked reader out: a silently missing row sends the volunteer
 * searching again; a row saying "Tài khoản đang tạm khoá" tells them what
 * to do. The block is LoanRules::memberMayBorrow's — the ONE predicate
 * LendCopy applies, so the row carries the very code the command throws
 * (LendingQueriesTest pins exactly this agreement).
 *
 * Row shape is deliberately narrow (Phase 1b's boundary, restated for this
 * screen): a list carries what it renders and no more, so this carries
 * exactly membershipId/userId/fullName/saintName/parishLine/activeLoans/
 * blocked/reason — never date of birth, parents' names or a phone number,
 * even though those columns are one join away on `users`/`memberships`.
 * `LendingQueriesTest`'s key-set assertion pins the boundary by equality,
 * not by a `not->toHaveKeys([...])` shape (which only means "does not have
 * ALL of these" and would pass even with every field present bar one).
 *
 * The count is per shelf via BookshelfScope on Loan, INV-5's own scoping —
 * the join below reaches `users` only through `memberships.user_id`, never
 * a hand-written `bookshelf_id` predicate.
 *
 * Folded match on `users.full_name_folded` (the prefix-indexed, accent- and
 * case-insensitive column) — never `full_name_ci` (deterministic
 * utf8mb4_bin, for exact identity matching only, per Phase 1b's Critical:
 * a merge caused by matching two different people under an
 * accent-insensitive collation). A manager typing "dang" or "đặng" into a
 * search box wants every reader whose name could sound like that, not an
 * exact-identity comparison.
 */
final class SearchReadersForLendingQuery
{
    public function __construct(
        private TenantContext $tenant,
        private ParishContextQuery $parishContext,
    ) {}

    /** @return list<array<string, mixed>> */
    public function run(string $q): array
    {
        $folded = Fold::fold($q);
        if ($folded === '') {
            return [];
        }

        $shelf = $this->tenant->bookshelf();
        if ($shelf === null) {
            return [];
        }
        $settings = LendingSettings::fromShelf($shelf);
        $context = $this->parishContext->run();

        $memberships = Membership::query()
            ->join('users', 'users.id', '=', 'memberships.user_id')
            ->whereNull('users.deleted_at')
            ->where('users.full_name_folded', 'like', '%'.$folded.'%')
            ->orderBy('users.full_name_folded')->orderBy('memberships.id')
            ->select('memberships.*', 'users.full_name', 'users.saint_name')
            ->get();

        $counts = Loan::query()
            ->whereIn('borrower_id', $memberships->pluck('user_id'))
            ->where('status', LoanStatus::Active)
            ->selectRaw('borrower_id, count(*) as n')
            ->groupBy('borrower_id')
            ->pluck('n', 'borrower_id');

        return array_values($memberships->map(function (Membership $m) use ($counts, $settings, $context): array {
            $activeLoans = (int) ($counts[$m->user_id] ?? 0);
            $reason = LoanRules::memberMayBorrow($m->status, $activeLoans, $settings->maxConcurrentLoans);

            return [
                'membershipId' => $m->id,
                'userId' => $m->user_id,
                'fullName' => (string) $m->getAttribute('full_name'),
                'saintName' => $m->getAttribute('saint_name'),
                'parishLine' => ParishUnits::describeSelection(
                    $context['taxonomy'], $context['units'],
                    $m->parish_unit_l1_id, $m->parish_unit_l2_id,
                ),
                'activeLoans' => $activeLoans,
                'blocked' => $reason !== null,
                'reason' => $reason,
            ];
        })->values()->all());
    }
}
