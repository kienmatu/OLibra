<?php

use App\Actions\Catalogue\AssessCondition;
use App\Actions\Catalogue\CreateBook;
use App\Actions\Catalogue\MarkCopyFound;
use App\Actions\Catalogue\ReportCopyLost;
use App\Actions\Catalogue\RetireCopy;
use App\Enums\CopyCondition;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Category;
use App\Models\ConditionAssessment;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Auth\Access\AuthorizationException;

afterEach(fn () => Carbon::setTestNow());

function copyStateFixture(string $role = 'manager'): array
{
    // Built to be callable twice in one test ('a lost copy may be written
    // off' does): unbind any earlier tenant first (a bound shelf refuses a
    // foreign membership create), take the factory's own random slug (a
    // fixed one trips bookshelves_slug_unique on the second build), and
    // firstOrCreate the category (its slug unique is plain).
    app(TenantContext::class)->clear();
    $shelf = Bookshelf::factory()->create(['settings' => []]);
    $user = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => $role, 'status' => 'active',
    ]);
    Category::query()->firstOrCreate(['slug' => 'truyen-thieu-nhi'], ['name' => 'Truyện thiếu nhi']);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($user);

    $book = app(CreateBook::class)->execute($user, [
        'title' => 'Dế Mèn Phiêu Lưu Ký', 'author' => 'Tô Hoài',
        'category_slug' => 'truyen-thieu-nhi', 'copy_count' => 1,
    ]);

    return [$shelf, $user, $book, $book->copies->first()];
}

function copyStateLoanFor($copy, User $borrower): Loan
{
    return Loan::query()->create([
        'copy_id' => $copy->id, 'book_id' => $copy->book_id,
        'borrower_id' => $borrower->id, 'lent_by' => $borrower->id,
        'due_on' => '2026-09-10', 'status' => 'active',
    ]);
}

it('a manager may assess a copy at any time, and history plus current judgement both move', function () {
    [, $user, , $copy] = copyStateFixture();

    $assessment = app(AssessCondition::class)->execute($user, $copy, CopyCondition::Torn, 'rách gáy');

    expect($assessment->loan_id)->toBeNull()
        ->and($assessment->assessed_by)->toBe($user->id)
        ->and($copy->fresh()->condition)->toBe(CopyCondition::Torn)
        ->and($copy->fresh()->condition_note)->toBe('rách gáy')
        ->and($copy->fresh()->state->value)->toBe('available');   // a condition is not a state

    $entry = AuditLog::query()->where('action', 'copy.condition_assessed')->firstOrFail();
    expect($entry->before['condition'])->toBe('perfect')
        ->and($entry->after['condition'])->toBe('torn');
});

it('assessments accumulate — BR §11: never deleted, a table not a column', function () {
    [, $user, , $copy] = copyStateFixture();

    app(AssessCondition::class)->execute($user, $copy, CopyCondition::Worn);
    app(AssessCondition::class)->execute($user, $copy, CopyCondition::Torn);

    expect(ConditionAssessment::query()->where('copy_id', $copy->id)->count())->toBe(2);
});

it('retiring records the reason the CHECK constraint requires', function () {
    [, $user, , $copy] = copyStateFixture();
    Carbon::setTestNow(Carbon::parse('2026-08-27 07:00:00', 'UTC'));

    app(RetireCopy::class)->execute($user, $copy, '  mất trang quá nhiều  ');

    $fresh = $copy->fresh();
    expect($fresh->state->value)->toBe('retired')
        ->and($fresh->retired_reason)->toBe('mất trang quá nhiều')
        ->and($fresh->retired_at->toDateTimeString())->toBe('2026-08-27 07:00:00');

    $entry = AuditLog::query()->where('action', 'copy.retired')->firstOrFail();
    expect($entry->before['state'])->toBe('available')
        ->and($entry->after['reason'])->toBe('mất trang quá nhiều');
});

it('retiring with no reason is a named failure, not a check-constraint violation', function () {
    [, $user, , $copy] = copyStateFixture();

    expect(fn () => app(RetireCopy::class)->execute($user, $copy, '   '))
        ->toThrow(RuleViolated::class, 'retire_reason_required');

    expect($copy->fresh()->state->value)->toBe('available');
});

it('a copy on loan cannot be retired, and is told what to do instead', function () {
    [, $user, , $copy] = copyStateFixture();
    $copy->update(['state' => 'on_loan']);

    expect(fn () => app(RetireCopy::class)->execute($user, $copy, 'hỏng'))
        ->toThrow(RuleViolated::class, 'copy_on_loan');
});

