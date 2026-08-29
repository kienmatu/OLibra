<?php

use App\Actions\Circulation\CreateBorrowRequest;
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
use Carbon\Carbon;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

afterEach(fn () => Carbon::setTestNow());

/**
 * Shelf + reader (acting, tenant-bound to their own membership) + one
 * book with one available copy. @return array{Bookshelf, User, Membership, Book}
 */
function cbrFix(string $slug = 'dong-thap-cbr'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $readerUser = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $readerUser->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men',
    ]);
    BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'available',
    ]);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($readerUser);

    return [$shelf, $readerUser, $membership, $book];
}

it('a reader joins the queue, and the row carries their USER id and the injected clock', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 03:00:00', 'UTC'));
    [, $reader, $membership, $book] = cbrFix();

    $result = app(CreateBorrowRequest::class)->execute($reader, $book);

    $row = BorrowRequest::query()->findOrFail($result['requestId']);
    expect($row->status)->toBe(RequestStatus::Pending)
        ->and($row->member_id)->toBe($membership->user_id)      // users.id, NEVER membership id
        ->and($row->book_id)->toBe($book->id)
        ->and($row->copy_id)->toBeNull()
        // requested_at is the queue's ordering key and every hold derived
        // from it is compared against the injected clock — a column
        // default would order the queue by the DB host's clock while
        // expiring holds by the injected one (the reference's docblock).
        ->and($row->requested_at->toIso8601ZuluString())->toBe('2026-08-28T03:00:00Z');
});

it('a copy being free is not a reason to refuse a request', function () {
    // OPS §4.2: a reader may queue even when copies exist — a request is
    // a statement of intent about a TITLE, never a claim on a copy.
    // Nothing reads book_copies at all.
    [, $reader, , $book] = cbrFix('dong-thap-cbr-free');

    $result = app(CreateBorrowRequest::class)->execute($reader, $book);

    expect(BorrowRequest::query()->find($result['requestId']))->not->toBeNull();
});

it('a second request for the same title is refused, pending or approved', function () {
    [, $reader, , $book] = cbrFix('dong-thap-cbr-dup');

    app(CreateBorrowRequest::class)->execute($reader, $book);
    expect(fn () => app(CreateBorrowRequest::class)->execute($reader, $book))
        ->toThrow(RuleViolated::class, 'duplicate_request');

    // Approved counts too: a child whose copy is on the shelf with their
    // name on it must not also stand in the queue for the same title.
    //
    // What this pins is the REFUSAL, not which of the two layers produces
    // it. Measured, both ways: narrowing the Action's read to Pending
    // alone leaves this green (the 1062 from
    // borrow_requests_one_live_per_title_member arrives instead, and
    // live_request_key covers approved too), and so does deleting the
    // read outright — the plan's own mutation 2b, which must not redden.
    // The plan additionally expected the narrowing to redden here; it
    // cannot, since a strictly larger mutation is required to leave it
    // green. Task 1's LiveRequestKeyTest pins the index; the read is the
    // friendly path that spares the common case a failed insert.
    BorrowRequest::query()->update(['status' => RequestStatus::Approved]);
    expect(fn () => app(CreateBorrowRequest::class)->execute($reader, $book))
        ->toThrow(RuleViolated::class, 'duplicate_request');
});

it('a cancelled request does not block a second attempt', function () {
    [, $reader, , $book] = cbrFix('dong-thap-cbr-again');

    $first = app(CreateBorrowRequest::class)->execute($reader, $book);
    BorrowRequest::query()->whereKey($first['requestId'])
        ->update(['status' => RequestStatus::Cancelled, 'cancelled_at' => now()]);

    $second = app(CreateBorrowRequest::class)->execute($reader, $book);
    expect($second['requestId'])->not->toBe($first['requestId']);
});

it('a suspended reader never reaches the queue\'s own words — the act-as-reader gate refuses first', function () {
    // PLAN CORRECTION (Task 4). The plan's test here bound the suspended
    // membership below the middleware and expected
    // RuleViolated('membership_not_active_cannot_request'). It cannot:
    // execute()'s first statement is Gate::authorize('create', …), and
    // BorrowRequestPolicy::create delegates to the act-as-reader gate,
    // whose closure returns false for any membership whose status is not
    // Active. The gate throws AuthorizationException before the
    // transaction opens, so the Action's own INV-4 branch is not reached
    // — for ANY suspended membership, bound or not. Measured: with the
    // plan's expectation in place this test failed with "Expected: This
    // action is unauthorized. To contain:
    // membership_not_active_cannot_request". This is also the shipped 1c
    // shape — RenewLoanTest's "Q4: a suspended reader cannot renew"
    // asserts AuthorizationException for the same reason. The Action's
    // own check is pinned as defence in depth by the next test.
    [$shelf, $reader, $membership, $book] = cbrFix('dong-thap-cbr-susp');
    Membership::query()->whereKey($membership->id)->update([
        'status' => 'suspended', 'suspension_reason' => 'thử nghiệm',
    ]);
    app(TenantContext::class)->set($shelf->fresh(), $membership->fresh());

    expect(fn () => app(CreateBorrowRequest::class)->execute($reader, $book))
        ->toThrow(AuthorizationException::class);
    expect(BorrowRequest::query()->count())->toBe(0);
});

