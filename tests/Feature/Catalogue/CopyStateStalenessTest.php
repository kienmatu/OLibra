<?php

use App\Actions\Catalogue\AssessCondition;
use App\Actions\Catalogue\CreateBook;
use App\Actions\Catalogue\MarkCopyFound;
use App\Actions\Catalogue\ReportCopyLost;
use App\Actions\Catalogue\RetireCopy;
use App\Enums\CopyCondition;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Category;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

// These four tests are the whole-branch review's probe, made permanent.
// Each binds a copy in one state, then changes the COMMITTED row underneath
// it through a second, independent query — never through the bound $copy
// object — so the bound instance's in-memory ->state stays exactly as it
// was loaded. If an action reads that stale in-memory value instead of
// re-reading the row inside its own transaction, it either performs a
// transition the committed row actually forbids, or skips a refusal the
// committed row actually requires. Each assertion below is only true when
// the action re-reads the committed row.

function stalenessFixture(): array
{
    app(TenantContext::class)->clear();
    $shelf = Bookshelf::factory()->create(['settings' => []]);
    $user = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => 'manager', 'status' => 'active',
    ]);
    Category::query()->firstOrCreate(['slug' => 'truyen-thieu-nhi'], ['name' => 'Truyện thiếu nhi']);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($user);

    $book = app(CreateBook::class)->execute($user, [
        'title' => 'Dế Mèn Phiêu Lưu Ký', 'author' => 'Tô Hoài',
        'category_slug' => 'truyen-thieu-nhi', 'copy_count' => 1,
    ]);

    return [$user, $book->copies->first()];
}

/** Flips the COMMITTED row without touching the given model instance. */
function flipCommittedState(BookCopy $copy, string $state): void
{
    BookCopy::query()->whereKey($copy->id)->update(['state' => $state]);
}

it('RetireCopy checks the committed row, not the bound instance, against the transition table', function () {
    [$user, $copy] = stalenessFixture();
    expect($copy->state->value)->toBe('available');   // bound instance: available

    // Committed row moves to on_loan underneath the bound instance, with an
    // open loan — the exact probe from the review.
    flipCommittedState($copy, 'on_loan');
    $loan = Loan::query()->create([
        'copy_id' => $copy->id, 'book_id' => $copy->book_id,
        'borrower_id' => $user->id, 'lent_by' => $user->id,
        'due_on' => '2026-09-10', 'status' => 'active',
    ]);

    expect(fn () => app(RetireCopy::class)->execute($user, $copy, 'hỏng'))
        ->toThrow(RuleViolated::class, 'copy_on_loan');

    expect($copy->fresh()->state->value)->toBe('on_loan')
        ->and($loan->fresh()->status->value)->toBe('active');
});

it('ReportCopyLost checks the committed row, not the bound instance, against the transition table', function () {
    [$user, $copy] = stalenessFixture();
    flipCommittedState($copy, 'on_loan');
    $copy->refresh();   // bound instance now (honestly) reads on_loan
    expect($copy->state->value)->toBe('on_loan');

    // Committed row moves back to available underneath the bound instance
    // (e.g. the loan was returned through a different path meanwhile).
    flipCommittedState($copy, 'available');

    expect(fn () => app(ReportCopyLost::class)->execute($user, $copy))
        ->toThrow(RuleViolated::class, 'copy_not_on_loan');

    expect($copy->fresh()->state->value)->toBe('available');
});

it('MarkCopyFound checks the committed row, not the bound instance, against the lost-check and the transition table', function () {
    [$user, $copy] = stalenessFixture();
    flipCommittedState($copy, 'lost');
    $copy->refresh();   // bound instance now (honestly) reads lost
    expect($copy->state->value)->toBe('lost');

    // Committed row moves to on_loan underneath the bound instance — the
    // loan was never returned, only the earlier lost report was undone by
    // another operator.
    flipCommittedState($copy, 'on_loan');
    $loan = Loan::query()->create([
        'copy_id' => $copy->id, 'book_id' => $copy->book_id,
        'borrower_id' => $user->id, 'lent_by' => $user->id,
        'due_on' => '2026-09-10', 'status' => 'active',
    ]);

    expect(fn () => app(MarkCopyFound::class)->execute($user, $copy))
        ->toThrow(RuleViolated::class, 'not_lost');

    expect($copy->fresh()->state->value)->toBe('on_loan')
        ->and($loan->fresh()->status->value)->toBe('active');
});

