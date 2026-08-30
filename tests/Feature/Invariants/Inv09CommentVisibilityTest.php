<?php

use App\Actions\Community\ApproveComment;
use App\Actions\Community\CreateComment;
use App\Actions\Community\HideComment;
use App\Actions\Community\RejectComment;
use App\Enums\CommentStatus;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\Comment;
use App\Models\Membership;
use App\Models\User;
use App\Queries\BookCommentsQuery;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * INV-9 — "A comment is publicly visible only when APPROVED." (BR §6.)
 *
 * Port of old_next/tests/invariants/inv-09-comment-visibility.test.ts, with
 * two blocks the Laravel port earns (the soft-delete row and the
 * nothing-approved read).
 *
 * ASSERTED THROUGH THE MEMBER-FACING QUERY, never by filtering here. The
 * reference's own docblock gives the reason and it is worth restating: a
 * test that read every comment and filtered on status in PHP would pass
 * against a query with NO status predicate at all — which is the defect
 * INV-9 exists to prevent. So every assertion below goes through
 * BookCommentsQuery, and what it does not return is the evidence.
 *
 * EVERY BLOCK SEEDS THE THING IT EXCLUDES. An exclusion test whose fixture
 * has nothing to exclude proves nothing (Global Constraints), and an empty
 * list is the easiest green in this file to get for the wrong reason — so
 * where the expected answer is empty, the row that must not appear is
 * written first and its existence asserted, and where the expected answer
 * is non-empty, a control row rides along so a query that returned nothing
 * at all cannot pass.
 *
 * ONE CONTROL OF THE REFERENCE'S IS NOT PORTED, and its absence is
 * recorded rather than left to be noticed: its blocks 1, 2 and 6 each
 * also read getPendingComments — the manager-side queue — so that "a
 * pending comment is absent" cannot pass by the comment simply never
 * having been written. That query is Task 6's (GetPendingComments) and
 * does not exist yet, so the substitute here is a direct read of the row
 * from the database in the blocks that need it: block 1 asserts the
 * pending row's stored status, the nothing-approved block counts its
 * three unapproved rows, and the soft-delete blocks read deleted_at back
 * out of the table. When Task 6 lands, the queue-side half of those
 * controls can be added on top; nothing here is waiting on it.
 *
 * This file must survive BookCommentsQueryTest being deleted: it shares no
 * fixture with it (inv9Fix here, bcqFix there) and repeats the rows it
 * needs rather than reaching for that file's.
 *
 * No actingAs: the act-as-* gates read TenantContext's membership and
 * compare it to the $actor they are handed (AppServiceProvider), and
 * nothing here goes over HTTP — so binding the right membership is what
 * these blocks do, and the SessionGuard caching trap never enters.
 *
 * @return array{shelf: Bookshelf, manager: User, managerMembership: Membership, author: User, authorMembership: Membership, book: Book}
 */
function inv9Fix(string $slug = 'dong-thap-inv9'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $author = User::factory()->create(['full_name' => 'Têrêsa Lê Ngọc Ánh']);
    $authorMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $author->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men',
        'is_published' => true,
    ]);
    app(TenantContext::class)->set($shelf, $managerMembership);

    return [
        'shelf' => $shelf, 'manager' => $manager, 'managerMembership' => $managerMembership,
        'author' => $author, 'authorMembership' => $authorMembership, 'book' => $book,
    ];
}

/** A comment in a named status, written straight to the row. */
function inv9Comment(Book $book, User $author, string $status, string $body, ?string $at = null): Comment
{
    return Comment::query()->create(array_filter([
        'bookshelf_id' => $book->bookshelf_id, 'book_id' => $book->id, 'author_id' => $author->id,
        'body' => $body, 'status' => $status, 'created_at' => $at,
    ], fn (mixed $v): bool => $v !== null));
}

