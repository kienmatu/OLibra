<?php

use App\Actions\Community\CreateAnnouncement;
use App\Actions\Community\HideAnnouncement;
use App\Actions\Community\PinAnnouncement;
use App\Actions\Community\PublishAnnouncement;
use App\Actions\Community\UnpinAnnouncement;
use App\Exceptions\RuleViolated;
use App\Models\Announcement;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;

/**
 * The four arrows on one table — publish, hide, pin, unpin — and the
 * *Đăng lại* pair (blocks 4 and 5) that is the reason they are reviewed
 * together.
 *
 * Grep first: `grep -rn "^function anpFix" tests/` — top-level helpers
 * are process-global (AGENTS.md).
 *
 * The seed goes through CreateAnnouncement rather than a factory: I
 * looked in database/factories and there is no AnnouncementFactory
 * there, and the command is the door Task 9 built onto this table.
 *
 * $publishedAt, $expiresAt and $pinned are parameters because the whole
 * subject of this file is which of four starting states a command is
 * pointed at: a draft, a live announcement, a lapsed one, a pinned one.
 *
 * @return array{User, Announcement}
 */
function anpFix(
    string $slug,
    ?CarbonImmutable $publishedAt = null,
    ?CarbonImmutable $expiresAt = null,
    bool $pinned = false,
    string $title = 'Tin Vui Tháng Năm',
): array {
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
        $title,
        'Tủ sách mở cửa lại từ thứ Hai.',
        pinned: $pinned,
        publishedAt: $publishedAt,
        expiresAt: $expiresAt,
    );

    return [$manager, Announcement::query()->findOrFail($created['announcementId'])];
}

/** A lapsed announcement: published in the past, expired in the past. */
function anpLapsed(string $slug): array
{
    return anpFix(
        $slug,
        publishedAt: CarbonImmutable::parse('2026-05-01 03:00:00', 'UTC'),
        expiresAt: CarbonImmutable::parse('2026-05-08 03:00:00', 'UTC'),
    );
}

afterEach(fn () => Carbon::setTestNow());

it('publishing a draft stamps published_at from the clock', function () {
    // FROM THE CLOCK, not from an argument: execute() below is called
    // with an empty $changes and no instant of any kind, and the column
    // still comes out equal to the frozen one. An Action reading the
    // wall clock instead would miss this equalTo by the run's duration.
    $frozen = CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC');
    Carbon::setTestNow($frozen);

    [$manager, $announcement] = anpFix('dong-thap-anp-draft');

    app(PublishAnnouncement::class)->execute($manager, $announcement, []);

    expect(Announcement::query()->sole()->published_at?->equalTo($frozen))->toBeTrue();
});

it('publishing an already-live announcement with no expiry supplied refuses with already_published', function () {
    // Live: published, and nothing says it has lapsed. This is the
    // refusal OPS §4.4 names, reached with the caller staying silent
    // about the expiry — the block below it starts from a LAPSED row and
    // the same silence, which is the comparison that makes this one mean
    // something.
    [$manager, $announcement] = anpFix(
        'dong-thap-anp-live',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
    );

    // Caught and compared with ->toBe rather than
    // toThrow(RuleViolated::class, 'already_published'): toThrow's
    // message check is assertStringContainsString (read in
    // vendor/pestphp/pest/src/Mixins/Expectation.php), so a code renamed
    // to already_published_MUT passes that form.
    try {
        app(PublishAnnouncement::class)->execute($manager, $announcement, []);
        test()->fail('expected a live announcement to refuse; the publish succeeded');
    } catch (RuleViolated $e) {
        expect($e->code)->toBe('already_published');
    }
});

it('republishing a lapsed announcement with a fresh expiry succeeds — Đăng lại', function () {
    // The second button. The row is published AND lapsed, and a manager
    // pressing *Đăng lại* supplies a new expiry — so the guard must be
    // about a LIVE publication rather than about published_at being
    // non-null.
    $frozen = CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC');
    Carbon::setTestNow($frozen);

    [$manager, $announcement] = anpLapsed('dong-thap-anp-relive');
    $fresh = CarbonImmutable::parse('2026-09-30 03:00:00', 'UTC');

    app(PublishAnnouncement::class)->execute($manager, $announcement, ['expiresAt' => $fresh]);

    $row = Announcement::query()->sole();
    // One statement per fact rather than an expect()->and() chain — the
    // chain short-circuits, and a failed expect() aborts the whole
    // METHOD.
    expect($row->published_at?->equalTo($frozen))->toBeTrue();
    expect($row->expires_at?->equalTo($fresh))->toBeTrue();
});

