<?php

use App\Actions\Circulation\HandoverRequest;
use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Enums\RequestStatus;
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
use Illuminate\Auth\Access\AuthorizationException;

afterEach(fn () => Carbon::setTestNow());

/**
 * Shelf + acting manager + holder (a reader with a LIVE approved hold on
 * the one copy). The same skeleton as lchFix, repeated rather than shared:
 * a fixture two files reach into is a fixture neither owns. Grep first —
 * `grep -rn "^function hovFix" tests/` — top-level helpers are
 * process-global (AGENTS.md).
 *
 * @return array{Bookshelf, User, Membership, BookCopy, BorrowRequest}
 */
function hovFix(string $slug = 'dong-thap-hov'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $mm = Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $holderUser = User::factory()->create(['full_name' => 'Têrêsa Người Giữ Chỗ']);
    $holder = Membership::factory()->for($shelf)->create(['user_id' => $holderUser->id, 'role' => 'reader', 'status' => 'active']);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'held']);
    $hold = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $holderUser->id,
        'status' => RequestStatus::Approved, 'requested_at' => now()->subDay(),
        'copy_id' => $copy->id, 'hold_expires_at' => now()->addDays(2),
        'decided_by' => $manager->id, 'decided_at' => now()->subDay(),
    ]);
    app(TenantContext::class)->set($shelf, $mm);
    test()->actingAs($manager);

    return [$shelf, $manager, $holder, $copy, $hold];
}

it('handing over the held copy creates the loan and closes the request', function () {
    [, $manager, $holder, $copy, $hold] = hovFix();

    $result = app(HandoverRequest::class)->execute($manager, $hold);

    $loan = Loan::query()->findOrFail($result['loanId']);
    expect($loan->status)->toBe(LoanStatus::Active)
        ->and($loan->borrower_id)->toBe($holder->user_id)
        ->and($loan->request_id)->toBe($hold->id)
        ->and($hold->fresh()->status)->toBe(RequestStatus::Fulfilled)
        ->and($hold->fresh()->fulfilled_loan_id)->toBe($loan->id)
        ->and($copy->fresh()->state)->toBe(CopyState::OnLoan);
});

it('the handover writes loan.created and request.fulfilled — LendCopy\'s pair, untouched', function () {
    [, $manager, , , $hold] = hovFix('dong-thap-hov-audit');

    app(HandoverRequest::class)->execute($manager, $hold);

    expect(AuditLog::query()->where('action', 'loan.created')->count())->toBe(1)
        ->and(AuditLog::query()->where('action', 'request.fulfilled')->count())->toBe(1);
    // actor_id, not lent_by/decided_by: AuditRecorder writes it from
    // Auth::id() alone, so it is the only column on these rows that pins
    // the SESSION rather than the $actor argument this test hands in. A
    // delegation that lost the acting manager — a queued job, a
    // system-context re-entry — would leave both rows here with a null
    // actor and every other assertion above still green.
    expect(AuditLog::query()->where('action', 'loan.created')->value('actor_id'))->toBe($manager->id);
    expect(AuditLog::query()->where('action', 'request.fulfilled')->value('actor_id'))->toBe($manager->id);
});

it('a hold that lapsed by the clock alone can no longer be handed over', function () {
    [, $manager, , $copy, $hold] = hovFix('dong-thap-hov-lapsed');
    Carbon::setTestNow(Carbon::now()->addDays(3));

    expect(fn () => app(HandoverRequest::class)->execute($manager, $hold))
        ->toThrow(RuleViolated::class, 'hold_expired');
    // Nothing wrote anything: no loan, request approved, copy held.
    expect(Loan::query()->count())->toBe(0)
        ->and($hold->fresh()->status)->toBe(RequestStatus::Approved)
        ->and($copy->fresh()->state)->toBe(CopyState::Held);
});

it('a request with nothing held for it is refused, whatever state it is in', function (string $case, array $override) {
    // A DATASET, not a foreach. hovFix ends with test()->actingAs($manager),
    // and SessionGuard caches the acting user for a whole test METHOD —
    // calling the fixture four times inside one it() is the zero-tolerance
    // violation Global Constraints names (fired four times on this
    // project). Each dataset case is its own test method, so each gets its
    // own guard, its own database state and its own slug.
    //
    // copy_id is left SET on the three decided cases on purpose: nulling it
    // would trip the first check and the STATUS branch would never run.
    // These are stale-queue-page shapes — the row moved on while the page
    // stood still — which is exactly what request_not_held answers.
    [, $manager, , , $hold] = hovFix('dong-thap-hov-unheld-'.$case);
    BorrowRequest::query()->whereKey($hold->id)->update($override);

    expect(fn () => app(HandoverRequest::class)->execute($manager, $hold->fresh()))
        ->toThrow(RuleViolated::class, 'request_not_held');
})->with([
    'pending' => ['pending', ['status' => 'pending', 'copy_id' => null, 'hold_expires_at' => null, 'decided_by' => null, 'decided_at' => null]],
    'rejected' => ['rejected', ['status' => 'rejected']],
    'cancelled' => ['cancelled', ['status' => 'cancelled', 'cancelled_at' => '2026-08-28 00:00:00']],
    'fulfilled' => ['fulfilled', ['status' => 'fulfilled']],
]);

