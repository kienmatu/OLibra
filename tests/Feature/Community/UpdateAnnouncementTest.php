<?php

use App\Actions\Community\CreateAnnouncement;
use App\Actions\Community\UpdateAnnouncement;
use App\Exceptions\RuleViolated;
use App\Models\Announcement;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;

/**
 * Shelf, one active manager, and one announcement already written —
 * anwFix's shape (tests/Feature/Community/CreateAnnouncementTest.php) with
 * the row this suite edits seeded in.
 *
 * Grep first: `grep -rn "^function anuFix" tests/` — top-level helpers are
 * process-global (AGENTS.md).
 *
 * The seed goes through CreateAnnouncement rather than a factory: I looked
 * in database/factories and there is no AnnouncementFactory there, and the
 * command is the door Task 9 built onto this table.
 *
 * $expiresAt is a parameter rather than a fixed value because the three
 * expiry blocks need a row that already carries one and the rest need a
 * row that does not — the difference the command under test is about.
 *
 * @return array{User, Announcement}
 */
function anuFix(string $slug, ?CarbonImmutable $expiresAt = null): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $mm = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $mm);
    test()->actingAs($manager);

    $created = app(CreateAnnouncement::class)->execute(
        $manager,
        'Tin Vui Tháng Năm',
        'Tủ sách mở cửa lại từ thứ Hai.',
        expiresAt: $expiresAt,
    );

    return [$manager, Announcement::query()->findOrFail($created['announcementId'])];
}

it('a title-only change leaves the body untouched', function () {
    [$manager, $announcement] = anuFix('dong-thap-anu-title');

    app(UpdateAnnouncement::class)->execute($manager, $announcement, ['title' => 'Tin Vui Tháng Sáu']);

    // One statement per fact rather than an expect()->and() chain — the
    // chain short-circuits, and a failed expect() aborts the whole METHOD,
    // so the body assertions below would never run if the title one broke.
    $row = Announcement::query()->sole();
    expect($row->title)->toBe('Tin Vui Tháng Sáu');
    expect($row->body)->toBe('Tủ sách mở cửa lại từ thứ Hai.');
    expect($row->body_text)->toBe('Tủ sách mở cửa lại từ thứ Hai.');
});

it('a body-only change rewrites body_text with it and leaves the title alone', function () {
    // Not in the plan's list of seven; added because body_text is NOT
    // NULL and is written from the same trimmed string as body in this
    // command, as it is in CreateAnnouncement. MEASURED over the whole
    // suite rather than asserted: with `$write['body_text'] = $body;`
    // deleted from App\Actions\Community\UpdateAnnouncement, the run is
    // 1 failed, 1414 passed, and this block is the failure — so an edit
    // that moved body and left the search column on the old text is a
    // regression only this block refuses. The trailing spaces are the
    // trim, measured in the same block.
    [$manager, $announcement] = anuFix('dong-thap-anu-body');

    app(UpdateAnnouncement::class)->execute($manager, $announcement, ['body' => '  Tủ sách nghỉ Chúa Nhật.  ']);

    $row = Announcement::query()->sole();
    expect($row->body)->toBe('Tủ sách nghỉ Chúa Nhật.');
    expect($row->body_text)->toBe('Tủ sách nghỉ Chúa Nhật.');
    expect($row->title)->toBe('Tin Vui Tháng Năm');
});

it('a present-but-blank title refuses with announcement_fields_required', function () {
    // Whitespace, not the empty string: the column is NOT NULL and would
    // take three spaces happily. Its own block, separate from the body's —
    // a failed expect() aborts the whole METHOD, so one block covering
    // both fields would stop at the first and never reach the second.
    [$manager, $announcement] = anuFix('dong-thap-anu-bt');

    // Caught and compared with ->toBe rather than
    // toThrow(RuleViolated::class, 'announcement_fields_required'):
    // toThrow's message check is assertStringContainsString (read in
    // vendor/pestphp/pest/src/Mixins/Expectation.php), so a code renamed
    // to announcement_fields_required_MUT passes that form.
    try {
        app(UpdateAnnouncement::class)->execute($manager, $announcement, ['title' => '   ']);
        test()->fail('expected a blank title to refuse; the update succeeded');
    } catch (RuleViolated $e) {
        expect($e->code)->toBe('announcement_fields_required');
    }

    expect(Announcement::query()->sole()->title)->toBe('Tin Vui Tháng Năm');
});

