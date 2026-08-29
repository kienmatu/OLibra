<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\Exports\BooksExportQuery;
use App\Queries\Exports\LoansExportQuery;
use App\Queries\Exports\ReadersExportQuery;
use App\Support\Exports\ExportTables;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * One shelf with every disclosure hazard represented, one foreign shelf
 * with colliding, distinguishable data. Seeded in an order that differs
 * from the folded alphabetical order the files assert (the UUIDv7 trap),
 * with a Đ-initial name/title so byte order and folded order disagree.
 *
 * Grep first: `grep -rn "^function xpqFix" tests/`.
 */
function xpqFix(): array
{
    app(TenantContext::class)->actSystemWide();

    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-xpq', 'settings' => []]);
    $other = Bookshelf::factory()->create(['slug' => 'can-tho-xpq', 'settings' => []]);

    // Fix round on task 8: has a username, so readers' hasCredentials has
    // a TRUE path in the fixture — before, only $child (always false) had
    // one, so the map's `!== null` branch had never actually been taken.
    $manager = User::factory()->create([
        'full_name' => 'Maria Xuất Tệp',
        // Paired, not username alone: users_credentials_paired requires
        // both or neither (INV-14's DB-level enforcement).
        'username' => 'maria.manager', 'password_hash' => password_hash('xpq-fixture', PASSWORD_BCRYPT),
    ]);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);

    // Seeded V-title first so folded order (Đất… before Vừa…) differs
    // from creation order.
    $vBook = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Vừa Nhắm Mắt Vừa Mở Cửa Sổ', 'slug' => 'vua-nham-mat-xpq']);
    // published_year/page_count: fix round on task 8. No fixture book had
    // either before, so ExportTables::num()'s "bare digits, not vi-VN's
    // 2.016" claim was asserted by a test with no number in it at all.
    $dBook = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'dat-rung-xpq', 'published_year' => 2016, 'page_count' => 248]);
    $vCopy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $vBook->id, 'code' => 'DT-0002', 'state' => 'available', 'condition' => 'worn']);
    $dCopy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $dBook->id, 'code' => 'DT-0001', 'state' => 'on_loan', 'condition' => 'perfect']);

    // Fix round on task 8: soft-delete exclusion, proven rather than
    // asserted. A book that is gone must take its copy with it out of the
    // file even though the copy row itself carries no deleted_at; a copy
    // that is gone on its own must vanish while its book's OTHER copy
    // stays. Both land inside the SAME exact-array assertion the books
    // test already makes, so a regression here fails that test, not a
    // new one nobody runs.
    $goneBook = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Sách Đã Xoá XPQ', 'slug' => 'sach-da-xoa-xpq']);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $goneBook->id, 'code' => 'DT-9001', 'state' => 'available']);
    $goneBook->delete();
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $vBook->id, 'code' => 'DT-9002', 'state' => 'available'])->delete();

    // The reader whose row must NOT leak manager_notes; approved at
    // 17:30 UTC = 00:30 NEXT DAY in VN — the joined_on day-boundary pin.
    $child = User::factory()->create([
        'full_name' => 'Đặng Thị Kim Chi', 'saint_name' => 'Têrêsa',
        'date_of_birth' => '2015-04-02', 'father_name' => 'Đặng Văn Cha',
        'mother_name' => 'Lê Thị Mẹ', 'phone' => '0912345678',
        'email' => null,   // the empty-cell assertion below depends on this
        // password_hash, NOT 'password': the column is named honestly
        // (User::getAuthPasswordName), and Factory::makeInstance runs
        // UNGUARDED, so a stray 'password' key becomes a real attribute and
        // the INSERT dies with "Unknown column 'password' in 'field list'".
        // UserFactory already defaults both to null; these two are here only
        // to make hasCredentials === false explicit at the fixture.
        'username' => null, 'password_hash' => null,
    ]);
    Membership::factory()->for($shelf)->create([
        'user_id' => $child->id, 'role' => 'reader', 'status' => 'active',
        'approved_at' => '2026-08-09 17:30:00',
        'manager_notes' => 'bố hay uống rượu, gọi mẹ',
    ]);

    // Fix round on task 8: soft-delete exclusion for the OTHER two
    // removals — a person whose ACCOUNT is gone, and a person whose
    // MEMBERSHIP is gone while the account survives. Both must vanish
    // from the file for a reason distinct from foreign-shelf scoping,
    // and both fall inside the same exact-array assertion the readers
    // ordering test makes.
    $goneUser = User::factory()->create(['full_name' => 'Xoá Người Dùng XPQ']);
    Membership::factory()->for($shelf)->create(['user_id' => $goneUser->id, 'role' => 'reader', 'status' => 'active']);
    $goneUser->delete();
    $leftUser = User::factory()->create(['full_name' => 'Xoá Hồ Sơ XPQ']);
    Membership::factory()->for($shelf)->create(['user_id' => $leftUser->id, 'role' => 'reader', 'status' => 'active'])->delete();

    // A second manager-side actor, distinguishable from $manager, so a
    // loan can carry a lentBy that differs from its receivedBy — the
    // pair `toContain`-based assertions could not tell apart if swapped.
    $receiver = User::factory()->create(['full_name' => 'Gioan Nhận Trả XPQ']);

    // Loans: one active (lent 12:00 UTC = 19:00 VN same day, newest), one
    // voided with a reason (INV-11: history includes it, reason in the
    // note), one returned (oldest) with lentBy/receivedBy DISTINCT
    // people. SEEDED OLDEST FIRST, on purpose: loans.id is a monotonic
    // UUIDv7, so an unordered scan returns creation order, and a "newest
    // first" assertion seeded newest-first proves nothing (the
    // five-times-fired trap). By lent_at, newest to oldest is
    // active (08-09) > voided (08-01) > returned (07-20) — the reverse
    // of the order below, so the assertion can fail.
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $vCopy->id, 'book_id' => $vBook->id,
        'borrower_id' => $child->id, 'lent_by' => $manager->id,
        'lent_at' => '2026-08-01 04:00:00', 'due_on' => '2026-08-15', 'status' => 'voided',
        'voided_at' => '2026-08-02 04:00:00', 'voided_by' => $manager->id,
        'void_reason' => 'bấm nhầm bản sách',
    ]);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $dCopy->id, 'book_id' => $dBook->id,
        'borrower_id' => $child->id, 'lent_by' => $manager->id,
        'lent_at' => '2026-08-09 12:00:51', 'due_on' => '2026-08-23', 'status' => 'active',
    ]);
    // Both return_note AND void_reason set — not a state a real loan
    // reaches (the two are mutually exclusive by status), but the ONLY
    // way to make the `??` operand order in LoansExportQuery observable:
    // when at most one side is ever non-null, either order returns the
    // same value. Pins that `return_note` wins, deliberately, over a
    // synthetic collision.
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $dCopy->id, 'book_id' => $dBook->id,
        'borrower_id' => $child->id, 'lent_by' => $manager->id, 'received_by' => $receiver->id,
        'lent_at' => '2026-07-20 04:00:00', 'due_on' => '2026-08-03', 'status' => 'returned',
        'returned_at' => '2026-08-01 03:00:00', 'return_condition' => 'worn',
        'return_note' => 'sách ướt nhẹ khi trả',
        'void_reason' => 'không nên có ở đây — chỉ để chứng minh thứ tự toán tử',
    ]);

    // Foreign shelf: one of everything, names that would be visible if
    // scoping leaked.
    $fUser = User::factory()->create(['full_name' => 'Người Tủ Khác XPQ']);
    Membership::factory()->for($other)->create(['user_id' => $fUser->id, 'role' => 'reader', 'status' => 'active']);
    $fBook = Book::query()->create(['bookshelf_id' => $other->id, 'title' => 'Sách Tủ Khác XPQ', 'slug' => 'sach-khac-xpq']);
    $fCopy = BookCopy::query()->create(['bookshelf_id' => $other->id, 'book_id' => $fBook->id, 'code' => 'CT-0001', 'state' => 'available']);
    Loan::query()->create([
        'bookshelf_id' => $other->id, 'copy_id' => $fCopy->id, 'book_id' => $fBook->id,
        'borrower_id' => $fUser->id, 'lent_by' => $fUser->id,
        'lent_at' => '2026-08-05 04:00:00', 'due_on' => '2026-08-19', 'status' => 'active',
    ]);

    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    return compact('shelf', 'child');
}

