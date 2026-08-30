<?php

use App\Actions\Circulation\ReceiveReturn;
use App\Enums\CopyCondition;
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
use App\Models\Notification;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

afterEach(fn () => Carbon::setTestNow());

/**
 * Shelf + acting manager + borrower with an ACTIVE loan on the one copy
 * + a queue of $queued PENDING requests by distinct readers, seeded OUT
 * of requested_at order (UUIDv7 rule).
 *
 * @return array{Bookshelf, User, Loan, BookCopy, list<BorrowRequest>}
 */
function rrwFix(int $queued = 0, string $slug = 'dong-thap-rrw'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $mm = Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $borrower = User::factory()->create(['full_name' => 'Giuse Người Đang Mượn']);
    Membership::factory()->for($shelf)->create(['user_id' => $borrower->id, 'role' => 'reader', 'status' => 'active']);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'on_loan']);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $borrower->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    // Queue seeded NEWEST-FIRST so creation order (and the v7 ids)
    // DISAGREES with requested_at order — the ordering is falsifiable.
    $requests = [];
    for ($i = $queued; $i >= 1; $i--) {
        $u = User::factory()->create(['full_name' => "Bạn Chờ Thứ {$i}"]);
        Membership::factory()->for($shelf)->create(['user_id' => $u->id, 'role' => 'reader', 'status' => 'active']);
        $requests[$i] = BorrowRequest::query()->create([
            'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $u->id,
            'status' => RequestStatus::Pending, 'requested_at' => now()->subMinutes(100 - $i),
        ]);
    }
    ksort($requests);
    app(TenantContext::class)->set($shelf, $mm);
    test()->actingAs($manager);

    return [$shelf, $manager, $loan, $copy, array_values($requests)];
}

it('nothing is held automatically when the manager does not ask', function () {
    [, $manager, $loan, $copy, $queue] = rrwFix(queued: 2);

    $result = app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect);

    expect($copy->fresh()->state)->toBe(CopyState::Available)
        ->and($queue[0]->fresh()->status)->toBe(RequestStatus::Pending)
        // The exclusions, with two queued readers actually seeded: no
        // second audit row and no bell. "Nothing is held" is not just the
        // request's status — an automatic hold that wrote request.approved
        // or told a child their book was ready would be exactly as wrong.
        ->and(AuditLog::query()->where('action', 'request.approved')->exists())->toBeFalse()
        ->and(Notification::query()->count())->toBe(0)
        // …but the earliest waiter IS reported, so the confirmation can
        // offer them (BR §16.3: "the confirmation says so immediately").
        ->and($result['queuedRequestId'])->toBe($queue[0]->id);
});

it('the queue is reported in requested_at order with the id tiebreak, not insertion order', function () {
    // Fixture seeds newest-first, so creation order is the WRONG answer.
    [, $manager, $loan, , $queue] = rrwFix(queued: 3, slug: 'dong-thap-rrw-order');

    $result = app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect);

    expect($result['queuedRequestId'])->toBe($queue[0]->id);
});

it('holding for the next reader is a second fact, in the same transaction, and the copy is never available', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 07:00:00', 'UTC'));
    [, $manager, $loan, $copy, $queue] = rrwFix(queued: 2, slug: 'dong-thap-rrw-hold');

    $result = app(ReceiveReturn::class)->execute(
        $manager, $loan, CopyCondition::Perfect, null, null, $queue[0]->id,
    );

    $held = $queue[0]->fresh();
    expect($loan->fresh()->status)->toBe(LoanStatus::Returned)
        // ONE copy write, straight to held — never available in between
        // (OPS §5; the single-UPDATE shape is pinned by the query-log
        // test below).
        ->and($copy->fresh()->state)->toBe(CopyState::Held)
        ->and($held->status)->toBe(RequestStatus::Approved)
        ->and($held->copy_id)->toBe($copy->id)
        ->and($held->hold_expires_at->toIso8601ZuluString())->toBe('2026-08-31T07:00:00Z')
        ->and($held->decided_by)->toBe($manager->id)
        // The reported next-in-line is read AFTER the writes: the held
        // request is no longer pending, so it is the person after them.
        ->and($result['queuedRequestId'])->toBe($queue[1]->id);
});

