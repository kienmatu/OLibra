<?php

use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/** @return array{Bookshelf, User, Loan, BookCopy, Book} */
function vlsFix(string $slug = 'dong-thap-vls'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Bấm Nhầm Tay']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Anna Không Hề Mượn']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'drpn-vls']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0801', 'state' => 'on_loan']);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $reader->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    app(TenantContext::class)->clear();

    return [$shelf, $manager, $loan, $copy, $book];
}

it('the book detail hands the page each on-loan copy\'s activeLoanId', function () {
    [$shelf, $manager, $loan, , $book] = vlsFix();

    $this->actingAs($manager)
        ->get(route('shelves.manage.books.show', ['shelf' => $shelf->slug, 'book' => $book->slug]))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/books/show')
            ->where('detail.copies.0.activeLoanId', $loan->id));
});

it('voiding from the book page needs a reason, voids, and returns there', function () {
    [$shelf, $manager, $loan, $copy, $book] = vlsFix(slug: 'dong-thap-vls-post');

    $from = route('shelves.manage.books.show', ['shelf' => $shelf->slug, 'book' => $book->slug]);

    $this->actingAs($manager)->from($from)
        ->post(route('shelves.manage.loans.void', ['shelf' => $shelf->slug, 'loan' => $loan->id]), ['reason' => ''])
        ->assertSessionHasErrors('reason');

    $this->actingAs($manager)->from($from)
        ->post(route('shelves.manage.loans.void', ['shelf' => $shelf->slug, 'loan' => $loan->id]),
            ['reason' => 'Ghi nhầm bạn đọc'])
        ->assertRedirect($from);

    expect($loan->fresh()->status)->toBe(LoanStatus::Voided)
        ->and($copy->fresh()->state)->toBe(CopyState::Available)
        // Fix round (minor 5): the manager's own typed text must reach
        // loans.void_reason — the whole point of the surviving voided
        // row. A hard-coded literal swapped in for
        // $request->validated()['reason'] in LoanController::void()
        // would leave every other assertion in this file green; only
        // this line pins the actual submitted string.
        ->and($loan->fresh()->void_reason)->toBe('Ghi nhầm bạn đọc');
});
