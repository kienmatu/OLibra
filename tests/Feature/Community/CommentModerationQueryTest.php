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

it('decided returns one status, newest first, capped', function () {
    [, , $reader, $book] = cmqFix();
    $comments = [];
    for ($i = 0; $i < 12; $i++) {
        $comments[] = cmqSeed(
            $book, $reader, 'approved', "Bình luận số {$i}",
            sprintf('2026-08-01 %02d:00:00', $i),
        );
    }
    $newest = end($comments);

    $rows = app(CommentModerationQuery::class)->decided(CommentStatus::Approved, 10);

    expect($rows)->toHaveCount(10)
        ->and($rows[0]['id'])->toBe($newest->id);
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

it('counts and the queue agree — three readings of one fact', function () {
    [, , $reader, $book] = cmqFix('dong-thap-cmq-agree');
    cmqSeed($book, $reader, 'pending', 'Chờ duyệt một');
    cmqSeed($book, $reader, 'pending', 'Chờ duyệt hai');
    cmqSeed($book, $reader, 'pending', 'Chờ duyệt ba');
    // Other statuses exist too, so the three readings agreeing is not
    // an accident of an otherwise-empty table.
    cmqSeed($book, $reader, 'approved', 'Đã duyệt');
    cmqSeed($book, $reader, 'rejected', 'Đã từ chối');

    $query = app(CommentModerationQuery::class);

    expect(count($query->queue()))->toBe(3)
        ->and($query->counts()['pending'])->toBe(3)
        ->and($query->countPending())->toBe(3);
});

it('another shelf\'s comments are in neither the queue nor the counts', function () {
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

    app(TenantContext::class)->set($shelf, $membership);
    $query = app(CommentModerationQuery::class);
    $ids = array_column($query->queue(), 'id');

    expect($ids)->toBe([$mine->id])
        ->and($ids)->not->toContain($theirs->id)
        ->and($query->counts()['pending'])->toBe(1)
        ->and($query->countPending())->toBe(1);
});

it('the dashboard\'s fourth card is the same number countPending() answers', function () {
    // Non-pending rows are seeded too, and that is load-bearing: a
    // countPending() that quietly counted every comment (dropping its
    // own status filter) would still agree with a fixture holding only
    // pending rows — see task-6-report.md's mutation (2). The approved
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
