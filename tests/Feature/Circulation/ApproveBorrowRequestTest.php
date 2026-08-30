<?php

use App\Actions\Circulation\ApproveBorrowRequest;
use App\Enums\CopyState;
use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Membership;
use App\Models\Notification;
use App\Models\User;
use App\Queries\SearchBooksForLendingQuery;
use App\Support\Circulation\ChooseCopy;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

afterEach(fn () => Carbon::setTestNow());

/**
 * Shelf + acting manager + reader + book with one available copy + one
 * PENDING request by the reader.
 *
 * Grep first: `grep -rn "^function abrFix" tests/` — top-level helpers are
 * process-global (AGENTS.md).
 *
 * @return array{Bookshelf, User, User, BookCopy, BorrowRequest}
 */
function abrFix(array $shelfSettings = [], string $slug = 'dong-thap-abr'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => $shelfSettings]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $mm = Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    Membership::factory()->for($shelf)->create(['user_id' => $reader->id, 'role' => 'reader', 'status' => 'active']);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0002', 'state' => 'available']);
    $request = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf, $mm);
    test()->actingAs($manager);

    return [$shelf, $manager, $reader, $copy, $request];
}

it('approving puts the copy aside and starts the hold clock from the injected clock', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 07:00:00', 'UTC'));
    [, $manager, , $copy, $request] = abrFix(['hold_days' => 5]);

    $result = app(ApproveBorrowRequest::class)->execute($manager, $request, $copy->id);

    $row = $request->fresh();
    expect($row->status)->toBe(RequestStatus::Approved)
        ->and($row->copy_id)->toBe($copy->id)
        ->and($row->decided_by)->toBe($manager->id)
        // hold_days is the SHELF's (5 here, not the default 3), counted
        // from the injected instant.
        ->and($row->hold_expires_at->toIso8601ZuluString())->toBe('2026-09-02T07:00:00Z')
        ->and($result['holdExpiresAt']->toIso8601ZuluString())->toBe('2026-09-02T07:00:00Z')
        ->and($copy->fresh()->state)->toBe(CopyState::Held);
});

it('the approval tells the reader — one notification with the title and the HCM deadline date', function () {
    // 17:30 UTC on the 28th is already the morning of the 29th in
    // Asia/Ho_Chi_Minh; +3 days lands 17:30Z on the 31st, which is
    // 00:30 on 01/09 HCM — the payload date is the PARISH's day (plan
    // divergence 5; the reference stored the UTC slice, 2026-08-31).
    Carbon::setTestNow(Carbon::parse('2026-08-28 17:30:00', 'UTC'));
    [, $manager, $reader, $copy, $request] = abrFix([], 'dong-thap-abr-notify');

    app(ApproveBorrowRequest::class)->execute($manager, $request, $copy->id);

    $note = Notification::query()->get();
    expect($note)->toHaveCount(1)
        ->and($note[0]->user_id)->toBe($reader->id)
        ->and($note[0]->kind)->toBe('request_approved')
        ->and($note[0]->payload)->toMatchArray(['title' => 'Hoàng Tử Bé', 'hold_until' => '2026-09-01']);
});

it('a copy of a different title cannot be assigned — not found, not refused about availability', function () {
    [$shelf, $manager, , , $request] = abrFix([], 'dong-thap-abr-other');
    app(TenantContext::class)->actSystemWide();
    $other = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'dat-rung']);
    $otherCopy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $other->id, 'code' => 'DT-0009', 'state' => 'available']);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $manager->id)->firstOrFail());

    expect(fn () => app(ApproveBorrowRequest::class)->execute($manager, $request, $otherCopy->id))
        ->toThrow(RuleViolated::class, 'copy_not_found');
});

it('a copy already held or on loan cannot be promised again', function () {
    [, $manager, , $copy, $request] = abrFix([], 'dong-thap-abr-held');
    BookCopy::query()->whereKey($copy->id)->update(['state' => 'held']);
    expect(fn () => app(ApproveBorrowRequest::class)->execute($manager, $request, $copy->id))
        ->toThrow(RuleViolated::class, 'no_copy_available');
});

