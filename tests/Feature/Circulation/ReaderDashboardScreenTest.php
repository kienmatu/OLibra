<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Inertia\Testing\AssertableInertia;

/** @return array{Bookshelf, User, Loan} */
function rdbFix(string $slug = 'dong-thap-rdb'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Trực Quầy Sách']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Đọc Ở Nhà']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men-rdb']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0901', 'state' => 'on_loan']);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $reader->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-04', 'status' => 'active',
    ]);
    app(TenantContext::class)->clear();

    return [$shelf, $reader, $loan];
}

it('the overview shows the reader\'s loans with days remaining and a live renew button', function () {
    Carbon::setTestNow(Carbon::parse('2026-09-01 03:00:00', 'UTC'));
    [$shelf, $reader] = rdbFix();

    $this->actingAs($reader)
        ->get(route('shelves.profile.overview', ['shelf' => $shelf->slug]))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('shelves/profile/overview')
            ->count('dashboard.loans', 1)
            ->where('dashboard.loans.0.daysRemaining', 3)
            ->where('dashboard.loans.0.renewBlockedBy', null));
    Carbon::setTestNow();
});

it('renewing from the dashboard moves the date the dashboard shows', function () {
    [$shelf, $reader, $loan] = rdbFix(slug: 'dong-thap-rdb-renew');

    $this->actingAs($reader)
        ->post(route('shelves.profile.loans.renew', ['shelf' => $shelf->slug, 'loan' => $loan->id]))
        ->assertRedirect()
        // AGENTS.md: "dates read as dates" — d/m/Y, the same format
        // formatDate() renders on the overview page (deviation from the
        // brief's Step 3 snippet, which passed the raw Y-m-d straight
        // through; see LendController::store's identical, already-fixed
        // case for the established precedent).
        ->assertSessionHas('success', 'Đã gia hạn — hạn trả mới là 11/09/2026.');

    expect($loan->fresh()->due_on->toDateString())->toBe('2026-09-11')
        ->and($loan->fresh()->renewals_used)->toBe(1);
});

it('a second renewal comes back as errors.rule with the renewals sentence', function () {
    [$shelf, $reader, $loan] = rdbFix(slug: 'dong-thap-rdb-cap');
    $this->actingAs($reader)
        ->post(route('shelves.profile.loans.renew', ['shelf' => $shelf->slug, 'loan' => $loan->id]));

    $this->actingAs($reader)
        ->post(route('shelves.profile.loans.renew', ['shelf' => $shelf->slug, 'loan' => $loan->id]))
        ->assertSessionHasErrors(['rule' => 'Bạn đã dùng hết số lần gia hạn cho lượt mượn này.']);
});

it('the history page keeps a returned loan and says how it came back', function () {
    [$shelf, $reader, $loan] = rdbFix(slug: 'dong-thap-rdb-hist');
    app(TenantContext::class)->actSystemWide();
    Loan::query()->whereKey($loan->id)->update([
        'status' => 'returned', 'return_condition' => 'worn',
        'returned_at' => '2026-08-25 08:00:00',
    ]);
    app(TenantContext::class)->clear();

    $this->actingAs($reader)
        ->get(route('shelves.profile.history', ['shelf' => $shelf->slug]))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('shelves/profile/history')
            ->where('history.total', 1)
            ->where('history.rows.0.status', 'returned')
            ->where('history.rows.0.returnCondition', 'worn'));
});

it('the history page threads ?page= through to the query, not just the default', function () {
    [$shelf, $reader] = rdbFix(slug: 'dong-thap-rdb-page');

    // Only one loan exists (from the fixture) — page 5 is past the end,
    // but the CONTROLLER must still hand MyLoanHistoryQuery the page the
    // caller asked for, not silently default it back to 1. pageCount
    // stays 1 either way (there is only one row to page over), so the
    // page number itself is the only signal this test has that
    // QueryParam::first's value actually reached the query.
    $this->actingAs($reader)
        ->get(route('shelves.profile.history', ['shelf' => $shelf->slug, 'page' => 5]))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('shelves/profile/history')
            ->where('history.page', 5)
            ->where('history.total', 1));
});

