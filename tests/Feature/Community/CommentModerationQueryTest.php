<?php

use App\Enums\CommentStatus;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\Comment;
use App\Models\Membership;
use App\Models\User;
use App\Queries\CommentModerationQuery;
use App\Queries\ManagerDashboardQuery;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Shelf + one reader + one book, tenant bound — the bcqFix/cmaFix shape.
 * No manager is seeded: CommentModerationQuery carries no inline gate
 * (the BorrowRequestQueueQuery precedent, its own docblock names three
 * queries it opened to check before writing that sentence), and none of
 * these blocks makes an HTTP request.
 *
 * Grep first: `grep -rn "^function cmqFix" tests/` — top-level helpers
 * are process-global (AGENTS.md).
 *
 * @return array{Bookshelf, Membership, User, Book}
 */
function cmqFix(string $slug = 'dong-thap-cmq'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $reader = User::factory()->create(['full_name' => 'Anna Phạm Thu Hà']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men-'.$slug,
        'is_published' => true,
    ]);
    app(TenantContext::class)->set($shelf, $membership);

    return [$shelf, $membership, $reader, $book];
}

function cmqSeed(Book $book, User $reader, string $status, string $body, ?string $createdAt = null): Comment
{
    return Comment::query()->create(array_filter([
        'bookshelf_id' => $book->bookshelf_id, 'book_id' => $book->id, 'author_id' => $reader->id,
        'body' => $body, 'status' => $status, 'created_at' => $createdAt,
    ], fn ($v) => $v !== null));
}

it('the queue is oldest first — seeded out of order so v7 ids cannot supply the answer', function () {
    // UUID v7 ids are chronologically monotonic (docs/known-gaps.md), so
    // creating rows in the intended order proves nothing — the middle
    // one (by created_at) is created LAST here, with created_at set
    // explicitly, so its id is the highest of the three while its place
    // in the answer is the middle.
    [, , $reader, $book] = cmqFix();
    $oldest = cmqSeed($book, $reader, 'pending', 'Bình luận buổi sáng', '2026-08-01 10:00:00');
    $newest = cmqSeed($book, $reader, 'pending', 'Bình luận buổi chiều', '2026-08-01 12:00:00');
    $middle = cmqSeed($book, $reader, 'pending', 'Bình luận buổi trưa', '2026-08-01 11:00:00');

    $ids = array_column(app(CommentModerationQuery::class)->queue(), 'id');

    expect($ids)->toBe([$oldest->id, $middle->id, $newest->id])
        // Named so a failure says which order was wrong: creation order
        // (oldest, newest, middle — middle was inserted last) is what an
        // unordered scan, or an id-ordered one, would hand back instead.
        ->and($ids)->not->toBe([$oldest->id, $newest->id, $middle->id]);
});

it('the queue is pending only', function () {
    [, , $reader, $book] = cmqFix();
    $pending = cmqSeed($book, $reader, 'pending', 'Đang chờ duyệt');
    $approved = cmqSeed($book, $reader, 'approved', 'Đã duyệt');
    $rejected = cmqSeed($book, $reader, 'rejected', 'Đã từ chối');
    $hidden = cmqSeed($book, $reader, 'hidden', 'Đã ẩn');

    $ids = array_column(app(CommentModerationQuery::class)->queue(), 'id');

    expect($ids)->toContain($pending->id)
        ->and($ids)->not->toContain($approved->id)
        ->and($ids)->not->toContain($rejected->id)
        ->and($ids)->not->toContain($hidden->id)
        ->and($ids)->toHaveCount(1);
});