it('the hold writes request.approved beside loan.returned, and tells the child — one transaction', function () {
    // 17:30 UTC, NOT 07:00: the three-day expiry lands 2026-08-31 17:30
    // UTC, which is already 2026-09-01 in Asia/Ho_Chi_Minh. At 07:00 the
    // two calendars agree and hold_until reads 2026-08-31 whether the
    // conversion is there or not — measured: deleting ->timezone(...)
    // from ReceiveReturn left the whole suite green on the old clock.
    // Divergence 5 is now pinned at BOTH doors that write this payload,
    // not only at ApproveBorrowRequest's.
    Carbon::setTestNow(Carbon::parse('2026-08-28 17:30:00', 'UTC'));
    [, $manager, $loan, $copy, $queue] = rrwFix(queued: 1, slug: 'dong-thap-rrw-audit');

    app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect, null, null, $queue[0]->id);

    $returned = AuditLog::query()->where('action', 'loan.returned')->firstOrFail();
    $approved = AuditLog::query()->where('action', 'request.approved')->firstOrFail();
    expect(((array) $returned->after)['copy_state'])->toBe('held')
        ->and($approved->entity_id)->toBe($queue[0]->id)
        // actor_id is the only column that pins the SESSION — the audit
        // row is written under the manager rrwFix authenticated, not
        // under the request's own member.
        ->and($approved->actor_id)->toBe($manager->id)
        ->and((array) $approved->before)->toMatchArray(['status' => 'pending', 'copy_id' => null])
        ->and(((array) $approved->after)['copy_id'])->toBe($copy->id)
        // Divergence 6: userId from THIS door too.
        ->and(((array) $approved->after)['userId'])->toBe($queue[0]->member_id);

    $note = Notification::query()->firstOrFail();
    expect($note->user_id)->toBe($queue[0]->member_id)
        ->and($note->kind)->toBe('request_approved')
        ->and($note->payload)->toMatchArray(['title' => 'Dế Mèn Phiêu Lưu Ký', 'hold_until' => '2026-09-01']);
});

it('holding for a request that is no longer queued fails cleanly, and the return rolls back with it', function () {
    [, $manager, $loan, $copy, $queue] = rrwFix(queued: 1, slug: 'dong-thap-rrw-gone');
    BorrowRequest::query()->whereKey($queue[0]->id)->update(['status' => RequestStatus::Cancelled, 'cancelled_at' => now()]);

    expect(fn () => app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect, null, null, $queue[0]->id))
        ->toThrow(RuleViolated::class, 'request_not_queued');
    // G3 in its sharpest form: a return that succeeded while its hold
    // failed would leave a book on the shelf the system believes is with
    // a reader. NOTHING committed.
    expect($loan->fresh()->status)->toBe(LoanStatus::Active)
        ->and($copy->fresh()->state)->toBe(CopyState::OnLoan)
        ->and(Notification::query()->count())->toBe(0);
});

it('holding for a request queued against a different title fails the same way', function () {
    [$shelf, $manager, $loan] = rrwFix(0, 'dong-thap-rrw-othertitle');
    app(TenantContext::class)->actSystemWide();
    $other = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be']);
    $u = User::factory()->create(['full_name' => 'Anna Chờ Sách Khác']);
    Membership::factory()->for($shelf)->create(['user_id' => $u->id, 'role' => 'reader', 'status' => 'active']);
    $foreign = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $other->id, 'member_id' => $u->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->whereHas('user', fn ($q) => $q->where('full_name', 'Maria Quản Lý Kho'))->firstOrFail());

    expect(fn () => app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect, null, null, $foreign->id))
        ->toThrow(RuleViolated::class, 'request_not_queued');
});