/**
 * Carry-over from Task 13's review: no test proved the overview/history
 * READ surfaces exclude another reader's loan on the SAME shelf — every
 * fixture in this file, until now, seeded exactly one reader with one loan
 * per shelf, so a bare count assertion could not distinguish "scoped to
 * this borrower" from "scoped to the whole shelf." Dropping
 * MyDashboardQuery/MyLoanHistoryQuery's `where('borrower_id', ...)` left
 * the entire suite green while this probe alone went red (verified: see
 * task-14-report.md).
 */
it('the overview excludes another reader\'s active loan on the same shelf', function () {
    [$shelf, $reader, $loan] = rdbFix(slug: 'dong-thap-rdb-owner-ov');
    app(TenantContext::class)->actSystemWide();
    $other = User::factory()->create(['full_name' => 'Phêrô Mượn Sách Khác']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $other->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $otherBook = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Sách Của Người Khác', 'slug' => 'sach-khac-rdb-ov']);
    $otherCopy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $otherBook->id, 'code' => 'DT-0910', 'state' => 'on_loan']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $otherCopy->id, 'book_id' => $otherBook->id,
        'borrower_id' => $other->id, 'lent_by' => $other->id,
        'due_on' => '2026-09-04', 'status' => 'active',
    ]);
    app(TenantContext::class)->clear();

    $this->actingAs($reader)
        ->get(route('shelves.profile.overview', ['shelf' => $shelf->slug]))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('shelves/profile/overview')
            ->count('dashboard.loans', 1)
            ->where('dashboard.loans.0.loanId', $loan->id));
});

it('the history excludes another reader\'s loan on the same shelf', function () {
    [$shelf, $reader, $loan] = rdbFix(slug: 'dong-thap-rdb-owner-hi');
    app(TenantContext::class)->actSystemWide();
    $other = User::factory()->create(['full_name' => 'Phêrô Mượn Sách Khác']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $other->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $otherBook = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Sách Của Người Khác', 'slug' => 'sach-khac-rdb-hi']);
    $otherCopy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $otherBook->id, 'code' => 'DT-0911', 'state' => 'on_loan']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $otherCopy->id, 'book_id' => $otherBook->id,
        'borrower_id' => $other->id, 'lent_by' => $other->id,
        'due_on' => '2026-09-04', 'status' => 'active',
    ]);
    app(TenantContext::class)->clear();

    $this->actingAs($reader)
        ->get(route('shelves.profile.history', ['shelf' => $shelf->slug]))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('shelves/profile/history')
            ->where('history.total', 1)
            ->where('history.rows.0.loanId', $loan->id));
});

it('another reader\'s renew POST is refused as loan_not_active — never an existence oracle', function () {
    [$shelf, , $loan] = rdbFix(slug: 'dong-thap-rdb-other');
    app(TenantContext::class)->actSystemWide();
    $other = User::factory()->create(['full_name' => 'Gioan Không Phải Chủ']);
    Membership::factory()->for(Bookshelf::query()->where('slug', 'dong-thap-rdb-other')->firstOrFail())->create([
        'user_id' => $other->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->clear();

    $this->actingAs($other)
        ->post(route('shelves.profile.loans.renew', ['shelf' => $shelf->slug, 'loan' => $loan->id]))
        ->assertSessionHasErrors(['rule' => 'Lượt mượn này đã được xử lý.']);
    expect($loan->fresh()->renewals_used)->toBe(0);
});

it('a guest is redirected to login', function () {
    [$shelf] = rdbFix(slug: 'dong-thap-rdb-guest');
    $this->get(route('shelves.profile.overview', ['shelf' => $shelf->slug]))
        ->assertRedirect(route('login'));
});
