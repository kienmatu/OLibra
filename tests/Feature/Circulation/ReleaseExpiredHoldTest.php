<?php

use App\Actions\Circulation\ApproveBorrowRequest;
use App\Actions\Circulation\HandoverRequest;
use App\Actions\Circulation\ReleaseExpiredHold;
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
use App\Queries\AuditLogQuery;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Shelf + manager (acting) + reader + an APPROVED request whose copy is
 * held — the full live-hold shape, which is the only shape this command
 * has anything to say about. Pass approved: false for the pending
 * variant.
 *
 * The manager's own membership comes back too: a test that has to create
 * a second reader must leave the tenant bound to a MANAGER again before
 * running a manager command, and rebuilding it by hand in the test body
 * is how the two drift.
 *
 * Grep first: `grep -rn "^function ehxFix" tests/` — top-level helpers are
 * process-global (AGENTS.md).
 *
 * @return array{Bookshelf, User, User, BorrowRequest, ?BookCopy, Membership}
 */
function ehxFix(bool $approved = true, string $slug = 'dong-thap-ehx'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $managerMembership = Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Lê Ngọc Ánh']);
    Membership::factory()->for($shelf)->create(['user_id' => $reader->id, 'role' => 'reader', 'status' => 'active']);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be']);
    $copy = null;
    $fields = [
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ];
    if ($approved) {
        // copy_id, hold_expires_at, decided_by and decided_at TOGETHER,
        // and the copy in `held`: an approved row that carries some of
        // those and not the others is a state ApproveBorrowRequest never
        // writes, so a fixture that produced one would be testing a shape
        // production cannot reach.
        $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0142', 'state' => 'held']);
        $fields = [...$fields, 'status' => RequestStatus::Approved, 'copy_id' => $copy->id,
            'hold_expires_at' => now()->addDays(3), 'decided_by' => $manager->id, 'decided_at' => now()];
    }
    $request = BorrowRequest::query()->create($fields);
    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    return [$shelf, $manager, $reader, $request, $copy, $managerMembership];
}

it('a lapsed hold is released: the request expires and the copy goes back on the shelf', function () {
    // The clock, not a job, is what ended the hold — this command only
    // RECORDS the lapse a manager chose to act on (BR §8: derived state
    // stays derived). setTestNow moves past the fixture's three-day
    // expiry; nothing else changes.
    [, $manager, , $request, $copy] = ehxFix(slug: 'dong-thap-ehx-release');
    Carbon::setTestNow(now()->addDays(4));

    $result = app(ReleaseExpiredHold::class)->execute($manager, $request);

    expect($request->fresh()->status)->toBe(RequestStatus::Expired)
        ->and($copy->fresh()->state)->toBe(CopyState::Available)
        ->and($result['requestId'])->toBe($request->id)
        ->and($result['copyId'])->toBe($copy->id);
});

it('the released row still names its copy — copy_id is not blanked', function () {
    // ITS OWN BLOCK, because it is the constraint that keeps another
    // command alive and a chained assertion would hide it behind the
    // release above. CancelOwnRequest is the precedent: it too sets the
    // status and releases the copy without touching copy_id, and for the
    // same reason — the row is the record of which copy was put aside for
    // whom, and blanking it erases that.
    //
    // What it costs elsewhere is the block below: HandoverRequest's
    // `Expired → hold_expired` branch is guarded by a `copy_id === null`
    // check ONE LINE EARLIER, so a null here silently reroutes that
    // command to request_not_held with every existing test still green.
    [, $manager, , $request, $copy] = ehxFix(slug: 'dong-thap-ehx-copyid');
    Carbon::setTestNow(now()->addDays(4));

    app(ReleaseExpiredHold::class)->execute($manager, $request);

    $row = $request->fresh();
    expect($row->copy_id)->toBe($copy->id)
        // hold_expires_at likewise: the record of the deadline the reader
        // missed. Every reader of a hold filters on status = approved
        // first, so an expired row's expiry is inert, not stale.
        ->and($row->hold_expires_at)->not->toBeNull();
});

it('after a release the stale queue page\'s handover says hold_expired, not request_not_held', function () {
    // THE REACHABILITY PIN, and the first commit in which it can be
    // written: HandoverRequest's Expired branch has existed since Task 9
    // and until now nothing could produce the row that reaches it —
    // that test wrote the status by hand. This one produces the row the
    // way production does, through the command, and therefore also fails
    // if the release ever blanks copy_id (the check one line above the
    // branch would fire first and the sentence would silently become
    // request_not_held, which is a false statement about a row that
    // plainly names a copy).
    [, $manager, , $request] = ehxFix(slug: 'dong-thap-ehx-stale');
    Carbon::setTestNow(now()->addDays(4));

    app(ReleaseExpiredHold::class)->execute($manager, $request);

    expect(fn () => app(HandoverRequest::class)->execute($manager, $request->fresh()))
        ->toThrow(RuleViolated::class, 'hold_expired');
});