it('a pending comment is absent from the member-facing query', function () {
    // Seeded: one approved and one pending on the SAME book. The approved
    // one is the control — an empty answer would otherwise pass this block
    // for the wrong reason — and the pending one is the thing excluded.
    // Asserted BY ID, not by count: a count of 1 is also what a query
    // returning the wrong single row gives.
    $f = inv9Fix('dong-thap-inv9-pending');
    $approved = inv9Comment($f['book'], $f['author'], 'approved', 'Cuốn này hay lắm ạ');
    $pending = inv9Comment($f['book'], $f['author'], 'pending', 'Bình luận đang chờ duyệt');

    $ids = array_column(app(BookCommentsQuery::class)->run($f['book']), 'id');

    // Present in the database…
    expect(Comment::query()->whereKey($pending->id)->firstOrFail()->status)->toBe(CommentStatus::Pending)
        // …and absent from what a member sees.
        ->and($ids)->toBe([$approved->id])
        ->and($ids)->not->toContain($pending->id);
});

it('approving is what makes a pending comment visible — absent before, present after', function () {
    // The reference titles this one "approving is what makes it visible,
    // AND NOTHING ELSE DOES", and that half is deliberately not ported:
    // app/Actions/Community/ApproveComment.php's own docblock records that
    // CreateComment inserts a comment as approved outright when a shelf's
    // comments_require_approval is off, so on such a shelf publication
    // never passes through ApproveComment at all. What this block measures
    // is what its title now says — this pending comment is absent before
    // the approval and present after it.
    //
    // Seeded OUT OF ORDER on purpose: the PENDING comment is written
    // FIRST and the already-approved one second, so the newly approved
    // row must appear SECOND in a newest-first list — the reverse of the
    // order the two rows were created in. A query that returned rows in
    // insertion order gives a different sequence and reddens this block.
    //
    // NARROWED (fix round, item 2): the previous wording also claimed a
    // query "that read the ids' monotonicity as an ordering" would give a
    // different sequence. It would not. created_at ascends WITH the v7
    // ids here (10:00 written before 11:00), so a descending-id read
    // gives exactly the expected answer and this fixture cannot tell the
    // two apart. Only the ASCENDING direction is falsifiable from here,
    // and it is: this block reddens under the created_at-desc-to-asc
    // mutation (measured). What pins the tiebreak line itself is
    // BookCommentsQueryTest's ORDER BY text block, not row order.
    $f = inv9Fix('dong-thap-inv9-approve');
    $pending = inv9Comment($f['book'], $f['author'], 'pending', 'Em thích chú Dế Mèn', '2026-08-01 10:00:00');
    $approved = inv9Comment($f['book'], $f['author'], 'approved', 'Bình luận đã được duyệt từ trước', '2026-08-01 11:00:00');

    $before = array_column(app(BookCommentsQuery::class)->run($f['book']), 'id');

    app(ApproveComment::class)->execute($f['manager'], $pending);

    $after = array_column(app(BookCommentsQuery::class)->run($f['book']), 'id');

    expect($before)->toBe([$approved->id])
        ->and($before)->not->toContain($pending->id)
        ->and($after)->toBe([$approved->id, $pending->id]);
});