it('decided returns one status, newest first, capped — seeded out of creation order', function () {
    // SEEDED SHUFFLED, for block 1's reason applied to the other
    // direction: v7 ids rise with creation time (docs/known-gaps.md), so
    // twelve rows inserted in ascending created_at order carry ascending
    // ids too, and a block built that way cannot tell
    // orderByDesc('created_at') from orderByDesc('id') — the two agree on
    // every row. Here the insertion sequence is a shuffle of the twelve
    // hours, so the id order and the created_at order are different
    // sequences and only one of them is the expected answer.
    [, , $reader, $book] = cmqFix('dong-thap-cmq-decided-order');
    $byHour = [];
    foreach ([5, 11, 0, 7, 3, 9, 1, 10, 2, 8, 4, 6] as $hour) {
        $byHour[$hour] = cmqSeed(
            $book, $reader, 'approved', "Bình luận lúc {$hour} giờ",
            sprintf('2026-08-01 %02d:00:00', $hour),
        );
    }
    $ids = fn (array $hours): array => array_map(fn (int $h): string => $byHour[$h]->id, $hours);

    $rows = app(CommentModerationQuery::class)->decided(CommentStatus::Approved, 10);

    expect(array_column($rows, 'id'))->toBe($ids([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]))
        // Named so a failure says which order was wrong: the ten highest
        // ids, newest-id first, are the last ten rows inserted — a
        // different set AND a different sequence from the ten newest by
        // created_at.
        ->and(array_column($rows, 'id'))->not->toBe($ids([6, 4, 8, 2, 10, 1, 9, 3, 7, 0]));
});

it('the queue\'s id tiebreak is in the ORDER BY text, not merely in the row order', function () {
    // MEASURED IN THE FIX ROUND, and this block exists because of what
    // was measured: deleting `->orderBy('id')` from queue() leaves every
    // row-order fixture in this file GREEN, including the same-instant
    // pair below.
    //
    // THE MECHANISM IS FILESORT INPUT ORDER, NOT AN INDEX SCAN, and the
    // first draft of this comment said the wrong one (re-review of fix
    // round 1). It claimed InnoDB appends the primary key to a secondary
    // index so an ascending scan emits a tied group in ascending id
    // order. That is BookCommentsQueryTest's mechanism, and it does not
    // transfer: `comments` carries exactly one index containing
    // created_at — comments_public (book_id, created_at) — and queue()
    // places no predicate on book_id, so that index cannot serve as an
    // ordered access path. EXPLAIN against olibra_testing: the
    // book-narrowed read uses comments_public with no filesort, while
    // queue() and decided() both use comments_book_fk with `Using
    // filesort`. There is no ascending scan here to appeal to.
    //
    // What actually happens: rows arrive through comments_book_fk
    // (bookshelf_id, book_id) plus the clustered PK, so within one shelf
    // the INPUT to the sort is already id-ascending, and MariaDB's
    // in-memory filesort preserves input order for a tied group — the
    // same property BorrowRequestQueueQueryTest pinned and had to correct
    // in ITS fix round 2, from this identical wrong framing. That
    // predicts the asymmetry measured here: the ascending pair gets
    // id-ascending for free, so deleting queue()'s tiebreak is invisible
    // to it, while decided() wants id-DESCENDING out of the same
    // ascending input, so deleting its tiebreak DOES redden.
    //
    // BOUNDED, not absolute: this holds while the filesort stays
    // in-memory and order-preserving. A fixture large enough to spill the
    // sort buffer into merge passes, or a plan change, is untested here.
    //
    // So the mechanism is pinned where a row-order test cannot reach it,
    // in the compiled SQL. The pattern is BookCommentsQueryTest's "the id
    // tiebreak is in the ORDER BY text" and OverdueLoansQueryTest's
    // ORDER BY pin before it.
    //
    // ->with(['author', 'book']) issues its own statements with no ORDER
    // BY, which is why this picks the logged statement that HAS one
    // rather than the first entry.
    [, , $reader, $book] = cmqFix('dong-thap-cmq-queue-sql-pin');
    cmqSeed($book, $reader, 'pending', 'Một bình luận để câu lệnh có dòng sắp xếp');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(CommentModerationQuery::class)->queue();
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    $main = collect($log)->first(fn (array $q): bool => str_contains($q['query'], 'order by'));

    expect($main)->not->toBeNull()
        ->and(str_contains((string) $main['query'], 'order by `created_at` asc, `id` asc'))
        ->toBeTrue('no created_at/id tiebreak in the queue ORDER BY: '.($main['query'] ?? ''));
});

