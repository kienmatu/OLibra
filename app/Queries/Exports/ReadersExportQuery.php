<?php

declare(strict_types=1);

namespace App\Queries\Exports;

use App\Models\Membership;
use App\Queries\ParishContextQuery;
use App\Support\Members\ParishUnits;

/**
 * OPS §3.3's ExportReadersCSV — "a CSV of children is a disclosure
 * surface" (the reference's own heading). The column set is bounded by
 * BR §16.3's reader-detail page: nothing here that the screen does not
 * already show a manager.
 *
 * manager_notes is deliberately absent, and it is the column that
 * matters: BR §5.4 calls it the manager's PRIVATE notes, no screen
 * renders it — the day someone types "bố hay uống rượu, gọi mẹ" into
 * it, that sentence must not leave the system in a downloadable file.
 * Unlike the reference's raw SQL, an Eloquent `select('memberships.*')`
 * would silently pull manager_notes onto the hydrated model even though
 * the mapped output below never reads it back out — so the column list
 * names every membership column this query needs EXCEPT manager_notes,
 * closing the leak at the query rather than trusting the map alone.
 * ExportQueriesTest writes exactly that string into the column and
 * asserts it never reaches the row, so restoring the column argues with
 * a test, not a comment. username/password_hash are not here either:
 * hasCredentials is the boolean the reader-detail page substitutes
 * (INV-14), so the file answers "does this child have a way in from
 * home" without being a list of accounts to try.
 *
 * joinedOn is the CIVIL DAY in Asia/Ho_Chi_Minh: approved_at is a UTC
 * instant, and a bare date cast files everyone approved after 5pm local
 * under the previous day — a whole day wrong, in a column headed "Ngày
 * tham gia" (the reference measured it; the test pins 17:30 UTC → next
 * day). approved_at is cast to Carbon on Membership, so this converts
 * the already-hydrated instant the way MyLoanHistoryQuery/MyDashboardQuery
 * convert lent_at/returned_at, rather than re-parsing a raw string.
 */
final class ReadersExportQuery
{
    public function __construct(private ParishContextQuery $parishContext) {}

    /** @return list<array<string, mixed>> */
    public function run(): array
    {
        $context = $this->parishContext->run();

        $rows = Membership::query()
            ->join('users', 'users.id', '=', 'memberships.user_id')
            ->whereNull('users.deleted_at')
            ->select('memberships.id', 'memberships.role', 'memberships.status',
                'memberships.approved_at', 'memberships.parish_unit_l1_id',
                'memberships.parish_unit_l2_id',
                'users.saint_name', 'users.full_name', 'users.full_name_folded',
                'users.date_of_birth', 'users.father_name', 'users.mother_name',
                'users.phone', 'users.email', 'users.username')
            ->orderBy('users.full_name_folded')
            ->orderBy('memberships.id')
            ->get();

        return array_values($rows->map(fn (Membership $m): array => [
            'saintName' => $m->getAttribute('saint_name'),
            'fullName' => (string) $m->getAttribute('full_name'),
            'dateOfBirth' => $m->getAttribute('date_of_birth'),
            'fatherName' => $m->getAttribute('father_name'),
            'motherName' => $m->getAttribute('mother_name'),
            'phone' => $m->getAttribute('phone'),
            'email' => $m->getAttribute('email'),
            'parishLine' => ParishUnits::describeSelection(
                $context['taxonomy'], $context['units'],
                $m->parish_unit_l1_id, $m->parish_unit_l2_id,
            ),
            'status' => $m->status->value,
            'role' => $m->role->value,
            'hasCredentials' => $m->getAttribute('username') !== null,
            'joinedOn' => $m->approved_at?->timezone('Asia/Ho_Chi_Minh')->toDateString(),
        ])->all());
    }
}
