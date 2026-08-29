<?php

use App\Enums\RequestStatus;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * Shelf + reader + one published book with one available copy.
 *
 * @return array{Bookshelf, User, Book}
 */
function rrsFix(string $slug = 'dong-thap-rrs'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    Membership::factory()->for($shelf)->create(['user_id' => $reader->id, 'role' => 'reader', 'status' => 'active']);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men',
        'is_published' => true,
    ]);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'available']);

    return [$shelf, $reader, $book];
}

it('POST books/{book}/request creates the reader\'s own pending request and flashes', function () {
    [$shelf, $reader, $book] = rrsFix();

    $response = test()->actingAs($reader)->post("/shelves/{$shelf->slug}/books/{$book->slug}/request");

    $response->assertRedirect()->assertSessionHas('success');
    $row = BorrowRequest::query()->sole();
    expect($row->member_id)->toBe($reader->id)
        ->and($row->status)->toBe(RequestStatus::Pending);
});

it('a second tap comes back as the duplicate sentence under errors.rule, not a 500', function () {
    [$shelf, $reader, $book] = rrsFix('dong-thap-rrs-dup');
    test()->actingAs($reader)->post("/shelves/{$shelf->slug}/books/{$book->slug}/request");

    $response = test()->actingAs($reader)->post("/shelves/{$shelf->slug}/books/{$book->slug}/request");

    $response->assertSessionHasErrors(['rule']);
    expect(session('errors')->first('rule'))->toBe(__('rules.duplicate_request'))
        ->and(BorrowRequest::query()->count())->toBe(1);
});

it('the book page carries myRequest for the signed-in reader, with a queue position', function () {
    [$shelf, $reader, $book] = rrsFix('dong-thap-rrs-mine');
    // Somebody AHEAD, requested earlier, so the position is 2.
    app(TenantContext::class)->actSystemWide();
    $ahead = User::factory()->create(['full_name' => 'Anna Đăng Ký Trước']);
    Membership::factory()->for($shelf)->create(['user_id' => $ahead->id, 'role' => 'reader', 'status' => 'active']);
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $ahead->id,
        'status' => RequestStatus::Pending, 'requested_at' => now()->subHour(),
    ]);
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);

    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/books/{$book->slug}")
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('detail.myRequest.status', 'pending')
            ->where('detail.myRequest.queuePosition', 2)
            ->where('detail.myRequest.holdExpiresAt', null));
});

it('the position follows requested_at even when the rows are INSERTED the other way round', function () {
    // Trap 3, and the reason the test above cannot stand alone: UUID v7
    // keys are chronologically monotonic, so seeding the earlier request
    // first makes id-order and requested_at-order agree and an ordering
    // bug is invisible. Here MY row is inserted FIRST (smaller v7 id) and
    // carries the LATER requested_at, so an implementation that counted by
    // id, or by insertion order, would answer 1 instead of 2.
    [$shelf, $reader, $book] = rrsFix('dong-thap-rrs-order');
    app(TenantContext::class)->actSystemWide();
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);
    $ahead = User::factory()->create(['full_name' => 'Anna Đăng Ký Trước Nhưng Lưu Sau']);
    Membership::factory()->for($shelf)->create(['user_id' => $ahead->id, 'role' => 'reader', 'status' => 'active']);
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $ahead->id,
        'status' => RequestStatus::Pending, 'requested_at' => now()->subHour(),
    ]);

    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/books/{$book->slug}")
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('detail.myRequest.queuePosition', 2));
});

it('an approved request renders as a hold with its expiry, not a position', function () {
    [$shelf, $reader, $book] = rrsFix('dong-thap-rrs-hold');
    app(TenantContext::class)->actSystemWide();
    $copy = BookCopy::query()->where('book_id', $book->id)->firstOrFail();
    $copy->update(['state' => 'held']);
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Approved, 'requested_at' => now()->subDay(),
        'copy_id' => $copy->id, 'hold_expires_at' => now()->addDays(2),
        'decided_by' => $reader->id, 'decided_at' => now(),
    ]);

    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/books/{$book->slug}")
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('detail.myRequest.status', 'approved')
            ->where('detail.myRequest.queuePosition', null)
            ->whereNot('detail.myRequest.holdExpiresAt', null));
});

it('another reader\'s request is NOT my request', function () {
    // The exclusion has something to exclude: the other reader's row
    // exists, and myRequest is null all the same.
    [$shelf, $reader, $book] = rrsFix('dong-thap-rrs-notmine');
    app(TenantContext::class)->actSystemWide();
    $other = User::factory()->create(['full_name' => 'Anna Người Khác']);
    Membership::factory()->for($shelf)->create(['user_id' => $other->id, 'role' => 'reader', 'status' => 'active']);
    BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $other->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);

    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/books/{$book->slug}")
        ->assertInertia(fn (AssertableInertia $page) => $page->where('detail.myRequest', null));
});

