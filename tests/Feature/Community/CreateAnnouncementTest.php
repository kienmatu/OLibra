<?php

use App\Actions\Community\CreateAnnouncement;
use App\Exceptions\RuleViolated;
use App\Models\Announcement;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use App\Support\UniqueViolation;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Shelf + one active manager, on the cmaFix shape
 * (tests/Feature/Community/ApproveCommentTest.php).
 *
 * Grep first: `grep -rn "^function anwFix" tests/` — top-level helpers
 * are process-global (AGENTS.md).
 *
 * No book and no comment: every block here writes an announcements row
 * and nothing in that table references either.
 *
 * @return array{Bookshelf, User}
 */
function anwFix(string $slug = 'dong-thap-anw'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $mm = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $mm);
    test()->actingAs($manager);

    return [$shelf, $manager];
}

it('a draft is created with published_at null, and its slug reads off the title', function () {
    [, $manager] = anwFix();

    $result = app(CreateAnnouncement::class)->execute($manager, 'Tin Vui Tháng Năm', 'Tủ sách mở cửa lại từ thứ Hai.');

    $row = Announcement::query()->sole();
    expect($result['slug'])->toBe('tin-vui-thang-nam')
        ->and($result['announcementId'])->toBe($row->id)
        ->and($row->slug)->toBe('tin-vui-thang-nam')
        ->and($row->title)->toBe('Tin Vui Tháng Năm')
        ->and($row->body)->toBe('Tủ sách mở cửa lại từ thứ Hai.')
        // A draft. OPS §4.4 makes publishing its own command precisely
        // because this column being null is what "draft" means.
        ->and($row->published_at)->toBeNull()
        ->and($row->expires_at)->toBeNull()
        ->and($row->is_pinned)->toBeFalse()
        // announcements.author_id is a users(id) — the FK in the live
        // table names users, and this phase writes one column two tables
        // along (book_donations.donor_membership_id) that points the
        // other way, so the manager's membership id is named and
        // excluded rather than merely "not asserted".
        ->and($row->author_id)->toBe($manager->id)
        ->and($row->author_id)->not->toBe(app(TenantContext::class)->membership()?->id);
});

it('a published announcement carries the instant it was given', function () {
    [, $manager] = anwFix('dong-thap-anw-pub');
    $when = CarbonImmutable::parse('2026-05-01 07:30:00', 'UTC');

    app(CreateAnnouncement::class)->execute(
        $manager, 'Tin Vui Tháng Năm', 'Tủ sách mở cửa lại từ thứ Hai.',
        pinned: true, publishedAt: $when, expiresAt: $when->addDays(7),
    );

    $row = Announcement::query()->sole();
    expect($row->published_at?->equalTo($when))->toBeTrue()
        ->and($row->expires_at?->equalTo($when->addDays(7)))->toBeTrue()
        ->and($row->is_pinned)->toBeTrue();
});

it('a blank title refuses with announcement_fields_required and writes nothing', function () {
    // Whitespace only, not the empty string: the column is NOT NULL and
    // would take three spaces happily. Its own block, separate from the
    // body's — a failed expect() aborts the whole METHOD, so a single
    // block covering both fields would stop at the first and never
    // exercise the second.
    [, $manager] = anwFix('dong-thap-anw-t');

    expect(fn () => app(CreateAnnouncement::class)->execute($manager, '   ', 'Tủ sách mở cửa lại.'))
        ->toThrow(RuleViolated::class, 'announcement_fields_required');

    expect(Announcement::query()->count())->toBe(0);
});

it('a blank body refuses with the same one code, and writes nothing', function () {
    // The SAME code as the blank title — one sentence about one form,
    // the reference's own shape (createAnnouncement throws a single
    // announcement_fields_required for either field).
    [, $manager] = anwFix('dong-thap-anw-b');

    expect(fn () => app(CreateAnnouncement::class)->execute($manager, 'Tin Vui Tháng Năm', "  \n "))
        ->toThrow(RuleViolated::class, 'announcement_fields_required');

    expect(Announcement::query()->count())->toBe(0);
});

it('a second announcement with the same title on the same shelf gets -2', function () {
    [, $manager] = anwFix('dong-thap-anw-dup');

    app(CreateAnnouncement::class)->execute($manager, 'Tin Vui Tháng Năm', 'Lần một.');
    $second = app(CreateAnnouncement::class)->execute($manager, 'Tin Vui Tháng Năm', 'Lần hai.');

    expect($second['slug'])->toBe('tin-vui-thang-nam-2');
});

it('a soft-deleted announcement frees its slug for the next one', function () {
    // MEASURED IN laravel-mariadb-1 BEFORE THIS BLOCK WAS WRITTEN, on a
    // scratch copy of the live table: slug_key is
    // D5114F92…3FA56ECB while deleted_at is null and NULL once it is
    // set, and the second insert of the identical (bookshelf_id, slug)
    // pair then succeeds where it had raised errno 1062. Both halves of
    // this block ride on that one measurement — the command's read skips
    // trashed rows, and the index lets the write through.
    [, $manager] = anwFix('dong-thap-anw-del');

    $first = app(CreateAnnouncement::class)->execute($manager, 'Tin Vui Tháng Năm', 'Lần một.');
    Announcement::query()->findOrFail($first['announcementId'])->delete();

    $second = app(CreateAnnouncement::class)->execute($manager, 'Tin Vui Tháng Năm', 'Lần hai.');

    expect($second['slug'])->toBe('tin-vui-thang-nam');
});

