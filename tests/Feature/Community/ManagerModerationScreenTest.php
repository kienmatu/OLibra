<?php

use App\Enums\CommentStatus;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\Comment;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * Shelf + manager + reader + one book + one PENDING comment, over HTTP —
 * the mqsFix shape (tests/Feature/Circulation/ManagerQueueScreenTest.php),
 * which is the manager-screen fixture this file's blocks are built on.
 *
 * Grep first: `grep -rn "^function mmsFix" tests/` — top-level helpers are
 * process-global (AGENTS.md).
 *
 * No actingAs() here, unlike cmaFix in ApproveCommentTest: every block
 * below drives the screen over HTTP and several of them act as the READER
 * rather than the manager, and SessionGuard caches the acting user for a
 * whole test method — so the actor is chosen by each block, once.
 *
 * @return array{Bookshelf, User, User, Book, Comment}
 */
function mmsFix(string $slug = 'dong-thap-mms'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men',
        'is_published' => true,
    ]);
    $comment = mmsSeed($shelf, $book, $reader, CommentStatus::Pending, 'Con thích chú Dế Mèn');

    return [$shelf, $manager, $reader, $book, $comment];
}

/** One more comment on the fixture's book, in whatever status a block needs. */
function mmsSeed(Bookshelf $shelf, Book $book, User $author, CommentStatus $status, string $body): Comment
{
    return Comment::query()->create([
        'bookshelf_id' => $shelf->id,
        'book_id' => $book->id,
        'author_id' => $author->id,
        'body' => $body,
        'status' => $status,
    ]);
}

it('GET /manage/comments renders the pending queue and the four chip counts', function () {
    [$shelf, $manager, $reader, $book] = mmsFix();
    mmsSeed($shelf, $book, $reader, CommentStatus::Approved, 'Đã duyệt rồi');
    mmsSeed($shelf, $book, $reader, CommentStatus::Rejected, 'Đã từ chối rồi');
    mmsSeed($shelf, $book, $reader, CommentStatus::Hidden, 'Đã ẩn rồi');

    test()->actingAs($manager)->get("/shelves/{$shelf->slug}/manage/comments")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/comments')
            ->where('status', 'pending')
            ->where('comments.0.body', 'Con thích chú Dế Mèn')
            // Queried, never counted from the list above — the list holds
            // one row and three of these numbers name statuses it does not
            // contain at all.
            ->where('counts.pending', 1)
            ->where('counts.approved', 1)
            ->where('counts.rejected', 1)
            ->where('counts.hidden', 1));
});

it('POST approve publishes the comment and lands back with the approve flash', function () {
    [$shelf, $manager, , , $comment] = mmsFix('dong-thap-mms-approve');

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/comments/{$comment->id}/approve",
    );

    $response->assertRedirect()->assertSessionHas('success', __('rules.comment_approved_flash'));
    expect($comment->fresh()->status)->toBe(CommentStatus::Approved);
});

it('POST reject turns the comment away and lands back with the reject flash', function () {
    [$shelf, $manager, , , $comment] = mmsFix('dong-thap-mms-reject');

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/comments/{$comment->id}/reject",
        ['reason' => 'Bình luận có từ ngữ chưa phù hợp.'],
    );

    $response->assertRedirect()->assertSessionHas('success', __('rules.comment_rejected_flash'));
    expect($comment->fresh()->status)->toBe(CommentStatus::Rejected);
});

it('POST hide pulls an approved comment and lands back with the hide flash', function () {
    [$shelf, $manager, $reader, $book] = mmsFix('dong-thap-mms-hide');
    $approved = mmsSeed($shelf, $book, $reader, CommentStatus::Approved, 'Đã hiển thị công khai');

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/comments/{$approved->id}/hide",
        ['reason' => 'Phụ huynh đề nghị gỡ.'],
    );

    $response->assertRedirect()->assertSessionHas('success', __('rules.comment_hidden_flash'));
    expect($approved->fresh()->status)->toBe(CommentStatus::Hidden);
});

