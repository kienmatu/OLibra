<?php

use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Queries\AuditLogQuery;
use App\Support\TenantContext;

/**
 * Two shelves with DISTINGUISHABLE audit histories plus one global
 * (null-bookshelf_id) row — a one-row-per-shelf fixture cannot tell
 * "scoped to this shelf" from "scoped to everything" (1c's measured
 * fixture-shape lesson). Rows are inserted with EXPLICIT occurred_at
 * values in an order that differs from every asserted order, because
 * audit_log.id is a monotonic BIGINT and an unordered scan returns
 * creation order (the five-times-fired trap, in its bigint costume).
 *
 * Grep first: `grep -rn "^function alogFix" tests/`.
 */
function alogFix(): array
{
    app(TenantContext::class)->actSystemWide();

    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-alog', 'settings' => []]);
    $other = Bookshelf::factory()->create(['slug' => 'can-tho-alog', 'settings' => []]);

    $maria = User::factory()->create(['full_name' => 'Maria Quản Lý Nhật Ký']);
    $mariaMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $maria->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $child = User::factory()->create(['full_name' => 'Giuse Bé Đọc Sách']);
    $childMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $child->id, 'role' => 'reader', 'status' => 'active',
    ]);

    $row = fn (array $overrides) => AuditLog::query()->create(array_merge([
        'bookshelf_id' => $shelf->id, 'actor_id' => $maria->id,
        'action' => 'copy.lost_reported', 'entity_type' => 'copy', 'entity_id' => null,
        'before' => null, 'after' => null, 'context' => [],
    ], $overrides));

    // Seeded MIDDLE, NEWEST, OLDEST — creation order differs from
    // occurred_at desc. The two 10:00:00 rows tie on the timestamp so the
    // id-desc tiebreak is falsifiable (AddCopies' one-instant burst is the
    // ordinary case, not the corner).
    $middle = $row(['action' => 'loan.created', 'entity_type' => 'loan',
        'after' => ['title' => 'Dế Mèn Phiêu Lưu Ký', 'borrower_id' => $child->id],
        'occurred_at' => '2026-08-10 10:00:00']);
    $tieLate = $row(['action' => 'copy.added', 'after' => ['code' => 'DT-0201'],
        'occurred_at' => '2026-08-10 10:00:00']);
    $newest = $row(['action' => 'membership.approved', 'entity_type' => 'membership',
        'entity_id' => $childMembership->id, 'occurred_at' => '2026-08-11 09:00:00']);
    $oldest = $row(['action' => 'credentials.set', 'entity_type' => 'user',
        'entity_id' => $child->id, 'occurred_at' => '2026-08-01 02:00:00']);

    // Foreign and global rows: both must be invisible to this shelf.
    $foreignActor = User::factory()->create(['full_name' => 'Anna Tủ Khác']);
    AuditLog::query()->create([
        'bookshelf_id' => $other->id, 'actor_id' => $foreignActor->id,
        'action' => 'book.created', 'entity_type' => 'book', 'entity_id' => null,
        'before' => null, 'after' => ['title' => 'Sách Của Tủ Khác'], 'context' => [],
        'occurred_at' => '2026-08-10 12:00:00',
    ]);
    AuditLog::query()->create([
        'bookshelf_id' => null, 'actor_id' => null,
        'action' => 'bookshelf.created', 'entity_type' => 'bookshelf', 'entity_id' => null,
        'before' => null, 'after' => ['name' => 'Tủ Toàn Cục'], 'context' => [],
        'occurred_at' => '2026-08-10 12:00:00',
    ]);

    app(TenantContext::class)->set($shelf, $mariaMembership);
    test()->actingAs($maria);

    return compact('shelf', 'other', 'maria', 'mariaMembership', 'child', 'childMembership',
        'middle', 'tieLate', 'newest', 'oldest', 'foreignActor');
}

it('orders occurred_at desc then id desc, proven on a tie seeded out of order', function () {
    $f = alogFix();

    $ids = collect(app(AuditLogQuery::class)->run()['rows'])->pluck('id')->all();

    expect($ids)->toBe([
        (string) $f['newest']->id,
        (string) $f['tieLate']->id,   // same instant as middle; larger id wins
        (string) $f['middle']->id,
        (string) $f['oldest']->id,
    ]);
});

