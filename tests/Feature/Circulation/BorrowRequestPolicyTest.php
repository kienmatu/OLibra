<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Membership;
use App\Models\Notification;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Route;

/*
 * The binding itself, over HTTP, on the URI and the middleware stack the
 * real thing will carry. Tasks 11 and 12 own the controllers; this route
 * is a stand-in for their path, not for their URL space, so it deliberately
 * matches what they will register rather than dodging it.
 *
 * The first draft dodged it — it lived at /brp-binding-probe/{shelf}/… with
 * only ['web','tenant'], on the theory that a runtime-registered route
 * survives into later test files and would trip
 * CirculationArchitectureTest's 'requests/{' absence pin and RouteOrderTest's
 * "every reader-area route carries a role: gate" sweep. That theory is
 * FALSE, and the review measured it: Laravel re-bootstraps the application
 * (and so re-runs RouteServiceProvider) for every test file AND every test
 * method, so nothing registered here is visible anywhere else. A throwaway
 * file placed after this one and ResolveTenantMiddlewareTest reported
 * `PROBES-VISIBLE: []`, 23 passed — reproduced here before this comment was
 * rewritten. (The ResolveTenantMiddlewareTest probe this file first copied
 * carries the same false claim, plus a Route::has guard that can therefore
 * never be true; its own probe has no role: gate and would trip
 * RouteOrderTest if the claim held — pairing those two files is 13 passed,
 * which is the disproof. Pre-existing, left alone.)
 *
 * What the dodge cost is the point: with neither 'auth' nor 'role:reader',
 * the probe proved "404, never 403" against a middleware stack strictly
 * weaker than the real one, and never ran EnsureShelfRole — the layer that
 * actually chooses 404 over 403 for a signed-in non-member. The real stack
 * is here now, and the three tests below exercise that layer directly.
 */
beforeEach(function () {
    // Registered unconditionally: the router is rebuilt for every test
    // method, so there is nothing to register twice and no earlier
    // registration to detect.
    Route::middleware(['web', 'auth', 'tenant', 'role:reader'])->scopeBindings()
        ->get('/shelves/{shelf}/requests/{borrowRequest}', fn (Bookshelf $shelf, BorrowRequest $borrowRequest) => response()->json(['id' => $borrowRequest->id]))
        ->name('brp-test.probe');
});

/**
 * shelf, manager, reader, the reader's own pending request.
 *
 * The plan's draft of this helper returned three values and built the
 * policy's subject as an unsaved `new BorrowRequest`. It returns a REAL
 * row instead, because the second half of this task — the `{borrowRequest}`
 * binding — cannot be exercised against an object that has no id, and a
 * policy proven only against an in-memory model proves nothing about the
 * row a route would hand it.
 *
 * Leaves the context system-wide: every test below binds its own actor,
 * because that binding IS the thing under test.
 *
 * @return array{Bookshelf, User, User, BorrowRequest}
 */
function brpFix(string $slug = 'dong-thap-brp'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men-'.$slug,
    ]);
    $request = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id,
        'member_id' => $reader->id, 'status' => 'pending',
    ]);

    return [$shelf, $manager, $reader, $request];
}

/** Bind $user's own membership of $shelf into the context, ResolveTenant-style. */
function brpActAs(Bookshelf $shelf, User $user): void
{
    app(TenantContext::class)->set($shelf, Membership::query()
        ->withoutGlobalScopes()
        ->where('bookshelf_id', $shelf->id)
        ->where('user_id', $user->id)
        ->firstOrFail());
}

it('a reader may create and cancel; only a manager may approve, reject, hand over', function () {
    [$shelf, , $reader, $request] = brpFix();
    brpActAs($shelf, $reader);

    expect(Gate::forUser($reader)->allows('create', BorrowRequest::class))->toBeTrue()
        ->and(Gate::forUser($reader)->allows('cancel', $request))->toBeTrue()
        ->and(Gate::forUser($reader)->allows('approve', $request))->toBeFalse()
        ->and(Gate::forUser($reader)->allows('reject', $request))->toBeFalse()
        ->and(Gate::forUser($reader)->allows('handover', $request))->toBeFalse();
});