/*
 * FOUR BLOCKS FOR THE READER, NOT ONE. A failed expect() aborts the whole
 * test METHOD, so a regression that reopened the GET would also hide
 * whether the three POSTs beneath it still refused. That is the structure
 * defect 2a's Task 14 shipped and had to fix, and it is what makes the
 * `role:manager` measurement in this task's report takeable at all: each
 * of the four numbers comes from a block that runs whatever the other
 * three answered.
 *
 * 404, never 403 — spec §5.4's anti-enumeration rule: a reader of this
 * shelf must not learn from a status code that the moderation screen, or
 * any particular comment id, is there.
 *
 * The actor is the same reader in all four, so splitting costs nothing
 * SessionGuard's per-method actor cache was guarding.
 */
it('a reader of the shelf 404s on the moderation screen', function () {
    [$shelf, , $reader] = mmsFix('dong-thap-mms-reader-get');

    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/manage/comments")->assertNotFound();
});

it('a reader of the shelf 404s on the approve POST', function () {
    [$shelf, , $reader, , $comment] = mmsFix('dong-thap-mms-reader-approve');

    test()->actingAs($reader)->post(
        "/shelves/{$shelf->slug}/manage/comments/{$comment->id}/approve",
    )->assertNotFound();
});

it('a reader of the shelf 404s on the reject POST', function () {
    [$shelf, , $reader, , $comment] = mmsFix('dong-thap-mms-reader-reject');

    test()->actingAs($reader)->post(
        "/shelves/{$shelf->slug}/manage/comments/{$comment->id}/reject",
        ['reason' => 'không được phép'],
    )->assertNotFound();
});

it('a reader of the shelf 404s on the hide POST', function () {
    [$shelf, , $reader, $book] = mmsFix('dong-thap-mms-reader-hide');
    $approved = mmsSeed($shelf, $book, $reader, CommentStatus::Approved, 'Đã hiển thị công khai');

    test()->actingAs($reader)->post(
        "/shelves/{$shelf->slug}/manage/comments/{$approved->id}/hide",
    )->assertNotFound();
});

it('an unrecognised ?status= renders the pending view rather than an error', function () {
    // QueryParam::first's $default fires only on null, and "banana" is not
    // null — so the narrowing that answers this is CommentStatus::tryFrom
    // plus a coalesce in the controller, not the default.
    [$shelf, $manager] = mmsFix('dong-thap-mms-banana');

    test()->actingAs($manager)->get("/shelves/{$shelf->slug}/manage/comments?status=banana")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('status', 'pending')
            ->where('comments.0.body', 'Con thích chú Dế Mèn'));
});

it('a hand-typed ?status=hidden renders the hidden view, not a collapse to pending', function () {
    [$shelf, $manager, $reader, $book] = mmsFix('dong-thap-mms-hidden');
    mmsSeed($shelf, $book, $reader, CommentStatus::Hidden, 'Đã ẩn rồi');

    test()->actingAs($manager)->get("/shelves/{$shelf->slug}/manage/comments?status=hidden")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('status', 'hidden')
            ->where('comments.0.body', 'Đã ẩn rồi'));
});

it('rejecting with an empty reason is a field error on reason, not a banner', function () {
    // RejectCommentRequest's `required` answers first — the Form Request
    // resolves before the controller body, so RejectComment's own
    // reject_reason_required (a RuleViolated, which bootstrap/app.php
    // renders into the page-level `rule` bag) is never reached from here.
    // The two are told apart key by key below rather than by the presence
    // of any error at all.
    [$shelf, $manager, , , $comment] = mmsFix('dong-thap-mms-empty-reason');

    $response = test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/comments/{$comment->id}/reject",
        ['reason' => ''],
    );

    $response->assertSessionHasErrors(['reason']);
    expect(array_key_exists('rule', session('errors')->getBag('default')->getMessages()))->toBeFalse();
});