it('a rejected comment is never visible, to anyone — its own author included', function () {
    // OPEN QUESTION 2's default, ported as written: BookCommentsQuery
    // takes no viewer at all, so there is no "except mine" arm to reach.
    // IF that question is ever answered the other way — a reader sees
    // their own comment awaiting or refused — THIS BLOCK is where the
    // change lands, and the change is a DIFFERENT query beside this one,
    // not a loosened predicate on it (BookCommentsQuery's docblock).
    //
    // Seeded: a rejected comment written by the reader themselves, plus an
    // approved control so an empty answer cannot pass this. The read is
    // then repeated under the AUTHOR's own membership, which is the whole
    // of what "to anyone" can mean for a query with no viewer parameter.
    $f = inv9Fix('dong-thap-inv9-reject');
    $approved = inv9Comment($f['book'], $f['author'], 'approved', 'Bình luận hợp lệ');
    $rejected = inv9Comment($f['book'], $f['author'], 'pending', 'nội dung không phù hợp');

    app(RejectComment::class)->execute($f['manager'], $rejected, 'Nội dung chưa phù hợp với tủ sách');

    $asManager = array_column(app(BookCommentsQuery::class)->run($f['book']), 'id');

    // Rebound to the author's own membership — the row IS theirs
    // (author_id is their users id), and it is still absent.
    app(TenantContext::class)->set($f['shelf'], $f['authorMembership']);
    $asAuthor = array_column(app(BookCommentsQuery::class)->run($f['book']), 'id');

    expect($rejected->fresh()->author_id)->toBe($f['author']->id)
        ->and($asManager)->toBe([$approved->id])
        ->and($asManager)->not->toContain($rejected->id)
        ->and($asAuthor)->toBe([$approved->id])
        ->and($asAuthor)->not->toContain($rejected->id);
});

it('hiding pulls a comment that was already public', function () {
    // BR §7.5's approved -> hidden. The interesting half is that it goes
    // back through the same query: a comment can stop being visible after
    // HAVING BEEN visible, which a predicate written as "not rejected"
    // gets wrong.
    //
    // A second approved comment stays untouched throughout, so the read
    // after the hide is a list that still has something in it — the row
    // that vanished is named, rather than the whole answer collapsing to
    // empty and proving only that something broke.
    //
    // The $before SEQUENCE here discriminates one thing and not another
    // (fix round, item 2): the two rows' created_at ascends with their v7
    // ids, so descending-created_at and descending-id read alike and this
    // block cannot separate them. It does redden if the ordering runs
    // ascending (measured under the created_at asc mutation). The
    // sequence is asserted because it is free, not because it pins the
    // tiebreak.
    $f = inv9Fix('dong-thap-inv9-hide');
    $stays = inv9Comment($f['book'], $f['author'], 'approved', 'Bình luận vẫn ở lại', '2026-08-01 10:00:00');
    $hidden = inv9Comment($f['book'], $f['author'], 'approved', 'Bình luận này sẽ bị ẩn', '2026-08-01 11:00:00');

    $before = array_column(app(BookCommentsQuery::class)->run($f['book']), 'id');

    app(HideComment::class)->execute($f['manager'], $hidden);

    $after = array_column(app(BookCommentsQuery::class)->run($f['book']), 'id');

    expect($before)->toBe([$hidden->id, $stays->id])
        ->and($after)->toBe([$stays->id])
        ->and($after)->not->toContain($hidden->id);
});

it('a body containing <script> round-trips as literal text', function () {
    // BR §5.4: comments are plain text, rendered escaped. The failure this
    // guards is not "the database rejected it" — it is somebody later
    // adding a sanitiser and silently rewriting what a child wrote.
    // Escaping is the renderer's job; what needs pinning is that nothing
    // on the way IN (CreateComment) or OUT (BookCommentsQuery) alters the
    // bytes, which is why this block writes through the real command
    // rather than seeding the row.
    $f = inv9Fix('dong-thap-inv9-script');
    $body = '<script>alert("xin chào")</script> & <b>đậm</b>';

    app(TenantContext::class)->set($f['shelf'], $f['authorMembership']);
    $created = app(CreateComment::class)->execute($f['author'], $f['book'], $body);

    app(TenantContext::class)->set($f['shelf'], $f['managerMembership']);
    app(ApproveComment::class)->execute($f['manager'], Comment::query()->findOrFail($created['commentId']));

    $row = app(BookCommentsQuery::class)->run($f['book'])[0];

    expect($row['body'])->toBe($body)
        // Byte for byte in the column too — no entity encoding, no
        // stripping on the way in.
        ->and(Comment::query()->whereKey($created['commentId'])->value('body'))->toBe($body);
});

