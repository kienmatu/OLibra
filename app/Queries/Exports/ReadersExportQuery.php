<?php

declare(strict_types=1);

namespace App\Queries\Exports;

use App\Models\Membership;
use App\Queries\ParishContextQuery;
use App\Support\Members\ParishUnits;

/**
 * OPS §3.3's ExportReadersCSV — "a CSV of children is a disclosure
 * surface" (the reference's own heading). The column set is bounded by
 * BR §16.3's reader-detail page (`ReaderDetailQuery` +
 * `resources/js/pages/manage/readers/show.tsx`): nothing here that the
 * screen does not already show a manager — checked column by column
 * against what the PAGE renders, not against `ReaderDetailQuery`'s own
 * select, which carries fields the page never puts on screen. **One
 * documented exception**, `role` — see below.
 *
 * manager_notes IS on that screen — resources/js/pages/manage/readers/
 * show.tsx renders it (search that file for `reader.managerNotes`), one
 * child's record at a time, when `editing` is false — so its absence
 * here is not "no screen renders it" (that claim is false in this
 * codebase). The reason it is still excluded is BR §5.4 calling it the
 * manager's PRIVATE notes and INV-style reasoning this port keeps: a
 * manager reading ONE child's own record is not the same disclosure as
 * a spreadsheet a manager can hand to someone else, screenshot, or leave
 * open on a shared machine — a downloadable file is a different
 * distribution surface than a page rendered one record at a time, and
 * the day someone types "bố hay uống rượu, gọi mẹ" into it, that
 * sentence must not leave the system in a file built for handing
 * around. Unlike the reference's raw SQL, an Eloquent
 * `select('memberships.*')` would silently pull manager_notes onto the
 * hydrated model even though the mapped output below never reads it
 * back out — so the column list names every membership column this
 * query needs EXCEPT manager_notes, closing the leak at the query
 * rather than trusting the map alone. ExportQueriesTest writes exactly
 * that string into the column and asserts it never reaches the row, so
 * restoring the column argues with a test, not a comment.
 * username/password_hash are not here either: hasCredentials is the
 * boolean the reader-detail page substitutes (INV-14), so the file
 * answers "does this child have a way in from home" without being a
 * list of accounts to try.
 *
 * joinedOn IS rendered on the reader-detail page as of this fix round
 * (show.tsx's "Ngày tham gia" row) — the file used to carry this column
 * while no screen showed the fact at all, which was the bound failing
 * on its own terms; the page was made to earn the column instead of the
 * column being dropped, the same resolution the reference reached for
 * this exact gap (`old_next/src/domain/shelf/queries/exports.ts`, the
 * `joinedOn` **is** here… comment). It is the CIVIL DAY in
 * Asia/Ho_Chi_Minh: approved_at is a UTC instant, and a bare date cast
 * files everyone approved after 5pm local under the previous day — a
 * whole day wrong, in a column headed "Ngày tham gia" (the reference
 * measured it; the test pins 17:30 UTC → next day). approved_at is cast
 * to Carbon on Membership, so this converts the already-hydrated
 * instant the way MyLoanHistoryQuery/MyDashboardQuery convert
 * lent_at/returned_at, rather than re-parsing a raw string.
 *
 * role is the ONE column this file ships that no screen in this
 * codebase renders — not on show.tsx (only `status` gets a Badge; role
 * backs `MembershipPolicy`'s §9 subject-role refinement instead, with
 * no visible label anywhere on the page), not anywhere else
 * (`resources/js/lib/copy.ts`
 * has no role-label map at all). Kept anyway, as a documented exception
 * rather than a silent one, for a reason distinct from "the reference
 * does it": this query is not filtered to `role = 'reader'` the way
 * `GetReadersList`/the readers-list screen is (OPS's own entry for that
 * query notes the filter exists there specifically) — it exports every
 * membership on the shelf, managers and admins included — so a role
 * column is how a volunteer opening the file tells a manager's row from
 * a child's. `lang/vi/exports.php`'s `role` map carries the matching
 * note: no screen shows a role word to someone who cannot hold it, so
 * this file supplies the word instead of shipping a blank column.
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
            // ->copy() first: Illuminate\Support\Carbon is MUTABLE and
            // ->timezone() returns $this after shifting in place, so
            // without the copy this would permanently rewrite the
            // timezone of $m's cached `approved_at` attribute for the
            // rest of the request — harmless today only because nothing
            // reads it again, not because the call is side-effect-free.
            'joinedOn' => $m->approved_at?->copy()->timezone('Asia/Ho_Chi_Minh')->toDateString(),
        ])->all());
    }
}
