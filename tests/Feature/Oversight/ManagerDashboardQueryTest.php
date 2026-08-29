<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\BorrowRequestQueueQuery;
use App\Queries\ManagerDashboardQuery;
use App\Queries\OverdueLoansQuery;
use App\Support\TenantContext;
use Carbon\Carbon;

afterEach(fn () => Carbon::setTestNow());

/**
 * Two shelves whose every figure DIFFERS (titles 2 vs 1, pending 1 vs 2,
 * …) — equal counts across shelves cannot distinguish "scoped to this
 * shelf" from "every parish's applicants added together", which is the
 * reference's named failure mode for exactly this query ("the missing
 * predicate looks like a working feature: the number is plausible").
 *
 * Grep first: `grep -rn "^function mdqFix" tests/`.
 */
function mdqFix(): array
{
    app(TenantContext::class)->actSystemWide();

    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-mdq', 'settings' => []]);
    $other = Bookshelf::factory()->create(['slug' => 'can-tho-mdq', 'settings' => []]);

    $manager = User::factory()->create(['full_name' => 'Maria Xem Tổng Quan']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);

    // Shelf A people: manager (active) + 2 active readers + 1 pending +
    // 1 suspended + 1 active membership whose USER is soft-deleted + 1
    // PENDING membership whose USER is soft-deleted.
    // readers must count active memberships managers included (the list
    // one tap away — GetReadersList — shows the manager too), and must
    // exclude the deleted identity (whereHas('user'), the same rule
    // PendingRegistrationsQuery spells). The task-5 brief shipped only the
    // active+deleted row, which pins whereHas('user') on the READERS total
    // but leaves it unfalsifiable on PENDING REGISTRATIONS — a mutant that
    // drops whereHas('user') from that count alone stayed green against
    // the brief's own fixture (verified: see task-5-report.md's mutation
    // log). The pending+deleted row below closes that gap without moving
    // any expected total, since both the kept and the deleted pending row
    // would already sit outside `readers` (status is pending, not active).
    foreach ([['active', false], ['active', false], ['pending', false],
        ['suspended', false], ['active', true], ['pending', true]] as $i => [$status, $deleteUser]) {
        $u = User::factory()->create(['full_name' => "Bạn Đọc Số {$i} MDQ"]);
        Membership::factory()->for($shelf)->create([
            'user_id' => $u->id, 'role' => 'reader', 'status' => $status,
        ]);
        if ($deleteUser) {
            $u->delete();
        }
    }

    // Shelf A catalogue: 2 titles; 3 copies of the first (one retired —
    // excluded from the copies total: it has left the shelf; the lost one
    // has not stopped being the shelf's).
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Sách Một MDQ', 'slug' => 'sach-mot-mdq']);
    Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Sách Hai MDQ', 'slug' => 'sach-hai-mdq']);
    $onLoanCopy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'on_loan']);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0002', 'state' => 'available']);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0003', 'state' => 'retired', 'retired_reason' => 'Hư hỏng nặng']);

    // One active loan, due 2026-08-10 — overdue only once the clock passes
    // the end of that VN civil day. One returned loan: late once, not
    // overdue (it must never count).
    $borrower = User::factory()->create(['full_name' => 'Giuse Đang Mượn MDQ']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $onLoanCopy->id, 'book_id' => $book->id,
        'borrower_id' => $borrower->id, 'lent_by' => $manager->id,
        'due_on' => '2026-08-10', 'status' => 'active',
    ]);
    $returnedCopy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0004', 'state' => 'available']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $returnedCopy->id, 'book_id' => $book->id,
        'borrower_id' => $borrower->id, 'lent_by' => $manager->id,
        'due_on' => '2026-08-01', 'status' => 'returned',
        'returned_at' => now(), 'return_condition' => 'perfect',
    ]);

    // Shelf B: every figure different — 1 title, 2 copies (1 available, 1
    // on loan), 2 pending, 1 active reader, 1 active+overdue loan. The
    // brief's own fixture left shelf B with zero loans and zero active
    // memberships, so a query that forgot to scope `onLoan`, `overdue` or
    // `readers` to the bound shelf at all (e.g. an unscoped `::count()`
    // reaching another shelf's rows through a stripped global scope) would
    // still pass every assertion below — 0 leaked rows is indistinguishable
    // from "correctly scoped" the same way two EQUAL counts are (see this
    // fixture's own docblock). Giving shelf B a nonzero contribution to all
    // three closes that gap; see task-5-report.md for the mutation that
    // caught it.
    $bBook = Book::query()->create(['bookshelf_id' => $other->id, 'title' => 'Sách Tủ Khác MDQ', 'slug' => 'sach-khac-mdq']);
    BookCopy::query()->create(['bookshelf_id' => $other->id, 'book_id' => $bBook->id, 'code' => 'CT-0001', 'state' => 'available']);
    $bOnLoanCopy = BookCopy::query()->create(['bookshelf_id' => $other->id, 'book_id' => $bBook->id, 'code' => 'CT-0002', 'state' => 'on_loan']);
    foreach ([1, 2] as $i) {
        $u = User::factory()->create(['full_name' => "Chờ Duyệt Tủ Khác {$i}"]);
        Membership::factory()->for($other)->create([
            'user_id' => $u->id, 'role' => 'reader', 'status' => 'pending',
        ]);
    }
    $bManager = User::factory()->create(['full_name' => 'Manager Tủ Khác MDQ']);
    Membership::factory()->for($other)->create([
        'user_id' => $bManager->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $bBorrower = User::factory()->create(['full_name' => 'Người Mượn Tủ Khác MDQ']);
    Loan::query()->create([
        'bookshelf_id' => $other->id, 'copy_id' => $bOnLoanCopy->id, 'book_id' => $bBook->id,
        'borrower_id' => $bBorrower->id, 'lent_by' => $bManager->id,
        'due_on' => '2026-08-01', 'status' => 'active',
    ]);

    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    return compact('shelf', 'other');
}

it('counts only the bound shelf, proven by distinguishable figures', function () {
    mdqFix();
    Carbon::setTestNow(Carbon::parse('2026-08-20 03:00:00', 'UTC'));

    $d = app(ManagerDashboardQuery::class)->run();

    expect($d)->toBe([
        'counts' => ['overdue' => 1, 'pendingRegistrations' => 1, 'pendingRequests' => 0],
        'totals' => ['titles' => 2, 'copies' => 3, 'onLoan' => 1, 'readers' => 3],
    ]);
    // Shelf B would have contributed: +1 title, +2 copies, +2 pending,
    // +1 reader, +1 onLoan, +1 overdue. Any of those leaking flips an
    // exact assertion above.
});

it('overdue moves when only the clock does — derived on read, no job, no column', function () {
    mdqFix();

    Carbon::setTestNow(Carbon::parse('2026-08-05 03:00:00', 'UTC'));
    $before = app(ManagerDashboardQuery::class)->run();
    Carbon::setTestNow(Carbon::parse('2026-08-20 03:00:00', 'UTC'));
    $after = app(ManagerDashboardQuery::class)->run();

    expect($before['counts']['overdue'])->toBe(0)
        ->and($after['counts']['overdue'])->toBe(1);
});

it('the overdue card agrees with the overdue list it opens', function () {
    // The reference's law: the card and the list sit one tap apart, and
    // two definitions of that number is how they come to disagree. The
    // count's where-clause mirrors OverdueLoansQuery's; this pins the
    // agreement over a fixture with active, returned-late and future rows.
    mdqFix();
    Carbon::setTestNow(Carbon::parse('2026-08-20 03:00:00', 'UTC'));

    expect(app(ManagerDashboardQuery::class)->run()['counts']['overdue'])
        ->toBe(count(app(OverdueLoansQuery::class)->run()));
});

it('pendingRequests counts pending and approved, and mirrors the queue count exactly', function () {
    ['shelf' => $shelf] = mdqFix();
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be-mdq']);
    // Three readers, because borrow_requests_one_live_per_title_member
    // (Task 1) allows one live row per title per reader — and because a
    // count that cannot tell three people apart is not a count.
    foreach ([
        ['Anna Chờ Duyệt', 'pending'],
        ['Giuse Đang Giữ Chỗ', 'approved'],
        ['Têrêsa Đã Huỷ', 'cancelled'],
    ] as [$name, $status]) {
        $u = User::factory()->create(['full_name' => $name]);
        Membership::factory()->for($shelf)->create(['user_id' => $u->id, 'role' => 'reader', 'status' => 'active']);
        BorrowRequest::query()->create([
            'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $u->id,
            'status' => $status, 'requested_at' => now(),
            'cancelled_at' => $status === 'cancelled' ? now() : null,
        ]);
    }

    $counts = app(ManagerDashboardQuery::class)->run()['counts'];

    // The cancelled row is the thing being excluded, and it exists —
    // a fixture with nothing to exclude cannot prove exclusion.
    expect($counts['pendingRequests'])->toBe(2)
        ->and($counts['pendingRequests'])->toBe(app(BorrowRequestQueueQuery::class)->countWaiting());
});