it('a manager holds all five abilities — act-as-manager implies act-as-reader', function () {
    // The shipped hierarchy IS the one the plan hoped for: the gates are
    // MembershipRole::atLeast() (app/Enums/MembershipRole.php), rank-based,
    // so manager (2) satisfies act-as-reader (1). BR §13's admin ⊃ manager
    // ⊃ reader, encoded once in the enum rather than per gate.
    [$shelf, $manager, , $request] = brpFix('dong-thap-brp-mgr');
    brpActAs($shelf, $manager);

    foreach (['approve', 'reject', 'handover', 'cancel'] as $ability) {
        expect(Gate::forUser($manager)->allows($ability, $request))->toBeTrue($ability);
    }
    expect(Gate::forUser($manager)->allows('create', BorrowRequest::class))->toBeTrue();
});

it('an admin holds all five abilities too — the top of the shelf hierarchy', function () {
    [$shelf, , , $request] = brpFix('dong-thap-brp-adm');
    app(TenantContext::class)->actSystemWide();
    $admin = User::factory()->create(['full_name' => 'Giuse Cha Xứ Coi Sóc']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $admin->id, 'role' => 'admin', 'status' => 'active',
    ]);
    brpActAs($shelf, $admin);

    foreach (['approve', 'reject', 'handover', 'cancel'] as $ability) {
        expect(Gate::forUser($admin)->allows($ability, $request))->toBeTrue($ability);
    }
    expect(Gate::forUser($admin)->allows('create', BorrowRequest::class))->toBeTrue();
});

/*
 * The negative branches. Each is its own it(): the tenant context is a
 * scoped singleton and SessionGuard caches the acting user for a whole
 * test method, so an actor switch inside one block is the trap this
 * project has been bitten by four times.
 *
 * These falsify the POLICY's bodies, not the shared act-as-* gate
 * (GateTest.php covers that closure exhaustively): replacing any of the
 * five methods with `return true;` has to turn something red, and only an
 * assertion made through these exact abilities can do it.
 */

it('a signed-in user with the tenant context entirely unset holds none of the five', function () {
    // Not "a guest", which is what this was called until the review
    // pointed out that the actor is a real User row: a true guest never
    // reaches a policy at all (Authenticate redirects first — pinned over
    // HTTP by "redirects a guest to login instead of 404ing" below). What
    // this falsifies is the entirely-unset context, GateTest's own
    // "grants nothing when the tenant context is entirely unset" aimed at
    // these five abilities rather than at the shared gate.
    [, , , $request] = brpFix('dong-thap-brp-unbound');
    $signedIn = User::factory()->create(['full_name' => 'Anna Người Lạ Qua Đường']);
    app(TenantContext::class)->clear();

    foreach (['create', 'cancel', 'approve', 'reject', 'handover'] as $ability) {
        expect(Gate::forUser($signedIn)->allows($ability, $request))->toBeFalse($ability);
    }
    expect(Gate::forUser($signedIn)->allows('create', BorrowRequest::class))->toBeFalse();
});

it('a non-member of this shelf (membership resolved to null) holds none of the five', function () {
    [$shelf, , , $request] = brpFix('dong-thap-brp-nonmember');
    $stranger = User::factory()->create(['full_name' => 'Phêrô Khách Lạ']);
    app(TenantContext::class)->set($shelf, null);

    foreach (['create', 'cancel', 'approve', 'reject', 'handover'] as $ability) {
        expect(Gate::forUser($stranger)->allows($ability, $request))->toBeFalse($ability);
    }
});

it('a membership belonging to a different user authorizes nobody else', function () {
    [$shelf, $manager, , $request] = brpFix('dong-thap-brp-otheruser');
    $stranger = User::factory()->create(['full_name' => 'Anna Kẻ Mượn Danh']);
    brpActAs($shelf, $manager);   // the MANAGER's row, bound for a stranger

    foreach (['create', 'cancel', 'approve', 'reject', 'handover'] as $ability) {
        expect(Gate::forUser($stranger)->allows($ability, $request))->toBeFalse($ability);
    }
});