it('with the gate opened, the command\'s own INV-4 and ownership checks still refuse, in the queue\'s own words', function () {
    // The defence-in-depth probe. Both of the Action's guards —
    // memberMayRequest (INV-4) and the membership-is-the-caller's
    // comparison — sit BEHIND a gate that already refuses every input
    // that could reach them (a non-Active membership, a membership
    // belonging to somebody else, no membership at all: all three are
    // `false` in the same closure). Without removing the outer layer,
    // neither branch is reachable and both would ship untested — the
    // "implemented, reachable from nowhere" shape, one layer down.
    //
    // So the gate is redefined to allow, which is precisely the "future
    // caller" the plan's ported reading 1 says these checks exist for,
    // and the inner layer is then shown to hold on its own terms. It is
    // an override of the app's own gate definition, not of the policy:
    // the policy still runs and still asks act-as-reader.
    [$shelf, $reader, $membership, $book] = cbrFix('dong-thap-cbr-inv4');
    Gate::define('act-as-reader', fn (User $user) => true);

    Membership::query()->whereKey($membership->id)->update([
        'status' => 'suspended', 'suspension_reason' => 'thử nghiệm',
    ]);
    app(TenantContext::class)->set($shelf->fresh(), $membership->fresh());

    expect(fn () => app(CreateBorrowRequest::class)->execute($reader, $book))
        ->toThrow(RuleViolated::class, 'membership_not_active_cannot_request');

    // And the ownership half: the bound membership is somebody else's.
    app(TenantContext::class)->actSystemWide();
    $other = User::factory()->create(['full_name' => 'Anna Người Khác Kia']);
    $otherMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $other->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf->fresh(), $otherMembership);

    expect(fn () => app(CreateBorrowRequest::class)->execute($reader, $book))
        ->toThrow(RuleViolated::class, 'not_permitted');

    expect(BorrowRequest::query()->withoutGlobalScopes()->count())->toBe(0);
});

it('this command takes no row lock at all — divergence 2, pinned rather than described', function () {
    // The withdrawn book lock closed an AB-BA cycle against UpdateBook
    // (which X-locks bookshelves, then writes the book row, while this
    // command's inserts want S on that same bookshelves row through their
    // RESTRICT foreign keys). "It takes no lock" is a claim a grep can
    // falsify, unlike a claim about cycles — so this is the claim made.
    DB::flushQueryLog();
    DB::enableQueryLog();
    [, $reader, , $book] = cbrFix('dong-thap-cbr-nolock');
    DB::flushQueryLog();
    app(CreateBorrowRequest::class)->execute($reader, $book);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    $locking = array_values(array_filter(
        $log,
        fn (array $q) => str_contains(strtolower($q['query']), 'for update'),
    ));
    expect($locking)->toBe([]);
    // And the source itself, so a lock added to a branch the fixture does
    // not reach is caught too — measured: moving the lock into the
    // duplicate branch, which cbrFix never reaches, leaves the query-log
    // half above green and reddens only this one. The grep is over RAW
    // source, comments included, which is why the Action's docblock
    // describes the withdrawn lock in words and never names the method.
    expect(file_get_contents(app_path('Actions/Circulation/CreateBorrowRequest.php')))
        ->not->toContain('lockForUpdate');
});

it('INV-8: the create writes one audit record storing the title and both ids', function () {
    [, $reader, $membership, $book] = cbrFix('dong-thap-cbr-audit');

    $result = app(CreateBorrowRequest::class)->execute($reader, $book);

    $entry = AuditLog::query()->where('action', 'request.created')->firstOrFail();
    $after = (array) $entry->after;
    expect($entry->entity_id)->toBe($result['requestId'])
        ->and($entry->actor_id)->toBe($reader->id)
        ->and($entry->before)->toBeNull()                        // the row did not exist
        ->and($after['status'])->toBe('pending')
        ->and($after['title'])->toBe('Dế Mèn Phiêu Lưu Ký')      // stored, never re-read
        ->and($after['userId'])->toBe($membership->user_id)
        ->and($after['membership_id'])->toBe($membership->id)
        // Always-present null: 2c's QR-scan path fills it (divergence 3),
        // and the payload shape must not change when it does.
        ->and(array_key_exists('copy_id', $after))->toBeTrue()
        ->and($after['copy_id'])->toBeNull();
});

it('a manager cannot queue on a reader\'s behalf through this command', function () {
    // OPS names the caller `reader`; a manager queueing for a child is a
    // DIFFERENT command nobody has specified (the reference's argument).
    // The manager's own membership is the bound one, and its user_id is
    // not the actor being requested for — there is no parameter to say
    // "for somebody else" at all; this pins that the row is always the
    // CALLER's.
    [$shelf, , , $book] = cbrFix('dong-thap-cbr-mgr');
    app(TenantContext::class)->actSystemWide();
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $mm = Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    app(TenantContext::class)->set($shelf->fresh(), $mm);
    test()->actingAs($manager);

    $result = app(CreateBorrowRequest::class)->execute($manager, $book);

    // The row belongs to the MANAGER (their own request as a member) —
    // never to any other member.
    expect(BorrowRequest::query()->findOrFail($result['requestId'])->member_id)->toBe($manager->id);
});