it('decided\'s id tiebreak is in the ORDER BY text, not merely in the row order', function () {
    // The same pin in the other direction, and the measurement came out
    // DIFFERENTLY here, which is why it was run per line rather than
    // once: deleting `->orderByDesc('id')` from decided() does redden
    // the same-instant descending pair below, unlike the ascending case
    // above. This block still earns its place — it states the mechanism
    // rather than an engine behaviour that a later index or plan change
    // could withdraw quietly — but the honest claim is that decided()'s
    // tiebreak has two witnesses today and queue()'s has one.
    //
    // Its own it(), not a chain on the block above: a failed expect()
    // aborts the whole METHOD, and each ordering must be able to fail
    // alone.
    [, , $reader, $book] = cmqFix('dong-thap-cmq-decided-sql-pin');
    cmqSeed($book, $reader, 'approved', 'Một bình luận để câu lệnh có dòng sắp xếp');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(CommentModerationQuery::class)->decided(CommentStatus::Approved);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    $main = collect($log)->first(fn (array $q): bool => str_contains($q['query'], 'order by'));

    expect($main)->not->toBeNull()
        ->and(str_contains((string) $main['query'], 'order by `created_at` desc, `id` desc'))
        ->toBeTrue('no created_at/id tiebreak in the decided ORDER BY: '.($main['query'] ?? ''));
});

it('two pending comments written in the same instant come back id asc', function () {
    // created_at carries no unique constraint, so this pair ties by
    // construction and the v7 id is what breaks the tie. This block fixes
    // the DIRECTION of the queue's tiebreak — flipping the line to
    // descending reddens it — while the SQL-text block above is what
    // catches the line being deleted outright.
    [, , $reader, $book] = cmqFix('dong-thap-cmq-queue-tie');
    $first = cmqSeed($book, $reader, 'pending', 'Cùng một khoảnh khắc, viết trước', '2026-08-01 10:00:00');
    $second = cmqSeed($book, $reader, 'pending', 'Cùng một khoảnh khắc, viết sau', '2026-08-01 10:00:00');

    $ids = array_column(app(CommentModerationQuery::class)->queue(), 'id');

    expect($second->id)->toBeGreaterThan($first->id)
        ->and($ids)->toBe([$first->id, $second->id]);
});

it('two decided comments written in the same instant come back id desc', function () {
    [, , $reader, $book] = cmqFix('dong-thap-cmq-decided-tie');
    $first = cmqSeed($book, $reader, 'approved', 'Cùng một khoảnh khắc, viết trước', '2026-08-01 10:00:00');
    $second = cmqSeed($book, $reader, 'approved', 'Cùng một khoảnh khắc, viết sau', '2026-08-01 10:00:00');

    $ids = array_column(app(CommentModerationQuery::class)->decided(CommentStatus::Approved), 'id');

    expect($second->id)->toBeGreaterThan($first->id)
        ->and($ids)->toBe([$second->id, $first->id]);
});

it('decided refuses the pending status — that list belongs to the queue', function () {
    // The reference types this parameter "approved" | "rejected" |
    // "hidden" and PHP's enum cannot express that subset, so the refusal
    // is written out. Unguarded, decided(Pending) answers a capped,
    // newest-first pending list, which contradicts queue() in both order
    // and cardinality — and a screen whose ?status= chip picks a list
    // uniformly would render it under the pending chip with nothing
    // failing. A pending row is seeded so that the refusal is not merely
    // an empty table answering emptily.
    [, , $reader, $book] = cmqFix('dong-thap-cmq-decided-refuses-pending');
    cmqSeed($book, $reader, 'pending', 'Đang chờ duyệt');

    // The MESSAGE is asserted, not only the class: the whole value of
    // this refusal to the next caller is that it names where the pending
    // list actually lives, and a class-only assertion leaves that half
    // free to be deleted.
    expect(fn () => app(CommentModerationQuery::class)->decided(CommentStatus::Pending))
        ->toThrow(InvalidArgumentException::class, 'decided() reads an already-decided status; the pending list is queue()\'s, which is oldest-first and uncapped.');
});