it('a second shelf may hold the identical slug', function () {
    // The uniqueness is per shelf because bookshelf_id is inside the
    // hashed generated column — measured on the scratch copy: shelf-A
    // and shelf-B holding the slug 'tin-moi' produce two different
    // slug_key values (D5114F92… and 766457A7…) and both rows insert.
    //
    // This block is also the ONE that catches a shelf filter dropped
    // from the command's existing-slug read: on a single-shelf fixture
    // that mutation changes no answer at all, which is why the second
    // shelf is here rather than folded into the block above.
    [, $managerA] = anwFix('dong-thap-anw-a');
    app(CreateAnnouncement::class)->execute($managerA, 'Tin Vui Tháng Năm', 'Bên A.');

    [, $managerB] = anwFix('dong-thap-anw-b2');
    $onB = app(CreateAnnouncement::class)->execute($managerB, 'Tin Vui Tháng Năm', 'Bên B.');

    expect($onB['slug'])->toBe('tin-vui-thang-nam');
});

it('INV-8: announcement.created records the title, the slug and whether it went out', function () {
    [, $manager] = anwFix('dong-thap-anw-audit');

    $result = app(CreateAnnouncement::class)->execute($manager, 'Tin Vui Tháng Năm', 'Tủ sách mở cửa lại.');

    $entry = AuditLog::query()->where('action', 'announcement.created')->sole();
    $after = (array) $entry->after;
    expect($entry->entity_type)->toBe('announcement')
        ->and($entry->entity_id)->toBe($result['announcementId'])
        ->and($entry->actor_id)->toBe($manager->id)
        ->and((array) $entry->before)->toBe([])
        // THE WHOLE BAG, not a subset: toMatchArray would pass on a bag
        // that also carried the body.
        ->and($after)->toBe(['title' => 'Tin Vui Tháng Năm', 'slug' => 'tin-vui-thang-nam', 'published' => false]);

    // Key by key, and not by count: a bag of three keys that happened to
    // hold 'body' in place of 'published' has the same count.
    expect(array_key_exists('body', $after))->toBeFalse();
});

it('a real collision on announcements_bookshelf_id_slug_key becomes announcement_slug_taken', function () {
    // tests/Feature/Members/UniqueViolationRealCollisionTest.php's shape,
    // and its reason: the Unit test proves the parser matches its own
    // hand-built fixture, not a real driver message.
    //
    // The command's own read hands a second identical headline a `-2`,
    // so this raises the collision the way the losing side of a race
    // would — two rows written straight at the table with the same
    // (bookshelf_id, slug) pair, no command involved.
    [$shelf, $manager] = anwFix('dong-thap-anw-1062');
    $row = fn () => [
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf->id,
        'title' => 'Tin Vui Tháng Năm', 'slug' => 'tin-vui-thang-nam',
        'body' => 'x', 'body_text' => 'x', 'author_id' => $manager->id,
    ];

    DB::table('announcements')->insert($row());

    try {
        DB::table('announcements')->insert($row());
        test()->fail('expected a real errno 1062 from announcements_bookshelf_id_slug_key, the second insert succeeded');
    } catch (QueryException $e) {
        expect(fn () => UniqueViolation::translate($e, ['announcements_bookshelf_id_slug_key' => 'announcement_slug_taken']))
            ->toThrow(RuleViolated::class, 'announcement_slug_taken');
    }
});

it('announcement_slug_taken has a Vietnamese sentence', function () {
    // RuleViolatedCodesHaveSentencesTest's census globs literal
    // `new RuleViolated('code')` calls, and this code is never spelled
    // that way — it reaches RuleViolated as a map VALUE handed to
    // UniqueViolation::translate. Its own block, therefore, rather than
    // an entry in that census.
    $rules = require __DIR__.'/../../../lang/vi/rules.php';

    expect(array_key_exists('announcement_slug_taken', $rules))->toBeTrue();
    expect($rules['announcement_slug_taken'])->toBeString()->not->toBe('');
});

it('body_text is written from the trimmed body, never left empty', function () {
    // announcements.body_text is NOT NULL and takes '' happily. An empty
    // one here would make a published announcement unfindable by the
    // later search that reads this column — the reference's own reason
    // for its fallback.
    [, $manager] = anwFix('dong-thap-anw-text');

    app(CreateAnnouncement::class)->execute($manager, 'Tin Vui Tháng Năm', '  Tủ sách mở cửa lại từ thứ Hai.  ');

    $row = Announcement::query()->sole();
    expect($row->body_text)->toBe('Tủ sách mở cửa lại từ thứ Hai.');
});
