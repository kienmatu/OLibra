<?php

use App\Actions\Community\DeclineDonation;
use App\Actions\Community\ReceiveDonation;
use App\Enums\DonationStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\BookDonation;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Queries\AuditLogQuery;
use App\Support\TenantContext;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;

/**
 * Shelf + manager + donor + one donation row in $status, bound as the
 * tenant with the manager signed in.
 *
 * BOTH OF THE MANAGER'S IDS ARE RETURNED, and that is what the first
 * block needs: book_donations carries donor_membership_id -> memberships
 * (id) and decided_by -> users(id), two 36-char uuid columns pointing at
 * two different tables, so an assertion that decided_by holds the right
 * SHAPE says nothing about which table it came from. Membership::factory()
 * mints its own uuid, so the manager's user id and their membership id are
 * unrelated and can never coincide.
 *
 * A `declined` fixture is seeded WITH a note, because the table refuses
 * one without: `CONSTRAINT book_donations_declined_has_reason CHECK
 * (status <> 'declined' or decision_note is not null)`, read off the live
 * table. Seeding a declined row with a null note is a 4025 in the fixture
 * rather than an assertion.
 *
 * Grep first: `grep -rn "^function dddFix" tests/` — top-level helpers are
 * process-global (AGENTS.md).
 *
 * @return array{Bookshelf, User, Membership, Membership, BookDonation}
 */
function dddFix(string $status = 'pending', string $slug = 'dong-thap-ddd'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);

    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);

    $donor = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    $donorMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $donor->id, 'role' => 'reader', 'status' => 'active',
    ]);

    $donation = BookDonation::query()->create([
        'bookshelf_id' => $shelf->id,
        'donor_membership_id' => $donorMembership->id,
        'description' => 'Một túi truyện tranh cũ',
        'estimated_count' => 12,
        'status' => $status,
        'decision_note' => $status === 'declined' ? 'Sách đã quá cũ' : null,
    ]);

    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    return [$shelf, $manager, $managerMembership, $donorMembership, $donation];
}

afterEach(fn () => Carbon::setTestNow());

it('receiving records the deciding manager\'s USER id, the moment, and the new status', function () {
    // decided_by FIRST, and it is the block's point: a failed expect()
    // aborts the whole Pest method, so the named probe has to be the
    // statement that fires.
    $frozen = CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC');
    Carbon::setTestNow($frozen);

    [, $manager, $managerMembership, , $donation] = dddFix('pending', 'dong-thap-ddd-recv');

    app(ReceiveDonation::class)->execute($manager, $donation);

    $row = $donation->fresh();
    expect($row->decided_by)->toBe($manager->id);

    // A SEPARATE STATEMENT, and not redundant. decided_by names a
    // users(id) — `CONSTRAINT book_donations_decided_by_foreign FOREIGN
    // KEY (decided_by) REFERENCES users (id)`, read off the live table —
    // while donor_membership_id three columns along names a
    // memberships(id). Both hold 36-char uuid strings, so the line above
    // passes for a value of the right SHAPE and this line is what says it
    // came from the right TABLE. dddFix mints the two ids independently.
    expect($row->decided_by)->not->toBe($managerMembership->id);

    expect($row->status)->toBe(DonationStatus::Received)
        // FROM THE CLOCK, not from the wall: an Action reading the wall
        // clock instead would miss this equalTo by the run's duration.
        ->and($row->decided_at?->equalTo($frozen))->toBeTrue()
        // Received, so there is no reason to record — the note column is
        // the decline's, and this command leaves it alone.
        ->and($row->decision_note)->toBeNull();
});

