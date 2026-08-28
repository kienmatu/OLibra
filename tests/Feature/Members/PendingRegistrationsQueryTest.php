<?php

use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Queries\PendingRegistrationsQuery;
use Tests\Support\TenantHarness;

/** @return Bookshelf a bound shelf */
function pregFixture(): Bookshelf
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    TenantHarness::actAs($shelf);

    return $shelf;
}

function pregMember(Bookshelf $shelf, string $name, string $status, array $userOver = [], array $membershipOver = []): Membership
{
    $person = User::factory()->create(array_merge(['full_name' => $name], $userOver));

    // memberships_rejected_has_reason (database/migrations/2026_08_26_000003_
    // create_memberships_table.php:53-54, added under Task 6's hardening,
    // after this brief's test text was written) requires a reason whenever
    // status = 'rejected' -- the same fixture note old_next's own
    // manager-queries.test.ts carries on its `reader()` helper for the
    // identical constraint. The brief's literal `pregMember($shelf, 'Đã Từ
    // Chối', 'rejected', [])` call predates the constraint and would
    // otherwise fail on a bare INSERT; this mirrors the reference's fix
    // rather than skip the rejected-status coverage.
    $rejectedDefault = $status === 'rejected' ? ['rejection_reason' => 'lý do khởi tạo cho kiểm thử'] : [];

    return Membership::factory()->for($shelf)->create(array_merge(
        ['user_id' => $person->id, 'status' => $status],
        $rejectedDefault,
        $membershipOver,
    ));
}

it('lists only pending applications, oldest first, with the review card\'s fields', function () {
    $shelf = pregFixture();
    pregMember($shelf, 'Đã Duyệt Rồi', 'active');
    pregMember($shelf, 'Đã Từ Chối', 'rejected', []);

    // Inserted in the REVERSE of the intended order: $newer's row lands in
    // the table before $older's row does. UUID v7 primary keys are
    // time-ordered by creation instant, and MariaDB's unordered scan of a
    // small, freshly-inserted table returns physical/insertion order — so a
    // fixture that inserts oldest-first can pass this assertion even with
    // `PendingRegistrationsQuery::run()`'s ORDER BY deleted outright, purely
    // because insertion order already happens to match intended order. This
    // fixture inserts $newer first and forces `created_at` explicitly on
    // both rows so the correct order can only come from the query's own
    // `ORDER BY created_at, id` — never from coincidental insertion order.
    $newer = pregMember($shelf, 'Lê Thị Mới', 'pending', [], [
        'created_at' => now(),
    ]);
    $older = pregMember($shelf, 'Trần Văn Cũ', 'pending', [
        'saint_name' => 'Giuse', 'date_of_birth' => '2014-01-01',
        'father_name' => 'Cha Cũ', 'mother_name' => 'Mẹ Cũ',
        'phone' => '0911111111', 'phone_missing_reason' => null,
    ], [
        'created_at' => now()->subHour(),
    ]);

    $rows = app(PendingRegistrationsQuery::class)->run();

    expect(array_column($rows, 'membershipId'))->toBe([$older->id, $newer->id])
        ->and($rows[0]['fullName'])->toBe('Trần Văn Cũ')
        ->and($rows[0]['saintName'])->toBe('Giuse')
        ->and($rows[0]['dateOfBirth'])->toBe('2014-01-01')
        ->and($rows[0]['fatherName'])->toBe('Cha Cũ')
        ->and($rows[0]['phone'])->toBe('0911111111')
        ->and($rows[0]['requestedAt'])->not->toBe('');
});

it('a near-duplicate ACTIVE name is flagged for the manager, and never acted on', function () {
    $shelf = pregFixture();
    $existing = pregMember($shelf, 'Trần Minh', 'active');
    $applicant = pregMember($shelf, 'Tran Minh Duc', 'pending');

    $rows = app(PendingRegistrationsQuery::class)->run();

    $row = collect($rows)->firstWhere('membershipId', $applicant->id);
    expect($row['similarTo'])->not->toBeNull()
        ->and($row['similarTo']['membershipId'])->toBe($existing->id)
        ->and($row['similarTo']['fullName'])->toBe('Trần Minh')
        ->and($row['similarTo']['similarity'])->toEqualWithDelta(10 / 14, 0.0001)
        // Nothing merged, nothing rejected — a warning to a human only.
        ->and($applicant->fresh()->status->value)->toBe('pending');
});

