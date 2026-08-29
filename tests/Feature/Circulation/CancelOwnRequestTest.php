<?php

use App\Actions\Circulation\CancelOwnRequest;
use App\Enums\CopyState;
use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Shelf + reader (acting) + their PENDING request; pass approved: true
 * for an approved-with-held-copy variant (the full live-approval shape).
 *
 * Grep first: `grep -rn "^function corFix" tests/` — top-level helpers are
 * process-global (AGENTS.md).
 *
 * @return array{Bookshelf, User, BorrowRequest, ?BookCopy}
 */
function corFix(bool $approved = false, string $slug = 'dong-thap-cor'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    $membership = Membership::factory()->for($shelf)->create(['user_id' => $reader->id, 'role' => 'reader', 'status' => 'active']);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'dat-rung']);
    $copy = null;
    $fields = [
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ];
    if ($approved) {
        $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0003', 'state' => 'held']);
        $fields = [...$fields, 'status' => RequestStatus::Approved, 'copy_id' => $copy->id,
            'hold_expires_at' => now()->addDays(3), 'decided_by' => $manager->id, 'decided_at' => now()];
    }
    $request = BorrowRequest::query()->create($fields);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($reader);

    return [$shelf, $reader, $request, $copy];
}

it('a reader withdraws a pending request', function () {
    [, $reader, $request] = corFix();

    $result = app(CancelOwnRequest::class)->execute($reader, $request);

    expect($request->fresh()->status)->toBe(RequestStatus::Cancelled)
        ->and($request->fresh()->cancelled_at)->not->toBeNull()
        ->and($result['releasedCopyId'])->toBeNull();
});

it('withdrawing a held request puts the copy back on the shelf, in the same transaction', function () {
    [, $reader, $request, $copy] = corFix(approved: true, slug: 'dong-thap-cor-held');

    $result = app(CancelOwnRequest::class)->execute($reader, $request);

    $row = $request->fresh();
    expect($row->status)->toBe(RequestStatus::Cancelled)
        ->and($copy->fresh()->state)->toBe(CopyState::Available)
        ->and($result['releasedCopyId'])->toBe($copy->id)
        // hold_expires_at and copy_id are LEFT WHERE THEY STAND — the
        // record of what the reader gave up; every read of either is
        // gated on status=approved, so a cancelled row's hold is inert.
        ->and($row->copy_id)->toBe($copy->id)
        ->and($row->hold_expires_at)->not->toBeNull();
});

it('withdrawing never drags a copy that has moved on back to available', function () {
    // The guard is state='held' in the WHERE itself: if the copy was
    // since lent, lost or retired, this cancellation must not put a lost
    // book on the shelf.
    [, $reader, $request, $copy] = corFix(approved: true, slug: 'dong-thap-cor-moved');
    BookCopy::query()->whereKey($copy->id)->update(['state' => 'lost']);

    $result = app(CancelOwnRequest::class)->execute($reader, $request);

    expect($copy->fresh()->state)->toBe(CopyState::Lost)
        ->and($result['releasedCopyId'])->toBeNull()
        ->and($request->fresh()->status)->toBe(RequestStatus::Cancelled);
});

it('a reader cannot withdraw somebody else\'s request', function () {
    // Same shelf, different reader: the binding resolves, the ownership
    // comparison refuses — and it compares USER ids on both sides; a
    // membership id on either side would refuse every cancel (the
    // reference's unwriteable-without-noticing trap).
    [$shelf, , $request] = corFix(slug: 'dong-thap-cor-other');
    app(TenantContext::class)->actSystemWide();
    $rival = User::factory()->create(['full_name' => 'Anna Người Khác']);
    $rivalMembership = Membership::factory()->for($shelf)->create(['user_id' => $rival->id, 'role' => 'reader', 'status' => 'active']);
    app(TenantContext::class)->set($shelf->fresh(), $rivalMembership);
    test()->actingAs($rival);

    expect(fn () => app(CancelOwnRequest::class)->execute($rival, $request))
        ->toThrow(RuleViolated::class, 'not_own_request');
});

it('a fulfilled request cannot be withdrawn, and says why', function () {
    [, $reader, $request] = corFix(slug: 'dong-thap-cor-ful');
    BorrowRequest::query()->whereKey($request->id)->update(['status' => RequestStatus::Fulfilled]);

    expect(fn () => app(CancelOwnRequest::class)->execute($reader, $request))
        ->toThrow(RuleViolated::class, 'request_already_fulfilled');
});

it('a rejected request is already decided', function () {
    [, $reader, $request] = corFix(slug: 'dong-thap-cor-rej');
    BorrowRequest::query()->whereKey($request->id)->update(['status' => RequestStatus::Rejected]);

    expect(fn () => app(CancelOwnRequest::class)->execute($reader, $request))
        ->toThrow(RuleViolated::class, 'request_not_pending');
});

it('for a held request the copy lock is first, the request lock second', function () {
    [, $reader, $request] = corFix(approved: true, slug: 'dong-thap-cor-lock');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(CancelOwnRequest::class)->execute($reader, $request);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect(str_contains($log[0]['query'], 'book_copies'))->toBeTrue($log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue($log[0]['query'])
        ->and(str_contains($log[1]['query'], 'borrow_requests'))->toBeTrue($log[1]['query'])
        ->and(str_contains(strtolower($log[1]['query']), 'for update'))->toBeTrue($log[1]['query']);
});

it('INV-8: request.cancelled records which copy went back, and null when none did', function () {
    [, $reader, $request, $copy] = corFix(approved: true, slug: 'dong-thap-cor-audit');

    app(CancelOwnRequest::class)->execute($reader, $request);

    $entry = AuditLog::query()->where('action', 'request.cancelled')->firstOrFail();
    expect((array) $entry->before)->toMatchArray(['status' => 'approved', 'copy_id' => $copy->id])
        // The fixture's actingAs is load-bearing, not scenery: AuditRecorder
        // takes actor_id from Auth::id(), never from the $actor parameter
        // this command is handed — a fixture that signed nobody in would
        // write a null actor_id here, and this assertion is what notices.
        // actor_id is nullable and AuditLogQuery's actor join is a LEFT
        // join (a null actor renders "Hệ thống", not a query failure), so
        // nothing else in this file would go red without it.
        ->and($entry->actor_id)->toBe($reader->id)
        ->and((array) $entry->after)->toMatchArray([
            'status' => 'cancelled',
            'title' => 'Đất Rừng Phương Nam',
            'released_copy_id' => $copy->id,
        ]);
});