it('a suspended member holds none of the five — INV-4 at the gate', function () {
    // ResolveTenant never binds a suspended membership (it filters
    // status = active), so over HTTP this is unreachable today — the same
    // accepted-as-unreachable shape LoanPolicy::renew's docblock records.
    // Pinned anyway: TenantContext::set() is public, and the gate's own
    // status clause is what makes it fail closed for a future caller.
    [$shelf, , , $request] = brpFix('dong-thap-brp-suspended');
    app(TenantContext::class)->actSystemWide();
    $suspended = User::factory()->create(['full_name' => 'Maria Bạn Đọc Tạm Ngưng']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $suspended->id, 'role' => 'manager', 'status' => 'suspended',
    ]);
    app(TenantContext::class)->set($shelf, $membership);

    foreach (['create', 'cancel', 'approve', 'reject', 'handover'] as $ability) {
        expect(Gate::forUser($suspended)->allows($ability, $request))->toBeFalse($ability);
    }
});

it('a soft-deleted membership holds none of the five', function () {
    [$shelf, , , $request] = brpFix('dong-thap-brp-trashed');
    app(TenantContext::class)->actSystemWide();
    $removed = User::factory()->create(['full_name' => 'Giuse Đã Rời Tủ Sách']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $removed->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $membership->delete();
    expect($membership->trashed())->toBeTrue();
    app(TenantContext::class)->set($shelf, $membership);

    foreach (['create', 'cancel', 'approve', 'reject', 'handover'] as $ability) {
        expect(Gate::forUser($removed)->allows($ability, $request))->toBeFalse($ability);
    }
});

it('a super administrator holds all five with no membership at all', function () {
    // The SHIPPED hierarchy, pinned rather than assumed: AppServiceProvider's
    // Gate::before returns true for any ability whose name starts with
    // 'act-as-' when users.is_super_admin is set — BR §13.1's ROLE_RANK
    // .super_admin = 4, above every shelf role. Because all five of this
    // policy's methods delegate to an act-as-* gate, the flag reaches them;
    // a method that grew its own non-delegating check would NOT be covered
    // by that bypass, which is why this is asserted through the abilities.
    [$shelf, , , $request] = brpFix('dong-thap-brp-super');
    $super = User::factory()->superAdmin()->create(['full_name' => 'Maria Quản Trị Hệ Thống']);
    app(TenantContext::class)->set($shelf, null);

    foreach (['create', 'cancel', 'approve', 'reject', 'handover'] as $ability) {
        expect(Gate::forUser($super)->allows($ability, $request))->toBeTrue($ability);
    }
});

it('cancel asks only for a reader membership — ownership is the Action\'s question', function () {
    // BR §5.4, the LoanPolicy::renew argument applied to the queue: a
    // policy answering "is this MY request" would 403 a guessed request id
    // and so confirm the row exists. Ownership folds into CancelOwnRequest's
    // not_own_request instead (Task 7). This test is what makes that a
    // decision rather than an omission: adding an ownership check to
    // BorrowRequestPolicy::cancel turns it red.
    [$shelf, , , $request] = brpFix('dong-thap-brp-notmine');
    app(TenantContext::class)->actSystemWide();
    $otherReader = User::factory()->create(['full_name' => 'Anna Bạn Đọc Khác']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $otherReader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    brpActAs($shelf, $otherReader);

    expect($request->member_id)->not->toBe($otherReader->id)
        ->and(Gate::forUser($otherReader)->allows('cancel', $request))->toBeTrue();
});

/*
 * The relations the scoped bindings resolve through, and the model's own.
 */

it('Bookshelf::borrowRequests() is shelf-local — the relation {borrowRequest} binds through', function () {
    [$shelfA, , , $request] = brpFix('dong-thap-brp-rel-a');
    app(TenantContext::class)->actSystemWide();
    $shelfB = Bookshelf::factory()->create(['slug' => 'dong-thap-brp-rel-b', 'settings' => []]);

    // System-wide, so BookshelfScope is OFF and the relation's own FK
    // filter is the only thing separating the two shelves — the layer
    // routes/web.php's comment says nothing had yet told apart from the
    // global scope.
    expect($shelfA->borrowRequests()->pluck('id')->all())->toBe([$request->id])
        ->and($shelfB->borrowRequests()->count())->toBe(0);
});

it('a soft-deleted request leaves borrowRequests() — the binding 404s an undone row', function () {
    [$shelfA, , , $request] = brpFix('dong-thap-brp-rel-trashed');
    expect($shelfA->borrowRequests()->count())->toBe(1);

    $request->delete();

    expect($shelfA->borrowRequests()->count())->toBe(0)
        ->and(BorrowRequest::withTrashed()->find($request->id))->not->toBeNull();
});

it('Bookshelf::notifications() is shelf-local — the relation {notification} binds through', function () {
    [$shelfA, , $reader] = brpFix('dong-thap-brp-notif-a');
    app(TenantContext::class)->actSystemWide();
    $shelfB = Bookshelf::factory()->create(['slug' => 'dong-thap-brp-notif-b', 'settings' => []]);
    $notification = Notification::query()->create([
        'bookshelf_id' => $shelfA->id, 'user_id' => $reader->id,
        'kind' => 'request_approved', 'payload' => [],
    ]);

    expect($shelfA->notifications()->pluck('id')->all())->toBe([$notification->id])
        ->and($shelfB->notifications()->count())->toBe(0);
});

it('BorrowRequest::book() resolves, and copy() is null until a copy is put aside', function () {
    [$shelf, , , $request] = brpFix('dong-thap-brp-belongs');

    expect($request->copy_id)->toBeNull()
        ->and($request->copy)->toBeNull()
        ->and($request->book)->not->toBeNull()
        ->and($request->book->title)->toBe('Dế Mèn Phiêu Lưu Ký');

    $copy = BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $request->book_id,
        'code' => 'DT-0142', 'state' => 'held',
    ]);
    $request->update(['copy_id' => $copy->id]);

    expect($request->fresh()->copy?->code)->toBe('DT-0142');
});