it('an unrelated name gets no warning, and a pending near-name is not a duplicate risk', function () {
    $shelf = pregFixture();
    pregMember($shelf, 'Hoàng Bách', 'pending');       // pending, near nothing
    pregMember($shelf, 'Hoang Bach Khoa', 'pending');  // near the OTHER PENDING one only

    $rows = app(PendingRegistrationsQuery::class)->run();

    // Compared against ACTIVE members only — two pending near-names do not
    // flag each other (the reference's explicit rule).
    foreach ($rows as $row) {
        expect($row['similarTo'])->toBeNull();
    }
});

it('INV-10: another shelf\'s pending applications never appear', function () {
    $shelves = TenantHarness::twoCollidingShelves();
    $b = $shelves['b'];
    $foreignPerson = User::factory()->create(['full_name' => 'Người Xứ Khác']);
    Membership::factory()->for($b)->create(['user_id' => $foreignPerson->id, 'status' => 'pending']);

    TenantHarness::actAs($shelves['a']);
    $rows = app(PendingRegistrationsQuery::class)->run();

    expect(collect($rows)->pluck('fullName')->all())->not->toContain('Người Xứ Khác');
});

it('the review card\'s row omits every field it does not render, per key', function () {
    // Pest's not->toHaveKeys() means "has ALL of these keys" negated, so it
    // is satisfied the moment even ONE named key is absent — it does not
    // prove every one of them is. The plan's first draft asserted the
    // negative that way and would have passed even if only one of these
    // three leaked through. Pinning each key individually is the fix.
    $shelf = pregFixture();
    pregMember($shelf, 'Trần Văn Ẩn', 'pending', [
        'father_name' => 'Cha Ẩn', 'mother_name' => 'Mẹ Ẩn', 'phone' => '0922222222',
    ]);

    $rows = app(PendingRegistrationsQuery::class)->run();

    expect($rows)->toHaveCount(1);
    $keys = array_keys($rows[0]);

    // The row shape is fixed and manager-facing: no password/username/
    // credential surface, no raw model attributes, nothing beyond the
    // named fields BR §16.3's card renders.
    foreach (['username', 'password_hash', 'is_super_admin', 'email', 'bookshelfId', 'display_name'] as $absent) {
        expect($keys)->not->toContain($absent);
    }

    expect($keys)->toEqualCanonicalizing([
        'membershipId', 'userId', 'fullName', 'saintName', 'dateOfBirth',
        'fatherName', 'motherName', 'phone', 'phoneMissingReason',
        'parishLine', 'requestedAt', 'similarTo',
    ]);
});

it('is scoped by the bound tenant, not by a role check baked into the query', function () {
    // TenantContext binds the shelf; this class trusts that binding rather
    // than re-deriving it. Two shelves, one pending applicant apiece,
    // switching the bound shelf switches which single row is visible.
    $shelfA = Bookshelf::factory()->create(['slug' => 'shelf-a', 'settings' => []]);
    $shelfB = Bookshelf::factory()->create(['slug' => 'shelf-b', 'settings' => []]);

    TenantHarness::actAs($shelfA);
    pregMember($shelfA, 'Người Ở A', 'pending');

    TenantHarness::actAs($shelfB);
    pregMember($shelfB, 'Người Ở B', 'pending');

    TenantHarness::actAs($shelfA);
    $rowsA = app(PendingRegistrationsQuery::class)->run();

    TenantHarness::actAs($shelfB);
    $rowsB = app(PendingRegistrationsQuery::class)->run();

    expect(collect($rowsA)->pluck('fullName')->all())->toBe(['Người Ở A'])
        ->and(collect($rowsB)->pluck('fullName')->all())->toBe(['Người Ở B']);
});
