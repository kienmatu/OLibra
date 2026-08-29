<?php

use App\Enums\CopyState;
use App\Enums\LoanStatus;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\ConditionAssessment;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/** @return array{Bookshelf, User, Loan, BookCopy} */
function rtsFix(string $slug = 'dong-thap-rts'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Nhận Lại Sách']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Giuse Mang Sách Về']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'htb-rts']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0601', 'state' => 'on_loan']);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $reader->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    app(TenantContext::class)->clear();

    return [$shelf, $manager, $loan, $copy];
}

it('the returns screen lists matching active loans and marks the chosen one', function () {
    [$shelf, $manager, $loan] = rtsFix();

    $this->actingAs($manager)
        ->get(route('shelves.manage.returns', ['shelf' => $shelf->slug, 'q' => 'hoang tu', 'loan' => $loan->id]))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/returns/index')
            ->count('loans', 1)
            ->where('loans.0.copyCode', 'DT-0601')
            ->where('chosenLoanId', $loan->id));
});

it('posting the return closes the loan with the condition and flashes success', function () {
    [$shelf, $manager, $loan, $copy] = rtsFix(slug: 'dong-thap-rts-post');

    $this->actingAs($manager)
        ->post(route('shelves.manage.returns.store', ['shelf' => $shelf->slug, 'loan' => $loan->id]),
            ['condition' => 'torn', 'note' => 'rách bìa sau'])
        ->assertRedirect(route('shelves.manage.returns', ['shelf' => $shelf->slug]))
        ->assertSessionHas('success');

    expect($loan->fresh()->status)->toBe(LoanStatus::Returned)
        ->and($copy->fresh()->state)->toBe(CopyState::Available)
        ->and(ConditionAssessment::query()->where('loan_id', $loan->id)->exists())->toBeTrue();
});

it('a condition outside the six is refused by validation before the Action runs', function () {
    [$shelf, $manager, $loan] = rtsFix(slug: 'dong-thap-rts-badcond');

    $this->actingAs($manager)
        ->post(route('shelves.manage.returns.store', ['shelf' => $shelf->slug, 'loan' => $loan->id]),
            ['condition' => 'lost'])   // a copy STATE, deliberately absent from the condition list (BR §9)
        ->assertSessionHasErrors('condition');
    expect($loan->fresh()->status)->toBe(LoanStatus::Active);
});

it('a double submit comes back as errors.rule with the double-submit sentence', function () {
    [$shelf, $manager, $loan] = rtsFix(slug: 'dong-thap-rts-double');
    $this->actingAs($manager)
        ->post(route('shelves.manage.returns.store', ['shelf' => $shelf->slug, 'loan' => $loan->id]),
            ['condition' => 'perfect'])->assertSessionHas('success');

    $this->actingAs($manager)
        ->post(route('shelves.manage.returns.store', ['shelf' => $shelf->slug, 'loan' => $loan->id]),
            ['condition' => 'perfect'])
        ->assertSessionHasErrors(['rule' => 'Lượt mượn này đã được xử lý.']);
});

it('the lost screen shows the chosen loan and posts to the EXISTING report-lost route', function () {
    // OPS §4.2: choosing "Bạn đọc báo làm mất" does not call ReceiveReturn
    // at all — it switches to ReportCopyLost with the loan's copy already
    // identified. Same command, second entry point, contract unchanged.
    [$shelf, $manager, $loan, $copy] = rtsFix(slug: 'dong-thap-rts-lost');

    $this->actingAs($manager)
        ->get(route('shelves.manage.returns.lost', ['shelf' => $shelf->slug, 'q' => 'hoang tu', 'loan' => $loan->id]))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/returns/lost')
            ->where('chosen.loanId', $loan->id)
            ->where('chosen.copyId', $copy->id)
            ->where('chosen.copyCode', 'DT-0601'));

    // The wired POST target closes the loan as lost, not returned.
    $this->actingAs($manager)
        ->post(route('shelves.manage.copies.report-lost', ['shelf' => $shelf->slug, 'bookCopy' => $copy->id]),
            ['note' => 'bạn đọc báo làm mất']);

    expect($loan->fresh()->status)->toBe(LoanStatus::Lost)
        ->and($copy->fresh()->state)->toBe(CopyState::Lost);
});

it('a foreign loan id 404s on the return POST', function () {
    [$shelf, $manager] = rtsFix(slug: 'dong-thap-rts-foreign');
    [, , $foreignLoan] = rtsFix(slug: 'can-tho-rts');

    $this->actingAs($manager)
        ->post(route('shelves.manage.returns.store', ['shelf' => $shelf->slug, 'loan' => $foreignLoan->id]),
            ['condition' => 'perfect'])
        ->assertNotFound();
    expect($foreignLoan->fresh()->status)->toBe(LoanStatus::Active);
});

it('a guest is redirected to login', function () {
    // Review fix: the draft title said "and a reader 404s" and asserted no
    // such thing. Two blocks, each named for what it checks.
    [$shelf] = rtsFix(slug: 'dong-thap-rts-guest');
    $this->get(route('shelves.manage.returns', ['shelf' => $shelf->slug]))
        ->assertRedirect(route('login'));
});

it('a reader 404s on both return screens — 404, never 403 (BR §5.4)', function () {
    [$shelf, , $loan] = rtsFix(slug: 'dong-thap-rts-reader');
    $reader = User::query()->findOrFail($loan->borrower_id);

    $this->actingAs($reader)
        ->get(route('shelves.manage.returns', ['shelf' => $shelf->slug]))
        ->assertNotFound();
    $this->actingAs($reader)
        ->get(route('shelves.manage.returns.lost', ['shelf' => $shelf->slug]))
        ->assertNotFound();
    $this->actingAs($reader)
        ->post(route('shelves.manage.returns.store', ['shelf' => $shelf->slug, 'loan' => $loan->id]),
            ['condition' => 'perfect'])
        ->assertNotFound();
    expect($loan->fresh()->status)->toBe(LoanStatus::Active);
});
