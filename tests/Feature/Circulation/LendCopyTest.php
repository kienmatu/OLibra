<?php

use App\Actions\Circulation\LendCopy;
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

/**
 * Shelf + manager (acting) + reader membership + one book with one available
 * copy. Names pinned OUTSIDE UserFactory's pool (known-gaps: the pool holds
 * 'Trần Minh' verbatim). Distinct slug per call so multi-command tests get
 * independent worlds.
 *
 * @return array{Bookshelf, User, Membership, BookCopy}
 */
function lendFix(array $shelfSettings = [], string $memberStatus = 'active', string $copyState = 'available', string $slug = 'dong-thap-lend'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => $shelfSettings]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $readerUser = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $readerUser->id, 'role' => 'reader', 'status' => $memberStatus,
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men',
    ]);
    $copy = BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => $copyState,
    ]);
    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    return [$shelf, $manager, $membership, $copy];
}

it('lends: loan row active, copy on_loan, due in loan_days from the local today', function () {
    // 23:30 UTC on the 27th is already the morning of the 28th in
    // Asia/Ho_Chi_Minh — BR §5.4's whole point. due_on must count from the
    // 28th; counting from the UTC date makes every evening's loans a day
    // short (the reference's dueDateFor note, lend-copy.test.ts
    // "lent_at and due_on both come from ctx.clock").
    Carbon::setTestNow(Carbon::parse('2026-08-27 23:30:00', 'UTC'));
    [, $manager, $membership, $copy] = lendFix();

    $result = app(LendCopy::class)->execute($manager, $copy, $membership);

    expect($result['dueOn'])->toBe('2026-09-11'); // 2026-08-28 + 14

    $loan = Loan::query()->findOrFail($result['loanId']);
    expect($loan->status)->toBe(LoanStatus::Active)
        ->and($loan->borrower_id)->toBe($membership->user_id)   // users.id, NEVER membership id
        ->and($loan->lent_by)->toBe($manager->id)
        ->and($loan->copy_id)->toBe($copy->id)
        ->and($loan->book_id)->toBe($copy->book_id)
        ->and($loan->due_on->toDateString())->toBe('2026-09-11')
        ->and($loan->renewals_used)->toBe(0)
        ->and($copy->fresh()->state)->toBe(CopyState::OnLoan);
});

it('loan_days is the shelf\'s own setting, defaulting to 14', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 03:00:00', 'UTC'));
    [, $manager, $membership, $copy] = lendFix(['loan_days' => 21]);

    $result = app(LendCopy::class)->execute($manager, $copy, $membership);

    expect($result['dueOn'])->toBe('2026-09-18'); // 2026-08-28 + 21
});

it('INV-7: a lost and a retired copy are refused with INV-7\'s reason, before the reader is even considered', function () {
    [, $manager, $membership, $copy] = lendFix(copyState: 'lost');
    expect(fn () => app(LendCopy::class)->execute($manager, $copy, $membership))
        ->toThrow(RuleViolated::class, 'copy_lost_or_retired');
});

it('INV-3: a copy already on loan is refused', function () {
    [, $manager, $membership, $copy] = lendFix(copyState: 'on_loan');
    expect(fn () => app(LendCopy::class)->execute($manager, $copy, $membership))
        ->toThrow(RuleViolated::class, 'copy_not_available');
});

it('OPS §5 order: the copy-side refusal beats the reader-side one', function () {
    // Lost copy AND suspended reader: the manager searched for a book that
    // is gone and needs to hear that first, not after picking a reader.
    [, $manager, $membership, $copy] = lendFix(memberStatus: 'suspended', copyState: 'lost');
    expect(fn () => app(LendCopy::class)->execute($manager, $copy, $membership))
        ->toThrow(RuleViolated::class, 'copy_lost_or_retired');
});

it('INV-4: a suspended member is refused before anything is written', function () {
    [, $manager, $membership, $copy] = lendFix(memberStatus: 'suspended');

    expect(fn () => app(LendCopy::class)->execute($manager, $copy, $membership))
        ->toThrow(RuleViolated::class, 'membership_not_active');
    expect(Loan::query()->count())->toBe(0)
        ->and($copy->fresh()->state)->toBe(CopyState::Available);
});

it('INV-5: the fourth book on a default shelf is refused; a returned loan stops counting', function () {
    [$shelf, $manager, $membership, $copy] = lendFix();

    // Three OTHER copies already out to this reader, plus one returned —
    // seeded directly. The returned fixture MUST carry return_condition:
    // loans_returned_has_condition rejects it otherwise (known-gaps, twice).
    app(TenantContext::class)->actSystemWide();
    $book2 = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be']);
    foreach ([2, 3, 4] as $i) {
        $c = BookCopy::query()->create([
            'bookshelf_id' => $shelf->id, 'book_id' => $book2->id, 'code' => sprintf('DT-%04d', $i), 'state' => 'on_loan',
        ]);
        Loan::query()->create([
            'bookshelf_id' => $shelf->id, 'copy_id' => $c->id, 'book_id' => $book2->id,
            'borrower_id' => $membership->user_id, 'lent_by' => $manager->id,
            'due_on' => '2026-09-11', 'status' => 'active',
        ]);
    }
    $returnedCopy = BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book2->id, 'code' => 'DT-0005', 'state' => 'available',
    ]);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $returnedCopy->id, 'book_id' => $book2->id,
        'borrower_id' => $membership->user_id, 'lent_by' => $manager->id,
        'due_on' => '2026-08-01', 'status' => 'returned',
        'returned_at' => now(), 'received_by' => $manager->id, 'return_condition' => 'perfect',
    ]);
    app(TenantContext::class)->set($shelf, Membership::query()->where('user_id', $manager->id)->firstOrFail());

    expect(fn () => app(LendCopy::class)->execute($manager, $copy, $membership))
        ->toThrow(RuleViolated::class, 'loan_limit_reached');
});