it('shelf A\'s book page shows shelf A\'s comment', function () {
    // WHAT THIS PAIR PINS IS THE BOOK NARROWING, and saying so precisely
    // matters more than the title suggests. comments_book_fk
    // (bookshelf_id, book_id) means a comment's book already belongs to
    // exactly one shelf, so a query narrowed by book_id excludes the other
    // shelf's comment whether or not Comment carries BelongsToBookshelf —
    // measured, and recorded in this task's report. A block claiming to
    // pin the model scope from here would be claiming something its
    // fixture cannot make true. Comment's model-level tenancy is pinned by
    // two shipped guards this task does not edit, both opened to check:
    // tests/Feature/Architecture/TenancyArchitectureTest.php ("puts
    // BelongsToBookshelf on every model whose table carries bookshelf_id")
    // and tests/Feature/Tenancy/TenantIsolationTest.php, whose dataset
    // names Comment::class.
    //
    // Its own it() beside the B half below because a failed expect()
    // aborts the whole METHOD: chained, a broken A read would hide the B
    // result entirely, and both halves are meant to be able to fail
    // visibly.
    $a = inv9Fix('dong-thap-inv9-shelf-a');
    $b = inv9Fix('dong-thap-inv9-shelf-b');
    // System-wide to WRITE both shelves' rows: BelongsToBookshelf's
    // creating hook refuses a foreign bookshelf_id while a shelf is bound,
    // which is the write-side half of the same tenancy this block reads.
    app(TenantContext::class)->actSystemWide();
    $aComment = inv9Comment($a['book'], $a['author'], 'approved', 'Bình luận của tủ sách A');
    $bComment = inv9Comment($b['book'], $b['author'], 'approved', 'Bình luận của tủ sách B');

    app(TenantContext::class)->set($a['shelf'], $a['managerMembership']);
    $ids = array_column(app(BookCommentsQuery::class)->run($a['book']), 'id');

    expect($ids)->toBe([$aComment->id])
        ->and($ids)->not->toContain($bComment->id);
});

it('shelf B\'s book page shows shelf B\'s comment', function () {
    // The other half of the pair above, read under B's context.
    $a = inv9Fix('dong-thap-inv9-shelf-a2');
    $b = inv9Fix('dong-thap-inv9-shelf-b2');
    app(TenantContext::class)->actSystemWide();
    $aComment = inv9Comment($a['book'], $a['author'], 'approved', 'Bình luận của tủ sách A');
    $bComment = inv9Comment($b['book'], $b['author'], 'approved', 'Bình luận của tủ sách B');

    app(TenantContext::class)->set($b['shelf'], $b['managerMembership']);
    $ids = array_column(app(BookCommentsQuery::class)->run($b['book']), 'id');

    expect($ids)->toBe([$bComment->id])
        ->and($ids)->not->toContain($aComment->id);
});

it('shelf B, handed shelf A\'s book, reads nothing — INV-10 through this query', function () {
    // The reference's own block-6 assertion (B's manager asking for A's
    // book by id), which the pair above does not make. Unlike that pair
    // this one IS sensitive to Comment's model scope — measured: with
    // BelongsToBookshelf deleted from Comment, the book_id predicate alone
    // hands B's context A's comment and this block reddens.
    //
    // This block calls the query directly, with no route in the way — a
    // screen that binds its book through the shelf never gets this far,
    // and the query is callable without a screen.
    $a = inv9Fix('dong-thap-inv9-cross-a');
    $b = inv9Fix('dong-thap-inv9-cross-b');
    app(TenantContext::class)->actSystemWide();
    $aComment = inv9Comment($a['book'], $a['author'], 'approved', 'Bình luận của tủ sách A');
    // Read back HERE, while the row is still reachable: under B's context
    // below, A's comment is out of scope and fresh() would answer null.
    $storedStatus = Comment::query()->whereKey($aComment->id)->firstOrFail()->status;

    app(TenantContext::class)->set($b['shelf'], $b['managerMembership']);
    $ids = array_column(app(BookCommentsQuery::class)->run($a['book']), 'id');

    expect($storedStatus)->toBe(CommentStatus::Approved)
        ->and($ids)->toBe([])
        ->and($ids)->not->toContain($aComment->id);
});

