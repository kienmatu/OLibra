<?php

use App\Actions\Circulation\RenewLoan;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

afterEach(fn () => Carbon::setTestNow());

/**
 * Shelf + a reader (ACTING — renewal is reader-initiated) holding one
 * active loan due 2026-09-04 with no renewals used.
 *
 * @return array{Bookshelf, User, Loan, Book}
 */
function renFix(array $shelfSettings = [], string $readerStatus = 'active', string $slug = 'dong-thap-ren'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => $shelfSettings]);
    $manager = User::factory()->create(['full_name' => 'Maria Thủ Thư Trưởng']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Phêrô Xin Gia Hạn']);
    $readerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => $readerStatus,
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Totto-chan Bên Cửa Sổ', 'slug' => 'totto-chan',
    ]);
    $copy = BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0003', 'state' => 'on_loan',
    ]);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $reader->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-04', 'status' => 'active', 'renewals_used' => 0,
    ]);
    app(TenantContext::class)->set($shelf, $readerMembership);
    test()->actingAs($reader);

    return [$shelf, $reader, $loan, $book];
}

it('INV-6: a renewal extends the CURRENT due date, not today — even when overdue', function () {
    // Today is 2026-09-10, six days past due. today+7 = 2026-09-17;
    // due_on+7 = 2026-09-11. The wrong arithmetic reads identical on every
    // early renewal and quietly LENGTHENS a late one — this is the fixture
    // that tells them apart (inv-06's first test).
    Carbon::setTestNow(Carbon::parse('2026-09-10 03:00:00', 'UTC'));
    [, $reader, $loan] = renFix();

    $result = app(RenewLoan::class)->execute($reader, $loan);

    expect($result['dueOn'])->toBe('2026-09-11')
        ->and($result['renewalsUsed'])->toBe(1)
        ->and($loan->fresh()->due_on->toDateString())->toBe('2026-09-11');
});

it('the extension is the shelf\'s renewal_days, not a hard-coded seven', function () {
    [, $reader, $loan] = renFix(['renewal_days' => 14]);

    $result = app(RenewLoan::class)->execute($reader, $loan);
    expect($result['dueOn'])->toBe('2026-09-18');
});

it('renewals run out, and the second attempt says so', function () {
    [, $reader, $loan] = renFix();
    app(RenewLoan::class)->execute($reader, $loan);

    expect(fn () => app(RenewLoan::class)->execute($reader, $loan->fresh()))
        ->toThrow(RuleViolated::class, 'no_renewals_remaining');
});

it('a shelf that allows more renewals allows more', function () {
    [, $reader, $loan] = renFix(['max_renewals' => 2]);
    app(RenewLoan::class)->execute($reader, $loan);
    $result = app(RenewLoan::class)->execute($reader, $loan->fresh());

    expect($result['renewalsUsed'])->toBe(2)
        ->and($result['dueOn'])->toBe('2026-09-18'); // 09-04 + 7 + 7
});

it('somebody queued for the TITLE blocks the renewal — pending only, and only this title', function () {
    // Requests are Phase 2's to CREATE; the INV-6 check ships now and is
    // tested by seeding rows directly. Three fixtures, three distinct
    // requesters (one row per case — the collapsed-fixture trap).
    [$shelf, $reader, $loan, $book] = renFix();
    app(TenantContext::class)->actSystemWide();
    $otherBook = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'dat-rung']);
    $waiting = User::factory()->create(['full_name' => 'Anna Đang Chờ Sách']);

    // A CANCELLED request for this title: not somebody waiting.
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id,
        'member_id' => $waiting->id, 'status' => 'cancelled',
    ]);
    // A PENDING request for a DIFFERENT title: not this book's queue.
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $otherBook->id,
        'member_id' => $waiting->id, 'status' => 'pending',
    ]);
    app(TenantContext::class)->set($shelf, Membership::query()->where('user_id', $reader->id)->firstOrFail());

    // Neither blocks:
    $result = app(RenewLoan::class)->execute($reader, $loan);
    expect($result['renewalsUsed'])->toBe(1);

    // A PENDING request for THIS title blocks (fresh loan on a fresh shelf
    // so renewals remain — the refusal must be the queue's, not the count's).
    [$shelf2, $reader2, $loan2, $book2] = renFix(slug: 'dong-thap-ren-q');
    app(TenantContext::class)->actSystemWide();
    $waiting2 = User::factory()->create(['full_name' => 'Gioan Đợi Đến Lượt']);
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf2->id, 'book_id' => $book2->id,
        'member_id' => $waiting2->id, 'status' => 'pending',
    ]);
    app(TenantContext::class)->set($shelf2, Membership::query()->where('user_id', $reader2->id)->firstOrFail());

    expect(fn () => app(RenewLoan::class)->execute($reader2, $loan2))
        ->toThrow(RuleViolated::class, 'title_has_queue');
});

it('Q4: a suspended reader may still renew — the assumed reading, pinned by name', function () {
    // INV-4 blocks NEW loans and protects existing ones; OPS §4.2's open
    // question records both readings and the reference implements ALLOWED.
    // Reversing is one predicate call in RenewLoan::execute (marked there)
    // plus flipping this test — loud either way.
    [, $reader, $loan] = renFix(readerStatus: 'suspended');

    $result = app(RenewLoan::class)->execute($reader, $loan);
    expect($result['renewalsUsed'])->toBe(1);
});

it('a reader cannot renew somebody else\'s loan, and hears loan_not_active, not whose it is', function () {
    [$shelf, , $loan] = renFix(slug: 'dong-thap-ren-own');
    app(TenantContext::class)->actSystemWide();
    $stranger = User::factory()->create(['full_name' => 'Đaminh Người Khác Hẳn']);
    $strangerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $stranger->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf->fresh(), $strangerMembership);
    test()->actingAs($stranger);

    expect(fn () => app(RenewLoan::class)->execute($stranger, $loan))
        ->toThrow(RuleViolated::class, 'loan_not_active');
});

it('a returned loan cannot be renewed', function () {
    [, $reader, $loan] = renFix();
    Loan::query()->whereKey($loan->id)->update([
        'status' => 'returned', 'return_condition' => 'perfect', 'returned_at' => now(),
    ]);

    expect(fn () => app(RenewLoan::class)->execute($reader, $loan))
        ->toThrow(RuleViolated::class, 'loan_not_active');
});

it('the renewal is audited, with both dates', function () {
    [, $reader, $loan] = renFix();
    app(RenewLoan::class)->execute($reader, $loan);

    $entry = AuditLog::query()->where('action', 'loan.renewed')->firstOrFail();
    expect((array) $entry->before)->toMatchArray(['due_on' => '2026-09-04', 'renewals_used' => 0])
        ->and((array) $entry->after)->toMatchArray(['due_on' => '2026-09-11', 'renewals_used' => 1]);
});

it('the loan lock is the transaction\'s first statement', function () {
    [, $reader, $loan] = renFix(slug: 'dong-thap-ren-lock');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(RenewLoan::class)->execute($reader, $loan);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect(str_contains($log[0]['query'], 'loans'))->toBeTrue($log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue($log[0]['query']);
});