it('pages a one-instant burst without repeating or skipping a row', function () {
    // The tie assertion above is WEAK on its own and must not be the only
    // pin: with `order by occurred_at desc` alone MariaDB can walk
    // audit_log_shelf (bookshelf_id, occurred_at) backwards and hand back
    // ties in descending PK order anyway — the same answer the id key
    // produces, for a reason the query does not own. What the second sort
    // key actually buys is a TOTAL order across a limit/offset boundary,
    // so pin that instead: 30 rows sharing one occurred_at, paged, must
    // union to 30 distinct ids.
    $f = alogFix();
    foreach (range(1, 30) as $i) {
        AuditLog::query()->create([
            'bookshelf_id' => $f['shelf']->id, 'actor_id' => $f['maria']->id,
            'action' => 'copy.added', 'entity_type' => 'copy', 'entity_id' => null,
            'before' => null, 'after' => ['code' => sprintf('DT-8%03d', $i)], 'context' => [],
            'occurred_at' => '2026-08-15 08:00:00',   // ONE instant, 30 rows
        ]);
    }

    $q = app(AuditLogQuery::class);
    $seen = array_merge(
        collect($q->run(page: 1)['rows'])->pluck('id')->all(),
        collect($q->run(page: 2)['rows'])->pluck('id')->all(),
    );

    // 4 fixture rows + 30 = 34: page 1 returns 25, page 2 returns 9.
    expect($seen)->toHaveCount(34)
        ->and(array_unique($seen))->toHaveCount(34);
});

it('never shows another shelf\'s rows, and never a global null-shelf row', function () {
    alogFix();

    $rows = app(AuditLogQuery::class)->run();

    expect($rows['total'])->toBe(4);
    foreach ($rows['rows'] as $row) {
        expect($row['sentence'])->not->toContain('Tủ Khác')
            ->and($row['sentence'])->not->toContain('Toàn Cục')
            ->and($row['action'])->not->toBe('bookshelf.created');
    }
});

it('renders each entry as its Vietnamese sentence with names resolved from stored ids', function () {
    $f = alogFix();

    $bySentence = collect(app(AuditLogQuery::class)->run()['rows'])->pluck('sentence', 'action');

    // Subject via after.borrower_id (a loan's entity is the loan; the
    // person is inside the payload):
    expect($bySentence['loan.created'])
        ->toBe('Maria Quản Lý Nhật Ký đã cho Giuse Bé Đọc Sách mượn Dế Mèn Phiêu Lưu Ký')
        // Subject via the membership entity join:
        ->and($bySentence['membership.approved'])
        ->toBe('Maria Quản Lý Nhật Ký đã duyệt tài khoản của Giuse Bé Đọc Sách')
        // Subject via the user entity join, with NO payload at all:
        ->and($bySentence['credentials.set'])
        ->toBe('Maria Quản Lý Nhật Ký đã đặt hoặc đổi tài khoản đăng nhập cho Giuse Bé Đọc Sách');
});

it('keeps naming a soft-deleted person — the log never rewrites itself', function () {
    $f = alogFix();
    $f['child']->delete();   // SoftDeletes

    $rows = collect(app(AuditLogQuery::class)->run()['rows'])->pluck('sentence', 'action');

    expect($rows['credentials.set'])->toContain('Giuse Bé Đọc Sách');
});

it('the actor filter narrows what is visible and never widens it', function () {
    $f = alogFix();

    // A well-formed uuid naming the OTHER shelf's actor: an empty page,
    // never Vĩnh Long's history (the reference's exact property).
    expect(app(AuditLogQuery::class)->run(actorId: $f['foreignActor']->id)['total'])->toBe(0)
        ->and(app(AuditLogQuery::class)->run(actorId: $f['maria']->id)['total'])->toBe(4);
});

it('the group filter partitions by family, from the one map that owns it', function () {
    alogFix();

    $q = app(AuditLogQuery::class);
    expect(collect($q->run(group: 'loans')['rows'])->pluck('action')->all())->toBe(['loan.created'])
        ->and($q->run(group: 'books')['total'])->toBe(1)      // copy.added
        ->and($q->run(group: 'readers')['total'])->toBe(2);   // membership.approved + credentials.set
});

it('date bounds are civil days in Asia/Ho_Chi_Minh, inclusive — the seven-hour trap, pinned', function () {
    $f = alogFix();
    // 2026-08-10 17:30 UTC is ALREADY 2026-08-11 00:30 in Hồ Chí Minh City.
    $lateUtc = AuditLog::query()->create([
        'bookshelf_id' => $f['shelf']->id, 'actor_id' => $f['maria']->id,
        'action' => 'copy.retired', 'entity_type' => 'copy', 'entity_id' => null,
        'before' => null, 'after' => ['reason' => 'rách nát'], 'context' => [],
        'occurred_at' => '2026-08-10 17:30:00',
    ]);

    $aug10 = app(AuditLogQuery::class)->run(from: '2026-08-10', to: '2026-08-10');
    $aug11 = app(AuditLogQuery::class)->run(from: '2026-08-11', to: '2026-08-11');

    // The two 08-10 10:00-UTC rows are 17:00 VN on the 10th; the 17:30
    // UTC row belongs to the 11th alongside membership.approved (09:00
    // UTC on the 11th = 16:00 VN).
    expect(collect($aug10['rows'])->pluck('id'))->not->toContain((string) $lateUtc->id)
        ->and($aug10['total'])->toBe(2)
        ->and(collect($aug11['rows'])->pluck('id'))->toContain((string) $lateUtc->id)
        ->and($aug11['total'])->toBe(2);
});