it('a comment deleted through the model is absent, and its row survives', function () {
    // BR §11: nothing is deleted. The row stays and stops being readable,
    // which is two facts, so this block asserts both — and the APPROVED
    // status it is deleted in is what stops the status predicate from
    // being the thing that excluded it.
    //
    // Under the trait-deletion mutation this block reddens on the
    // SURVIVAL half rather than on a leak, and that is the honest signal:
    // with SoftDeletes gone, delete() removes the row outright, so its
    // absence from the answer proves nothing about the read path. The
    // sibling block below is the one that shows the leak.
    $f = inv9Fix('dong-thap-inv9-deleted-model');
    $stays = inv9Comment($f['book'], $f['author'], 'approved', 'Bình luận vẫn ở lại');
    $deleted = inv9Comment($f['book'], $f['author'], 'approved', 'Bình luận đã bị xoá mềm qua model');

    $deleted->delete();

    $ids = array_column(app(BookCommentsQuery::class)->run($f['book']), 'id');

    expect(DB::table('comments')->where('id', $deleted->id)->value('deleted_at'))->not->toBeNull()
        ->and($ids)->toBe([$stays->id])
        ->and($ids)->not->toContain($deleted->id);
});

it('a row carrying deleted_at is absent — the model\'s scope, not the delete path', function () {
    // Its own block beside the one above because a failed expect() aborts
    // the whole METHOD, and under the trait-deletion mutation the two fail
    // for different reasons that both deserve to be seen.
    //
    // deleted_at is written STRAIGHT TO THE COLUMN here, which needs no
    // trait — so this row is soft-deleted whether or not Comment carries
    // SoftDeletes, and with the trait gone nothing filters it and the
    // query hands a deleted comment to a book page. Measured: that is
    // exactly how this block reddens.
    $f = inv9Fix('dong-thap-inv9-deleted-column');
    $stays = inv9Comment($f['book'], $f['author'], 'approved', 'Bình luận vẫn ở lại');
    $deleted = inv9Comment($f['book'], $f['author'], 'approved', 'Bình luận đã bị xoá mềm qua cột');

    DB::table('comments')->where('id', $deleted->id)->update(['deleted_at' => '2026-08-01 09:00:00']);

    $ids = array_column(app(BookCommentsQuery::class)->run($f['book']), 'id');

    expect(DB::table('comments')->where('id', $deleted->id)->value('deleted_at'))->not->toBeNull()
        ->and($ids)->toBe([$stays->id])
        ->and($ids)->not->toContain($deleted->id);
});

it('a book with nothing approved answers empty — not an error, and not a leak', function () {
    // The exclusion at its most fragile: the expected answer is an empty
    // list, which is also what a broken query returns. So the book carries
    // one comment of every unapproved status (a pending, a rejected and a
    // hidden — three rows that DO exist), and a sibling book on the same
    // shelf carries an approved one whose read is asserted in the same
    // breath, proving the query still answers.
    $f = inv9Fix('dong-thap-inv9-empty');
    inv9Comment($f['book'], $f['author'], 'pending', 'Đang chờ duyệt');
    inv9Comment($f['book'], $f['author'], 'rejected', 'Đã bị từ chối');
    inv9Comment($f['book'], $f['author'], 'hidden', 'Đã bị ẩn');
    $sibling = Book::query()->create([
        'bookshelf_id' => $f['shelf']->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be',
        'is_published' => true,
    ]);
    $visible = inv9Comment($sibling, $f['author'], 'approved', 'Bình luận đã được duyệt');

    expect(Comment::query()->where('book_id', $f['book']->id)->count())->toBe(3)
        ->and(app(BookCommentsQuery::class)->run($f['book']))->toBe([])
        ->and(array_column(app(BookCommentsQuery::class)->run($sibling), 'id'))->toBe([$visible->id]);
});
