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
use Illuminate\Auth\Access\AuthorizationException;
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
    // Mirrors ResolveTenant (app/Http/Middleware/ResolveTenant.php:61-65)
    // exactly: its query is filtered `->where('status', Active)`, so a
    // non-active membership NEVER resolves into TenantContext on the real
    // request path — binding the suspended row itself here (as this
    // fixture used to) certifies a binding no controller produces.
    app(TenantContext::class)->set($shelf, $readerStatus === 'active' ? $readerMembership : null);
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

it('an APPROVED request for the same title does not block renewal — it already names a specific copy', function () {
    // The reference's longest paragraph on this clause: an approved
    // request already holds a specific copy, so blocking a renewal on
    // account of it would refuse the reader over a queue already served.
    // Widening the status filter to include Approved must turn this red.
    [$shelf, $reader, $loan, $book] = renFix(slug: 'dong-thap-ren-approved');
    app(TenantContext::class)->actSystemWide();
    $approved = User::factory()->create(['full_name' => 'Maria Đã Được Duyệt']);
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id,
        'member_id' => $approved->id, 'status' => 'approved',
    ]);
    app(TenantContext::class)->set($shelf, Membership::query()->where('user_id', $reader->id)->firstOrFail());

    $result = app(RenewLoan::class)->execute($reader, $loan);
    expect($result['renewalsUsed'])->toBe(1);
});

it('a soft-deleted PENDING request for the same title does not block renewal — not somebody waiting', function () {
    // The reference writes `deleted_at is null` explicitly. Adding
    // ->withTrashed() to the exists() query must turn this red.
    [$shelf, $reader, $loan, $book] = renFix(slug: 'dong-thap-ren-trashed');
    app(TenantContext::class)->actSystemWide();
    $cancelled = User::factory()->create(['full_name' => 'Gioan Đã Hủy Yêu Cầu']);
    $request = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id,
        'member_id' => $cancelled->id, 'status' => 'pending',
    ]);
    $request->delete();
    expect($request->trashed())->toBeTrue();
    app(TenantContext::class)->set($shelf, Membership::query()->where('user_id', $reader->id)->firstOrFail());

    $result = app(RenewLoan::class)->execute($reader, $loan);
    expect($result['renewalsUsed'])->toBe(1);
});

it('Q4: a suspended reader cannot renew — ResolveTenant never binds their membership, so the act-as-reader gate refuses', function () {
    // 2026-08-29 product-owner ruling: this reading is CLOSED, not open.
    // ResolveTenant (app/Http/Middleware/ResolveTenant.php:61-65) is the
    // only place a membership is ever resolved into TenantContext, and it
    // filters `->where('status', Active)` — so a suspended reader's
    // TenantContext::membership() is null on every real route, this one
    // included. renFix() mirrors that filtering exactly (a suspended
    // status binds null, matching production), so this test exercises the
    // real refusal path: Gate::authorize('renew', $loan) in
    // RenewLoan::execute throws before the action's own logic runs at
    // all — the same act-as-reader gate lend/receiveReturn/void use.
    [, $reader, $loan] = renFix(readerStatus: 'suspended');

    expect(fn () => app(RenewLoan::class)->execute($reader, $loan))
        ->toThrow(AuthorizationException::class);
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

it('the queue check is skipped once renewals are already exhausted — no wasted query inside the lock', function () {
    [, $reader, $loan] = renFix(slug: 'dong-thap-ren-shortcircuit');
    app(RenewLoan::class)->execute($reader, $loan); // uses the one renewal

    DB::flushQueryLog();
    DB::enableQueryLog();
    expect(fn () => app(RenewLoan::class)->execute($reader, $loan->fresh()))
        ->toThrow(RuleViolated::class, 'no_renewals_remaining');
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect(collect($log)->contains(fn ($entry) => str_contains($entry['query'], 'borrow_requests')))
        ->toBeFalse();
});