it('holding for a pending request on ANOTHER shelf fails the same way', function () {
    // The cross-shelf refusal claimed in ReceiveReturn's comment, made
    // executable. Two things are asserted, and the FIRST is the one that
    // isolates the mechanism, because the second is OVER-DETERMINED and
    // that was measured, not assumed: replacing the Action's resolve with
    // withoutGlobalScopes() leaves this test GREEN, since the foreign
    // request necessarily carries a foreign book_id and the title clause
    // refuses it anyway. It cannot carry ours — creating a borrow_request
    // with bookshelf_id = shelf 2 and book_id = shelf 1's book raises
    // errno 1452 on borrow_requests_book_fk (run live against
    // laravel-mariadb-1). So `find()` returning null under the bound
    // tenant is what pins BookshelfScope, before the title clause is ever
    // reached; the throw below pins the refusal a manager would actually
    // meet.
    [$shelf, $manager, $loan] = rrwFix(0, 'dong-thap-rrw-othershelf');
    app(TenantContext::class)->actSystemWide();
    $otherShelf = Bookshelf::factory()->create(['slug' => 'cai-lay-rrw', 'settings' => []]);
    $u = User::factory()->create(['full_name' => 'Anna Tủ Sách Khác']);
    Membership::factory()->for($otherShelf)->create(['user_id' => $u->id, 'role' => 'reader', 'status' => 'active']);
    $otherBook = Book::query()->create([
        'bookshelf_id' => $otherShelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men',
    ]);
    $foreign = BorrowRequest::query()->create([
        'bookshelf_id' => $otherShelf->id, 'book_id' => $otherBook->id, 'member_id' => $u->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $manager->id)->firstOrFail());

    expect(BorrowRequest::query()->find($foreign->id))->toBeNull();
    expect(fn () => app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect, null, null, $foreign->id))
        ->toThrow(RuleViolated::class, 'request_not_queued');
});

it('holding for a request another manager already approved onto a different copy fails the same way', function () {
    // OPS §4.2's second half, in its own right: the cancelled case above
    // covers "the reader cancelled between page load and confirm"; this is
    // "another manager approved them onto a different copy". Same code,
    // different status — and the status branch is what refuses it, since
    // the book_id still matches.
    [$shelf, $manager, $loan, , $queue] = rrwFix(queued: 1, slug: 'dong-thap-rrw-approved');
    app(TenantContext::class)->actSystemWide();
    $otherCopy = BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $loan->book_id, 'code' => 'DT-0009', 'state' => 'held',
    ]);
    BorrowRequest::query()->whereKey($queue[0]->id)->update([
        'status' => RequestStatus::Approved, 'copy_id' => $otherCopy->id,
        'hold_expires_at' => now()->addDays(3), 'decided_at' => now(), 'decided_by' => $manager->id,
    ]);
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $manager->id)->firstOrFail());

    expect(fn () => app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect, null, null, $queue[0]->id))
        ->toThrow(RuleViolated::class, 'request_not_queued');
    expect($loan->fresh()->status)->toBe(LoanStatus::Active);
});

it('T27 on the HELD side: a torn copy still goes to the reader whose turn it is', function () {
    // 1c pins T27 on the available side (ReceiveReturnTest: "a worse
    // condition NEVER diverts the copy away from available"). The
    // re-widened file's docblock claims the same of the held side, and a
    // claim in a docblock is not a pin — this is the pin. A Rách copy is
    // exactly as holdable the instant it returns; the condition record is
    // what a manager reads before deciding, by hand, to retire.
    [, $manager, $loan, $copy, $queue] = rrwFix(queued: 1, slug: 'dong-thap-rrw-t27');

    app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Torn, 'rách gáy', null, $queue[0]->id);

    $fresh = $copy->fresh();
    expect($fresh->state)->toBe(CopyState::Held)
        ->and($fresh->condition)->toBe(CopyCondition::Torn)
        ->and($fresh->condition_note)->toBe('rách gáy')
        ->and($queue[0]->fresh()->status)->toBe(RequestStatus::Approved);
});