it('POST profile/requests/{borrowRequest}/cancel withdraws my own request', function () {
    [$shelf, $reader, $book] = rrsFix('dong-thap-rrs-cancel');
    app(TenantContext::class)->actSystemWide();
    $request = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);

    $response = test()->actingAs($reader)
        ->post("/shelves/{$shelf->slug}/profile/requests/{$request->id}/cancel");

    $response->assertRedirect()->assertSessionHas('success');
    expect($request->fresh()->status)->toBe(RequestStatus::Cancelled);
});

it('a draft book 404s on the request POST, the same way the page itself does', function () {
    // Review round 1, item 2. Book::getRouteKeyName() is `slug`, so this
    // URL is guessable, and nothing in the binding, this controller or
    // CreateBorrowRequest reads is_published — the sibling GET
    // (Reader\BookController:25, "hidden means absent") was the only
    // thing filtering drafts. Without the same abort_unless here, a shelf
    // reader who guesses a draft slug gets a 302 and a success flash while
    // a slug that does not exist gets a 404: an existence oracle over
    // unpublished titles, spec §5.4's exact shape. The row would also
    // surface on the manager's queue, whose waiting() builder joins books
    // with no is_published filter.
    //
    // The reference omits this check on the premise that a draft is one a
    // reader has no URL for; this task creates that URL, so the premise no
    // longer holds and the inherited decision is reversed here.
    [$shelf, $reader] = rrsFix('dong-thap-rrs-draft');
    app(TenantContext::class)->actSystemWide();
    $draft = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'dat-rung',
        'is_published' => false,
    ]);

    test()->actingAs($reader)->post("/shelves/{$shelf->slug}/books/{$draft->slug}/request")
        ->assertNotFound();

    expect(BorrowRequest::query()->withoutGlobalScopes()->count())->toBe(0);
});

it('a guest is redirected to login on the request POST', function () {
    // Named for what it asserts: the non-member case is the it() below,
    // which has to be its own block anyway (SessionGuard caches the
    // acting user for a whole test method).
    [$shelf, , $book] = rrsFix('dong-thap-rrs-guest');

    test()->post("/shelves/{$shelf->slug}/books/{$book->slug}/request")->assertRedirect('/login');
});

it('a signed-in non-member 404s on the request POST', function () {
    // Its own it() block — SessionGuard caches the actingAs user.
    [$shelf, , $book] = rrsFix('dong-thap-rrs-nonmember');
    app(TenantContext::class)->actSystemWide();
    $stranger = User::factory()->create(['full_name' => 'Người Lạ Qua Đường']);

    test()->actingAs($stranger)->post("/shelves/{$shelf->slug}/books/{$book->slug}/request")->assertNotFound();
});

it('a signed-in non-member 404s on the cancel POST too, and neither refusal is a 403', function () {
    // The requirement held since Task 4: what reaches the BROWSER is 404,
    // never Laravel's default 403 for AuthorizationException. There is no
    // Form Request on either route to carry an abort_unless(..., 404), so
    // the 404 has exactly one producer here — EnsureShelfRole, which
    // abort(404)s when Gate::allows('act-as-reader') is false. The
    // Action's own Gate::authorize (BorrowRequestPolicy -> the SAME
    // act-as-reader ability) is therefore never the thing this caller
    // meets: it would throw AuthorizationException and render 403, and
    // this assertion is what would go red if the route ever lost
    // role:reader — measured both ways, on each route separately, by
    // adding ->withoutMiddleware('role:reader') and watching the 404
    // become a 403.
    //
    // The not-403 line below CANNOT fail independently: assertNotFound()
    // is assertStatus(404), which a 403 already fails. It is kept purely
    // for readability, so the property this block exists for is legible
    // without knowing what assertNotFound expands to.
    [$shelf, , $book] = rrsFix('dong-thap-rrs-nonmember-cancel');
    app(TenantContext::class)->actSystemWide();
    $stranger = User::factory()->create(['full_name' => 'Người Lạ Thứ Hai']);
    $request = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id,
        'member_id' => User::factory()->create()->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);

    $response = test()->actingAs($stranger)
        ->post("/shelves/{$shelf->slug}/profile/requests/{$request->id}/cancel");

    $response->assertNotFound();
    expect($response->getStatusCode())->not->toBe(403);
});