it('a present-but-blank body refuses with the same one code', function () {
    // The same code as the blank title — one sentence about one form, the
    // shape CreateAnnouncement already ships and the reference's own
    // (updateAnnouncement raises a single announcement_fields_required for
    // either field).
    [$manager, $announcement] = anuFix('dong-thap-anu-bb');

    try {
        app(UpdateAnnouncement::class)->execute($manager, $announcement, ['body' => "  \n "]);
        test()->fail('expected a blank body to refuse; the update succeeded');
    } catch (RuleViolated $e) {
        expect($e->code)->toBe('announcement_fields_required');
    }

    expect(Announcement::query()->sole()->body)->toBe('Tủ sách mở cửa lại từ thứ Hai.');
});

it('an absent expiresAt leaves an existing expiry alone', function () {
    // Half of the pair this command exists for. This half is what an
    // isset()/?? read gets RIGHT, which is why it is written apart from
    // the block below: the two must be able to disagree.
    $when = CarbonImmutable::parse('2026-05-08 07:30:00', 'UTC');
    [$manager, $announcement] = anuFix('dong-thap-anu-keep', $when);

    app(UpdateAnnouncement::class)->execute($manager, $announcement, ['title' => 'Tin Vui Tháng Sáu']);

    expect(Announcement::query()->sole()->expires_at?->equalTo($when))->toBeTrue();
});

it('an explicit null expiresAt clears the expiry', function () {
    // The other half. "This announcement no longer expires" is a THIRD
    // case, distinct from "I am not editing the expiry", and an isset()
    // or a ?? collapses it into that one — silently, because the block
    // above stays green while this one goes red. MEASURED over the whole
    // suite: with the command's guard rewritten
    // `if (isset($changes['expiresAt']))` the run is 1 failed, 1414
    // passed, and this block is the failure.
    $when = CarbonImmutable::parse('2026-05-08 07:30:00', 'UTC');
    [$manager, $announcement] = anuFix('dong-thap-anu-clear', $when);

    app(UpdateAnnouncement::class)->execute($manager, $announcement, ['expiresAt' => null]);

    expect(Announcement::query()->sole()->expires_at)->toBeNull();
});

it('a date in expiresAt sets the expiry', function () {
    [$manager, $announcement] = anuFix('dong-thap-anu-set');
    $when = CarbonImmutable::parse('2026-06-01 09:00:00', 'UTC');

    app(UpdateAnnouncement::class)->execute($manager, $announcement, ['expiresAt' => $when]);

    expect(Announcement::query()->sole()->expires_at?->equalTo($when))->toBeTrue();
});

it('INV-8: announcement.updated records the title before and after', function () {
    [$manager, $announcement] = anuFix('dong-thap-anu-audit');

    $result = app(UpdateAnnouncement::class)->execute($manager, $announcement, ['title' => 'Tin Vui Tháng Sáu']);

    $entry = AuditLog::query()->where('action', 'announcement.updated')->sole();
    expect($entry->entity_type)->toBe('announcement');
    expect($entry->entity_id)->toBe($result['announcementId']);
    expect($entry->actor_id)->toBe($manager->id);
    // THE WHOLE BAG in each direction, not a subset: toMatchArray would
    // pass on a `before` that also carried the body.
    expect((array) $entry->before)->toBe(['title' => 'Tin Vui Tháng Năm']);
    expect((array) $entry->after)->toBe(['title' => 'Tin Vui Tháng Sáu']);
});