it('decided for a status with no rows is an empty list, not an error', function () {
    [, , $reader, $book] = cmqFix('dong-thap-cmq-empty-decided');
    // A pending row exists, so the table itself is not empty — only the
    // asked-for status (rejected) has nothing.
    cmqSeed($book, $reader, 'pending', 'Đang chờ duyệt');

    expect(app(CommentModerationQuery::class)->decided(CommentStatus::Rejected))->toBe([]);
});

it('counts fills in the zeroes — a well-moderated shelf still answers four keys', function () {
    [, , $reader, $book] = cmqFix('dong-thap-cmq-zeroes');
    cmqSeed($book, $reader, 'pending', 'Đang chờ duyệt một');
    cmqSeed($book, $reader, 'pending', 'Đang chờ duyệt hai');

    $counts = app(CommentModerationQuery::class)->counts();

    expect(array_key_exists('pending', $counts))->toBeTrue()
        ->and(array_key_exists('approved', $counts))->toBeTrue()
        ->and(array_key_exists('rejected', $counts))->toBeTrue()
        ->and(array_key_exists('hidden', $counts))->toBeTrue();
});

it('counts fills in the zeroes — the three empty statuses read 0, not absent', function () {
    // A separate block from the key-presence one above: a failed
    // expect() aborts the whole METHOD, and "the keys exist" and "the
    // values are 0" are two facts that must each be able to fail alone
    // (AGENTS.md / the standing Pest-traps rule).
    [, , $reader, $book] = cmqFix('dong-thap-cmq-zeroes-values');
    cmqSeed($book, $reader, 'pending', 'Đang chờ duyệt');

    $counts = app(CommentModerationQuery::class)->counts();

    expect($counts['pending'])->toBe(1)
        ->and($counts['approved'])->toBe(0)
        ->and($counts['rejected'])->toBe(0)
        ->and($counts['hidden'])->toBe(0);
});

/**
 * The pending fixture the three agreement blocks below share: three
 * pending rows, plus rows in two other statuses so that agreeing on 3 is
 * not an accident of an otherwise-empty table.
 *
 * Grep first: `grep -rn "^function cmqAgreeFix" tests/` — top-level
 * helpers are process-global (AGENTS.md).
 */
function cmqAgreeFix(string $slug): CommentModerationQuery
{
    [, , $reader, $book] = cmqFix($slug);
    cmqSeed($book, $reader, 'pending', 'Chờ duyệt một');
    cmqSeed($book, $reader, 'pending', 'Chờ duyệt hai');
    cmqSeed($book, $reader, 'pending', 'Chờ duyệt ba');
    cmqSeed($book, $reader, 'approved', 'Đã duyệt');
    cmqSeed($book, $reader, 'rejected', 'Đã từ chối');

    return app(CommentModerationQuery::class);
}

// THREE BLOCKS, NOT ONE CHAIN, and the split is the fix for what the one
// chain could not do. queue(), counts()['pending'] and countPending() are
// three genuinely separate statements — a filtered SELECT, a GROUP BY and
// a COUNT — and the stated job of pinning them is catching TWO of them
// drifting. Chained through ->and(), a broken queue() short-circuits the
// rest and the run reports one failure that says nothing about whether
// the other two still agree; and a failed expect() aborts the whole
// METHOD, so separate statements inside one it() would not have helped
// either. Each reading gets its own block, each compared against the
// number the fixture seeded rather than against its neighbours.
it('the queue agrees with the seeded pending count', function () {
    expect(count(cmqAgreeFix('dong-thap-cmq-agree-queue')->queue()))->toBe(3);
});

it('the pending chip agrees with the seeded pending count', function () {
    expect(cmqAgreeFix('dong-thap-cmq-agree-chip')->counts()['pending'])->toBe(3);
});

