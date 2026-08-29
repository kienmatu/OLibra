<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Gate;

/**
 * @return array{Bookshelf, User, User, Loan} shelf, manager, reader, the reader's active loan
 */
function lpFix(string $actorRole = 'manager'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['settings' => []]);
    $actor = User::factory()->create();
    $actorMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $actor->id, 'role' => $actorRole, 'status' => 'active',
    ]);
    $reader = User::factory()->create();
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be',
    ]);
    $copy = BookCopy::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'on_loan',
    ]);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $reader->id, 'lent_by' => $actor->id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $actorMembership);

    return [$shelf, $actor, $reader, $loan];
}

it('a manager may lend, receive and void; a reader may not', function () {
    [, $manager, , $loan] = lpFix('manager');
    expect(Gate::forUser($manager)->allows('lend', $loan))->toBeTrue()
        ->and(Gate::forUser($manager)->allows('receiveReturn', $loan))->toBeTrue()
        ->and(Gate::forUser($manager)->allows('void', $loan))->toBeTrue();
});

it('a reader is refused the manager abilities', function () {
    [, $reader, , $loan] = lpFix('reader');
    expect(Gate::forUser($reader)->allows('lend', $loan))->toBeFalse()
        ->and(Gate::forUser($reader)->allows('receiveReturn', $loan))->toBeFalse()
        ->and(Gate::forUser($reader)->allows('void', $loan))->toBeFalse();
});

it('renew asks only for a reader membership — ownership is the Action\'s question', function () {
    // The policy answering "is this MY loan" would 403 a guessed loan id
    // where the command's loan_not_active (rendered as a refusal sentence,
    // not an existence oracle) is the specified shape — OPS §4.2 lists no
    // loan_not_found and the reference folds all three cases into one code.
    [, $actor, , $loan] = lpFix('reader');
    expect(Gate::forUser($actor)->allows('renew', $loan))->toBeTrue();
});

/**
 * Four negative branches for 'renew' specifically — not the shared
 * act-as-reader gate (GateTest.php already covers that closure
 * exhaustively). LoanPolicy::renew()'s BODY is what needs falsifying:
 * replacing it with `return true;` leaves the whole suite green unless
 * something asserts a DENY through this exact ability.
 */
it('a guest with the tenant context entirely unset may not renew', function () {
    [, , , $loan] = lpFix();
    $guest = User::factory()->create();
    // Entirely unset, not merely null-membership — mirrors GateTest's
    // "grants nothing when the tenant context is entirely unset", for the
    // renew ability specifically rather than the shared gate directly.
    app(TenantContext::class)->clear();

    expect(Gate::forUser($guest)->allows('renew', $loan))->toBeFalse();
});

it('a non-member of this shelf (membership resolved to null) may not renew', function () {
    [$shelf, , , $loan] = lpFix();
    $nonMember = User::factory()->create();
    app(TenantContext::class)->set($shelf, null);

    expect(Gate::forUser($nonMember)->allows('renew', $loan))->toBeFalse();
});

it('a membership belonging to a different user may not authorize this actor to renew', function () {
    [$shelf, , , $loan] = lpFix();
    $owner = User::factory()->create();
    $ownerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $owner->id, 'role' => 'admin', 'status' => 'active',
    ]);
    $stranger = User::factory()->create();
    app(TenantContext::class)->set($shelf, $ownerMembership);

    expect(Gate::forUser($stranger)->allows('renew', $loan))->toBeFalse();
});

it('a soft-deleted membership may not renew', function () {
    [$shelf, , , $loan] = lpFix();
    $reader = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $membership->delete();
    expect($membership->trashed())->toBeTrue();
    app(TenantContext::class)->set($shelf, $membership);

    expect(Gate::forUser($reader)->allows('renew', $loan))->toBeFalse();
});

it('Bookshelf::loans() is shelf-local — the relation the {loan} binding resolves through', function () {
    // Review fix: the draft called this "…and 404s a foreign loan" while
    // making no HTTP request at all. The 404 itself is asserted over HTTP
    // in QuickLendScreensTest / ReturnScreensTest / VoidLoanScreenTest,
    // where scopeBindings() is actually in play. This block pins only the
    // relation those bindings need to exist.
    [$shelfA] = lpFix();
    expect($shelfA->loans()->count())->toBe(1);

    // Second shelf, colliding data — the actSystemWide() template.
    app(TenantContext::class)->actSystemWide();
    $shelfB = Bookshelf::factory()->create(['settings' => []]);
    expect($shelfB->loans()->count())->toBe(0);
});