it('INV-8: request.expired records the lapse, the copy and the reader', function () {
    [, $manager, $reader, $request, $copy] = ehxFix(slug: 'dong-thap-ehx-audit');
    Carbon::setTestNow(now()->addDays(4));

    app(ReleaseExpiredHold::class)->execute($manager, $request);

    $entry = AuditLog::query()->where('action', 'request.expired')->firstOrFail();
    expect((array) $entry->before)->toMatchArray(['status' => 'approved', 'copy_id' => $copy->id])
        // The fixture's actingAs is load-bearing: AuditRecorder takes
        // actor_id from Auth::id(), never from the $actor parameter, so a
        // fixture that signed nobody in would write a null actor_id and
        // the audit screen would say "Hệ thống" ended the hold.
        ->and($entry->actor_id)->toBe($manager->id)
        ->and((array) $entry->after)->toMatchArray([
            'status' => 'expired',
            'copy_id' => $copy->id,
            'title' => 'Hoàng Tử Bé',
            'userId' => $reader->id,
        ]);
});

it('the audit sentence names the reader whose hold lapsed', function () {
    // The payload's userId key is what the subject join reads
    // (AuditLogQuery's payload_subject arm); spell it any other way and
    // the block above still passes while the log reads "của một bạn đọc".
    // Separate block, because that is a different mechanism failing —
    // the lang line and the join, not the payload.
    [, $manager, , $request] = ehxFix(slug: 'dong-thap-ehx-sentence');
    Carbon::setTestNow(now()->addDays(4));

    app(ReleaseExpiredHold::class)->execute($manager, $request);

    $rendered = app(AuditLogQuery::class)->run(page: 1);
    $line = collect($rendered['rows'])->firstWhere('action', 'request.expired');
    expect($line['sentence'])
        ->toBe('Maria Quản Lý Kho đã kết thúc giữ chỗ quá hạn của Têrêsa Lê Ngọc Ánh và trả bản sách về kệ');
});

it('a LIVE hold is not the manager\'s to yank, and nothing is written', function () {
    // Ruling 1's guard: the hold is a promise to a child who may be on
    // their way. Freeing it early has an ordinary path — the reader
    // cancels, or the clock ends it.
    [, $manager, , $request, $copy] = ehxFix(slug: 'dong-thap-ehx-live');

    expect(fn () => app(ReleaseExpiredHold::class)->execute($manager, $request))
        ->toThrow(RuleViolated::class, 'hold_not_expired');

    expect($request->fresh()->status)->toBe(RequestStatus::Approved)
        ->and($copy->fresh()->state)->toBe(CopyState::Held)
        ->and(AuditLog::query()->count())->toBe(0);
});

it('a pending request has no hold to release', function () {
    [, $manager, , $request] = ehxFix(approved: false, slug: 'dong-thap-ehx-pending');

    expect(fn () => app(ReleaseExpiredHold::class)->execute($manager, $request))
        ->toThrow(RuleViolated::class, 'request_not_held');
});

it('the copy lock is first, the request lock second', function () {
    [, $manager, , $request] = ehxFix(slug: 'dong-thap-ehx-lock');
    Carbon::setTestNow(now()->addDays(4));

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(ReleaseExpiredHold::class)->execute($manager, $request);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect(str_contains($log[0]['query'], 'book_copies'))->toBeTrue($log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue($log[0]['query'])
        ->and(str_contains($log[1]['query'], 'borrow_requests'))->toBeTrue($log[1]['query'])
        ->and(str_contains(strtolower($log[1]['query']), 'for update'))->toBeTrue($log[1]['query']);
});

it('the released copy is immediately approvable onto the next reader', function () {
    // What the ruling is FOR: the volunteer holding the book puts it back
    // and the next child in the queue gets it, with no second command and
    // no job in between. One ordinary Duyệt & giữ chỗ.
    [$shelf, $manager, , $request, $copy, $managerMembership] = ehxFix(slug: 'dong-thap-ehx-next');
    Carbon::setTestNow(now()->addDays(4));

    app(ReleaseExpiredHold::class)->execute($manager, $request);

    // A DIFFERENT reader: borrow_requests_one_live_per_title_member
    // allows one live row per title per reader, and the released row is
    // terminal but the ex-holder could not be re-approved onto the same
    // title from a second live row anyway.
    app(TenantContext::class)->actSystemWide();
    $next = User::factory()->create(['full_name' => 'Phêrô Nguyễn Văn Bình']);
    Membership::factory()->for($shelf)->create(['user_id' => $next->id, 'role' => 'reader', 'status' => 'active']);
    $queued = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $request->book_id, 'member_id' => $next->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf->fresh(), $managerMembership);
    DB::flushQueryLog();

    app(ApproveBorrowRequest::class)->execute($manager, $queued, $copy->id);

    expect($queued->fresh()->status)->toBe(RequestStatus::Approved)
        ->and($queued->fresh()->copy_id)->toBe($copy->id)
        ->and($copy->fresh()->state)->toBe(CopyState::Held);
});

it('a copy that has since gone to lost is left alone, and the lapse is still recorded', function () {
    // The release is guarded ON THE STATE, in the WHERE itself
    // (CancelOwnRequest's idiom): a copy that moved on is not dragged back
    // onto the shelf by a manager tidying up a queue row. The expiry is
    // recorded either way — the hold really did lapse, whatever became of
    // the copy.
    [, $manager, , $request, $copy] = ehxFix(slug: 'dong-thap-ehx-lost');
    BookCopy::query()->whereKey($copy->id)->update(['state' => 'lost']);
    Carbon::setTestNow(now()->addDays(4));

    app(ReleaseExpiredHold::class)->execute($manager, $request);

    expect($copy->fresh()->state)->toBe(CopyState::Lost)
        ->and($request->fresh()->status)->toBe(RequestStatus::Expired)
        ->and(AuditLog::query()->where('action', 'request.expired')->count())->toBe(1);
});