it('pages at 25 with a total the empty page still carries', function () {
    $f = alogFix();
    foreach (range(1, 26) as $i) {
        AuditLog::query()->create([
            'bookshelf_id' => $f['shelf']->id, 'actor_id' => $f['maria']->id,
            'action' => 'copy.added', 'entity_type' => 'copy', 'entity_id' => null,
            'before' => null, 'after' => ['code' => sprintf('DT-9%03d', $i)], 'context' => [],
            'occurred_at' => '2026-08-12 08:00:00',
        ]);
    }

    $p1 = app(AuditLogQuery::class)->run();
    $p2 = app(AuditLogQuery::class)->run(page: 2);
    $p9 = app(AuditLogQuery::class)->run(page: 9);

    expect($p1['rows'])->toHaveCount(25)->and($p1['total'])->toBe(30)
        ->and($p1['pageCount'])->toBe(2)
        ->and($p2['rows'])->toHaveCount(5)
        // Unlike the reference (its recorded pager-stranding defect), an
        // empty page still knows the total, so the pager can render.
        ->and($p9['rows'])->toBe([])->and($p9['total'])->toBe(30);
});

it('a hostile after.borrower_id resolves to no subject, and renders', function () {
    $f = alogFix();
    // Whatever a build once serialised: Vietnamese text and an emoji where
    // a uuid belongs. What this pins is the OUTCOME — no subject, the bare
    // sentence, a rendered page. It does NOT pin the CONVERT guard: measured
    // on MariaDB 10.11.19, the raw JSON comparison does not raise 1267
    // either (divergence 5's table), so this test is green with the guard
    // removed. The guard is defence in depth; the bind guards in Task 4 are
    // the ones the 1267 class actually needs.
    AuditLog::query()->create([
        'bookshelf_id' => $f['shelf']->id, 'actor_id' => $f['maria']->id,
        'action' => 'loan.created', 'entity_type' => 'loan', 'entity_id' => null,
        'before' => null,
        'after' => ['title' => 'Sách Lạ', 'borrower_id' => 'Giáo họ Đức Mẹ 📚'],
        'context' => [], 'occurred_at' => '2026-08-13 08:00:00',
    ]);

    $rows = app(AuditLogQuery::class)->run();

    expect($rows['total'])->toBe(5)
        ->and(collect($rows['rows'])->first(fn ($r) => str_starts_with($r['occurredAt'], '2026-08-13'))['sentence'])
        ->toBe('Maria Quản Lý Nhật Ký đã cho mượn Sách Lạ');   // subject null → bare form
});

it('an action this build has no sentence for renders the fallback, raw name only in the row data', function () {
    // THE FIXTURE ACTION MOVED IN PHASE 3b-ii TASK 5, and the reason is
    // this test working exactly as intended. It used 'parish_unit.created',
    // which was unregistered when this was written and IS registered now
    // that manage/units ships — so the fallback stopped being the answer and
    // this test went red on the real sentence, which is the correct
    // behaviour of a guard against an unregistered action.
    //
    // 'parish_unit.merged' replaces it: there is no such command anywhere,
    // in this codebase or in the reference (OPS §4.5 lists four unit acts —
    // create, rename, delete, reorder — and merging two đơn vị is not among
    // them). It is also deliberately SHAPED like a real action, dotted and
    // snake_cased, so the fallback is proved against something the parser
    // accepts rather than against a malformed string.
    $f = alogFix();
    AuditLog::query()->create([
        'bookshelf_id' => $f['shelf']->id, 'actor_id' => $f['maria']->id,
        'action' => 'parish_unit.merged', 'entity_type' => 'parish_unit', 'entity_id' => null,
        'before' => null, 'after' => ['name' => 'Tổ 1'], 'context' => [],
        'occurred_at' => '2026-08-14 08:00:00',
    ]);

    $row = app(AuditLogQuery::class)->run()['rows'][0];

    expect($row['sentence'])->toBe('Maria Quản Lý Nhật Ký đã thực hiện một thao tác hệ thống chưa được mô tả')
        ->and($row['sentence'])->not->toContain('parish_unit.merged')
        ->and($row['action'])->toBe('parish_unit.merged')   // the expansion's copy
        ->and($row['group'])->toBeNull();
});