it('republishing a lapsed announcement with expiresAt present and null succeeds and leaves expires_at null', function () {
    // AN EXPLICIT NULL IS A SUPPLY. "The shelf is closed until further
    // notice" is the ordinary *Đăng lại*: the form sends expires_at with
    // an empty value, so the key is PRESENT and holds null. This block
    // and the one below it are the pair — they must be able to disagree,
    // which is why they are written apart.
    $frozen = CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC');
    Carbon::setTestNow($frozen);

    [$manager, $announcement] = anpLapsed('dong-thap-anp-clear');

    app(PublishAnnouncement::class)->execute($manager, $announcement, ['expiresAt' => null]);

    $row = Announcement::query()->sole();
    expect($row->published_at?->equalTo($frozen))->toBeTrue();
    expect($row->expires_at)->toBeNull();
});

it('republishing a lapsed announcement with the expiresAt key ABSENT refuses with already_published', function () {
    // The other half of the pair. Absent is not a supply, so a lapsed
    // row reached with an empty $changes takes the refusal — and the
    // stored published_at is untouched, which is what makes the refusal
    // observable beyond the exception.
    [$manager, $announcement] = anpLapsed('dong-thap-anp-absent');
    $published = CarbonImmutable::parse('2026-05-01 03:00:00', 'UTC');

    try {
        app(PublishAnnouncement::class)->execute($manager, $announcement, []);
        test()->fail('expected an absent expiresAt to refuse; the publish succeeded');
    } catch (RuleViolated $e) {
        expect($e->code)->toBe('already_published');
    }

    expect(Announcement::query()->sole()->published_at?->equalTo($published))->toBeTrue();
});

it('hiding returns an announcement to draft, and it can then be posted again', function () {
    // The reference's own named behaviour. Hiding CLEARS published_at —
    // that is what "not public" means for this table — and clearing it
    // is also what leaves the row in the draft state PublishAnnouncement
    // accepts without an expiry. A hide that wrote some other column
    // instead would leave the second half of this block refusing.
    $frozen = CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC');
    Carbon::setTestNow($frozen);

    [$manager, $announcement] = anpFix(
        'dong-thap-anp-hide',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
    );

    app(HideAnnouncement::class)->execute($manager, $announcement);
    expect(Announcement::query()->sole()->published_at)->toBeNull();

    app(PublishAnnouncement::class)->execute($manager, $announcement, []);
    expect(Announcement::query()->sole()->published_at?->equalTo($frozen))->toBeTrue();
});

it('pinning flips the flag and records announcement.pinned', function () {
    [$manager, $announcement] = anpFix('dong-thap-anp-pin');

    app(PinAnnouncement::class)->execute($manager, $announcement);

    expect(Announcement::query()->sole()->is_pinned)->toBeTrue();

    $entry = AuditLog::query()->where('action', 'announcement.pinned')->sole();
    expect($entry->entity_type)->toBe('announcement');
    expect($entry->entity_id)->toBe($announcement->id);
    // THE WHOLE BAG in each direction, not a subset: toMatchArray would
    // pass on a `before` that also carried the body.
    expect((array) $entry->before)->toBe(['is_pinned' => false]);
    expect((array) $entry->after)->toBe(['title' => 'Tin Vui Tháng Năm', 'is_pinned' => true]);
});

it('unpinning flips the flag back and records announcement.unpinned', function () {
    [$manager, $announcement] = anpFix('dong-thap-anp-unpin', pinned: true);

    app(UnpinAnnouncement::class)->execute($manager, $announcement);

    expect(Announcement::query()->sole()->is_pinned)->toBeFalse();

    $entry = AuditLog::query()->where('action', 'announcement.unpinned')->sole();
    expect($entry->entity_type)->toBe('announcement');
    expect($entry->entity_id)->toBe($announcement->id);
    expect((array) $entry->before)->toBe(['is_pinned' => true]);
    expect((array) $entry->after)->toBe(['title' => 'Tin Vui Tháng Năm', 'is_pinned' => false]);
});