it('receiving writes no books row and no book_copies row', function () {
    // THE BLOCK THE PORT EXISTS FOR. The reference's own docblock for
    // receiveDonation calls itself "the decision most likely to be
    // 'improved' later by somebody who reasons that a received donation
    // ought to create its own catalogue entry. It must not." — so the
    // convenience fails here rather than shipping.
    //
    // withoutGlobalScopes on both counts, so this is zero rows ANYWHERE
    // and not merely zero on the bound shelf.
    [, $manager, , , $donation] = dddFix('pending', 'dong-thap-ddd-nobook');

    app(ReceiveDonation::class)->execute($manager, $donation);

    expect(Book::query()->withoutGlobalScopes()->count())->toBe(0);
    expect(BookCopy::query()->withoutGlobalScopes()->count())->toBe(0);

    // NON-VACUITY, and it has to come after the two counts: a command
    // that threw before writing anything would leave both counts at zero
    // and this block would pass while pinning nothing. dddFix, at the top
    // of this file, seeds a shelf, two users, two memberships and one
    // donation — so the two zeros above start true.
    expect($donation->fresh()->status)->toBe(DonationStatus::Received);
});

it('declining stores the status and the reason together', function () {
    [, $manager, , , $donation] = dddFix('pending', 'dong-thap-ddd-decline');

    app(DeclineDonation::class)->execute($manager, $donation, 'Sách đã quá cũ, tủ sách xin phép không nhận');

    // The note first: it is the column
    // book_donations_declined_has_reason is about, and a decline that
    // reached the database at all had to carry it.
    $row = $donation->fresh();
    expect($row->decision_note)->toBe('Sách đã quá cũ, tủ sách xin phép không nhận');

    expect($row->status)->toBe(DonationStatus::Declined)
        ->and($row->decided_by)->toBe($manager->id)
        ->and($row->decided_at)->not->toBeNull();
});

it('a reason of whitespace refuses and leaves the row pending', function () {
    // The column is `decision_note text NULL` and would take three spaces
    // happily, so the trim is the whole of the rule. Caught and compared
    // with ->toBe rather than toThrow(RuleViolated::class, '...'):
    // toThrow's message check is assertStringContainsString, so a code
    // renamed to reject_reason_required_MUT would pass that form.
    [, $manager, , , $donation] = dddFix('pending', 'dong-thap-ddd-blank');

    try {
        app(DeclineDonation::class)->execute($manager, $donation, "  \n ");
        test()->fail('expected a blank reason to refuse; the offer was declined');
    } catch (RuleViolated $e) {
        expect($e->code)->toBe('reject_reason_required');
    }

    $row = $donation->fresh();
    expect($row->status)->toBe(DonationStatus::Pending)
        ->and($row->decision_note)->toBeNull()
        ->and($row->decided_by)->toBeNull()
        ->and($row->decided_at)->toBeNull()
        ->and(AuditLog::query()->where('action', 'donation.declined')->count())->toBe(0);
});

it('a received offer cannot then be declined', function () {
    [, $manager, , , $donation] = dddFix('received', 'dong-thap-ddd-twice-a');

    try {
        app(DeclineDonation::class)->execute($manager, $donation, 'Đổi ý rồi');
        test()->fail('expected a received offer to refuse a decline');
    } catch (RuleViolated $e) {
        expect($e->code)->toBe('donation_not_pending');
    }

    expect($donation->fresh()->status)->toBe(DonationStatus::Received)
        ->and($donation->fresh()->decision_note)->toBeNull();
});

it('a declined offer cannot then be received', function () {
    [, $manager, , , $donation] = dddFix('declined', 'dong-thap-ddd-twice-b');

    try {
        app(ReceiveDonation::class)->execute($manager, $donation);
        test()->fail('expected a declined offer to refuse a receive');
    } catch (RuleViolated $e) {
        expect($e->code)->toBe('donation_not_pending');
    }

    // The fixture's own note survives, which is the half a "just set the
    // status" repair would break: moving a declined row to received with
    // the note still on it is a row that reads as both.
    expect($donation->fresh()->status)->toBe(DonationStatus::Declined)
        ->and($donation->fresh()->decision_note)->toBe('Sách đã quá cũ');
});

