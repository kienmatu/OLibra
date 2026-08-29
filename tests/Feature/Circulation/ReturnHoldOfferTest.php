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
 * Shelf + manager + an active loan + one PENDING request for its title +
 * a second reader whose request for the same title is already APPROVED
 * on a second copy. The approved row is not decoration: the waiting panel
 * offers pending rows only, and a fixture with nothing to exclude cannot
 * prove exclusion (Global Constraints' Pest rule). It is also what makes
 * this task's mutation check able to fire.
 *
 * @return array{Bookshelf, User, Loan, BorrowRequest, BorrowRequest}
 */
function rhoFix(string $slug = 'dong-thap-rho'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $borrower = User::factory()->create(['full_name' => 'Giuse Người Đang Mượn']);
    Membership::factory()->for($shelf)->create(['user_id' => $borrower->id, 'role' => 'reader', 'status' => 'active']);
    $waiter = User::factory()->create(['full_name' => 'Têrêsa Người Đang Chờ']);
    Membership::factory()->for($shelf)->create(['user_id' => $waiter->id, 'role' => 'reader', 'status' => 'active']);
    $holder = User::factory()->create(['full_name' => 'Anna Đã Được Giữ Chỗ']);
    Membership::factory()->for($shelf)->create(['user_id' => $holder->id, 'role' => 'reader', 'status' => 'active']);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'on_loan']);
    // The approved row's own copy — an approved request always names one
    // and its copy is held, or the fixture describes a state no command
    // produces (Global Constraints).
    $heldCopy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0002', 'state' => 'held']);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $borrower->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    $request = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $waiter->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);
    // A DIFFERENT reader: borrow_requests_one_live_per_title_member
    // (Task 1) allows one live row per title per reader.
    $approved = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $holder->id,
        'status' => RequestStatus::Approved, 'requested_at' => now()->subHour(),
        'copy_id' => $heldCopy->id, 'hold_expires_at' => now()->addDays(2),
        'decided_by' => $manager->id, 'decided_at' => now()->subHour(),
    ]);

    return [$shelf, $manager, $loan, $request, $approved];
}

it('the chosen loan surfaces who is waiting, pending only, before confirmation', function () {
    [$shelf, $manager, $loan, $request, $approved] = rhoFix();

    test()->actingAs($manager)
        // q=DT-0001 (the loan's own copy code) carried alongside loan=,
        // exactly as the real screen's Link always does (loans/index.tsx's
        // href passes q: filters.q, loan: loan.loanId together): the brief
        // text omitted this, but SearchLoansForReturnQuery::run('') short-
        // circuits to [] (Fold::fold('') === ''), so with no q the loan
        // could never be "chosen" — chosenLoanId/$chosenRow are resolved
        // from $rows by design ("only a loan the CURRENT search returned
        // can be chosen"), measured live via tinker before this fix.
        ->get("/shelves/{$shelf->slug}/manage/returns?loan={$loan->id}&q=DT-0001")
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('waiting.0.requestId', $request->id)
            ->where('waiting.0.readerName', 'Têrêsa Người Đang Chờ')
            // PENDING ONLY, and the approved row exists to prove it: Anna
            // already has DT-0002 put aside for her, so offering this
            // returned copy to her would put two copies under one request.
            // One entry, and it is not hers.
            ->count('waiting', 1));
    expect($approved->fresh()->status)->toBe(RequestStatus::Approved);
});

it('with nobody waiting the panel data is empty, and no loan chosen means null', function () {
    [$shelf, $manager, $loan, $request] = rhoFix('dong-thap-rho-empty');
    BorrowRequest::query()->whereKey($request->id)->update(['status' => RequestStatus::Cancelled, 'cancelled_at' => now()]);

    test()->actingAs($manager)
        // q=DT-0001 (the loan's own copy code) carried alongside loan=,
        // exactly as the real screen's Link always does (loans/index.tsx's
        // href passes q: filters.q, loan: loan.loanId together): the brief
        // text omitted this, but SearchLoansForReturnQuery::run('') short-
        // circuits to [] (Fold::fold('') === ''), so with no q the loan
        // could never be "chosen" — chosenLoanId/$chosenRow are resolved
        // from $rows by design ("only a loan the CURRENT search returned
        // can be chosen"), measured live via tinker before this fix.
        ->get("/shelves/{$shelf->slug}/manage/returns?loan={$loan->id}&q=DT-0001")
        ->assertInertia(fn (AssertableInertia $page) => $page->where('waiting', []));

    test()->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/returns")
        ->assertInertia(fn (AssertableInertia $page) => $page->where('waiting', null));
});

it('the POST with a chosen reader holds the copy and flashes the hold sentence', function () {
    [$shelf, $manager, $loan, $request] = rhoFix('dong-thap-rho-hold');

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/returns/{$loan->id}",
        ['condition' => 'perfect', 'hold_for_request_id' => $request->id],
    );

    $response->assertRedirect()->assertSessionHas('success', fn ($msg) => str_contains($msg, 'giữ chỗ'));
    expect($request->fresh()->status)->toBe(RequestStatus::Approved)
        ->and(BookCopy::query()->findOrFail($loan->copy_id)->state)->toBe(CopyState::Held);
});

it('the empty radio value means no hold, and the copy goes back on the shelf', function () {
    [$shelf, $manager, $loan, $request] = rhoFix('dong-thap-rho-none');

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/returns/{$loan->id}",
        ['condition' => 'perfect', 'hold_for_request_id' => ''],
    );

    $response->assertRedirect()->assertSessionHas('success');
    expect($request->fresh()->status)->toBe(RequestStatus::Pending)
        ->and(BookCopy::query()->findOrFail($loan->copy_id)->state)->toBe(CopyState::Available);
});

it('a stale request id comes back as the request_not_queued sentence, return not applied', function () {
    [$shelf, $manager, $loan, $request] = rhoFix('dong-thap-rho-stale');
    BorrowRequest::query()->whereKey($request->id)->update(['status' => RequestStatus::Cancelled, 'cancelled_at' => now()]);

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/returns/{$loan->id}",
        ['condition' => 'perfect', 'hold_for_request_id' => $request->id],
    );

    $response->assertSessionHasErrors(['rule']);
    expect(session('errors')->first('rule'))->toBe(__('rules.request_not_queued'))
        ->and($loan->fresh()->status->value)->toBe('active');
});

it('an emoji hold_for_request_id is a field error too — the errno 1267 path never opens', function () {
    // Same measured shape as ManagerQueueScreenTest's copy_id case: the
    // Form Request's bail+uuid rule is what keeps '🙂' from ever reaching
    // BorrowRequest::query()->lockForUpdate()->find($holdForRequestId)
    // inside ReceiveReturn — borrow_requests.id is ascii/ascii_bin
    // (2026_08_26_000008_create_borrow_requests_table.php), so an
    // unvalidated emoji id is SQLSTATE[HY000] 1267 "Illegal mix of
    // collations", a 500, not a refusal. The POST below is the validated
    // path; the raw find() beneath it is the un-validated one, measured
    // directly rather than assumed.
    [$shelf, $manager, $loan] = rhoFix('dong-thap-rho-emoji');

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/returns/{$loan->id}",
        ['condition' => 'perfect', 'hold_for_request_id' => '🙂'],
    );

    $response->assertSessionHasErrors(['hold_for_request_id']);
    expect($loan->fresh()->status->value)->toBe('active');
    // The 500 the rule prevents, produced deliberately one layer down.
    expect(fn () => BorrowRequest::query()->find('🙂'))
        ->toThrow(QueryException::class);
});
