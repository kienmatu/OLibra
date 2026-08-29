<?php

use App\Enums\CopyState;
use App\Enums\RequestStatus;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Inertia\Testing\AssertableInertia;

/**
 * Shelf + manager (acting over HTTP) + book with one free copy + one
 * pending request. @return array{Bookshelf, User, Book, BookCopy, BorrowRequest}
 */
function mqsFix(string $slug = 'dong-thap-mqs'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    Membership::factory()->for($shelf)->create(['user_id' => $reader->id, 'role' => 'reader', 'status' => 'active']);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'available']);
    $request = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);

    return [$shelf, $manager, $book, $copy, $request];
}

it('GET /manage/borrow-requests renders the queues with free copies', function () {
    [$shelf, $manager] = mqsFix();

    test()->actingAs($manager)->get("/shelves/{$shelf->slug}/manage/borrow-requests")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/borrow-requests')
            ->where('queues.0.title', 'Dế Mèn Phiêu Lưu Ký')
            ->where('queues.0.waiting', 1)
            ->where('queues.0.freeCopies.0.code', 'DT-0001'));
});

it('POST approve puts the chosen copy aside and lands back on the queue', function () {
    [$shelf, $manager, , $copy, $request] = mqsFix('dong-thap-mqs-approve');

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/borrow-requests/{$request->id}/approve",
        ['copy_id' => $copy->id],
    );

    $response->assertRedirect()->assertSessionHas('success');
    expect($request->fresh()->status)->toBe(RequestStatus::Approved)
        ->and($copy->fresh()->state)->toBe(CopyState::Held);
});

it('approving with no free copy is a field error, not a failed uuid cast', function () {
    [$shelf, $manager, , , $request] = mqsFix('dong-thap-mqs-nocopy');

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/borrow-requests/{$request->id}/approve",
        ['copy_id' => ''],
    );

    $response->assertSessionHasErrors(['copy_id']);
    expect($request->fresh()->status)->toBe(RequestStatus::Pending);
});

it('an emoji copy_id is a field error too — the errno 1267 path never opens', function () {
    // The condition docs/known-gaps.md attached to this task: book_copies.id
    // is ascii_bin, so BookCopy::query()->find('🙂') inside
    // ApproveBorrowRequest is SQLSTATE[HY000] 1267 "Illegal mix of
    // collations" — a 500, not a refusal. Measured again here rather than
    // taken on trust: the raw find() below is the un-validated shape, and
    // the POST above it is the validated one. `bail` in front of `uuid` is
    // what keeps the two apart, and this test fails on the POST the moment
    // the rule is removed.
    [$shelf, $manager, , , $request] = mqsFix('dong-thap-mqs-emoji');

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/borrow-requests/{$request->id}/approve",
        ['copy_id' => '🙂'],
    );

    $response->assertSessionHasErrors(['copy_id']);
    expect($request->fresh()->status)->toBe(RequestStatus::Pending);
    // The 500 the rule prevents, produced deliberately one layer down.
    expect(fn () => BookCopy::query()->find('🙂'))
        ->toThrow(QueryException::class);
});

it('POST reject with an empty reason box is accepted and stores no reason', function () {
    // Ruling 2: the reason is optional, settled. An empty box is NO
    // reason — decision_note NULL — not a reason that says nothing.
    [$shelf, $manager, , , $request] = mqsFix('dong-thap-mqs-reject');

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/borrow-requests/{$request->id}/reject",
        ['reason' => ''],
    );

    $response->assertRedirect()->assertSessionHas('success');
    expect($request->fresh()->status)->toBe(RequestStatus::Rejected)
        ->and($request->fresh()->decision_note)->toBeNull();
});

it('POST reject with a reason keeps it — the optional field is still a field', function () {
    [$shelf, $manager, , , $request] = mqsFix('dong-thap-mqs-reject-why');

    test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/borrow-requests/{$request->id}/reject",
        ['reason' => 'Bạn đọc đang giữ quá nhiều sách.'],
    )->assertRedirect()->assertSessionHas('success');

    expect($request->fresh()->decision_note)->toBe('Bạn đọc đang giữ quá nhiều sách.');
});