it('a soft-deleted book leaves the audit title NULL and the notification title a string', function () {
    // The audit bag keeps 1c's nullable spelling and the notification takes
    // the cast, and NEITHER may drift into the other. AuditSentences::str
    // maps "" back to null so the SENTENCE cannot tell them apart — but
    // renderValue json_encodes the payload row with no trimming, so a
    // coerced "" would render `""` where every 1c row reads `null`. That
    // is a merged command's audit trail changing shape, which this task
    // had no warrant to do.
    [$shelf, $manager, $loan, , $queue] = rrwFix(queued: 1, slug: 'dong-thap-rrw-gone-book');
    app(TenantContext::class)->actSystemWide();
    Book::query()->whereKey($loan->book_id)->delete();   // soft delete
    app(TenantContext::class)->set($shelf->fresh(), Membership::query()->where('user_id', $manager->id)->firstOrFail());

    app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect, null, null, $queue[0]->id);

    $after = (array) AuditLog::query()->where('action', 'loan.returned')->firstOrFail()->after;
    expect($after)->toHaveKey('title')
        ->and($after['title'])->toBeNull()
        ->and(Notification::query()->firstOrFail()->payload['title'])->toBe('');
});

it('the lock order is copy, loan, then the hold-for request', function () {
    [, $manager, $loan, , $queue] = rrwFix(queued: 1, slug: 'dong-thap-rrw-lock');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Perfect, null, null, $queue[0]->id);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect(str_contains($log[0]['query'], 'book_copies'))->toBeTrue($log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue($log[0]['query'])
        ->and(str_contains($log[1]['query'], 'loans'))->toBeTrue($log[1]['query'])
        ->and(str_contains(strtolower($log[1]['query']), 'for update'))->toBeTrue($log[1]['query'])
        ->and(str_contains($log[2]['query'], 'borrow_requests'))->toBeTrue($log[2]['query'])
        ->and(str_contains(strtolower($log[2]['query']), 'for update'))->toBeTrue($log[2]['query']);

    // And the copy write is ONE statement, straight to held.
    //
    // str_starts_with, not str_contains: the transaction's FIRST statement
    // is `select * from `book_copies` … limit 1 for update`, which
    // contains the substring "update" inside "for update" — a
    // str_contains filter matches it, returns two entries, and reads the
    // SELECT as the copy write, whose text has no `state`. (Shipped
    // precedent for the log text: tests/Feature/Circulation/
    // LendCopyTest.php:221 asserts on exactly that string.) Anchoring at
    // the start of the statement leaves only real UPDATEs.
    $copyWrites = array_values(array_filter(
        $log,
        fn (array $q) => str_starts_with(trim($q['query']), 'update `book_copies`'),
    ));
    expect($copyWrites)->toHaveCount(1)
        ->and(str_contains($copyWrites[0]['query'], 'state'))->toBeTrue($copyWrites[0]['query'])
        // The single write's BOUND VALUE, not just the column name: a
        // shape that wrote `available` first and `held` second would trip
        // the count above, and one that wrote `available` and left it
        // there would satisfy the column check alone. The value the log
        // recorded is the value the statement sent.
        ->and($copyWrites[0]['bindings'])->toContain('held')
        ->and($copyWrites[0]['bindings'])->not->toContain('available');
});

it('with no queue at all, queuedRequestId is null and the 1c behaviour is byte-identical', function () {
    [, $manager, $loan, $copy] = rrwFix(0, 'dong-thap-rrw-plain');

    $result = app(ReceiveReturn::class)->execute($manager, $loan, CopyCondition::Worn, 'gáy hơi sờn');

    expect($result['queuedRequestId'])->toBeNull()
        ->and($copy->fresh()->state)->toBe(CopyState::Available)
        ->and($loan->fresh()->return_condition)->toBe(CopyCondition::Worn);
});
