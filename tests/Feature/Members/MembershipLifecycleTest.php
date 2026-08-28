<?php

use App\Actions\Members\ApproveMembership;
use App\Actions\Members\MarkMembershipLeft;
use App\Actions\Members\ReactivateMembership;
use App\Actions\Members\RejectMembership;
use App\Actions\Members\SuspendMembership;
use App\Enums\MembershipStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;

afterEach(fn () => Carbon::setTestNow());

/** @return array{Bookshelf, User, Membership} shelf, manager, a membership in $status */
function lcFixture(string $status = 'pending', string $actorRole = 'manager'): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $actor = User::factory()->create();
    $actorMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $actor->id, 'role' => $actorRole, 'status' => 'active',
    ]);
    $subject = Membership::factory()->for($shelf)->create(['status' => $status]);
    app(TenantContext::class)->set($shelf, $actorMembership);
    test()->actingAs($actor);

    return [$shelf, $actor, $subject];
}

it('approving a pending application records who approved it, and when', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 03:00:00', 'UTC'));
    [, $actor, $subject] = lcFixture();

    app(ApproveMembership::class)->execute($actor, $subject);

    $fresh = $subject->fresh();
    expect($fresh->status)->toBe(MembershipStatus::Active)
        ->and($fresh->approved_by)->toBe($actor->id)
        ->and($fresh->approved_at->toDateTimeString())->toBe('2026-08-28 03:00:00');
});

it('approving clears any stale suspension_reason left on the row, defensively', function () {
    [, $actor, $subject] = lcFixture();
    $subject->update(['suspension_reason' => 'còn sót lại', 'rejection_reason' => 'cũ']);

    app(ApproveMembership::class)->execute($actor, $subject);

    $fresh = $subject->fresh();
    expect($fresh->suspension_reason)->toBeNull()
        ->and($fresh->rejection_reason)->toBeNull();
});

it('approving twice says the application was already dealt with', function () {
    [, $actor, $subject] = lcFixture();
    app(ApproveMembership::class)->execute($actor, $subject);

    expect(fn () => app(ApproveMembership::class)->execute($actor, $subject))
        ->toThrow(RuleViolated::class, 'registration_not_pending');
});

it('IMPORTANT 3: approving a suspended membership is refused, not a silent un-suspend', function () {
    [, $actor, $subject] = lcFixture('suspended');

    expect(fn () => app(ApproveMembership::class)->execute($actor, $subject))
        ->toThrow(RuleViolated::class, 'registration_not_pending');
});

it('rejecting keeps the record and its reason, so the person may re-apply', function () {
    [, $actor, $subject] = lcFixture();

    app(RejectMembership::class)->execute($actor, $subject, 'Chưa gặp được gia đình');

    $fresh = $subject->fresh();
    expect($fresh->status)->toBe(MembershipStatus::Rejected)
        ->and($fresh->rejection_reason)->toBe('Chưa gặp được gia đình')
        ->and($fresh->deleted_at)->toBeNull();
});

it('a rejection with no reason is refused before the constraint sees it', function () {
    [, $actor, $subject] = lcFixture();

    expect(fn () => app(RejectMembership::class)->execute($actor, $subject, '   '))
        ->toThrow(RuleViolated::class, 'reject_reason_required');
});

it('only a pending application can be rejected, not an active membership', function () {
    [, $actor, $subject] = lcFixture('active');

    expect(fn () => app(RejectMembership::class)->execute($actor, $subject, 'Bất kỳ lý do nào'))
        ->toThrow(RuleViolated::class, 'registration_not_pending');
});

it('suspending records the reason, and only an active membership may be suspended', function () {
    [, $actor, $subject] = lcFixture('active');

    app(SuspendMembership::class)->execute($actor, $subject, 'Mượn quá lâu không trả');
    expect($subject->fresh()->status)->toBe(MembershipStatus::Suspended)
        ->and($subject->fresh()->suspension_reason)->toBe('Mượn quá lâu không trả');
});

it('a pending membership cannot be suspended', function () {
    [, $actor, $subject] = lcFixture('pending');

    expect(fn () => app(SuspendMembership::class)->execute($actor, $subject, null))
        ->toThrow(RuleViolated::class, 'not_active_cannot_suspend');
});

it('a suspension reason is optional — OPS §4.3 marks it so', function () {
    [, $actor, $subject] = lcFixture('active');

    app(SuspendMembership::class)->execute($actor, $subject, '   ');

    expect($subject->fresh()->suspension_reason)->toBeNull();
});

