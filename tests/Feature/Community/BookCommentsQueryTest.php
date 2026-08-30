<?php

use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\Comment;
use App\Models\Membership;
use App\Models\User;
use App\Queries\BookCommentsQuery;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Shelf + one reader + one book, tenant bound — the cmaFix shape
 * (tests/Feature/Community/ApproveCommentTest.php) with no manager,
 * because this file moderates nothing: it asks what the member-facing
 * query RETURNS, and seeds every row directly in the status it is to be
 * read in.
 *
 * Grep first: `grep -rn "^function bcqFix" tests/` — top-level helpers
 * are process-global (AGENTS.md).
 *
 * No actingAs anywhere in this file. BookCommentsQuery takes no viewer
 * and none of these blocks makes an HTTP request, so a session would add
 * only the SessionGuard caching trap docs/known-gaps.md records. The
 * tenant IS bound, because BookshelfScope fails closed on Comment and an
 * unbound read throws rather than returning rows.
 *
 * This fixture answers a different question from Inv09CommentVisibility's
 * inv9Fix, which is why there are two: this one asks "does the shape come
 * back right", that one asks "can anything make an unapproved comment
 * visible". Deleting this file must leave that one standing.
 *
 * @return array{Bookshelf, User, Book}
 */
function bcqFix(string $slug = 'dong-thap-bcq'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Lê Ngọc Ánh']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men',
        'is_published' => true,
    ]);
    app(TenantContext::class)->set($shelf, $membership);

    return [$shelf, $reader, $book];
}

it('a book page reads its approved comments — four fields, and exactly four', function () {
    [, $reader, $book] = bcqFix();
    $comment = Comment::query()->create([
        'bookshelf_id' => $book->bookshelf_id, 'book_id' => $book->id, 'author_id' => $reader->id,
        'body' => 'Con thích chú Dế Mèn', 'status' => 'approved',
        'created_at' => '2026-08-01 10:00:00',
    ]);

    $rows = app(BookCommentsQuery::class)->run($book);

    expect($rows)->toHaveCount(1)
        // The exact key set, not a subset: a query that also handed the
        // page `status`, `moderated_by` or `author_id` would satisfy every
        // per-key assertion below and still ship a moderation record to a
        // book page. array_keys equality is what refuses that.
        ->and(array_keys($rows[0]))->toBe(['id', 'body', 'authorName', 'createdAt'])
        ->and($rows[0]['id'])->toBe($comment->id)
        ->and($rows[0]['body'])->toBe('Con thích chú Dế Mèn')
        // From users.full_name through author(), with its diacritics
        // intact — not a memberships row, and not an id.
        ->and($rows[0]['authorName'])->toBe('Têrêsa Lê Ngọc Ánh')
        ->and($rows[0]['createdAt'])->toBe('2026-08-01T10:00:00.000000Z');
});

it('a manager\'s moderation note never reaches the book page', function () {
    // Its own block rather than a chain on the one above: a failed
    // expect() aborts the whole METHOD, and these are two facts that must
    // each be able to fail on their own.
    //
    // The note is SEEDED, and that is what makes this an exclusion rather
    // than a restatement of the fixture: there is a real manager's
    // sentence about this child's comment sitting on the row, and the
    // question is whether the book page can read it. Asserted key-by-key
    // with array_key_exists in both spellings the mapper might have used,
    // never `not->toHaveKeys`.
    [, $reader, $book] = bcqFix('dong-thap-bcq-note');
    $comment = Comment::query()->create([
        'bookshelf_id' => $book->bookshelf_id, 'book_id' => $book->id, 'author_id' => $reader->id,
        'body' => 'Con thích chú Dế Mèn', 'status' => 'approved',
        'moderation_note' => 'Đã sửa lỗi chính tả giúp bạn đọc',
    ]);

    $row = app(BookCommentsQuery::class)->run($book)[0];

    expect($comment->fresh()->moderation_note)->toBe('Đã sửa lỗi chính tả giúp bạn đọc')
        ->and(array_key_exists('moderation_note', $row))->toBeFalse()
        ->and(array_key_exists('moderationNote', $row))->toBeFalse()
        ->and(array_key_exists('status', $row))->toBeFalse();
});

it('newest first, seeded out of creation order so the ids cannot supply the answer', function () {
    // UUID v7 keys are chronologically monotonic (docs/known-gaps.md), so
    // three rows inserted oldest-first come back in the intended order
    // from an unordered scan and prove nothing. These three are inserted
    // middle, newest, oldest — the expected answer is a different sequence
    // from both insertion order and its reverse.
    [, $reader, $book] = bcqFix('dong-thap-bcq-order');
    $seed = function (string $body, string $at) use ($book, $reader): Comment {
        return Comment::query()->create([
            'bookshelf_id' => $book->bookshelf_id, 'book_id' => $book->id, 'author_id' => $reader->id,
            'body' => $body, 'status' => 'approved', 'created_at' => $at,
        ]);
    };
    $middle = $seed('Bình luận buổi trưa', '2026-08-01 11:00:00');
    $newest = $seed('Bình luận buổi chiều', '2026-08-01 12:00:00');
    $oldest = $seed('Bình luận buổi sáng', '2026-08-01 10:00:00');

    $ids = array_column(app(BookCommentsQuery::class)->run($book), 'id');

    expect($ids)->toBe([$newest->id, $middle->id, $oldest->id])
        // Named so the failure message says which order was wrong: neither
        // insertion order nor its reverse is the expected sequence.
        ->and($ids)->not->toBe([$middle->id, $newest->id, $oldest->id])
        ->and($ids)->not->toBe([$oldest->id, $newest->id, $middle->id]);
});