it('a lost copy cannot be put aside, and says so in its own words', function () {
    [, $manager, , $copy, $request] = abrFix([], 'dong-thap-abr-lost');
    BookCopy::query()->whereKey($copy->id)->update(['state' => 'lost']);
    expect(fn () => app(ApproveBorrowRequest::class)->execute($manager, $request, $copy->id))
        ->toThrow(RuleViolated::class, 'chosen_copy_lost_or_retired');
});

it('an AVAILABLE copy under a live hold is refused — the two-clause predicate, not state alone', function () {
    // No shipped command produces available+held-for, but no constraint
    // forbids it either; the predicate must refuse it (the reference's
    // copies_borrowable second clause). Constructed directly.
    Carbon::setTestNow(Carbon::parse('2026-08-28 07:00:00', 'UTC'));
    [$shelf, $manager, , $copy, $request] = abrFix([], 'dong-thap-abr-twoclause');
    app(TenantContext::class)->actSystemWide();
    $rival = User::factory()->create(['full_name' => 'Anna Người Giữ Trước']);
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $request->book_id, 'member_id' => $rival->id,
        'status' => RequestStatus::Approved, 'requested_at' => now()->subHour(),
        'copy_id' => $copy->id, 'hold_expires_at' => now()->addDays(2),
        'decided_by' => $manager->id, 'decided_at' => now()->subHour(),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $manager->id)->firstOrFail());

    expect(fn () => app(ApproveBorrowRequest::class)->execute($manager, $request, $copy->id))
        ->toThrow(RuleViolated::class, 'no_copy_available');
});

it('a LAPSED rival hold is no obstacle — the expiry filter, pinned directly', function () {
    // The mirror of the test above, and the one that makes the
    // `hold_expires_at > now` filter falsifiable: same shape, same rival
    // row, only the deadline moved into the past. BR §8 — no job flipped
    // anything; the clock alone made the hold absent, and the copy the
    // ex-holder never collected was put back on the shelf by an ordinary
    // ReleaseExpiredHold (ruling 1) or was never taken off it. Delete the
    // filter and the rival reads as live: this test goes red with
    // no_copy_available while the live-hold test above stays green, which
    // is why BOTH are needed.
    Carbon::setTestNow(Carbon::parse('2026-08-28 07:00:00', 'UTC'));
    [$shelf, $manager, , $copy, $request] = abrFix([], 'dong-thap-abr-lapsed');
    app(TenantContext::class)->actSystemWide();
    $rival = User::factory()->create(['full_name' => 'Anna Người Không Đến']);
    Membership::factory()->for($shelf)->create(['user_id' => $rival->id, 'role' => 'reader', 'status' => 'active']);
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $request->book_id, 'member_id' => $rival->id,
        'status' => RequestStatus::Approved, 'requested_at' => now()->subDays(5),
        'copy_id' => $copy->id, 'hold_expires_at' => now()->subDay(),   // LAPSED
        'decided_by' => $manager->id, 'decided_at' => now()->subDays(5),
    ]);
    // The copy is available: the lapsed holder never came, and the shelf
    // has it back. (A different reader, so the live-request unique index
    // — Task 1 — is not in play.)
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $manager->id)->firstOrFail());

    $result = app(ApproveBorrowRequest::class)->execute($manager, $request, $copy->id);

    expect($request->fresh()->status)->toBe(RequestStatus::Approved)
        ->and($result['copyId'])->toBe($copy->id)
        ->and($copy->fresh()->state)->toBe(CopyState::Held)
        // And the lapsed row was left exactly as it was — approving over
        // a dead hold is not a licence to rewrite it.
        ->and(BorrowRequest::query()->where('member_id', $rival->id)->sole()->status)
        ->toBe(RequestStatus::Approved);
});

it('a request that has already been decided cannot be approved again', function () {
    [, $manager, , $copy, $request] = abrFix([], 'dong-thap-abr-decided');
    BorrowRequest::query()->whereKey($request->id)->update(['status' => RequestStatus::Rejected]);
    expect(fn () => app(ApproveBorrowRequest::class)->execute($manager, $request, $copy->id))
        ->toThrow(RuleViolated::class, 'request_not_pending');
    // And the refusal wrote nothing: no notification, copy untouched.
    expect(Notification::query()->count())->toBe(0)
        ->and($copy->fresh()->state)->toBe(CopyState::Available);
});