it('books: one row per COPY, folded alphabetical, this shelf only', function () {
    xpqFix();

    $rows = app(BooksExportQuery::class)->run();

    // Exact two-element arrays, not toContain/toHaveCount: a soft-deleted
    // BOOK (with its own still-undeleted copy) and a soft-deleted COPY
    // on an otherwise-live book both exist in the fixture now, so any
    // leak of either changes this array's length or order, not just its
    // membership.
    expect(array_column($rows, 'copyCode'))->toBe(['DT-0001', 'DT-0002'])   // Đất before Vừa
        ->and(array_column($rows, 'title'))->toBe(['Đất Rừng Phương Nam', 'Vừa Nhắm Mắt Vừa Mở Cửa Sổ'])
        ->and(array_column($rows, 'title'))->not->toContain('Sách Tủ Khác XPQ');
});

it('readers: the full manager-visible profile, and NEVER manager_notes', function () {
    xpqFix();

    $rows = app(ReadersExportQuery::class)->run();
    $child = collect($rows)->firstWhere('fullName', 'Đặng Thị Kim Chi');
    $manager = collect($rows)->firstWhere('fullName', 'Maria Xuất Tệp');

    expect($child['phone'])->toBe('0912345678')
        ->and($child['fatherName'])->toBe('Đặng Văn Cha')
        ->and($child['motherName'])->toBe('Lê Thị Mẹ')
        // Prove the absence by the KEY, one assertion, then by the value
        // anywhere in the row — not a not->toHaveKeys bundle (inert).
        ->and(array_key_exists('managerNotes', $child))->toBeFalse()
        ->and(in_array('bố hay uống rượu, gọi mẹ', $child, true))->toBeFalse()
        // The credential pair is a boolean, never the values (INV-14).
        ->and($child['hasCredentials'])->toBeFalse()
        ->and(array_key_exists('username', $child))->toBeFalse()
        // Fix round: hasCredentials has a TRUE path too — $manager has a
        // username, so the map's `!== null` branch is actually exercised.
        ->and($manager['hasCredentials'])->toBeTrue()
        ->and(array_column($rows, 'fullName'))->not->toContain('Người Tủ Khác XPQ');
});

