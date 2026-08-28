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