it('countPending agrees with the seeded pending count', function () {
    expect(cmqAgreeFix('dong-thap-cmq-agree-count')->countPending())->toBe(3);
});

/**
 * The decided fixture the three chip/list blocks below share — a
 * different row count per status (pending 4, approved 3, rejected 2,
 * hidden 1), so a chip read against the wrong status disagrees with its
 * list instead of accidentally matching it.
 *
 * Grep first: `grep -rn "^function cmqChipFix" tests/`.
 */
function cmqChipFix(string $slug): CommentModerationQuery
{
    [, , $reader, $book] = cmqFix($slug);
    foreach (['pending' => 4, 'approved' => 3, 'rejected' => 2, 'hidden' => 1] as $status => $howMany) {
        for ($i = 1; $i <= $howMany; $i++) {
            cmqSeed($book, $reader, $status, "{$status} số {$i}");
        }
    }

    return app(CommentModerationQuery::class);
}

// THE OTHER THREE CHIPS, each against the list it sits above. counts()
// is a GROUP BY and decided() is a filtered SELECT: they share no
// predicate, so a chip counting one status while its list selects
// another is a live way for the screen to lie, and only the pending pair
// was pinned before. The cap is passed ABOVE the seeded row count on
// purpose — at the default 10 a truncated list would agree with a chip
// that had drifted, or disagree with one that had not, and neither
// answer would be about the predicate.
it('the approved chip agrees with the approved list', function () {
    $query = cmqChipFix('dong-thap-cmq-chip-approved');

    expect($query->counts()['approved'])->toBe(count($query->decided(CommentStatus::Approved, 50)))
        ->and($query->counts()['approved'])->toBe(3);
});

it('the rejected chip agrees with the rejected list', function () {
    $query = cmqChipFix('dong-thap-cmq-chip-rejected');

    expect($query->counts()['rejected'])->toBe(count($query->decided(CommentStatus::Rejected, 50)))
        ->and($query->counts()['rejected'])->toBe(2);
});

it('the hidden chip agrees with the hidden list', function () {
    $query = cmqChipFix('dong-thap-cmq-chip-hidden');

    expect($query->counts()['hidden'])->toBe(count($query->decided(CommentStatus::Hidden, 50)))
        ->and($query->counts()['hidden'])->toBe(1);
});

it('a trashed comment leaves the queue', function () {
    // SoftDeletes on Comment is what excludes it — CommentModerationQuery
    // writes no deleted_at predicate of its own. Two pending rows are
    // seeded and one is trashed, so the block tells exclusion apart from
    // an empty answer.
    //
    // THE RAW-ROW ASSERTION IS LOAD-BEARING, and it is here because the
    // fix round measured its absence: with SoftDeletes deleted from
    // Comment, ->delete() becomes a HARD delete, the row leaves the
    // table, and a block that only asked "is it excluded" stayed GREEN
    // through the very mutation it was written to catch (measured: 21
    // passed). Asserting the row is still IN the table is what turns
    // delete() into a stamp this query then has to skip.
    [, , $reader, $book] = cmqFix('dong-thap-cmq-trashed-queue');
    $kept = cmqSeed($book, $reader, 'pending', 'Còn lại');
    $trashed = cmqSeed($book, $reader, 'pending', 'Đã xoá');
    $trashed->delete();

    $stillThere = DB::table('comments')->where('id', $trashed->id)->whereNotNull('deleted_at')->exists();
    $ids = array_column(app(CommentModerationQuery::class)->queue(), 'id');

    expect($stillThere)->toBeTrue()
        ->and($ids)->toBe([$kept->id])
        ->and($ids)->not->toContain($trashed->id);
});

