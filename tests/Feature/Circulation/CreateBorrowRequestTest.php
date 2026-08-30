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
    // The refusal alone does not pin WHICH of the two layers produces it:
    // live_request_key covers approved as well as pending, so narrowing
    // the Action's read to Pending only moves the refusal from the read to
    // the index's 1062, and both arrive as the same sentence. (That is why
    // the plan's Step 6 mutation 2 is unsatisfiable and has been STRUCK: a
    // strictly smaller mutation cannot redden what mutation 2b — deleting
    // the read outright — requires to stay green.)
    //
    // So the layer is pinned separately, by the absence of an attempted
    // INSERT. DB::beforeExecuting, not the query log: Connection::run()
    // logs AFTER the callback returns, so a statement that throws is never
    // logged at all and a query-log assertion here would be a tautology
    // (measured — see the fix report). beforeExecuting fires before the
    // statement runs, so it sees the insert the index would have rejected.
    $statements = [];
    DB::beforeExecuting(function (string $query) use (&$statements) {
        $statements[] = $query;
    });

    BorrowRequest::query()->update(['status' => RequestStatus::Approved]);
    expect(fn () => app(CreateBorrowRequest::class)->execute($reader, $book))
        ->toThrow(RuleViolated::class, 'duplicate_request');

    // The friendly read refused before the row was ever offered to the
    // database. Task 1's LiveRequestKeyTest pins the index itself.
    $inserts = array_values(array_filter(
        $statements,
        fn (string $q) => str_contains($q, 'insert into `borrow_requests`'),
    ));
    expect($inserts)->toBe([]);
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
    // The defence-in-depth probe, and it covers ONLY the branches that are
    // genuinely unreachable in production. The act-as-reader closure
    // returns false for all three of a non-Active membership, somebody
    // else's membership and no membership at all — but that closure is not
    // the last word. AppServiceProvider's Gate::before short-circuits it
    // with true for any act-as-* ability when $user->is_super_admin, so
    // "the gate already refuses" holds for ordinary callers only. The one
    // branch that IS live in production because of that bypass —
    // not_permitted for a super admin with no membership — has its own
    // test below, and is not what this probe is for.
    //
    // What remains unreachable, and is what this test covers:
    // memberMayRequest's INV-4 refusal (ResolveTenant binds only
    // status = Active memberships, so a bound membership is Active by
    // construction, and a super admin's non-Active membership binds as
    // null and meets not_permitted first), and the ownership comparison
    // (TenantContext::set() resolves the membership for the signed-in
    // caller, never from a parameter). Both would ship untested — the
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

it('a super admin who belongs to no shelf is refused not_permitted — a LIVE path, not defence in depth', function () {
    // The one branch of the ownership guard that production can reach, and
    // the reason the guard is not decorative. The chain, each link read
    // from the shipped source rather than assumed:
    //
    //   AppServiceProvider's Gate::before returns true for any act-as-*
    //   ability when is_super_admin, short-circuiting the role closure;
    //   EnsureShelfRole gates role:reader on that same
    //   Gate::allows('act-as-reader'), so the route lets them through;
    //   ResolveTenant binds the shelf but filters memberships on
    //   status = Active, so a super admin who is not a member of this
    //   shelf arrives with membership === null;
    //   BorrowRequestPolicy::create asks act-as-reader and is allowed.
    //
    // Every gate in front of this command therefore says yes, and the
    // Action's own null check is the only thing standing between a super
    // admin and a borrow_requests row with no member behind it. It fails
    // closed, with a named Vietnamese sentence — which is why Task 12's
    // controller needs a path for not_permitted rather than treating it as
    // unreachable.
    //
    // No actingAs switch: this test builds its own fixture and signs in
    // once, as the super admin. The tenant is bound the way ResolveTenant
    // would bind it for them — the shelf, and a null membership.
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-cbr-super', 'settings' => []]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be',
    ]);
    $superAdmin = User::factory()->superAdmin()->create(['full_name' => 'Phêrô Quản Trị Hệ Thống']);
    app(TenantContext::class)->set($shelf->fresh(), null);
    test()->actingAs($superAdmin);

    // The gate really does wave them through — without this the test could
    // pass for the wrong reason (an AuthorizationException would also stop
    // the row being written).
    expect(Gate::forUser($superAdmin)->allows('act-as-reader'))->toBeTrue();

    expect(fn () => app(CreateBorrowRequest::class)->execute($superAdmin, $book))
        ->toThrow(RuleViolated::class, 'not_permitted');

    expect(BorrowRequest::query()->withoutGlobalScopes()->count())->toBe(0)
        ->and(AuditLog::query()->withoutGlobalScopes()->where('action', 'request.created')->count())->toBe(0);
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
    //
    // BOTH spellings the Global Constraint names, not just the Eloquent
    // one: a hand-written ->select(DB::raw('… for update')) or a
    // DB::statement would carry the lock past a grep for lockForUpdate
    // alone. Lower-cased for the second, so the SQL's own casing cannot
    // decide whether the rule applies.
    $source = (string) file_get_contents(app_path('Actions/Circulation/CreateBorrowRequest.php'));
    expect($source)->not->toContain('lockForUpdate')
        ->and(strtolower($source))->not->toContain('for update');
});

it('INV-8: the create writes one audit record storing the title and both ids', function () {
    [, $reader, $membership, $book] = cbrFix('dong-thap-cbr-audit');

    $result = app(CreateBorrowRequest::class)->execute($reader, $book);

    // ONE, as the title says — firstOrFail() alone would pass on two.
    expect(AuditLog::query()->where('action', 'request.created')->count())->toBe(1);

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
    //
    // ACTOR SWITCH, and it is load-bearing on purpose. cbrFix() signs the
    // reader in; this test then signs the manager in over the top.
    // SessionGuard caches the actingAs user for the whole test method, so
    // a switch that silently failed to take would leave the reader signed
    // in — and every assertion below about member_id would still pass,
    // because member_id comes from TenantContext, not from the session.
    // Splitting this into two it() blocks does not help: the switch lives
    // inside the shared fixture, so the second block would still contain
    // both calls. What closes it is asserting something the session alone
    // decides — AuditRecorder::record writes actor_id from Auth::id(), so
    // the audit row below names whoever is actually signed in.
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

    // And the switch took: Auth::id() at the moment of the write was the
    // manager's, not the reader cbrFix() left signed in.
    expect(AuditLog::query()->where('action', 'request.created')->firstOrFail()->actor_id)
        ->toBe($manager->id);
});