it('a hold whose row already carries the expired status refuses with hold_expired', function () {
    // Ruling 1 made this branch REACHABLE: ReleaseExpiredHold (Task 18) is
    // the one writer of `expired`, and a manager who releases a lapsed hold
    // while a volunteer's queue page still shows its handover button
    // produces exactly this row. Before that ruling the branch was
    // defensive against nothing and the docblock said so; it no longer
    // does, and this test is why. The SENTENCE matters as much as the
    // refusal: request_not_held ("Yêu cầu này không có bản sách nào đang
    // được giữ chỗ") would be a false statement about a row that plainly
    // names a copy — hold_expired names the remedy ("Bạn đọc cần đăng ký
    // lại").
    [, $manager, , $copy, $hold] = hovFix('dong-thap-hov-expired');
    BorrowRequest::query()->whereKey($hold->id)->update(['status' => 'expired']);

    expect(fn () => app(HandoverRequest::class)->execute($manager, $hold->fresh()))
        ->toThrow(RuleViolated::class, 'hold_expired');
    expect(Loan::query()->count())->toBe(0)
        ->and($copy->fresh()->state)->toBe(CopyState::Held);
});

it('a suspended holder is refused at handover — LendCopy\'s own sentence, not a second definition', function () {
    // Named for what it asserts. The first draft called this "a suspended
    // holder, AND ONE AT THE LOAN LIMIT, are refused" and tested only the
    // suspension; the limit case belongs to LendCopyTest, which owns
    // memberMayBorrow's count, and is not restated here.
    [, $manager, $holder, , $hold] = hovFix('dong-thap-hov-susp');
    Membership::query()->whereKey($holder->id)->update(['status' => 'suspended', 'suspension_reason' => 'thử nghiệm']);

    expect(fn () => app(HandoverRequest::class)->execute($manager, $hold))
        ->toThrow(RuleViolated::class, 'membership_not_active');
});

it('the handover fulfils the request it was asked about, never an earlier one', function () {
    // Two live approved holds on one copy is a state the approve lock
    // exists to prevent and no constraint enforces; constructed directly.
    // The EARLIER hold is the one LendCopy's ordered read finds, so a
    // handover asked about the LATER row must refuse.
    //
    // This pins the CODE, and the code is the whole of what the check
    // buys — measured by deleting the first-hold check and running this
    // file: this test alone reddens, with copy_not_available (LendCopy
    // refusing on its own, since it collects only the borrower's own
    // hold) where request_not_held is expected. So the assertion below is
    // not decoration around a safety property; it IS the property. The
    // untouched earlier hold is asserted too, and stayed green under that
    // mutation.
    [$shelf, $manager, , $copy, $hold] = hovFix('dong-thap-hov-first');
    app(TenantContext::class)->actSystemWide();
    $later = User::factory()->create(['full_name' => 'Anna Đăng Ký Sau']);
    Membership::factory()->for($shelf)->create(['user_id' => $later->id, 'role' => 'reader', 'status' => 'active']);
    $laterHold = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $hold->book_id, 'member_id' => $later->id,
        'status' => RequestStatus::Approved, 'requested_at' => now(),          // AFTER $hold's subDay()
        'copy_id' => $copy->id, 'hold_expires_at' => now()->addDays(2),
        'decided_by' => $manager->id, 'decided_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());

    expect(fn () => app(HandoverRequest::class)->execute($manager, $laterHold))
        ->toThrow(RuleViolated::class, 'request_not_held');
    expect($hold->fresh()->status)->toBe(RequestStatus::Approved);
});

it('the holder having left the shelf refuses cleanly rather than passing null onward', function () {
    [$shelf, $manager, $holder, , $hold] = hovFix('dong-thap-hov-left');
    Membership::query()->whereKey($holder->id)->delete();   // soft delete

    expect(fn () => app(HandoverRequest::class)->execute($manager, $hold))
        ->toThrow(RuleViolated::class, 'request_not_held');
});

it('a reader is refused by the gate before the row is described at all', function () {
    // No second actingAs, so the SessionGuard rule holds with hovFix's own
    // switch the only one in this block: act-as-manager reads
    // TenantContext's membership (AppServiceProvider's $roleGate, which
    // also checks membership->user_id === the gated user), so rebinding
    // the tenant to the holder's own READER membership is all it takes to
    // change who the gate sees.
    //
    // The row is deliberately one the pre-flight would refuse, and that is
    // what makes this test discriminating rather than decorative: delete
    // this command's authorize() and the throw becomes
    // RuleViolated('hold_expired') — a reader reading the state of a
    // request that is none of their business. Measured: with the
    // authorize() line and its import removed, the whole suite (1135
    // tests) stayed green before this block existed. A LIVE-hold version
    // would pin nothing, LendCopy's own authorize('lend', …) raising the
    // same exception class one call later.
    [$shelf, , $holder, , $hold] = hovFix('dong-thap-hov-reader');
    BorrowRequest::query()->whereKey($hold->id)->update(['status' => 'expired']);
    app(TenantContext::class)->set($shelf->fresh(), $holder);

    expect(fn () => app(HandoverRequest::class)->execute($holder->user, $hold->fresh()))
        ->toThrow(AuthorizationException::class);
});