it('readers: ordered by folded full name, this shelf only — soft-deleted user or membership excluded', function () {
    xpqFix();

    $rows = app(ReadersExportQuery::class)->run();

    // Fix round: the query orders by users.full_name_folded then
    // memberships.id, but nothing asserted it — dropping either sort,
    // dropping both, or reversing the folded sort were all green.
    // $manager was created FIRST (so id order puts it first) while
    // "Đặng…" folds before "Maria…" (so folded order puts the child
    // first) — the two orders disagree, so this can fail. The exact
    // two-element array also re-proves, in one assertion, that neither
    // soft-deleted fixture (a gone USER, a gone MEMBERSHIP) leaked in.
    expect(array_column($rows, 'fullName'))->toBe(['Đặng Thị Kim Chi', 'Maria Xuất Tệp']);
});

it('readers: joinedOn is the VN civil day — approved at 17:30 UTC files under the NEXT day', function () {
    xpqFix();

    $child = collect(app(ReadersExportQuery::class)->run())->firstWhere('fullName', 'Đặng Thị Kim Chi');

    expect($child['joinedOn'])->toBe('2026-08-10');   // NOT 2026-08-09
});

it('loans: complete history newest first, voided included with its reason as the note', function () {
    xpqFix();

    $rows = app(LoansExportQuery::class)->run();

    // Seeded oldest-first (voided, active, returned by CREATION order);
    // by lent_at the true order is active, voided, returned — the
    // reverse of two of the three, so the assertion can fail.
    expect($rows)->toHaveCount(3)
        ->and($rows[0]['status'])->toBe('active')
        ->and($rows[1]['status'])->toBe('voided')
        ->and($rows[1]['note'])->toBe('bấm nhầm bản sách')
        ->and($rows[2]['status'])->toBe('returned')
        // return_note ?? void_reason: this loan has BOTH set (a
        // synthetic collision no real loan reaches — see the fixture),
        // deliberately, because with only one side ever non-null either
        // operand order returns the same value. Swapping the operands
        // in LoansExportQuery turns this red.
        ->and($rows[2]['note'])->toBe('sách ướt nhẹ khi trả')
        // lentBy/receivedBy are DISTINCT people here on purpose — a
        // toContain-based check on the whole row cannot tell the pair
        // apart if the query swapped them; a keyed assertion can.
        ->and($rows[2]['lentBy'])->toBe('Maria Xuất Tệp')
        ->and($rows[2]['receivedBy'])->toBe('Gioan Nhận Trả XPQ')
        // The instant in the shelf's timezone, no offset suffix, no
        // fractional seconds — 12:00:51 UTC is 19:00:51 in VN.
        ->and($rows[0]['lentOn'])->toBe('2026-08-09 19:00:51')
        ->and(array_column($rows, 'title'))->not->toContain('Sách Tủ Khác XPQ');
});

