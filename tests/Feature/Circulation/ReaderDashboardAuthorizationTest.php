<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;

/**
 * BR §5.4's anti-enumeration rule, exercised against the three routes Task
 * 13 adds: a guest redirects to login (not authenticated yet, not
 * refused), and every other refusal is a 404, never a 403 — a signed-in
 * stranger, a member of a DIFFERENT shelf, and a suspended member of THIS
 * shelf must all see the identical nothing a wrong slug shows.
 *
 * Each actor gets its own it() — the acting user persists across calls
 * within a single test method (a reviewer's own authorization matrix was
 * contaminated by exactly that trap and had to be re-run with an explicit
 * logout), so mixing actors inside one test would silently pass on a
 * cached session rather than a fresh unauthenticated/unauthorized request.
 */
function rdaFix(string $slug = 'dong-thap-rda'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);

    $activeReader = User::factory()->create(['full_name' => 'Anna Đọc Đàng Hoàng']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $activeReader->id, 'role' => 'reader', 'status' => 'active',
    ]);

    $suspendedReader = User::factory()->create(['full_name' => 'Phêrô Bị Khoá Thẻ']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $suspendedReader->id, 'role' => 'reader', 'status' => 'suspended',
        'suspension_reason' => 'Thử nghiệm',
    ]);

    $otherShelf = Bookshelf::factory()->create(['slug' => $slug.'-other', 'settings' => []]);
    $otherShelfReader = User::factory()->create(['full_name' => 'Gioan Tủ Sách Khác']);
    Membership::factory()->for($otherShelf)->create([
        'user_id' => $otherShelfReader->id, 'role' => 'reader', 'status' => 'active',
    ]);

    app(TenantContext::class)->clear();

    return [$shelf, $activeReader, $suspendedReader, $otherShelfReader];
}

// ── overview ─────────────────────────────────────────────────────────────

it('overview: a guest is redirected to login', function () {
    [$shelf] = rdaFix('rda-ov-guest');
    $this->get(route('shelves.profile.overview', ['shelf' => $shelf->slug]))
        ->assertRedirect(route('login'));
});

it('overview: a signed-in member of a DIFFERENT shelf 404s — never 403', function () {
    [$shelf, , , $otherShelfReader] = rdaFix('rda-ov-other');
    $this->actingAs($otherShelfReader)
        ->get(route('shelves.profile.overview', ['shelf' => $shelf->slug]))
        ->assertNotFound();
});

it('overview: a suspended member of THIS shelf 404s — never 403', function () {
    [$shelf, , $suspendedReader] = rdaFix('rda-ov-susp');
    $this->actingAs($suspendedReader)
        ->get(route('shelves.profile.overview', ['shelf' => $shelf->slug]))
        ->assertNotFound();
});

it('overview: an active reader of this shelf sees it', function () {
    [$shelf, $activeReader] = rdaFix('rda-ov-ok');
    $this->actingAs($activeReader)
        ->get(route('shelves.profile.overview', ['shelf' => $shelf->slug]))
        ->assertOk();
});

// ── history ──────────────────────────────────────────────────────────────

it('history: a guest is redirected to login', function () {
    [$shelf] = rdaFix('rda-hi-guest');
    $this->get(route('shelves.profile.history', ['shelf' => $shelf->slug]))
        ->assertRedirect(route('login'));
});

it('history: a signed-in member of a DIFFERENT shelf 404s — never 403', function () {
    [$shelf, , , $otherShelfReader] = rdaFix('rda-hi-other');
    $this->actingAs($otherShelfReader)
        ->get(route('shelves.profile.history', ['shelf' => $shelf->slug]))
        ->assertNotFound();
});

it('history: a suspended member of THIS shelf 404s — never 403', function () {
    [$shelf, , $suspendedReader] = rdaFix('rda-hi-susp');
    $this->actingAs($suspendedReader)
        ->get(route('shelves.profile.history', ['shelf' => $shelf->slug]))
        ->assertNotFound();
});

// ── renew ────────────────────────────────────────────────────────────────

it('renew: a guest is redirected to login', function () {
    [$shelf, $activeReader] = rdaFix('rda-re-guest');
    $loan = renewFixLoan($shelf, $activeReader);
    $this->post(route('shelves.profile.loans.renew', ['shelf' => $shelf->slug, 'loan' => $loan->id]))
        ->assertRedirect(route('login'));
});

it('renew: a signed-in member of a DIFFERENT shelf 404s — never 403', function () {
    [$shelf, $activeReader, , $otherShelfReader] = rdaFix('rda-re-other');
    $loan = renewFixLoan($shelf, $activeReader);
    $this->actingAs($otherShelfReader)
        ->post(route('shelves.profile.loans.renew', ['shelf' => $shelf->slug, 'loan' => $loan->id]))
        ->assertNotFound();
});

it('renew: a suspended member of THIS shelf 404s — never 403', function () {
    [$shelf, $activeReader, $suspendedReader] = rdaFix('rda-re-susp');
    $loan = renewFixLoan($shelf, $activeReader);
    $this->actingAs($suspendedReader)
        ->post(route('shelves.profile.loans.renew', ['shelf' => $shelf->slug, 'loan' => $loan->id]))
        ->assertNotFound();
    expect($loan->fresh()->renewals_used)->toBe(0);
});

/** A minimal active loan under $shelf, borrowed by $borrower, for the renew-route matrix. */
function renewFixLoan(Bookshelf $shelf, User $borrower): Loan
{
    app(TenantContext::class)->actSystemWide();
    $manager = User::factory()->create();
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'htb-'.$shelf->slug]);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'RD-0001', 'state' => 'on_loan']);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $borrower->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    app(TenantContext::class)->clear();

    return $loan;
}