it('INV-5: the limit counts per shelf — three books elsewhere do not block here', function () {
    [$shelf, $manager, $membership, $copy] = lendFix();

    // The same PERSON holds three active loans on ANOTHER shelf. The count
    // must be BookshelfScope's, not a cross-shelf borrower_id scan.
    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho-lend', 'settings' => []]);
    $otherBook = Book::query()->create(['bookshelf_id' => $other->id, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'dat-rung']);
    foreach ([1, 2, 3] as $i) {
        $c = BookCopy::query()->create([
            'bookshelf_id' => $other->id, 'book_id' => $otherBook->id, 'code' => sprintf('CT-%04d', $i), 'state' => 'on_loan',
        ]);
        Loan::query()->create([
            'bookshelf_id' => $other->id, 'copy_id' => $c->id, 'book_id' => $otherBook->id,
            'borrower_id' => $membership->user_id, 'lent_by' => $manager->id,
            'due_on' => '2026-09-11', 'status' => 'active',
        ]);
    }
    app(TenantContext::class)->set($shelf, Membership::query()->where('user_id', $manager->id)->firstOrFail());

    $result = app(LendCopy::class)->execute($manager, $copy, $membership);
    expect(Loan::query()->find($result['loanId']))->not->toBeNull();
});

it('INV-1: the index, not the predicate, refuses the loser — 1062 becomes copy_not_available', function () {
    // The two-connection race cannot run under RefreshDatabase (1a
    // divergence 2), so this constructs the exact state the loser's
    // transaction would meet: copy still reads available, but an active
    // loan row already committed. The predicate passes; the INSERT hits
    // loans_one_active_per_copy; the 1062 must surface as the SAME code a
    // stale copy read produces — BR §2's "fail cleanly, plain message".
    [$shelf, $manager, $membership, $copy] = lendFix();
    app(TenantContext::class)->actSystemWide();
    $rival = User::factory()->create(['full_name' => 'Anna Người Thắng Cuộc']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $copy->book_id,
        'borrower_id' => $rival->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, Membership::query()->where('user_id', $manager->id)->firstOrFail());

    expect(fn () => app(LendCopy::class)->execute($manager, $copy, $membership))
        ->toThrow(RuleViolated::class, 'copy_not_available');
    // The loser wrote NOTHING: no second loan, copy untouched.
    expect(Loan::query()->where('copy_id', $copy->id)->count())->toBe(1)
        ->and($copy->fresh()->state)->toBe(CopyState::Available);
});

it('INV-8: the lend writes one audit record naming both ids and storing the title', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 03:00:00', 'UTC'));
    [, $manager, $membership, $copy] = lendFix();

    $result = app(LendCopy::class)->execute($manager, $copy, $membership);

    $entry = AuditLog::query()->where('action', 'loan.created')->firstOrFail();
    $after = (array) $entry->after;
    expect($entry->entity_id)->toBe($result['loanId'])
        ->and($entry->actor_id)->toBe($manager->id)
        ->and($after['borrower_id'])->toBe($membership->user_id)   // what the row holds
        ->and($after['membership_id'])->toBe($membership->id)      // what the screen picked
        ->and($after['title'])->toBe('Dế Mèn Phiêu Lưu Ký')        // stored, never re-read
        ->and($after['due_on'])->toBe('2026-09-11')
        ->and($after['request_id'])->toBeNull();                   // a walk-up lend, visibly
});

it('the copy lock is the transaction\'s first statement, the membership lock its second', function () {
    [, $manager, $membership, $copy] = lendFix(slug: 'dong-thap-lend-lock');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(LendCopy::class)->execute($manager, $copy, $membership);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect(str_contains($log[0]['query'], 'book_copies'))->toBeTrue($log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue($log[0]['query'])
        ->and(str_contains($log[1]['query'], 'memberships'))->toBeTrue($log[1]['query'])
        ->and(str_contains(strtolower($log[1]['query']), 'for update'))->toBeTrue($log[1]['query']);
});

it('the availability check reads the LOCKED row, not the stale route-bound model', function () {
    // 1a's copy-state actions validated the route-bound snapshot and would
    // have retired a copy on loan. Here: the in-memory $copy still says
    // available while the database row says on_loan. The command must
    // refuse — proof it re-reads under the lock.
    [$shelf, $manager, $membership, $copy] = lendFix(slug: 'dong-thap-lend-stale');
    BookCopy::query()->whereKey($copy->id)->update(['state' => 'on_loan']);
    expect($copy->state)->toBe(CopyState::Available); // the stale snapshot

    expect(fn () => app(LendCopy::class)->execute($manager, $copy, $membership))
        ->toThrow(RuleViolated::class, 'copy_not_available');
});

it('a reader may not lend', function () {
    [$shelf, , $membership, $copy] = lendFix(slug: 'dong-thap-lend-reader');
    $readerUser = $membership->user; // acting as the reader themselves
    test()->actingAs($readerUser);
    app(TenantContext::class)->set($shelf->fresh(), $membership);

    expect(fn () => app(LendCopy::class)->execute($readerUser, $copy, $membership))
        ->toThrow(AuthorizationException::class);
});