it('the copy lock is first, the request lock second', function () {
    [, $manager, , $copy, $request] = abrFix([], 'dong-thap-abr-lock');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(ApproveBorrowRequest::class)->execute($manager, $request, $copy->id);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect(str_contains($log[0]['query'], 'book_copies'))->toBeTrue($log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue($log[0]['query'])
        ->and(str_contains($log[1]['query'], 'borrow_requests'))->toBeTrue($log[1]['query'])
        ->and(str_contains(strtolower($log[1]['query']), 'for update'))->toBeTrue($log[1]['query']);
});

it('INV-8: request.approved stores the copy, the expiry and the reader under userId', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 07:00:00', 'UTC'));
    [, $manager, $reader, $copy, $request] = abrFix([], 'dong-thap-abr-audit');

    app(ApproveBorrowRequest::class)->execute($manager, $request, $copy->id);

    $entry = AuditLog::query()->where('action', 'request.approved')->firstOrFail();
    $before = (array) $entry->before;
    $after = (array) $entry->after;
    expect($entry->entity_id)->toBe($request->id)
        // The fixture's actingAs is load-bearing, not scenery: AuditRecorder
        // takes actor_id from Auth::id(), so a fixture that signed nobody in
        // would write a null here and this assertion is what notices.
        ->and($entry->actor_id)->toBe($manager->id)
        ->and($before)->toMatchArray(['status' => 'pending', 'copy_id' => null])
        ->and($after['status'])->toBe('approved')
        ->and($after['copy_id'])->toBe($copy->id)
        ->and($after['hold_expires_at'])->toBe('2026-08-31T07:00:00.000000Z')
        ->and($after['userId'])->toBe($reader->id);
});

/*
 * Divergence 14's disposition, made executable.
 *
 * Quick-lend step 1 (SearchBooksForLendingQuery's `blocked` flag) derives
 * availability from CountsCopies::borrowable() — state available AND no
 * live approved hold. Step 3 (ChooseCopy::lowestLendable) reads
 * book_copies.state alone and knows nothing about holds. 1c's known-gaps
 * entry called that a Phase 2 landmine: the moment an approval could
 * create a hold, the two predicates could disagree and BR §16.3's "the
 * block is stated before the confirm step" would become a lie.
 *
 * The resolution taken was to keep them in sync at the WRITER rather than
 * teach ChooseCopy the hold predicate: ApproveBorrowRequest flips the copy
 * to `held` in the same transaction as the hold, so the state-only branch
 * and the state-plus-no-live-hold branch select the same copies. These two
 * blocks are what stops that from being a paragraph — delete the
 * `$copy->update(['state' => CopyState::Held])` line and the second one
 * goes red while the command's own tests, which assert on the request row,
 * do not all follow.
 */
it('before an approval, step 1 and step 3 both offer the title\'s only copy', function () {
    [, , , $copy] = abrFix([], 'dong-thap-abr-sync-before');

    $row = app(SearchBooksForLendingQuery::class)->run('Hoàng Tử Bé')[0];
    $chosen = ChooseCopy::lowestLendable(Book::query()->with('copies')->findOrFail($copy->book_id)->copies);

    expect($row['blocked'])->toBeFalse()
        ->and($row['reason'])->toBeNull()
        ->and($chosen['copy']?->id)->toBe($copy->id)
        ->and($chosen['reason'])->toBeNull();
});

it('after an approval, step 1\'s blocked flag and ChooseCopy agree the title has nothing lendable', function () {
    [, $manager, , $copy, $request] = abrFix([], 'dong-thap-abr-sync-after');

    app(ApproveBorrowRequest::class)->execute($manager, $request, $copy->id);

    $row = app(SearchBooksForLendingQuery::class)->run('Hoàng Tử Bé')[0];
    $chosen = ChooseCopy::lowestLendable(Book::query()->with('copies')->findOrFail($copy->book_id)->copies);

    // Both halves in one expectation on purpose: the claim is that the two
    // predicates AGREE, so seeing one of them alone tells you nothing.
    expect(['blocked' => $row['blocked'], 'reason' => $row['reason']])
        ->toBe(['blocked' => true, 'reason' => 'copy_not_available'])
        ->and(['copy' => $chosen['copy'], 'reason' => $chosen['reason']])
        ->toBe(['copy' => null, 'reason' => 'copy_not_available']);
});