it('the rejected comment stays pending when the reason box is empty', function () {
    [$shelf, $manager, , , $comment] = mmsFix('dong-thap-mms-empty-reason-row');

    test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/comments/{$comment->id}/reject",
        ['reason' => ''],
    );

    expect($comment->fresh()->status)->toBe(CommentStatus::Pending);
});

it('the chip reports the true total when the decided list is longer than its cap', function () {
    // THE BLOCK THAT CATCHES COUNTING FROM THE RENDERED LIST. Twelve
    // approved rows against decided()'s default limit of ten: a chip fed
    // from the list on screen reports ten and this goes red.
    [$shelf, $manager, $reader, $book] = mmsFix('dong-thap-mms-cap');
    foreach (range(1, 12) as $n) {
        mmsSeed($shelf, $book, $reader, CommentStatus::Approved, "Bình luận số {$n}");
    }

    test()->actingAs($manager)->get("/shelves/{$shelf->slug}/manage/comments?status=approved")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->where('counts.approved', 12));
});

it('the decided list itself is capped at ten rows', function () {
    // The block above proves nothing unless the list really is shorter
    // than the count it is being compared against, and a silently
    // uncapped list would leave it green while the property it names
    // ("queried, not counted") went untested. This is that premise, in
    // its own block so a broken cap and a broken count fail separately.
    // A thirteenth block, one past the brief's twelve, for that reason.
    [$shelf, $manager, $reader, $book] = mmsFix('dong-thap-mms-cap-premise');
    foreach (range(1, 12) as $n) {
        mmsSeed($shelf, $book, $reader, CommentStatus::Approved, "Bình luận số {$n}");
    }

    test()->actingAs($manager)->get("/shelves/{$shelf->slug}/manage/comments?status=approved")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->count('comments', 10));
});

it('the hide POST lands back on the archive it was posted from, filter intact', function () {
    // THE BLOCK THAT NAMES THE URL. The three success POSTs above assert
    // a bare assertRedirect(), which passes on any 302 — so the controller's
    // back() and a redirect()->route('shelves.manage.comments') are
    // indistinguishable to those three, and the second would drop a
    // manager out of the archive they were working and back onto the
    // queue after every tap. ->from() sets the previous URL that back()
    // reads, which is what a browser's Referer supplies here.
    [$shelf, $manager, $reader, $book] = mmsFix('dong-thap-mms-back');
    $approved = mmsSeed($shelf, $book, $reader, CommentStatus::Approved, 'Đã hiển thị công khai');
    $from = "/shelves/{$shelf->slug}/manage/comments?status=approved";

    test()->actingAs($manager)->from($from)->post(
        "/shelves/{$shelf->slug}/manage/comments/{$approved->id}/hide",
    )->assertRedirect($from);
});

it('approving an already-decided comment answers 302 with errors.rule, not 404 and not 500', function () {
    // THIS SCREEN'S WIRING TO THE SHARED REFUSAL PATH, which no block in
    // this file reached before it: CommentDecisionsTest pins the codes
    // at Action level and bootstrap/app.php registers the one render
    // callback that turns them into back()->withErrors(['rule' => …]).
    // What is unpinned is that a refusal raised from one of THESE four
    // routes arrives at the page as a 302 carrying that bag — an
    // uncaught RuleViolated would be a 500 here, and a 404 would mean the
    // row never reached the command at all. ApproveComment refuses a row
    // that is not pending; this one is already approved.
    [$shelf, $manager, $reader, $book] = mmsFix('dong-thap-mms-refusal');
    $approved = mmsSeed($shelf, $book, $reader, CommentStatus::Approved, 'Đã duyệt rồi');

    test()->actingAs($manager)->post(
        "/shelves/{$shelf->slug}/manage/comments/{$approved->id}/approve",
    )->assertStatus(302)->assertSessionHasErrors(['rule']);
});
