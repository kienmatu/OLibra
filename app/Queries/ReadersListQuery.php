<?php

namespace App\Queries;

use App\Models\Loan;
use App\Models\Membership;
use App\Support\Fold;
use App\Support\Members\ParishUnits;
use App\Support\SafeId;

/**
 * GetReadersList (OPS §3.3): the manager's roster — the shelf's own
 * parish line, the live holding count, and the name/status/role/unit
 * filters. Deliberately narrow rows: BR §5.3's manager-only fields (DOB,
 * parents, phone) belong to the DETAIL, and a page must never receive a
 * field it does not render.
 *
 * Ordering is full_name_folded then memberships.id — both halves are the
 * reference's own corrections (U3 wave 1): unfolded, every Đặng sorted
 * after every Vũ; untie-broken, a paged walk lost readers between pages.
 *
 * The holding count is a second, grouped query over the SCOPED Loan model
 * — never a join that would need a hand-written tenant predicate, and
 * never a stored counter (BR §8).
 */
final class ReadersListQuery
{
    private const int PAGE_SIZE = 24;

    public function __construct(private ParishContextQuery $parish) {}

    /**
     * @param  array{q?: ?string, status?: ?string, role?: ?string, parishUnitId?: ?string, page?: int}  $input
     * @return array{rows: list<array<string, mixed>>, page: int, pageCount: int, total: int, taxonomy: array<string, mixed>}
     */
    public function run(array $input): array
    {
        $context = $this->parish->run();
        $page = max(1, (int) ($input['page'] ?? 1));

        $base = Membership::query()
            ->join('users', 'users.id', '=', 'memberships.user_id')
            ->whereNull('users.deleted_at');

        if (($input['role'] ?? null) !== null && $input['role'] !== '') {
            $base->where('memberships.role', $input['role']);
        }
        if (($input['status'] ?? null) !== null && $input['status'] !== '') {
            $base->where('memberships.status', $input['status']);
        }
        if (($input['parishUnitId'] ?? null) !== null && $input['parishUnitId'] !== '') {
            $unit = (string) $input['parishUnitId'];
            if (! SafeId::isUuid($unit)) {
                // PR #62 review, finding 1: parish_unit_l1_id/l2_id are
                // ascii_bin (database/migrations/..._create_memberships_
                // table.php). A ?unit= value that isn't UUID-shaped can
                // never match a real parish unit id, and binding its raw
                // bytes into this comparison is MariaDB errno 1267
                // ("Illegal mix of collations"), not a clean "no rows" —
                // reproduced live with an ordinary Vietnamese unit name and
                // with a bare emoji, both 500ing before this fix. Refuse
                // the same way M7's garbage-fold branch below does: matches
                // NOTHING, not everything and not a 500.
                $base->whereRaw('1 = 0');
            } else {
                $base->where(fn ($w) => $w
                    ->where('memberships.parish_unit_l1_id', $unit)
                    ->orWhere('memberships.parish_unit_l2_id', $unit));
            }
        }

        $q = trim((string) ($input['q'] ?? ''));
        if ($q !== '') {
            $folded = Fold::fold($q);
            if ($folded === '') {
                // M7: a garbage query behaves like a blank pattern would —
                // by matching NOTHING, not everything.
                $base->whereRaw('1 = 0');
            } else {
                // The fold strips % and _ to spaces, so no LIKE escape is
                // needed — same property SearchQuery relies on.
                $base->where('users.full_name_folded', 'like', '%'.$folded.'%');
            }
        }

        $total = (clone $base)->count();

        $rows = $base
            ->select('memberships.*', 'users.full_name', 'users.saint_name')
            ->orderBy('users.full_name_folded')->orderBy('memberships.id')
            ->forPage($page, self::PAGE_SIZE)
            ->get();

        // The live holding counts, one grouped query over the scoped model.
        $counts = Loan::query()
            ->whereIn('borrower_id', $rows->pluck('user_id'))
            ->where('status', 'active')
            ->selectRaw('borrower_id, count(*) as holding')
            ->groupBy('borrower_id')
            ->pluck('holding', 'borrower_id');

        return [
            'rows' => array_values($rows->map(fn (Membership $m): array => [
                'membershipId' => $m->id,
                'userId' => $m->user_id,
                'fullName' => (string) $m->getAttribute('full_name'),
                'saintName' => $m->getAttribute('saint_name'),
                'status' => $m->status->value,
                'role' => $m->role->value,
                'parishLine' => ParishUnits::describeSelection(
                    $context['taxonomy'], $context['units'],
                    $m->parish_unit_l1_id, $m->parish_unit_l2_id,
                ),
                'holdingCount' => (int) ($counts[$m->user_id] ?? 0),
            ])->all()),
            'page' => $page,
            'pageCount' => max(1, (int) ceil($total / self::PAGE_SIZE)),
            'total' => $total,
            'taxonomy' => [
                'levels' => $context['taxonomy']->levels,
                'nested' => $context['taxonomy']->nested,
                'level1Label' => $context['taxonomy']->level1Label,
                'level2Label' => $context['taxonomy']->level2Label,
            ],
        ];
    }
}