it('the expansion carries the stored values, em-dashed where never recorded', function () {
    $f = alogFix();

    $row = collect(app(AuditLogQuery::class)->run()['rows'])
        ->firstWhere('action', 'credentials.set');

    // No payload at all, by design: nothing to expand is the correct answer.
    expect($row['expansion'])->toBe([]);

    $loan = collect(app(AuditLogQuery::class)->run()['rows'])->firstWhere('action', 'loan.created');
    $fields = array_column($loan['expansion'], 'field');
    expect($fields)->toBe(['borrower_id', 'title'])
        ->and($loan['expansion'][1])->toBe(['field' => 'title', 'before' => '—', 'after' => '"Dế Mèn Phiêu Lưu Ký"']);
});

it('lists actors most-active first, for the filter control', function () {
    $f = alogFix();

    // A SECOND actor on this shelf, with fewer entries and a name that
    // sorts BEFORE Maria's in every collation — so "most active first" is
    // falsifiable. With one actor the ordering claim asserts nothing.
    app(TenantContext::class)->actSystemWide();
    $anh = User::factory()->create(['full_name' => 'Anna Ít Việc']);
    AuditLog::query()->create([
        'bookshelf_id' => $f['shelf']->id, 'actor_id' => $anh->id,
        'action' => 'copy.found', 'entity_type' => 'copy', 'entity_id' => null,
        'before' => null, 'after' => null, 'context' => [],
        'occurred_at' => '2026-08-12 01:00:00',
    ]);
    app(TenantContext::class)->set($f['shelf'], $f['mariaMembership']);

    $actors = app(AuditLogQuery::class)->actors();

    expect($actors)->toBe([
        ['userId' => $f['maria']->id, 'name' => 'Maria Quản Lý Nhật Ký', 'entries' => 4],
        ['userId' => $anh->id, 'name' => 'Anna Ít Việc', 'entries' => 1],
    ]);
});

it('resolves a subject from the payload\'s userId when nothing earlier in the coalesce does', function () {
    // Phase 2a's request.* payloads name the reader `userId`, not
    // `borrower_id` (Task 1's fourth join). No request.* writer exists
    // yet — Tasks 5-8 mint them — so the row here is a deliberate stand-in
    // whose only job is to make the JOIN falsifiable now rather than
    // leaving it dead until Task 6: entity_type is not `user` or
    // `membership`, and the payload carries no borrower_id, so the three
    // earlier joins all miss and only the userId join can name anybody.
    // Break the join (its `$.userId` path, or drop it from the coalesce)
    // and this test is the one that goes red.
    $f = alogFix();
    AuditLog::query()->create([
        'bookshelf_id' => $f['shelf']->id, 'actor_id' => $f['maria']->id,
        'action' => 'loan.created', 'entity_type' => 'request', 'entity_id' => null,
        'before' => null,
        'after' => ['title' => 'Hoàng Tử Bé', 'userId' => $f['child']->id],
        'context' => [], 'occurred_at' => '2026-08-14 08:00:00',
    ]);
    // …and borrower_id still WINS when a row carries both, because it sits
    // ahead of userId in the coalesce. A one-row fixture could not tell
    // "userId resolves" from "userId resolves FIRST".
    $other = User::factory()->create(['full_name' => 'Phêrô Người Mượn Thật']);
    AuditLog::query()->create([
        'bookshelf_id' => $f['shelf']->id, 'actor_id' => $f['maria']->id,
        'action' => 'loan.created', 'entity_type' => 'request', 'entity_id' => null,
        'before' => null,
        'after' => ['title' => 'Totto-chan', 'borrower_id' => $other->id, 'userId' => $f['child']->id],
        'context' => [], 'occurred_at' => '2026-08-15 08:00:00',
    ]);

    $rows = collect(app(AuditLogQuery::class)->run()['rows']);
    $viaUserId = $rows->first(fn ($r) => str_starts_with($r['occurredAt'], '2026-08-14'));
    $viaBorrower = $rows->first(fn ($r) => str_starts_with($r['occurredAt'], '2026-08-15'));

    expect($viaUserId['sentence'])->toBe('Maria Quản Lý Nhật Ký đã cho Giuse Bé Đọc Sách mượn Hoàng Tử Bé')
        ->and($viaBorrower['sentence'])->toBe('Maria Quản Lý Nhật Ký đã cho Phêrô Người Mượn Thật mượn Totto-chan');
});