it('POST handover posts one id, and the book goes out', function () {
    [$shelf, $manager, , $copy, $request] = mqsFix('dong-thap-mqs-handover');
    // Promote to a live hold first (the full approval shape).
    BookCopy::query()->whereKey($copy->id)->update(['state' => 'held']);
    BorrowRequest::query()->whereKey($request->id)->update([
        'status' => RequestStatus::Approved, 'copy_id' => $copy->id,
        'hold_expires_at' => now()->addDays(2), 'decided_by' => $manager->id, 'decided_at' => now(),
    ]);

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/borrow-requests/{$request->id}/handover",
    );

    $response->assertRedirect()->assertSessionHas('success');
    expect($request->fresh()->status)->toBe(RequestStatus::Fulfilled)
        ->and($copy->fresh()->state)->toBe(CopyState::OnLoan)
        ->and(Loan::query()->count())->toBe(1);
});

it('a lapsed hold\'s handover comes back as the hold_expired sentence', function () {
    [$shelf, $manager, , $copy, $request] = mqsFix('dong-thap-mqs-lapsed');
    BookCopy::query()->whereKey($copy->id)->update(['state' => 'held']);
    BorrowRequest::query()->whereKey($request->id)->update([
        'status' => RequestStatus::Approved, 'copy_id' => $copy->id,
        'hold_expires_at' => now()->subHour(), 'decided_by' => $manager->id, 'decided_at' => now()->subDays(3),
    ]);

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/borrow-requests/{$request->id}/handover",
    );

    $response->assertSessionHasErrors(['rule']);
    expect(session('errors')->first('rule'))->toBe(__('rules.hold_expired'));
});

it('the lapsed row is still on the screen, flagged — hiding it would hide the problem', function () {
    // Trap 1: two facts that must both be shown failing need two it()
    // blocks, so the sentence above and the row's survival below are
    // separate. The reference's own argument for keeping it: the copy is
    // still `held` with nobody coming for it.
    [$shelf, $manager, , $copy, $request] = mqsFix('dong-thap-mqs-lapsed-row');
    BookCopy::query()->whereKey($copy->id)->update(['state' => 'held']);
    BorrowRequest::query()->whereKey($request->id)->update([
        'status' => RequestStatus::Approved, 'copy_id' => $copy->id,
        'hold_expires_at' => now()->subHour(), 'decided_by' => $manager->id, 'decided_at' => now()->subDays(3),
    ]);

    test()->actingAs($manager)->get("/shelves/{$shelf->slug}/manage/borrow-requests")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('queues.0.requests.0.status', 'approved')
            ->where('queues.0.requests.0.holdExpired', true)
            ->where('queues.0.requests.0.copyCode', 'DT-0001'));
});

it('a reader 404s on the queue screen and on every POST', function () {
    // All four surfaces, in one it() because the actor never changes —
    // one actingAs, four requests, which SessionGuard is perfectly happy
    // with. The name says "every POST", so every POST is here; the first
    // draft asserted only the GET.
    [$shelf, , , $copy, $request] = mqsFix('dong-thap-mqs-reader');
    $reader = User::query()->where('full_name', 'Têrêsa Bạn Đọc Nhỏ')->firstOrFail();
    $base = "/shelves/{$shelf->slug}/manage/borrow-requests";

    test()->actingAs($reader)->get($base)->assertNotFound();
    // 404, never 403 — spec §5.4: a reader must not learn the request
    // exists. The Form Requests' authorize() aborts before validation, so
    // a well-formed body is answered the same way as an empty one.
    test()->actingAs($reader)->post("{$base}/{$request->id}/approve", ['copy_id' => $copy->id])->assertNotFound();
    test()->actingAs($reader)->post("{$base}/{$request->id}/reject", ['reason' => 'thử'])->assertNotFound();
    test()->actingAs($reader)->post("{$base}/{$request->id}/handover")->assertNotFound();

    // And nothing happened on the way past.
    expect($request->fresh()->status)->toBe(RequestStatus::Pending)
        ->and($copy->fresh()->state)->toBe(CopyState::Available)
        ->and(Loan::query()->count())->toBe(0);
});

it('the dashboard shows the third card, counting this queue', function () {
    [$shelf, $manager] = mqsFix('dong-thap-mqs-card');

    test()->actingAs($manager)->get("/shelves/{$shelf->slug}/manage")
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('dashboard.counts.pendingRequests', 1));
});