it('a trashed comment leaves the chips and the decided list', function () {
    // Its own it(): the chips are a different statement from the queue
    // (a GROUP BY, and no shared builder), and a failed expect() aborts
    // the whole METHOD. Same raw-row assertion, same reason as the block
    // above.
    [, , $reader, $book] = cmqFix('dong-thap-cmq-trashed-chips');
    $kept = cmqSeed($book, $reader, 'approved', 'Còn lại');
    $trashed = cmqSeed($book, $reader, 'approved', 'Đã xoá');
    $trashed->delete();

    $stillThere = DB::table('comments')->where('id', $trashed->id)->whereNotNull('deleted_at')->exists();
    $query = app(CommentModerationQuery::class);
    $ids = array_column($query->decided(CommentStatus::Approved, 50), 'id');

    expect($stillThere)->toBeTrue()
        ->and($query->counts()['approved'])->toBe(1)
        ->and($ids)->toBe([$kept->id])
        ->and($ids)->not->toContain($trashed->id);
});

it('another shelf\'s comments are in none of the queue, the archives or the counts', function () {
    [$shelf, $membership, $reader, $book] = cmqFix('dong-thap-cmq-tenancy-a');
    $mine = cmqSeed($book, $reader, 'pending', 'Bình luận của Tủ Đồng Tháp');

    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'can-tho-cmq-tenancy-b', 'settings' => []]);
    $otherReader = User::factory()->create(['full_name' => 'Giuse Tủ Khác']);
    Membership::factory()->for($other)->create([
        'user_id' => $otherReader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $otherBook = Book::query()->create([
        'bookshelf_id' => $other->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be-cmq-tenancy-b',
        'is_published' => true,
    ]);
    $theirs = Comment::query()->create([
        'bookshelf_id' => $other->id, 'book_id' => $otherBook->id, 'author_id' => $otherReader->id,
        'body' => 'Bình luận của Tủ Khác', 'status' => 'pending',
    ]);
    // APPROVED, on the other shelf, because decided() needs its own row
    // to leak. It does not inherit this scoping from queue(): base()
    // carries the eager loads and the columns, no scope logic at all,
    // and counts() and countPending() do not call it. What scopes all
    // four methods is BookshelfScope on Comment::query(), and this query
    // is shelf-scoped rather than book-narrowed, so that scope is the
    // whole mechanism — there is no book_id predicate underneath it the
    // way BookCommentsQuery has one.
    $theirsDecided = Comment::query()->create([
        'bookshelf_id' => $other->id, 'book_id' => $otherBook->id, 'author_id' => $otherReader->id,
        'body' => 'Bình luận đã duyệt của Tủ Khác', 'status' => 'approved',
    ]);

    app(TenantContext::class)->set($shelf, $membership);
    $query = app(CommentModerationQuery::class);
    $ids = array_column($query->queue(), 'id');
    $decided = array_column($query->decided(CommentStatus::Approved, 50), 'id');

    expect($ids)->toBe([$mine->id])
        ->and($ids)->not->toContain($theirs->id)
        ->and($query->counts()['pending'])->toBe(1)
        ->and($query->countPending())->toBe(1)
        ->and($decided)->toBe([])
        ->and($decided)->not->toContain($theirsDecided->id);
});

it('the dashboard\'s fourth card is the same number countPending() answers', function () {
    // Non-pending rows are seeded too, and that is load-bearing: a
    // countPending() that quietly counted every comment (dropping its
    // own status filter) would still agree with a fixture holding only
    // pending rows. The approved
    // and rejected rows here are what make "5 total, 2 pending" able to
    // tell the two apart.
    [, , $reader, $book] = cmqFix('dong-thap-cmq-dashboard');
    cmqSeed($book, $reader, 'pending', 'Chờ duyệt một');
    cmqSeed($book, $reader, 'pending', 'Chờ duyệt hai');
    cmqSeed($book, $reader, 'approved', 'Đã duyệt một');
    cmqSeed($book, $reader, 'approved', 'Đã duyệt hai');
    cmqSeed($book, $reader, 'rejected', 'Đã từ chối');

    $dashboard = app(ManagerDashboardQuery::class)->run();

    expect($dashboard['counts']['pendingComments'])
        ->toBe(app(CommentModerationQuery::class)->countPending())
        ->and($dashboard['counts']['pendingComments'])->toBe(2);
});