it('binds this shelf\'s own request, and 404s — never 403 — every other shape', function () {
    [$shelfA, , $reader, $requestA] = brpFix('dong-thap-brp-bind-a');
    app(TenantContext::class)->actSystemWide();
    $shelfB = Bookshelf::factory()->create(['slug' => 'dong-thap-brp-bind-b', 'settings' => []]);
    $readerB = User::factory()->create(['full_name' => 'Phêrô Bạn Đọc Kệ Khác']);
    Membership::factory()->for($shelfB)->create([
        'user_id' => $readerB->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $bookB = Book::query()->create([
        'bookshelf_id' => $shelfB->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be-brp',
    ]);
    $requestB = BorrowRequest::query()->create([
        'bookshelf_id' => $shelfB->id, 'book_id' => $bookB->id,
        'member_id' => $readerB->id, 'status' => 'pending',
    ]);
    $trashed = BorrowRequest::query()->create([
        'bookshelf_id' => $shelfA->id, 'book_id' => $requestA->book_id,
        'member_id' => $reader->id, 'status' => 'cancelled',
    ]);
    $trashed->delete();

    // The row is STILL IN THE TABLE, so the third assertion below is soft
    // deletion doing the work rather than the row having ceased to exist.
    //
    // Precisely what this line does and does not buy, because the first
    // draft credited it with more than it earns: dropping SoftDeletes from
    // BorrowRequest kills this test and the relation test, but by
    // BadMethodCallException on withTrashed() — an exception, not the 404
    // discriminating. The mutation the 404 itself survives or dies by is
    // putting ->withTrashed() ON the relation
    // (Bookshelf::borrowRequests()); that one keeps the model's API intact
    // and reddens both this test's third assertion and the relation test,
    // which is the discrimination being claimed here.
    expect(BorrowRequest::withTrashed()->find($trashed->id))->not->toBeNull();

    // One actor for the whole block — SessionGuard caches it, and the
    // point here is what the URL space tells THIS reader, four ways.
    $this->actingAs($reader)
        ->get("/shelves/{$shelfA->slug}/requests/{$requestA->id}")
        ->assertOk()->assertJson(['id' => $requestA->id]);

    // A real request id, a real shelf, and the two do not belong together:
    // absence, not refusal. assertNotFound is the load-bearing half. The
    // 403 it rules out is the one a route whose Form Request returned a
    // bare Gate::allows() bool would produce (the five Members requests
    // known-gaps records at :1361, since fixed to abort_unless(…, 404)) —
    // NOT one this policy could produce, since none of its methods reads
    // the row.
    $this->actingAs($reader)
        ->get("/shelves/{$shelfA->slug}/requests/{$requestB->id}")
        ->assertNotFound();

    // Soft deletion is undo (BR §11): an undone row is gone from the URL space.
    $this->actingAs($reader)
        ->get("/shelves/{$shelfA->slug}/requests/{$trashed->id}")
        ->assertNotFound();

    // A guessed id that never existed is indistinguishable from the two above.
    $this->actingAs($reader)
        ->get("/shelves/{$shelfA->slug}/requests/0199a1b2-c3d4-7000-8000-000000000000")
        ->assertNotFound();
});

/*
 * The three actors the probe's first draft could not see at all, because
 * it carried neither 'auth' nor 'role:reader': every one of these is
 * decided by EnsureShelfRole (or by Authenticate) before routing ever
 * reaches the binding, let alone the policy. Each is its own it() —
 * SessionGuard caches the acting user for a whole test method.
 */

it('404s a signed-in non-member on a real request URL — EnsureShelfRole, not the policy', function () {
    // The anti-enumeration rule's actual enforcement point: a stranger who
    // pastes a real shelf's real request URL is told the same nothing a
    // wrong slug tells them. EnsureShelfRole's own docblock is where the
    // rule is written down; RouteIsolationTest is where it is swept.
    [$shelfA, , , $requestA] = brpFix('dong-thap-brp-http-stranger');
    $stranger = User::factory()->create(['full_name' => 'Phêrô Người Ngoài Tủ Sách']);

    $this->actingAs($stranger)
        ->get("/shelves/{$shelfA->slug}/requests/{$requestA->id}")
        ->assertNotFound();
});

it('404s a suspended member on their own shelf\'s request URL — INV-4 over HTTP', function () {
    // The unreachable-by-construction branch the policy test asserts
    // against a hand-bound context, reached the way a real request reaches
    // it: ResolveTenant resolves only active memberships, so a suspended
    // reader has no membership in TenantContext, act-as-reader is false,
    // and EnsureShelfRole 404s before the binding runs.
    [$shelfA, , , $requestA] = brpFix('dong-thap-brp-http-suspended');
    app(TenantContext::class)->actSystemWide();
    $suspended = User::factory()->create(['full_name' => 'Anna Bạn Đọc Bị Tạm Ngưng']);
    Membership::factory()->for($shelfA)->create([
        'user_id' => $suspended->id, 'role' => 'reader', 'status' => 'suspended',
    ]);

    $this->actingAs($suspended)
        ->get("/shelves/{$shelfA->slug}/requests/{$requestA->id}")
        ->assertNotFound();
});

it('redirects a guest to login instead of 404ing — the deliberate difference', function () {
    // EnsureShelfRole's documented split: a guest has not failed
    // authorisation, they have not authenticated yet. Pinned because the
    // 404s above would look equally "secure" if this route ever started
    // 404ing guests, and that would be the regression RouteIsolationTest's
    // unknown-slug assertion exists to catch on the manage side.
    [$shelfA, , , $requestA] = brpFix('dong-thap-brp-http-guest');

    $this->get("/shelves/{$shelfA->slug}/requests/{$requestA->id}")
        ->assertRedirect('/login');

    // And the same redirect on an UNKNOWN slug, which is what the route's
    // explicit 'auth' is for — RouteIsolationTest's argument, applied here
    // because measuring found the middleware otherwise unpinned by this
    // file: dropping 'auth' leaves all 18 green without this line, since
    // EnsureShelfRole redirects a guest by itself on a KNOWN slug. On an
    // unknown one it never runs, ResolveTenant 404s first, and a guest can
    // then tell a real shelf (302) from a made-up one (404) — an
    // unauthenticated existence oracle over the shelf URL space.
    $this->get('/shelves/khong-ton-tai/requests/'.$requestA->id)
        ->assertRedirect('/login');
});