it('INV-8: donation.received records the two statuses and renders a Vietnamese sentence', function () {
    [, $manager, , , $donation] = dddFix('pending', 'dong-thap-ddd-audit-recv');

    app(ReceiveDonation::class)->execute($manager, $donation);

    $entry = AuditLog::query()->where('action', 'donation.received')->sole();
    expect((array) $entry->after)->toBe(['status' => 'received']);

    expect($entry->entity_type)->toBe('donation')
        ->and($entry->entity_id)->toBe($donation->id)
        ->and($entry->actor_id)->toBe($manager->id)
        ->and((array) $entry->before)->toBe(['status' => 'pending']);

    // Through the query the audit screen calls, so the arm is REACHABLE
    // and not merely present: AuditSentences::phrase() ends in a default
    // arm, so a missing arm renders the undescribed-action fallback to a
    // volunteer instead of failing the build.
    $rendered = app(AuditLogQuery::class)->run(page: 1);
    $line = collect($rendered['rows'])->firstWhere('action', 'donation.received');
    expect($line)->not->toBeNull()
        ->and($line['group'])->toBe('community')
        ->and($line['sentence'])->toBe('Maria Quản Lý Kho đã nhận một đề nghị tặng sách');
});

it('INV-8: donation.declined carries the reason into the payload and into the sentence', function () {
    [, $manager, , , $donation] = dddFix('pending', 'dong-thap-ddd-audit-dec');

    app(DeclineDonation::class)->execute($manager, $donation, 'Sách đã quá cũ');

    $entry = AuditLog::query()->where('action', 'donation.declined')->sole();
    // THE REASON, and first — it is what this block is titled for. THE
    // WHOLE BAG rather than a subset: toMatchArray would pass on a bag
    // that also carried the donor's free-text description.
    expect((array) $entry->after)->toBe(['status' => 'declined', 'reason' => 'Sách đã quá cũ']);

    expect($entry->entity_type)->toBe('donation')
        ->and($entry->entity_id)->toBe($donation->id)
        ->and($entry->actor_id)->toBe($manager->id)
        ->and((array) $entry->before)->toBe(['status' => 'pending']);

    $rendered = app(AuditLogQuery::class)->run(page: 1);
    $line = collect($rendered['rows'])->firstWhere('action', 'donation.declined');
    expect($line)->not->toBeNull()
        ->and($line['group'])->toBe('community')
        ->and($line['sentence'])->toBe('Maria Quản Lý Kho đã từ chối một đề nghị tặng sách vì Sách đã quá cũ');
});

it('a reader cannot receive an offer — this command\'s own gate call', function () {
    // Task 4's review found both comment decisions' authorize() lines
    // deletable with the whole suite green, because every block acted as
    // the manager. These two blocks are that finding answered for the
    // donation pair the day they ship. There is no route to either
    // command yet, so this asks the Action directly; over HTTP the same
    // refusal is a 404 rather than a 403 (spec §5.4), which belongs to
    // Task 19's screen.
    //
    // The READER's own membership is bound, so act-as-manager's role
    // comparison is what denies rather than an identity guard ahead of
    // it.
    [$shelf, , , $donorMembership, $donation] = dddFix('pending', 'dong-thap-ddd-gate-recv');
    $reader = User::query()->findOrFail($donorMembership->user_id);
    app(TenantContext::class)->set($shelf, $donorMembership);
    test()->actingAs($reader);

    expect(fn () => app(ReceiveDonation::class)->execute($reader, $donation))
        ->toThrow(AuthorizationException::class);

    expect($donation->fresh()->status)->toBe(DonationStatus::Pending)
        ->and(AuditLog::query()->where('action', 'donation.received')->count())->toBe(0);
});

it('a reader cannot decline an offer — this command\'s own gate call', function () {
    // The sibling block above's reasoning, for the other command.
    [$shelf, , , $donorMembership, $donation] = dddFix('pending', 'dong-thap-ddd-gate-dec');
    $reader = User::query()->findOrFail($donorMembership->user_id);
    app(TenantContext::class)->set($shelf, $donorMembership);
    test()->actingAs($reader);

    expect(fn () => app(DeclineDonation::class)->execute($reader, $donation, 'Không nhận'))
        ->toThrow(AuthorizationException::class);

    expect($donation->fresh()->status)->toBe(DonationStatus::Pending)
        ->and($donation->fresh()->decision_note)->toBeNull()
        ->and(AuditLog::query()->where('action', 'donation.declined')->count())->toBe(0);
});
