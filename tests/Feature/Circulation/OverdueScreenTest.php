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

/** @return array{Bookshelf, User} */
function ovdFix(string $slug = 'dong-thap-ovd'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Nhắc Trả Sách']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Giuse Quên Trả Sách', 'phone' => '0912999888']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Totto-chan Bên Cửa Sổ', 'slug' => 'ttc-ovd']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0701', 'state' => 'on_loan']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $reader->id, 'lent_by' => $manager->id,
        'due_on' => '2026-08-01', 'status' => 'active',
    ]);
    app(TenantContext::class)->clear();

    return [$shelf, $manager];
}

it('lists overdue loans with days late and the borrower\'s phone', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 03:00:00', 'UTC'));
    [$shelf, $manager] = ovdFix();

    $this->actingAs($manager)
        ->get(route('shelves.manage.overdue', ['shelf' => $shelf->slug]))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/overdue')
            ->count('loans', 1)
            ->where('loans.0.daysLate', 27)
            ->where('loans.0.borrowerPhone', '0912999888')
            ->where('sort', 'most-late'));
    Carbon::setTestNow();
});

/**
 * Fix round (minor 6d): the only existing test pinned the DEFAULT sort
 * (`most-late`, the fallback when `?sort=` is absent/invalid) — nothing
 * proved the query string was read at all. A controller that ignored
 * `$request` entirely and always called `$overdue->run('most-late')`
 * would have passed every test in this file before this one existed.
 * This creates two overdue loans that sort differently under each of the
 * three modes and asserts the FIRST row actually changes per mode.
 */
it('threads ?sort= through to OverdueLoansQuery — each mode actually reorders the rows', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 03:00:00', 'UTC'));
    [$shelf, $manager] = ovdFix(slug: 'dong-thap-ovd-sort');

    app(TenantContext::class)->actSystemWide();
    // Alphabetically first (folded), and the LEAST overdue of the two —
    // due_on is later (closer to "today") than ovdFix's own loan.
    $secondReader = User::factory()->create(['full_name' => 'Anna Đợi Sách', 'phone' => '0911000111']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $secondReader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'dm-ovd-sort']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0702', 'state' => 'on_loan']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $secondReader->id, 'lent_by' => $manager->id,
        'due_on' => '2026-08-20', 'status' => 'active',
    ]);
    app(TenantContext::class)->clear();

    // most-late (default): earliest due_on first -> Giuse's loan (due 08-01).
    $this->actingAs($manager)
        ->get(route('shelves.manage.overdue', ['shelf' => $shelf->slug]))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('sort', 'most-late')
            ->count('loans', 2)
            ->where('loans.0.borrowerName', 'Giuse Quên Trả Sách'));

    // least-late: reversed -> Anna's loan (due 08-20, closer to today) first.
    $this->actingAs($manager)
        ->get(route('shelves.manage.overdue', ['shelf' => $shelf->slug, 'sort' => 'least-late']))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('sort', 'least-late')
            ->where('loans.0.borrowerName', 'Anna Đợi Sách'));

    // borrower: alphabetical by folded name -> Anna before Giuse.
    $this->actingAs($manager)
        ->get(route('shelves.manage.overdue', ['shelf' => $shelf->slug, 'sort' => 'borrower']))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('sort', 'borrower')
            ->where('loans.0.borrowerName', 'Anna Đợi Sách'));

    Carbon::setTestNow();
});

it('a guest is redirected to login', function () {
    // Its own it() block, and named only for what it asserts (review fix:
    // the draft title claimed "a reader 404s" and never checked one). The
    // reader case is the block below — separate, because SessionGuard
    // caches the actingAs user for the rest of a method.
    [$shelf] = ovdFix(slug: 'dong-thap-ovd-guest');
    $this->get(route('shelves.manage.overdue', ['shelf' => $shelf->slug]))
        ->assertRedirect(route('login'));
});

it('a reader 404s on the overdue screen — 404, never 403 (BR §5.4)', function () {
    [$shelf] = ovdFix(slug: 'dong-thap-ovd-reader');
    $reader = User::query()->where('full_name', 'Giuse Quên Trả Sách')->firstOrFail();

    $this->actingAs($reader)
        ->get(route('shelves.manage.overdue', ['shelf' => $shelf->slug]))
        ->assertNotFound();
});
