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

/*
 * TWO BLOCKS, NOT ONE, AND THE PLAN PRESCRIBED ONE (review fix round 1,
 * item 1 — the brief specified a single block verbatim, comment included,
 * and it is overridden).
 *
 * The single block asserted the GET's 404 first, and a failed assertion
 * aborts the whole test METHOD — so a regression that reopened the GET to
 * readers would also HIDE whether the three POSTs still refused. That is
 * not hypothetical here: this task's own authorization measurement (drop
 * role:manager from the manage group, see the report) could only be taken
 * by editing the GET assertion out of the way, which is the structure
 * defeating the person using it.
 *
 * The SessionGuard justification the original comment gave answers a
 * different question. SessionGuard caches the acting user for a whole
 * test method, so the rule it protects is "do not switch actors inside
 * one it()". The actor is the SAME reader in both blocks below, so
 * splitting costs nothing it was guarding — each block makes its own
 * single actingAs call and never changes actor.
 */
it('a reader 404s on the queue screen', function () {
    [$shelf] = mqsFix('dong-thap-mqs-reader-get');
    $reader = User::query()->where('full_name', 'Têrêsa Bạn Đọc Nhỏ')->firstOrFail();

    // 404, never 403 — spec §5.4: a reader must not learn the queue
    // exists. EnsureShelfRole (role:manager) is what produces it; this
    // GET carries no Form Request and no controller Gate, which is the
    // house shape for a manage read (OverdueController and
    // DashboardController are the same bare shape — opened, 2026-08-30).
    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/manage/borrow-requests")->assertNotFound();
});

it('a reader 404s on every POST, and nothing happens on the way past', function () {
    // The name says "every POST", so every POST is here; the first draft
    // asserted only the GET. All three in ONE block is deliberate and is
    // not the mistake item 1 corrected: these three are the same fact
    // about three sibling routes, and if the first one regresses the
    // other two are not independent evidence — whereas the GET and the
    // POSTs fail for genuinely different reasons (no Form Request vs. a
    // Form Request's own abort_unless), which is why THAT split matters.
    [$shelf, , , $copy, $request] = mqsFix('dong-thap-mqs-reader-post');
    $reader = User::query()->where('full_name', 'Têrêsa Bạn Đọc Nhỏ')->firstOrFail();
    $base = "/shelves/{$shelf->slug}/manage/borrow-requests";

    // A well-formed body is answered the same way as an empty one: the
    // role middleware aborts before routing reaches a Form Request at
    // all, and the Form Requests' own authorize() aborts before
    // validation.
    test()->actingAs($reader)->post("{$base}/{$request->id}/approve", ['copy_id' => $copy->id])->assertNotFound();
    test()->actingAs($reader)->post("{$base}/{$request->id}/reject", ['reason' => 'thử'])->assertNotFound();
    test()->actingAs($reader)->post("{$base}/{$request->id}/handover")->assertNotFound();

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
