<?php

use App\Actions\Circulation\LendCopy;
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

afterEach(fn () => Carbon::setTestNow());

/**
 * Shelf + acting manager + holder (reader with a LIVE approved hold on
 * the one copy, the full live-approval shape) + a second reader with no
 * hold. Grep first: `grep -rn "^function lchFix" tests/` — top-level
 * helpers are process-global (AGENTS.md).
 *
 * @return array{Bookshelf, User, Membership, Membership, BookCopy, BorrowRequest}
 */
function lchFix(string $slug = 'dong-thap-lch'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $mm = Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $holderUser = User::factory()->create(['full_name' => 'Têrêsa Người Giữ Chỗ']);
    $holder = Membership::factory()->for($shelf)->create(['user_id' => $holderUser->id, 'role' => 'reader', 'status' => 'active']);
    $otherUser = User::factory()->create(['full_name' => 'Anna Người Đến Sau']);
    $other = Membership::factory()->for($shelf)->create(['user_id' => $otherUser->id, 'role' => 'reader', 'status' => 'active']);
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

    return [$shelf, $manager, $holder, $other, $copy, $hold];
}

it('INV-3: a held copy is lendable to its holder, and the lend closes the hold', function () {
    [, $manager, $holder, , $copy, $hold] = lchFix();

    $result = app(LendCopy::class)->execute($manager, $copy, $holder);

    $loan = Loan::query()->findOrFail($result['loanId']);
    $request = $hold->fresh();
    expect($loan->status)->toBe(LoanStatus::Active)
        ->and($loan->request_id)->toBe($hold->id)                    // the rows point at each other
        ->and($request->status)->toBe(RequestStatus::Fulfilled)
        ->and($request->fulfilled_loan_id)->toBe($loan->id)
        ->and($request->hold_expires_at)->not->toBeNull()            // the deadline they met, kept
        ->and($copy->fresh()->state)->toBe(CopyState::OnLoan);
});

it('INV-3: a held copy is refused to anyone but its holder, and nothing is written', function () {
    [, $manager, , $other, $copy] = lchFix('dong-thap-lch-other');

    expect(fn () => app(LendCopy::class)->execute($manager, $copy, $other))
        ->toThrow(RuleViolated::class, 'copy_not_available');
    expect(Loan::query()->count())->toBe(0)
        ->and($copy->fresh()->state)->toBe(CopyState::Held);
});

it('INV-3: a lapsed hold makes the copy lendable to nobody, its own ex-holder included', function () {
    // The clock alone lapses it: no job ran, no row changed — the filter
    // reads the holder as absent and the state branch refuses. BR §8.
    [, $manager, $holder, , $copy, $hold] = lchFix('dong-thap-lch-lapsed');
    Carbon::setTestNow(Carbon::now()->addDays(3));

    expect(fn () => app(LendCopy::class)->execute($manager, $copy, $holder))
        ->toThrow(RuleViolated::class, 'copy_not_available');
    expect($hold->fresh()->status)->toBe(RequestStatus::Approved);   // nothing wrote 'expired'
});

it('an AVAILABLE copy under somebody else\'s live hold still lends — and never closes their request', function () {
    // TWO things at once, and both are deliberate (plan divergence 13).
    //
    // (a) The lend SUCCEEDS. LoanRules::copyLendable's available branch
    //     does not look at holds — the faithful port of the reference's
    //     policy.ts:86-108, hole included. The row is reachable with
    //     shipped 1a commands: approve onto this copy (held), ReportCopyLost
    //     (lost, the request still approved with a live hold),
    //     MarkCopyFound (available). ApproveBorrowRequest refuses that row
    //     (Task 5 has the named test); LendCopy does not, and neither does
    //     the reference. Task 19 records it in known-gaps.
    //
    // (b) The lend must NEVER close the other reader's request. That is
    //     the second half of $collectedHoldId, and this row is the only
    //     one that can exercise it — the fixture's own hold names DT-0001,
    //     so a hold on a DIFFERENT copy leaves $hold null and the branch
    //     untested.
    //
    // A third reader owns the foreign hold, not the fixture's holder:
    // holder already has a live approved row for this title, and
    // borrow_requests_one_live_per_title_member (Task 1) allows one.
    [$shelf, $manager, , $other, , $hold] = lchFix('dong-thap-lch-foreign');
    app(TenantContext::class)->actSystemWide();
    $free = BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $hold->book_id, 'code' => 'DT-0044', 'state' => 'available',
    ]);
    $promised = User::factory()->create(['full_name' => 'Phêrô Người Được Hứa']);
    Membership::factory()->for($shelf)->create(['user_id' => $promised->id, 'role' => 'reader', 'status' => 'active']);
    $foreignHold = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $hold->book_id, 'member_id' => $promised->id,
        'status' => RequestStatus::Approved, 'requested_at' => now()->subHours(2),
        'copy_id' => $free->id, 'hold_expires_at' => now()->addDays(2),
        'decided_by' => $manager->id, 'decided_at' => now()->subHours(2),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());

    $result = app(LendCopy::class)->execute($manager, $free, $other);

    expect(Loan::query()->findOrFail($result['loanId'])->request_id)->toBeNull()
        ->and($foreignHold->fresh()->status)->toBe(RequestStatus::Approved)
        ->and($foreignHold->fresh()->fulfilled_loan_id)->toBeNull()
        // The fixture's own hold, on the other copy, is untouched too.
        ->and($hold->fresh()->status)->toBe(RequestStatus::Approved);
});

it('collecting a hold writes both facts, one audit row each, in one transaction', function () {
    [, $manager, $holder, , $copy, $hold] = lchFix('dong-thap-lch-audit');

    $result = app(LendCopy::class)->execute($manager, $copy, $holder);

    $created = AuditLog::query()->where('action', 'loan.created')->firstOrFail();
    $fulfilled = AuditLog::query()->where('action', 'request.fulfilled')->firstOrFail();
    expect(((array) $created->after)['request_id'])->toBe($hold->id)     // no longer the walk-up null
        // The state the copy was ACTUALLY in. 1c could write the literal
        // 'available' safely because that was the only lendable state;
        // this row reaches the lend from held, and an audit before-bag
        // that said otherwise would be a false record, not a rounding.
        ->and(((array) $created->before)['copy_state'])->toBe('held')
        ->and($fulfilled->entity_id)->toBe($hold->id)
        // actor_id is the ONLY column that pins the session: the fixture's
        // single actingAs, not a value this test handed the command.
        ->and($fulfilled->actor_id)->toBe($manager->id)
        ->and((array) $fulfilled->before)->toMatchArray(['status' => 'approved', 'copy_id' => $copy->id, 'fulfilled_loan_id' => null])
        ->and((array) $fulfilled->after)->toMatchArray(['status' => 'fulfilled', 'copy_id' => $copy->id, 'fulfilled_loan_id' => $result['loanId']]);
});

it('a walk-up lend still audits request_id as null — 1c\'s test stays green beside this one', function () {
    // Belt to LendCopyTest's existing pin: the whole 1c suite runs
    // untouched, and this asserts the same fact from this file so a
    // regression here is named here too.
    [$shelf, $manager, , $other] = lchFix('dong-thap-lch-walkup');
    app(TenantContext::class)->actSystemWide();
    $book2 = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be']);
    $free = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book2->id, 'code' => 'DT-0090', 'state' => 'available']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());

    app(LendCopy::class)->execute($manager, $free, $other);

    expect(((array) AuditLog::query()->where('action', 'loan.created')->firstOrFail()->after)['request_id'])->toBeNull();
});