it('more than one announcement may be pinned at once', function () {
    // Divergence 8, the ported reading: BR §16.1 orders pinned
    // announcements among themselves ("most recent next"), which implies
    // more than one may be pinned, and no cap is stated anywhere. A
    // BLOCK rather than a comment, because "no cap" is a claim a later
    // partial unique index would falsify silently — the commands
    // themselves would not change shape.
    [$manager, $first] = anpFix('dong-thap-anp-many');

    $second = Announcement::query()->findOrFail(
        app(CreateAnnouncement::class)->execute(
            $manager,
            'Tin Vui Tháng Sáu',
            'Tủ sách nghỉ Chúa Nhật.',
        )['announcementId'],
    );

    app(PinAnnouncement::class)->execute($manager, $first);
    app(PinAnnouncement::class)->execute($manager, $second);

    expect(Announcement::query()->where('is_pinned', true)->count())->toBe(2);
});

it('INV-8: announcement.published records the published_at before and after', function () {
    $frozen = CarbonImmutable::parse('2026-08-30 04:00:00', 'UTC');
    Carbon::setTestNow($frozen);

    [$manager, $announcement] = anpFix('dong-thap-anp-audit-pub');

    app(PublishAnnouncement::class)->execute($manager, $announcement, []);

    $entry = AuditLog::query()->where('action', 'announcement.published')->sole();
    expect($entry->entity_type)->toBe('announcement');
    expect($entry->entity_id)->toBe($announcement->id);
    expect($entry->actor_id)->toBe($manager->id);
    // A draft's prior value is a stored null, not an absent key —
    // AuditSentences::payloadRows renders those as different things, and
    // "was not published" is a fact worth recording.
    expect((array) $entry->before)->toBe(['published_at' => null]);
    expect((array) $entry->after)->toBe([
        'title' => 'Tin Vui Tháng Năm',
        'published_at' => $frozen->toIso8601String(),
    ]);
});

it('INV-8: announcement.hidden records the published_at it cleared', function () {
    $was = CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC');
    [$manager, $announcement] = anpFix('dong-thap-anp-audit-hide', publishedAt: $was);

    app(HideAnnouncement::class)->execute($manager, $announcement);

    $entry = AuditLog::query()->where('action', 'announcement.hidden')->sole();
    expect($entry->entity_type)->toBe('announcement');
    expect($entry->entity_id)->toBe($announcement->id);
    expect((array) $entry->before)->toBe(['published_at' => $was->toIso8601String()]);
    expect((array) $entry->after)->toBe(['title' => 'Tin Vui Tháng Năm']);
});

/**
 * The four gate blocks below exist because each command opens with its
 * own Gate::forUser($actor)->authorize(...) call against its own policy
 * ability, and every block above this point acts as a manager — so
 * without these, deleting any one of those four lines leaves the file
 * green. UpdateAnnouncementTest carries the same block for the same
 * reason.
 *
 * THE READER'S OWN membership is bound in each, and that is the point
 * rather than tidiness: act-as-manager first checks that the membership
 * TenantContext holds belongs to the $user the gate was handed, so
 * leaving the manager's membership bound would deny on that identity
 * guard and never reach the ROLE comparison — green even if the policy
 * asked for act-as-reader.
 *
 * @return User the reader, with their own membership bound
 */
function anpReader(string $slug): User
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::query()->where('slug', $slug)->sole();
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    $rm = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $rm);

    return $reader;
}

it('a reader cannot publish', function () {
    [, $announcement] = anpFix('dong-thap-anp-gate-pub');
    $reader = anpReader('dong-thap-anp-gate-pub');

    expect(fn () => app(PublishAnnouncement::class)->execute($reader, $announcement, []))
        ->toThrow(AuthorizationException::class);
});

it('a reader cannot hide', function () {
    [, $announcement] = anpFix(
        'dong-thap-anp-gate-hide',
        publishedAt: CarbonImmutable::parse('2026-08-01 03:00:00', 'UTC'),
    );
    $reader = anpReader('dong-thap-anp-gate-hide');

    expect(fn () => app(HideAnnouncement::class)->execute($reader, $announcement))
        ->toThrow(AuthorizationException::class);
});

it('a reader cannot pin', function () {
    [, $announcement] = anpFix('dong-thap-anp-gate-pin');
    $reader = anpReader('dong-thap-anp-gate-pin');

    expect(fn () => app(PinAnnouncement::class)->execute($reader, $announcement))
        ->toThrow(AuthorizationException::class);
});

it('a reader cannot unpin', function () {
    [, $announcement] = anpFix('dong-thap-anp-gate-unpin', pinned: true);
    $reader = anpReader('dong-thap-anp-gate-unpin');

    expect(fn () => app(UnpinAnnouncement::class)->execute($reader, $announcement))
        ->toThrow(AuthorizationException::class);
});