it('a lost copy may be written off; a held one may not', function () {
    [, $user, , $copy] = copyStateFixture();

    $copy->update(['state' => 'lost']);
    app(RetireCopy::class)->execute($user, $copy, 'không tìm lại được');
    expect($copy->fresh()->state->value)->toBe('retired');

    [, $user2, , $copy2] = copyStateFixture();
    $copy2->update(['state' => 'held']);
    expect(fn () => app(RetireCopy::class)->execute($user2, $copy2, 'x'))
        ->toThrow(RuleViolated::class, 'copy_not_available');
});

it('reporting an on-loan copy lost closes its loan in the same transaction, with two audit entries', function () {
    [, $user, , $copy] = copyStateFixture();
    $copy->update(['state' => 'on_loan']);
    $loan = copyStateLoanFor($copy, $user);
    Carbon::setTestNow(Carbon::parse('2026-08-27 08:00:00', 'UTC'));

    app(ReportCopyLost::class)->execute($user, $copy, 'em bảo để quên trên xe buýt');

    $freshCopy = $copy->fresh();
    $freshLoan = $loan->fresh();
    expect($freshCopy->state->value)->toBe('lost')
        ->and($freshCopy->lost_reported_at->toDateTimeString())->toBe('2026-08-27 08:00:00')
        ->and($freshLoan->status->value)->toBe('lost')
        ->and($freshLoan->lost_reported_by)->toBe($user->id);

    expect(AuditLog::query()->where('action', 'copy.lost_reported')->count())->toBe(1)
        ->and(AuditLog::query()->where('action', 'loan.lost')->count())->toBe(1);

    $copyEntry = AuditLog::query()->where('action', 'copy.lost_reported')->firstOrFail();
    expect($copyEntry->after['note'])->toBe('em bảo để quên trên xe buýt');
});

it('Q3: an available copy cannot be reported lost', function () {
    [, $user, , $copy] = copyStateFixture();

    expect(fn () => app(ReportCopyLost::class)->execute($user, $copy))
        ->toThrow(RuleViolated::class, 'copy_not_on_loan');
});

it('an already-lost or already-retired copy says which, not just no', function () {
    [, $user, , $copy] = copyStateFixture();

    $copy->update(['state' => 'lost']);
    expect(fn () => app(ReportCopyLost::class)->execute($user, $copy))
        ->toThrow(RuleViolated::class, 'already_lost');

    $copy->update(['state' => 'retired', 'retired_reason' => 'x']);
    expect(fn () => app(ReportCopyLost::class)->execute($user, $copy))
        ->toThrow(RuleViolated::class, 'already_retired');
});

it('a lost copy that turns up goes back to available, and its loan is not reopened', function () {
    [, $user, , $copy] = copyStateFixture();
    $copy->update(['state' => 'on_loan']);
    $loan = copyStateLoanFor($copy, $user);
    app(ReportCopyLost::class)->execute($user, $copy);

    app(MarkCopyFound::class)->execute($user, $copy, 'tìm thấy sau ghế nhà thờ');

    $freshCopy = $copy->fresh();
    expect($freshCopy->state->value)->toBe('available')
        ->and($freshCopy->lost_reported_at)->toBeNull()
        ->and($loan->fresh()->status->value)->toBe('lost');   // history stays

    $entry = AuditLog::query()->where('action', 'copy.found')->firstOrFail();
    expect($entry->before['state'])->toBe('lost')
        ->and($entry->after['note'])->toBe('tìm thấy sau ghế nhà thờ');
});

it('marking a copy found when it is not lost says so', function () {
    [, $user, , $copy] = copyStateFixture();

    expect(fn () => app(MarkCopyFound::class)->execute($user, $copy))
        ->toThrow(RuleViolated::class, 'not_lost');

    $copy->update(['state' => 'on_loan']);
    expect(fn () => app(MarkCopyFound::class)->execute($user, $copy))
        ->toThrow(RuleViolated::class, 'not_lost');
});

it('a reader may not touch any of the four', function () {
    [$shelf, $manager, , $copy] = copyStateFixture();
    app(TenantContext::class)->clear();
    $reader = User::factory()->create();
    $readerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $readerMembership);
    test()->actingAs($reader);

    expect(fn () => app(AssessCondition::class)->execute($reader, $copy, CopyCondition::Worn))
        ->toThrow(AuthorizationException::class);
    expect(fn () => app(RetireCopy::class)->execute($reader, $copy, 'x'))
        ->toThrow(AuthorizationException::class);
    expect(fn () => app(ReportCopyLost::class)->execute($reader, $copy))
        ->toThrow(AuthorizationException::class);
    expect(fn () => app(MarkCopyFound::class)->execute($reader, $copy))
        ->toThrow(AuthorizationException::class);
});