it('an ordinary reader whose membership is suspended meets a 404, not a sentence', function () {
    // Review round 1, item 3, pinned rather than only commented. The
    // reference's own comment claims a suspended membership surfaces
    // membership_not_active_cannot_request on this page; under THIS app's
    // gating it cannot. ResolveTenant:67 filters on status = Active, so a
    // suspended reader binds a null membership; the act-as-reader gate
    // (AppServiceProvider:147-179) returns false for a non-super-admin;
    // EnsureShelfRole 404s them before any Action runs. The same reasoning
    // is why not_permitted is a SUPER ADMIN's refusal only — Gate::before
    // (:126-132) is what lets a null membership through, and it fires for
    // nobody else. Both halves of book.tsx's banner comment rest on this.
    [$shelf, $reader, $book] = rrsFix('dong-thap-rrs-suspended');
    app(TenantContext::class)->actSystemWide();
    Membership::query()->where('user_id', $reader->id)->update([
        'status' => 'suspended', 'suspension_reason' => 'thử nghiệm',
    ]);

    test()->actingAs($reader)->post("/shelves/{$shelf->slug}/books/{$book->slug}/request")
        ->assertNotFound();

    expect(BorrowRequest::query()->withoutGlobalScopes()->count())->toBe(0);
});

it('a memberless super admin meets not_permitted as a Vietnamese sentence on the page they came from', function () {
    // Held for this task since Task 4, and it is a LIVE production path,
    // not defence in depth: AppServiceProvider's Gate::before returns true
    // for any act-as-* ability when is_super_admin, so EnsureShelfRole
    // lets a super admin through role:reader; ResolveTenant filters
    // memberships on status = Active, so one who is not a member of this
    // shelf binds a null membership; CreateBorrowRequest's null check is
    // then the only thing left, and it throws not_permitted.
    //
    // What this test adds over CreateBorrowRequestTest's unit-level twin
    // is the READER's end of it: bootstrap/app.php renders RuleViolated as
    // back()->withErrors(['rule' => ...]), so the sentence has to survive
    // a 302 and come back on the book page's shared `errors` prop. The
    // second request below is the page the browser actually lands on.
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-rrs-super', 'settings' => []]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be',
        'is_published' => true,
    ]);
    BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0002', 'state' => 'available',
    ]);
    $admin = User::factory()->superAdmin()->create(['full_name' => 'Giuse Quản Trị Toàn Hệ Thống']);
    $page = "/shelves/{$shelf->slug}/books/{$book->slug}";

    // One actingAs for the whole method — the SessionGuard rule.
    $post = test()->actingAs($admin)->from($page)->post($page.'/request');

    $post->assertRedirect($page);
    expect(BorrowRequest::query()->withoutGlobalScopes()->count())->toBe(0);

    test()->get($page)->assertOk()
        ->assertInertia(fn (AssertableInertia $p) => $p
            ->component('shelves/book')
            ->where('errors.rule', __('rules.not_permitted')));
});

it('cancelling somebody else\'s request on my own shelf is the ownership sentence, not a 403', function () {
    // BorrowRequestPolicy deliberately does not read the row (a
    // policy-level 403 would confirm it exists), so ownership arrives as
    // CancelOwnRequest's not_own_request — a 302 carrying the sentence,
    // indistinguishable in status from any other refusal.
    [$shelf, $reader, $book] = rrsFix('dong-thap-rrs-notowner');
    app(TenantContext::class)->actSystemWide();
    $other = User::factory()->create(['full_name' => 'Phêrô Người Khác Nữa']);
    Membership::factory()->for($shelf)->create(['user_id' => $other->id, 'role' => 'reader', 'status' => 'active']);
    $request = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $other->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);

    $response = test()->actingAs($reader)
        ->post("/shelves/{$shelf->slug}/profile/requests/{$request->id}/cancel");

    $response->assertRedirect()->assertSessionHasErrors(['rule']);
    expect(session('errors')->first('rule'))->toBe(__('rules.not_own_request'))
        ->and($request->fresh()->status)->toBe(RequestStatus::Pending);
});

it('a request that belongs to another shelf 404s on the bound cancel URL', function () {
    // The binding's own answer, before any ability is asked: the id is
    // real, and it is not this shelf's.
    [$shelf, $reader] = rrsFix('dong-thap-rrs-foreign');
    app(TenantContext::class)->actSystemWide();
    $far = Bookshelf::factory()->create(['slug' => 'dong-thap-rrs-foreign-far', 'settings' => []]);
    $farBook = Book::query()->create([
        'bookshelf_id' => $far->id, 'title' => 'Totto-chan Bên Cửa Sổ', 'slug' => 'totto-chan',
        'is_published' => true,
    ]);
    $foreign = BorrowRequest::query()->create([
        'bookshelf_id' => $far->id, 'book_id' => $farBook->id,
        'member_id' => User::factory()->create()->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);

    test()->actingAs($reader)
        ->post("/shelves/{$shelf->slug}/profile/requests/{$foreign->id}/cancel")
        ->assertNotFound();
});