it('AssessCondition audits the committed condition, not the bound instance\'s stale one', function () {
    [$user, $copy] = stalenessFixture();
    expect($copy->condition->value)->toBe('perfect');   // bound instance: perfect

    // Committed row's condition changes underneath the bound instance.
    BookCopy::query()->whereKey($copy->id)->update(['condition' => 'worn']);

    app(AssessCondition::class)->execute($user, $copy, CopyCondition::Torn, 'rách gáy');

    $entry = AuditLog::query()->where('action', 'copy.condition_assessed')->latest('id')->firstOrFail();
    expect($entry->before['condition'])->toBe('worn')
        ->and($copy->fresh()->condition->value)->toBe('torn');
});

// The four tests above pin that each action re-reads the committed row
// rather than trusting the bound instance — necessary, but blind to WHERE
// in the transaction that re-read happens. Under RefreshDatabase the outer
// test transaction is already open before the fixture runs, so each
// action's own DB::transaction is only a SAVEPOINT on the same connection:
// a read inserted above the lockForUpdate would still see the fixture's
// writes and would leave every test above green. Only a positional pin on
// the query log — the same idiom as CreateBookTest, AddCopiesTest and
// BookLifecycleTest use for the bookshelf lock — can catch that ordering
// regression, because it does not depend on what the read sees, only on
// when it runs.

it('RetireCopy takes the copy-row lock BEFORE any read — the first query of the transaction', function () {
    [$user, $copy] = stalenessFixture();
    DB::enableQueryLog();

    app(RetireCopy::class)->execute($user, $copy, 'hỏng');

    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect($log)->not->toBe([])
        ->and(str_contains($log[0]['query'], 'book_copies'))->toBeTrue('first query is not on book_copies: '.$log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue('first query is not FOR UPDATE: '.$log[0]['query']);
});

it('ReportCopyLost takes the copy-row lock BEFORE any read — the first query of the transaction', function () {
    [$user, $copy] = stalenessFixture();
    flipCommittedState($copy, 'on_loan');
    $copy->refresh();
    Loan::query()->create([
        'copy_id' => $copy->id, 'book_id' => $copy->book_id,
        'borrower_id' => $user->id, 'lent_by' => $user->id,
        'due_on' => '2026-09-10', 'status' => 'active',
    ]);
    DB::enableQueryLog();

    app(ReportCopyLost::class)->execute($user, $copy);

    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect($log)->not->toBe([])
        ->and(str_contains($log[0]['query'], 'book_copies'))->toBeTrue('first query is not on book_copies: '.$log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue('first query is not FOR UPDATE: '.$log[0]['query']);
});

it('MarkCopyFound takes the copy-row lock BEFORE any read — the first query of the transaction', function () {
    [$user, $copy] = stalenessFixture();
    flipCommittedState($copy, 'lost');
    $copy->refresh();
    DB::enableQueryLog();

    app(MarkCopyFound::class)->execute($user, $copy);

    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect($log)->not->toBe([])
        ->and(str_contains($log[0]['query'], 'book_copies'))->toBeTrue('first query is not on book_copies: '.$log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue('first query is not FOR UPDATE: '.$log[0]['query']);
});

it('AssessCondition takes the copy-row lock BEFORE any read — the first query of the transaction', function () {
    [$user, $copy] = stalenessFixture();
    DB::enableQueryLog();

    app(AssessCondition::class)->execute($user, $copy, CopyCondition::Torn, 'rách gáy');

    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect($log)->not->toBe([])
        ->and(str_contains($log[0]['query'], 'book_copies'))->toBeTrue('first query is not on book_copies: '.$log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue('first query is not FOR UPDATE: '.$log[0]['query']);
});