it('reactivating clears the suspension reason, and needs a suspended member', function () {
    [, $actor, $subject] = lcFixture('suspended');
    $subject->update(['suspension_reason' => 'Lý do cũ']);

    app(ReactivateMembership::class)->execute($actor, $subject);
    expect($subject->fresh()->status)->toBe(MembershipStatus::Active)
        ->and($subject->fresh()->suspension_reason)->toBeNull();

    expect(fn () => app(ReactivateMembership::class)->execute($actor, $subject->fresh()))
        ->toThrow(RuleViolated::class, 'not_suspended_cannot_reactivate');
});

it('a member with no books out may be marked left, from any status — twice, idempotently', function () {
    [, $actor, $subject] = lcFixture('pending');

    app(MarkMembershipLeft::class)->execute($actor, $subject);
    expect($subject->fresh()->status)->toBe(MembershipStatus::Left);

    // OPS §4.3's "Any status → left", read literally (M6): a re-click
    // changes nothing and refuses nothing.
    app(MarkMembershipLeft::class)->execute($actor, $subject->fresh());
    expect($subject->fresh()->status)->toBe(MembershipStatus::Left);
});

it('a member still holding a book cannot simply leave with it', function () {
    [$shelf, $actor, $subject] = lcFixture('active');
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn', 'slug' => 'de-men']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $subject->user_id, 'lent_by' => $actor->id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);

    expect(fn () => app(MarkMembershipLeft::class)->execute($actor, $subject))
        ->toThrow(RuleViolated::class, 'member_has_active_loans');
});

it('a returned loan does not keep a member from leaving', function () {
    [$shelf, $actor, $subject] = lcFixture('active');
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn', 'slug' => 'de-men']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $subject->user_id, 'lent_by' => $actor->id,
        'due_on' => '2026-09-11', 'status' => 'returned', 'return_condition' => 'perfect',
    ]);

    app(MarkMembershipLeft::class)->execute($actor, $subject);

    expect($subject->fresh()->status)->toBe(MembershipStatus::Left);
});

it('INV-8: each transition writes one audit entry naming before and after', function () {
    [, $actor, $subject] = lcFixture();

    app(ApproveMembership::class)->execute($actor, $subject);
    app(SuspendMembership::class)->execute($actor, $subject->fresh(), 'Lý do');
    app(ReactivateMembership::class)->execute($actor, $subject->fresh());
    app(MarkMembershipLeft::class)->execute($actor, $subject->fresh());

    $actions = AuditLog::query()->orderBy('occurred_at')->pluck('action')->all();
    expect($actions)->toBe(['membership.approved', 'membership.suspended', 'membership.reactivated', 'membership.left']);

    $approved = AuditLog::query()->where('action', 'membership.approved')->firstOrFail();
    expect($approved->before['status'])->toBe('pending')
        ->and($approved->after['status'])->toBe('active')
        ->and($approved->actor_id)->toBe($actor->id)
        ->and($approved->entity_id)->toBe($subject->id);
});

it('INV-10: a manager of one shelf cannot touch another shelf\'s member', function () {
    // Both shelves built BEFORE the actor binds, so the foreign membership
    // exists; the lockForUpdate re-read under the bound scope is what 404s.
    $other = Bookshelf::factory()->create(['slug' => 'can-tho', 'settings' => []]);
    $foreign = Membership::factory()->for($other)->create(['status' => 'pending']);
    [, $actor] = lcFixture();

    expect(fn () => app(ApproveMembership::class)->execute($actor, $foreign))
        ->toThrow(ModelNotFoundException::class);
});

it('a reader cannot approve, reject, suspend, reactivate or mark left', function () {
    [, $actor, $subject] = lcFixture('pending', 'reader');

    expect(fn () => app(ApproveMembership::class)->execute($actor, $subject))
        ->toThrow(AuthorizationException::class)
        ->and(fn () => app(RejectMembership::class)->execute($actor, $subject, 'x'))
        ->toThrow(AuthorizationException::class)
        ->and(fn () => app(SuspendMembership::class)->execute($actor, $subject, null))
        ->toThrow(AuthorizationException::class)
        ->and(fn () => app(ReactivateMembership::class)->execute($actor, $subject))
        ->toThrow(AuthorizationException::class)
        ->and(fn () => app(MarkMembershipLeft::class)->execute($actor, $subject))
        ->toThrow(AuthorizationException::class);
});

it('each command takes the locking re-read as the first statement of its transaction', function () {
    [, $actor, $subject] = lcFixture('active');

    DB::enableQueryLog();
    app(SuspendMembership::class)->execute($actor, $subject, 'vì lý do');
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect($log)->not->toBe([])
        ->and(str_contains($log[0]['query'], 'memberships'))->toBeTrue('first query is not on memberships: '.$log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue('first query is not FOR UPDATE: '.$log[0]['query']);
});
