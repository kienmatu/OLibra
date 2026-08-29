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

    $manager = User::factory()->create(['full_name' => 'Maria Xuất Tệp']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);

    // Seeded V-title first so folded order (Đất… before Vừa…) differs
    // from creation order.
    $vBook = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Vừa Nhắm Mắt Vừa Mở Cửa Sổ', 'slug' => 'vua-nham-mat-xpq']);
    $dBook = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'dat-rung-xpq']);
    $vCopy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $vBook->id, 'code' => 'DT-0002', 'state' => 'available', 'condition' => 'worn']);
    $dCopy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $dBook->id, 'code' => 'DT-0001', 'state' => 'on_loan', 'condition' => 'perfect']);

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

    // Loans: one active (lent 12:00 UTC = 19:00 VN same day), one voided
    // with a reason (INV-11: history includes it, reason in the note).
    // SEEDED OLDEST FIRST, on purpose: loans.id is a monotonic UUIDv7, so
    // an unordered scan returns creation order, and a "newest first"
    // assertion seeded newest-first proves nothing (the five-times-fired
    // trap). The voided row is the OLDER one and must come back SECOND.
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

    expect(array_column($rows, 'copyCode'))->toBe(['DT-0001', 'DT-0002'])   // Đất before Vừa
        ->and(array_column($rows, 'title'))->toBe(['Đất Rừng Phương Nam', 'Vừa Nhắm Mắt Vừa Mở Cửa Sổ'])
        ->and(array_column($rows, 'title'))->not->toContain('Sách Tủ Khác XPQ');
});

it('readers: the full manager-visible profile, and NEVER manager_notes', function () {
    xpqFix();

    $rows = app(ReadersExportQuery::class)->run();
    $child = collect($rows)->firstWhere('fullName', 'Đặng Thị Kim Chi');

    expect($child['phone'])->toBe('0912345678')
        ->and($child['fatherName'])->toBe('Đặng Văn Cha')
        // Prove the absence by the KEY, one assertion, then by the value
        // anywhere in the row — not a not->toHaveKeys bundle (inert).
        ->and(array_key_exists('managerNotes', $child))->toBeFalse()
        ->and(in_array('bố hay uống rượu, gọi mẹ', $child, true))->toBeFalse()
        // The credential pair is a boolean, never the values (INV-14).
        ->and($child['hasCredentials'])->toBeFalse()
        ->and(array_key_exists('username', $child))->toBeFalse()
        ->and(array_column($rows, 'fullName'))->not->toContain('Người Tủ Khác XPQ');
});

it('readers: joinedOn is the VN civil day — approved at 17:30 UTC files under the NEXT day', function () {
    xpqFix();

    $child = collect(app(ReadersExportQuery::class)->run())->firstWhere('fullName', 'Đặng Thị Kim Chi');

    expect($child['joinedOn'])->toBe('2026-08-10');   // NOT 2026-08-09
});

it('loans: complete history newest first, voided included with its reason as the note', function () {
    xpqFix();

    $rows = app(LoansExportQuery::class)->run();

    // The voided row was seeded FIRST and must come back SECOND — the
    // assertion is the reverse of creation order, so it can fail.
    expect($rows)->toHaveCount(2)
        ->and($rows[0]['status'])->toBe('active')
        ->and($rows[1]['status'])->toBe('voided')
        ->and($rows[1]['note'])->toBe('bấm nhầm bản sách')
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
        ->and($readers['rows'][0])->toContain('Không');           // hasCredentials
});

it('dates in the grid are ISO, numbers bare digits, null an empty cell', function () {
    // ISO because 02/04/2015 is April in Vietnam and February in a
    // US-locale Excel, silently; bare digits because vi-VN renders 2016
    // as "2.016", which a spreadsheet reads as two-point-oh-one-six; an
    // empty cell is what a spreadsheet means by "not recorded" — a dash
    // is a value that sorts and filters like one.
    xpqFix();

    $readers = ExportTables::readers(app(ReadersExportQuery::class)->run());
    $row = collect($readers['rows'])->first(fn ($r) => in_array('Đặng Thị Kim Chi', $r, true));

    expect($row)->toContain('2015-04-02')     // dateOfBirth, ISO
        ->and($row)->toContain('');           // email — empty cell, never "null"
});

it('the status and condition word sets match copy.ts verbatim', function () {
    $ts = file_get_contents(base_path('resources/js/lib/copy.ts'));
    $lang = require lang_path('vi/exports.php');

    foreach (array_merge($lang['condition'], $lang['membership_status']) as $key => $word) {
        expect($ts)->toContain("{$key}: \"{$word}\"");
    }
});