it('two comments written in the same instant come back id desc', function () {
    // created_at carries no unique constraint, so this pair ties by
    // construction, and the v7 id is what breaks the tie deterministically.
    //
    // MEASURED, and the measurement is the reason this comment exists
    // rather than a claim that the tiebreak line is pinned: deleting
    // `->orderByDesc('id')` from BookCommentsQuery leaves this block GREEN
    // on today's engine, because InnoDB appends the primary key to a
    // secondary index and the descending scan of comments_public
    // (book_id, created_at) already emits descending id within a tie.
    // What DOES redden it is flipping that line to ascending. The line
    // states an intent an index change could otherwise quietly withdraw;
    // MyNotificationsQuery's docblock records the same measurement for the
    // same reason.
    [, $reader, $book] = bcqFix('dong-thap-bcq-tie');
    $first = Comment::query()->create([
        'bookshelf_id' => $book->bookshelf_id, 'book_id' => $book->id, 'author_id' => $reader->id,
        'body' => 'Cùng một khoảnh khắc, viết trước', 'status' => 'approved',
        'created_at' => '2026-08-01 10:00:00',
    ]);
    $second = Comment::query()->create([
        'bookshelf_id' => $book->bookshelf_id, 'book_id' => $book->id, 'author_id' => $reader->id,
        'body' => 'Cùng một khoảnh khắc, viết sau', 'status' => 'approved',
        'created_at' => '2026-08-01 10:00:00',
    ]);

    $ids = array_column(app(BookCommentsQuery::class)->run($book), 'id');

    expect($second->id)->toBeGreaterThan($first->id)
        ->and($ids)->toBe([$second->id, $first->id]);
});

it('the id tiebreak is in the ORDER BY text, not merely in the row order', function () {
    // The block above can only ever falsify ONE direction of that line:
    // flipping it to ascending reddens it (measured), but DELETING it
    // leaves the whole file green, because InnoDB appends the primary key
    // to a secondary index and the descending scan already emits
    // descending id within a created_at tie. So the mechanism is pinned
    // where a row-order test cannot reach it — in the compiled SQL.
    //
    // The pattern is OverdueLoansQueryTest's "equally late loans are
    // ordered by a key that cannot tie — the ORDER BY is pinned", which
    // does exactly this with str_contains over the query log, and
    // BorrowRequestQueueQueryTest's "pins the tiebreak in the SQL itself"
    // does the same for a much heavier statement. This query is
    // single-table, so the log holds the statement plainly.
    //
    // ->with('author') issues its own second statement with no ORDER BY,
    // which is why the assertion picks the logged statement that HAS one
    // rather than the first entry.
    [, $reader, $book] = bcqFix('dong-thap-bcq-sql-pin');
    Comment::query()->create([
        'bookshelf_id' => $book->bookshelf_id, 'book_id' => $book->id, 'author_id' => $reader->id,
        'body' => 'Một bình luận để câu lệnh có dòng lệnh sắp xếp', 'status' => 'approved',
    ]);

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(BookCommentsQuery::class)->run($book);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    $main = collect($log)->first(fn (array $q): bool => str_contains($q['query'], 'order by'));

    expect($main)->not->toBeNull()
        ->and(str_contains((string) $main['query'], 'order by `created_at` desc, `id` desc'))
        ->toBeTrue('no created_at/id tiebreak in the ORDER BY: '.($main['query'] ?? ''));
});

it('a sibling book\'s comments never appear on this book\'s page', function () {
    // Same shelf, so the tenant scope cannot be what excludes it — this is
    // the book_id predicate on its own, and the sibling's comment is
    // APPROVED so there is a genuinely visible row to leak.
    [$shelf, $reader, $book] = bcqFix('dong-thap-bcq-sibling');
    $sibling = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be',
        'is_published' => true,
    ]);
    $mine = Comment::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'author_id' => $reader->id,
        'body' => 'Bình luận của Dế Mèn', 'status' => 'approved',
    ]);
    $theirs = Comment::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $sibling->id, 'author_id' => $reader->id,
        'body' => 'Bình luận của Hoàng Tử Bé', 'status' => 'approved',
    ]);

    $ids = array_column(app(BookCommentsQuery::class)->run($book), 'id');

    expect($ids)->toBe([$mine->id])
        ->and($ids)->not->toContain($theirs->id);
});

it('a book with no comments at all answers with an empty list, not an error', function () {
    [, , $book] = bcqFix('dong-thap-bcq-empty');

    expect(app(BookCommentsQuery::class)->run($book))->toBe([]);
});