it('the tables translate every enum to its shipped Vietnamese word', function () {
    xpqFix();

    $books = ExportTables::books(app(BooksExportQuery::class)->run());
    $loans = ExportTables::loans(app(LoansExportQuery::class)->run());
    $readers = ExportTables::readers(app(ReadersExportQuery::class)->run());

    expect($books['headers'][0])->toBe('Tên sách')
        ->and($books['rows'][0])->toContain('Đang cho mượn')      // on_loan
        ->and($books['rows'][1])->toContain('Cũ')                 // worn
        ->and($loans['rows'][1])->toContain('Đã huỷ')             // voided
        ->and($readers['rows'][0])->toContain('Đang hoạt động')   // active
        ->and($readers['rows'][0])->toContain('Không')            // hasCredentials
        // fatherName/motherName (indices 3/4) and lentBy/receivedBy
        // (indices 8/9) are DISTINCT values on purpose — toContain on
        // the whole row is position-blind and both pairs swap green
        // under it; a fixed-index assertion is not.
        ->and($readers['rows'][0][3])->toBe('Đặng Văn Cha')       // fatherName
        ->and($readers['rows'][0][4])->toBe('Lê Thị Mẹ')          // motherName
        ->and($loans['rows'][2][8])->toBe('Maria Xuất Tệp')       // lentBy
        ->and($loans['rows'][2][9])->toBe('Gioan Nhận Trả XPQ');  // receivedBy
});

it('dates in the grid are ISO, numbers bare digits, null an empty cell', function () {
    // ISO because 02/04/2015 is April in Vietnam and February in a
    // US-locale Excel, silently; bare digits because vi-VN renders 2016
    // as "2.016", which a spreadsheet reads as two-point-oh-one-six; an
    // empty cell is what a spreadsheet means by "not recorded" — a dash
    // is a value that sorts and filters like one.
    xpqFix();

    $books = ExportTables::books(app(BooksExportQuery::class)->run());
    $readers = ExportTables::readers(app(ReadersExportQuery::class)->run());
    $row = collect($readers['rows'])->first(fn ($r) => in_array('Đặng Thị Kim Chi', $r, true));

    expect($row)->toContain('2015-04-02')     // dateOfBirth, ISO
        // email is index 6 in ExportTables::readers's row — asserted by
        // POSITION, not toContain('') alone: parishLine (index 7) is ALSO
        // '' in this fixture (no parish taxonomy configured), so a
        // content-only check that '' appears somewhere is satisfied by
        // either column and proves neither one specifically.
        ->and($row[6])->toBe('')              // email — empty cell, never "null"
        // "Đất Rừng Phương Nam" (DT-0001) is $books['rows'][0]: bare
        // digits, not vi-VN's "2.016"/"2.016" grouping — no fixture book
        // carried a year or page count before this fix round, so this
        // assertion is the first one with a number in it to fail.
        ->and($books['rows'][0][4])->toBe('2016')  // publishedYear
        ->and($books['rows'][0][6])->toBe('248');  // pageCount
});

it('the three export queries never SELECT the private column their sibling table carries', function () {
    // Fix round on task 8. The report for this file's original landing
    // claimed the readers query's narrowed `select()` (named membership
    // columns, not `memberships.*`) was "verified by the manager_notes
    // mutation" — that mutation added `manager_notes` to BOTH the select
    // AND the map, so it reds on the map half alone; restoring
    // `memberships.*` with the map untouched stays green, because the
    // map emits a fixed literal array regardless of what got hydrated
    // onto the model. Grepping the rendered SQL TEXT does not pin this
    // either: `select('memberships.*', ...)` compiles to the literal
    // string "memberships.*" — the wildcard never spells the column
    // name out, so a text search for "manager_notes" stays green against
    // exactly the regression this test exists to catch (caught by
    // running this test against that mutation before settling on the
    // approach below). The only pin that actually measures the SELECT
    // LIST is to re-run each captured statement and read the ACTUAL
    // column names MySQL expanded the wildcard into.
    //
    // Same treatment for the siblings' `loans.*`/`book_copies.*`
    // narrowing done in this same fix round: hygiene applied to one file
    // and not proven for the others is the same shape of gap this report
    // is correcting.
    xpqFix();

    $captured = [];
    DB::listen(function ($query) use (&$captured) {
        if (str_starts_with(trim(strtolower($query->sql)), 'select')) {
            $captured[] = ['sql' => $query->sql, 'bindings' => $query->bindings];
        }
    });

    app(ReadersExportQuery::class)->run();
    app(BooksExportQuery::class)->run();
    app(LoansExportQuery::class)->run();

    $columns = [];
    foreach ($captured as $query) {
        $row = DB::selectOne($query['sql'], $query['bindings']);
        if ($row !== null) {
            $columns = [...$columns, ...array_keys((array) $row)];
        }
    }

    expect($columns)->not->toContain('manager_notes')
        ->and($columns)->not->toContain('notes')       // loans.notes
        ->and($columns)->not->toContain('condition_note')
        ->and($columns)->not->toContain('retired_reason');
});

it('the status and condition word sets match copy.ts verbatim', function () {
    $ts = file_get_contents(base_path('resources/js/lib/copy.ts'));
    $lang = require lang_path('vi/exports.php');

    foreach (array_merge($lang['condition'], $lang['membership_status']) as $key => $word) {
        expect($ts)->toContain("{$key}: \"{$word}\"");
    }
});
