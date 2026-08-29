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
    // One statement per fact, so a regression names itself rather than
    // hiding behind whichever assertion Pest reaches first.
    expect($loan->status)->toBe(LoanStatus::Active);
    expect($loan->request_id)->toBe($hold->id);                      // the rows point at each other
    expect($request->status)->toBe(RequestStatus::Fulfilled);
    expect($request->fulfilled_loan_id)->toBe($loan->id);
    expect($request->hold_expires_at)->not->toBeNull();              // the deadline they met, kept
    expect($copy->fresh()->state)->toBe(CopyState::OnLoan);
});

it('INV-3: a held copy is refused to anyone but its holder, and nothing is written', function () {
    [, $manager, , $other, $copy] = lchFix('dong-thap-lch-other');

    expect(fn () => app(LendCopy::class)->execute($manager, $copy, $other))
        ->toThrow(RuleViolated::class, 'copy_not_available');
    expect(Loan::query()->count())->toBe(0);
    expect($copy->fresh()->state)->toBe(CopyState::Held);
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

/**
 * The divergence-13 row, which takes two it() blocks to observe (see the
 * first of them). lchFix's shelf, plus a SECOND copy that is `available`
 * while carrying a live approved hold for a THIRD reader — Phêrô, not the
 * fixture's holder, because the holder already has a live approved row for
 * this title and borrow_requests_one_live_per_title_member (Task 1) allows
 * one. Grep first: `grep -rn "^function lchForeignHoldFix" tests/` — top-level
 * helpers are process-global (AGENTS.md).
 *
 * @return array{User, Membership, BookCopy, BorrowRequest, BorrowRequest}
 */
function lchForeignHoldFix(string $slug): array
{
    [$shelf, $manager, , $other, , $hold] = lchFix($slug);
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

    return [$manager, $other, $free, $foreignHold, $hold];
}

it('an AVAILABLE copy under somebody else\'s live hold still lends — plan divergence 13', function () {
    // Half (a) of divergence 13, and the reason it gets its OWN it():
    // dropping the ownership half of $collectedHoldId breaks this fact AND
    // the two in the next test, but a failed expect() aborts the whole
    // test METHOD — not just a ->and() chain — so facts sharing an it()
    // can never be observed failing together. Measured, not assumed: with
    // the four facts as four separate statements in one it(), the mutation
    // still showed only the first. Two it() blocks is what makes both
    // halves of the brief's mutation-2 prediction visible.
    //
    // The lend SUCCEEDS: LoanRules::copyLendable's available branch does
    // not look at holds — the faithful port of the reference's
    // policy.ts:86-108, hole included. ApproveBorrowRequest refuses that
    // row (Task 5 has the named test); LendCopy does not, and neither does
    // the reference.
    //
    // CORRECTED by Task 19's walk, which RAN the sequence this comment used
    // to claim: "approve onto this copy (held), ReportCopyLost, then
    // MarkCopyFound" does NOT reach the row. CopyStateMachine::ALLOWED has
    // no held->lost arrow, so ReportCopyLost on a held copy throws
    // copy_not_on_loan — measured against the real MariaDB, not read off
    // the table. The fixture below constructs the row directly for that
    // reason, exactly as ApproveBorrowRequestTest's two-clause block says
    // in its own words ("No shipped command produces available+held-for").
    // The hole in the predicate is real and ported; what keeps it out of
    // reach today is BR §7.1's transition table, which is not a guard
    // anybody wrote for this purpose — CopyStateMachine's own Q3 note calls
    // widening the arrows into `lost` "one line here plus one test", and
    // that line would open this. known-gaps carries the full disposition.
    [$manager, $other, $free] = lchForeignHoldFix('dong-thap-lch-foreign');

    $result = app(LendCopy::class)->execute($manager, $free, $other);

    // The loan exists, and it came out of no queue.
    expect(Loan::query()->findOrFail($result['loanId'])->request_id)->toBeNull();
});

it('...and that lend NEVER closes the other reader\'s request', function () {
    // Half (b), the second half of $collectedHoldId. This row is the only
    // one that can exercise it: the fixture's own hold names DT-0001, so a
    // foreign hold on a DIFFERENT copy would leave $hold null and the
    // branch untested. Here the foreign hold names the copy being lent.
    //
    // Both of Phêrô's columns in ONE assertion, deliberately: they are
    // written by a single UPDATE, so a failure should show both rather
    // than abort on whichever came first.
    [$manager, $other, $free, $foreignHold, $hold] = lchForeignHoldFix('dong-thap-lch-foreign-b');

    app(LendCopy::class)->execute($manager, $free, $other);

    $row = $foreignHold->fresh();
    expect(['status' => $row->status, 'fulfilled_loan_id' => $row->fulfilled_loan_id])
        ->toBe(['status' => RequestStatus::Approved, 'fulfilled_loan_id' => null]);
    // The fixture's own hold, on the other copy, is untouched too.
    expect($hold->fresh()->status)->toBe(RequestStatus::Approved);
});

it('collecting a hold writes both facts, one audit row each, in one transaction', function () {
    [, $manager, $holder, , $copy, $hold] = lchFix('dong-thap-lch-audit');

    $result = app(LendCopy::class)->execute($manager, $copy, $holder);

    $created = AuditLog::query()->where('action', 'loan.created')->firstOrFail();
    $fulfilled = AuditLog::query()->where('action', 'request.fulfilled')->firstOrFail();
    expect(((array) $created->after)['request_id'])->toBe($hold->id);    // no longer the walk-up null
    // The state the copy was ACTUALLY in. 1c could write the literal
    // 'available' safely because that was the only lendable state; this
    // row reaches the lend from held, and an audit before-bag that said
    // otherwise would be a false record, not a rounding. Paired with the
    // walk-up test's 'available' pin below, which is what measures the
    // claim that the change is a no-op off this path.
    expect(((array) $created->before)['copy_state'])->toBe('held');
    expect($fulfilled->entity_id)->toBe($hold->id);
    // actor_id is the ONLY column that pins the session: the fixture's
    // single actingAs, not a value this test handed the command.
    expect($fulfilled->actor_id)->toBe($manager->id);
    expect((array) $fulfilled->before)->toMatchArray(['status' => 'approved', 'copy_id' => $copy->id, 'fulfilled_loan_id' => null]);
    expect((array) $fulfilled->after)->toMatchArray(['status' => 'fulfilled', 'copy_id' => $copy->id, 'fulfilled_loan_id' => $result['loanId']]);
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

    $entry = AuditLog::query()->where('action', 'loan.created')->firstOrFail();
    expect(((array) $entry->after)['request_id'])->toBeNull();
    // And the before-bag still reads 'available'. Phase 2a replaced the
    // literal with the copy's actual state (a collected hold reaches the
    // lend from held); this is the measurement, not the argument, that the
    // replacement is a no-op on the walk-up path 1c shipped.
    expect(((array) $entry->before)['copy_state'])->toBe('available');
});
