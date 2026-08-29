<?php

use App\Actions\Catalogue\ReportCopyLost;
use App\Actions\Circulation\LendCopy;
use App\Actions\Circulation\ReceiveReturn;
use App\Enums\CopyCondition;
use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\ConditionAssessment;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

afterEach(fn () => Carbon::setTestNow());

/**
 * Shelf + manager + an ACTIVE loan of one copy to one reader.
 *
 * @return array{Bookshelf, User, Loan, BookCopy}
 */
function retFix(string $slug = 'dong-thap-ret'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Nhận Trả Sách']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Giuse Người Mượn Sách']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be',
    ]);
    $copy = BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0002', 'state' => 'on_loan',
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

it('a returned copy becomes available again, and the loan carries who, when, in what condition', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 07:00:00', 'UTC'));
    [, $manager, $loan, $copy] = retFix();

    app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect);

    $fresh = $loan->fresh();
    expect($fresh->status)->toBe(LoanStatus::Returned)
        ->and($fresh->received_by)->toBe($manager->id)
        ->and($fresh->return_condition)->toBe(CopyCondition::Perfect)
        ->and($fresh->returned_at->toDateTimeString())->toBe('2026-08-28 07:00:00')
        ->and($copy->fresh()->state)->toBe(CopyState::Available);
});

it('the return records a ConditionAssessment tied to the loan, in the same transaction', function () {
    [, $manager, $loan, $copy] = retFix();

    app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Torn, 'rách gáy');

    $assessment = ConditionAssessment::query()->where('loan_id', $loan->id)->firstOrFail();
    expect($assessment->copy_id)->toBe($copy->id)
        ->and($assessment->assessed_by)->toBe($manager->id)
        ->and($assessment->condition)->toBe(CopyCondition::Torn)
        ->and($assessment->note)->toBe('rách gáy');
});

it('T27: a worse condition NEVER diverts the copy away from available', function () {
    // BR §7.1 draws exactly one arrow out of on_loan on a return. A Rách
    // copy is exactly as lendable the instant it returns; the condition
    // record is what a manager reads before deciding, by hand, to retire.
    [, $manager, $loan, $copy] = retFix();

    app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::MissingPages, 'mất trang 12-20');

    expect($copy->fresh()->state)->toBe(CopyState::Available)
        ->and($copy->fresh()->condition)->toBe(CopyCondition::MissingPages)
        ->and($copy->fresh()->condition_note)->toBe('mất trang 12-20');
});

it('returning an already-returned loan fails with loan_not_active and writes nothing more', function () {
    [, $manager, $loan] = retFix();
    app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect);

    expect(fn () => app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect))
        ->toThrow(RuleViolated::class, 'loan_not_active');
    expect(ConditionAssessment::query()->count())->toBe(1);
});

it('INV-11: a loan is never deleted on return', function () {
    [, $manager, $loan] = retFix();
    app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect);

    expect(Loan::query()->whereKey($loan->id)->exists())->toBeTrue();
});

it('INV-1 stays satisfiable: the returned copy can immediately be lent again', function () {
    [$shelf, $manager, $loan, $copy] = retFix();
    app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect);

    app(TenantContext::class)->actSystemWide();
    $next = User::factory()->create(['full_name' => 'Anna Người Mượn Kế']);
    $nextMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $next->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, Membership::query()->where('user_id', $manager->id)->firstOrFail());

    $result = app(LendCopy::class)->execute($manager, $copy->fresh(), $nextMembership);
    expect(Loan::query()->find($result['loanId'])?->status)->toBe(LoanStatus::Active);
});

it('INV-8: the return audits before and after, storing the title and the borrower', function () {
    [, $manager, $loan] = retFix();

    app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::SlightlyWorn);

    $entry = AuditLog::query()->where('action', 'loan.returned')->firstOrFail();
    $after = (array) $entry->after;
    expect((array) $entry->before)->toMatchArray(['status' => 'active', 'copy_state' => 'on_loan'])
        ->and($after['status'])->toBe('returned')
        ->and($after['copy_state'])->toBe('available')
        ->and($after['condition'])->toBe('slightly_worn')
        ->and($after['title'])->toBe('Hoàng Tử Bé')
        ->and($after['borrower_id'])->toBe($loan->borrower_id);
});

it('the copy lock is the transaction\'s first statement, the loan lock its second', function () {
    [, $manager, $loan] = retFix(slug: 'dong-thap-ret-lock');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect(str_contains($log[0]['query'], 'book_copies'))->toBeTrue($log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue($log[0]['query'])
        ->and(str_contains($log[1]['query'], 'loans'))->toBeTrue($log[1]['query'])
        ->and(str_contains(strtolower($log[1]['query']), 'for update'))->toBeTrue($log[1]['query']);
});

it('the status check reads the LOCKED row: a loan closed underneath the route binding refuses', function () {
    [, $manager, $loan] = retFix(slug: 'dong-thap-ret-stale');
    // Close it out from underneath — single statement, so
    // loans_returned_has_condition holds.
    Loan::query()->whereKey($loan->id)->update([
        'status' => 'returned', 'return_condition' => 'perfect',
        'returned_at' => now(), 'received_by' => $manager->id,
    ]);
    expect($loan->status)->toBe(LoanStatus::Active); // the stale snapshot

    expect(fn () => app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect))
        ->toThrow(RuleViolated::class, 'loan_not_active');
});

it('divergence 2: report-lost\'s loan close now takes a locking read, copy first then loan', function () {
    // The AB-BA hardening this task applies to 1a's ReportCopyLost: its
    // loan close must be a FOR UPDATE read issued AFTER its copy lock, so
    // a racing return either wins cleanly (report-lost then sees no active
    // loan) or waits — never a blind overwrite of a committed return.
    [$shelf, $manager, $loan, $copy] = retFix(slug: 'dong-thap-ret-rcl');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(ReportCopyLost::class)->execute($manager, $copy, 'bạn đọc báo làm mất');
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    $copyLockAt = null;
    $loanReadAt = null;
    foreach ($log as $i => $q) {
        $sql = strtolower($q['query']);
        if ($copyLockAt === null && str_contains($sql, 'book_copies') && str_contains($sql, 'for update')) {
            $copyLockAt = $i;
        }
        if ($loanReadAt === null && str_contains($sql, 'from `loans`')) {
            $loanReadAt = $i;
            expect(str_contains($sql, 'for update'))->toBeTrue('loan close read is not FOR UPDATE: '.$q['query']);
        }
    }
    expect($copyLockAt)->not->toBeNull()->and($loanReadAt)->not->toBeNull()
        ->and($copyLockAt)->toBeLessThan($loanReadAt);
    expect($loan->fresh()->status)->toBe(LoanStatus::Lost);
});

it('a reader may not receive a return', function () {
    [$shelf, , $loan] = retFix(slug: 'dong-thap-ret-reader');
    $borrower = User::query()->findOrFail($loan->borrower_id);
    $borrowerMembership = Membership::query()->where('user_id', $borrower->id)->firstOrFail();
    test()->actingAs($borrower);
    app(TenantContext::class)->set($shelf->fresh(), $borrowerMembership);

    expect(fn () => app(ReceiveReturn::class)->execute($borrower, $loan, CopyCondition::Perfect))
        ->toThrow(AuthorizationException::class);
});
