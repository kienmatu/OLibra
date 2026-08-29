<?php

use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\User;
use App\Support\AuditRecorder;
use Carbon\Carbon;
use Tests\Support\TenantHarness;

afterEach(fn () => Carbon::setTestNow());

it('writes one audit row naming actor, shelf, entity, before and after', function () {
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();
    $user = TenantHarness::readerFor($shelf);
    TenantHarness::actAs($shelf);
    $this->actingAs($user);
    Carbon::setTestNow(Carbon::parse('2026-08-27 03:00:00', 'UTC'));

    app(AuditRecorder::class)->record(
        'book.created', 'book', 'b0000000-0000-7000-8000-000000000001',
        null, ['title' => 'Dế Mèn Phiêu Lưu Ký'],
    );

    $row = AuditLog::query()->where('action', 'book.created')->orderByDesc('id')->first();
    expect($row)->not->toBeNull()
        ->and($row->bookshelf_id)->toBe($shelf->id)
        ->and($row->actor_id)->toBe($user->id)
        ->and($row->entity_type)->toBe('book')
        ->and($row->entity_id)->toBe('b0000000-0000-7000-8000-000000000001')
        ->and($row->before)->toBeNull()
        ->and($row->after)->toBe(['title' => 'Dế Mèn Phiêu Lưu Ký'])
        ->and($row->occurred_at->toDateTimeString())->toBe('2026-08-27 03:00:00');
});

it('refuses a forbidden key in either bag instead of writing the row — the guard is actually wired in', function () {
    // Every one of AuditSecretsTest's 15 cases calls
    // AuditSecrets::assertNoSecrets() directly; none of them go through
    // AuditRecorder::record() at all, so none of them can tell whether
    // AuditRecorder.php:35's `AuditSecrets::assertNoSecrets($before,
    // $after);` line is still there. Deleting that one line leaves every
    // writer's own feature test green (none of the 21 shipped payload
    // shapes carries a forbidden key, so the guard being absent changes
    // nothing they exercise) and this is the only test in the suite that
    // calls record() WITH one — the mutation this test exists to catch.
    ['a' => $shelf] = TenantHarness::twoCollidingShelves();
    $user = TenantHarness::readerFor($shelf);
    TenantHarness::actAs($shelf);
    $this->actingAs($user);

    expect(fn () => app(AuditRecorder::class)->record(
        'book.created', 'book', 'b0000000-0000-7000-8000-000000000002',
        null, ['password_hash' => 'x'],
    ))->toThrow(RuleViolated::class);

    // Refused before the INSERT, not after — no row for this action at all.
    expect(AuditLog::query()->where('entity_id', 'b0000000-0000-7000-8000-000000000002')->exists())
        ->toBeFalse();
});

it('refuses to record with no tenant bound rather than writing a shelfless row', function () {
    // A shelf-scoped command's audit row missing its shelf would be
    // invisible to that shelf's own audit screen — fail loudly instead,
    // matching BookshelfScope's fail-closed shape.
    $user = User::factory()->create();
    $this->actingAs($user);

    expect(fn () => app(AuditRecorder::class)->record('book.created', 'book', null, null, []))
        ->toThrow(RuntimeException::class);
});
