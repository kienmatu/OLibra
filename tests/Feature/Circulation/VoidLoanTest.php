<?php

use App\Actions\Circulation\VoidLoan;
use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

afterEach(fn () => Carbon::setTestNow());

/** @return array{Bookshelf, User, Loan, BookCopy} shelf, manager (acting), active loan, its copy */
function voidFix(string $slug = 'dong-thap-void'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Sửa Sai Sổ Sách']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Giuse Bị Ghi Nhầm']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'dat-rung-pn',
    ]);
    $copy = BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0004', 'state' => 'on_loan',
    ]);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $reader->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    return [$shelf, $manager, $loan, $copy];
}

it('INV-11: voiding keeps the row — status, reason, voider, time — and frees the copy', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 05:00:00', 'UTC'));
    [, $manager, $loan, $copy] = voidFix();

    app(VoidLoan::class)->execute($manager, $loan, 'Ghi nhầm bạn đọc');

    $fresh = $loan->fresh();
    expect($fresh)->not->toBeNull()
        ->and($fresh->status)->toBe(LoanStatus::Voided)
        ->and($fresh->void_reason)->toBe('Ghi nhầm bạn đọc')
        ->and($fresh->voided_by)->toBe($manager->id)
        ->and($fresh->voided_at->toDateTimeString())->toBe('2026-08-28 05:00:00')
        ->and($copy->fresh()->state)->toBe(CopyState::Available);
});

it('a reason is required, and three spaces are no reason at all', function () {
    [, $manager, $loan] = voidFix();

    expect(fn () => app(VoidLoan::class)->execute($manager, $loan, '   '))
        ->toThrow(RuleViolated::class, 'reason_required');
    expect($loan->fresh()->status)->toBe(LoanStatus::Active);
});

it('only an active loan can be voided — the undo that no longer applies says so', function () {
    [, $manager, $loan] = voidFix();
    Loan::query()->whereKey($loan->id)->update([
        'status' => 'returned', 'return_condition' => 'perfect', 'returned_at' => now(),
    ]);

    expect(fn () => app(VoidLoan::class)->execute($manager, $loan, 'muộn rồi'))
        ->toThrow(RuleViolated::class, 'loan_not_active_cannot_void');
});

it('INV-1\'s other half: a voided loan frees the copy for the next lend', function () {
    // The generated column goes NULL on the voided row, so a new active
    // loan for the same copy no longer collides.
    [$shelf, $manager, $loan, $copy] = voidFix();
    app(VoidLoan::class)->execute($manager, $loan, 'Ghi nhầm');

    app(TenantContext::class)->actSystemWide();
    $next = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $loan->book_id,
        'borrower_id' => $loan->borrower_id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-25', 'status' => 'active',
    ]);
    expect($next->exists)->toBeTrue();
});

it('voiding writes an audit record naming the reason', function () {
    // INV-12 makes the audit append-only, while loans.void_reason is an
    // ordinary column — the record here is the durable copy.
    [, $manager, $loan] = voidFix();
    app(VoidLoan::class)->execute($manager, $loan, 'Ghi nhầm bạn đọc');

    $entry = AuditLog::query()->where('action', 'loan.voided')->firstOrFail();
    expect((array) $entry->before)->toMatchArray(['status' => 'active', 'copy_state' => 'on_loan'])
        ->and((array) $entry->after)->toMatchArray([
            'status' => 'voided', 'copy_state' => 'available', 'reason' => 'Ghi nhầm bạn đọc',
        ]);
});

it('the copy lock is the transaction\'s first statement, the loan lock its second', function () {
    [, $manager, $loan] = voidFix(slug: 'dong-thap-void-lock');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(VoidLoan::class)->execute($manager, $loan, 'Ghi nhầm');
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect(str_contains($log[0]['query'], 'book_copies'))->toBeTrue($log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue($log[0]['query'])
        ->and(str_contains($log[1]['query'], 'loans'))->toBeTrue($log[1]['query'])
        ->and(str_contains(strtolower($log[1]['query']), 'for update'))->toBeTrue($log[1]['query']);
});

it('a reader may not void a loan', function () {
    [$shelf, , $loan] = voidFix(slug: 'dong-thap-void-reader');
    $borrower = User::query()->findOrFail($loan->borrower_id);
    $borrowerMembership = Membership::query()->where('user_id', $borrower->id)->firstOrFail();
    test()->actingAs($borrower);
    app(TenantContext::class)->set($shelf->fresh(), $borrowerMembership);

    expect(fn () => app(VoidLoan::class)->execute($borrower, $loan, 'không phải việc của em'))
        ->toThrow(AuthorizationException::class);
});
