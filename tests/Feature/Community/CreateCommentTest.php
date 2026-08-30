<?php

use App\Actions\Community\CreateComment;
use App\Enums\CommentStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\Comment;
use App\Models\Membership;
use App\Models\User;
use App\Queries\AuditLogQuery;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * Shelf + active reader + one published book, on the rjbFix shape.
 *
 * $settings is the shelf's settings blob VERBATIM — `[]` is the shelf
 * that never opened its settings screen, which CommentSettings reads as
 * both taking comments and moderating them.
 *
 * Grep first: `grep -rn "^function cmcFix" tests/` — top-level helpers
 * are process-global (AGENTS.md).
 *
 * @param  array<string, bool>  $settings
 * @return array{Bookshelf, User, Book}
 */
function cmcFix(array $settings = [], string $slug = 'dong-thap-cmc'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => $settings]);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men',
        'is_published' => true,
    ]);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($reader);

    return [$shelf, $reader, $book];
}

it('a moderating shelf files the comment as pending, authored by a users(id)', function () {
    // The default blob: a shelf that never opened its settings screen.
    // Moderation is the safe direction and BR §5.5 chose it — a coalesce
    // defaulting the other way would be invisible on every configured
    // shelf, which is the reference's own reason for pinning it.
    [$shelf, $reader, $book] = cmcFix();

    $result = app(CreateComment::class)->execute($reader, $book, 'Sách hay lắm ạ');

    $row = Comment::query()->sole();
    expect($result['status'])->toBe(CommentStatus::Pending)
        ->and($result['commentId'])->toBe($row->id)
        ->and($row->status)->toBe(CommentStatus::Pending)
        ->and($row->body)->toBe('Sách hay lắm ạ')
        ->and($row->book_id)->toBe($book->id)
        // THE TRAP THIS PHASE CARRIES END TO END: author_id is a
        // users(id), the usual direction in this schema and the opposite
        // of book_donations' donor_membership_id two tables along, which
        // this same phase also writes. Asserting the id equals the
        // reader's user id is only half of it — a membership id would be
        // a uuid too, and the FK points at users, so the two shapes are
        // indistinguishable by eye. The membership row's own id is
        // therefore named and excluded.
        ->and($row->author_id)->toBe($reader->id)
        ->and($row->author_id)->not->toBe(app(TenantContext::class)->membership()?->id)
        // Nobody has looked at it yet.
        ->and($row->moderated_by)->toBeNull();

    expect($shelf->comments()->count())->toBe(1);
});

it('a shelf that does not moderate publishes immediately, and still nobody moderated it', function () {
    // OPS §4.4: a comment starts pending "unless comments_require_approval
    // is off, in which case it starts approved and is immediately public".
    // INV-9 is untouched either way — it says approved comments are the
    // visible ones, not that a manager must have looked at them, and
    // moderated_by staying null is that distinction made executable.
    [, $reader, $book] = cmcFix(['comments_require_approval' => false], 'dong-thap-cmc-open');

    $result = app(CreateComment::class)->execute($reader, $book, 'Hiện ngay không cần duyệt');

    $row = Comment::query()->sole();
    expect($result['status'])->toBe(CommentStatus::Approved)
        ->and($row->status)->toBe(CommentStatus::Approved)
        ->and($row->moderated_by)->toBeNull();
});

it('a shelf that has turned comments off refuses, and writes nothing', function () {
    [, $reader, $book] = cmcFix(['comments_enabled' => false], 'dong-thap-cmc-off');

    expect(fn () => app(CreateComment::class)->execute($reader, $book, 'Xin chào'))
        ->toThrow(RuleViolated::class, 'comments_disabled');

    expect(Comment::query()->count())->toBe(0);
});

it('an empty body is refused, whitespace included', function () {
    // The column is NOT NULL and would take three spaces happily, so the
    // trim is the whole of the rule.
    [, $reader, $book] = cmcFix([], 'dong-thap-cmc-empty');

    expect(fn () => app(CreateComment::class)->execute($reader, $book, '   '))
        ->toThrow(RuleViolated::class, 'empty_body');

    expect(Comment::query()->count())->toBe(0);
});

it('INV-8: comment.created records the status and the book, never the body', function () {
    // BR §14 asks the log to record what CHANGED rather than to duplicate
    // it. The body is the reader's own words on a row that survives, and a
    // second copy is a second thing to redact if a child ever asks for
    // theirs to be removed.
    [, $reader, $book] = cmcFix([], 'dong-thap-cmc-audit');

    app(CreateComment::class)->execute($reader, $book, 'Con thích chú Dế Mèn');

    $entry = AuditLog::query()->where('action', 'comment.created')->sole();
    $after = (array) $entry->after;
    expect($entry->entity_type)->toBe('comment')
        ->and($entry->actor_id)->toBe($reader->id)
        ->and((array) $entry->before)->toBe([])
        ->and($after)->toMatchArray(['status' => 'pending', 'book_id' => $book->id]);

    // KEY-BY-KEY. The plan asked for this form on the grounds that
    // `not->toHaveKey` "passes unconditionally"; PROBED on this Pest
    // version and that did not reproduce — a bare expect(), a chained
    // ->and(), and an object subject each failed correctly with the key
    // present. The form stays anyway, for the reason that survives the
    // correction: array_key_exists says exactly what is being asserted
    // and cannot be read as a negated-matcher subtlety. What makes it a
    // real pin is not the spelling but the mutation, which WAS run —
    // adding 'body' to the bag reddens this line and nothing else.
    expect(array_key_exists('body', $after))->toBeFalse();

    // Through the query the audit screen actually calls, so the new
    // group's phrase is REACHABLE and not merely present in the map.
    // This is not belt and braces: AuditSentences::phrase() ends in a
    // default arm, so a MISSING match arm is not a build error the way a
    // missing NotificationSentences arm is — measured, deleting the
    // comment.created arm leaves AuditActionCensusTest fully green (2
    // passed) and reddens only this block, which sees the
    // undescribed-action fallback a volunteer would have read.
    $rendered = app(AuditLogQuery::class)->run(page: 1);
    $line = collect($rendered['rows'])->firstWhere('action', 'comment.created');
    expect($line)->not->toBeNull()
        ->and($line['group'])->toBe('community')
        ->and($line['sentence'])->toBe('Têrêsa Bạn Đọc Nhỏ đã viết một bình luận')
        ->and($line['sentence'])->not->toContain('Con thích chú Dế Mèn');
});

it('a memberless super admin meets not_permitted as a Vietnamese sentence, over HTTP', function () {
    // Divergence 4's pin, and a LIVE path rather than defence in depth.
    // AppServiceProvider's Gate::before returns true for any act-as-*
    // ability when is_super_admin, so EnsureShelfRole lets a super admin
    // through role:reader and StoreCommentRequest::authorize allows the
    // POST; ResolveTenant resolves only ACTIVE memberships, so a super
    // admin who is not a member of this shelf arrives with a null
    // membership. CreateComment's own null check is then the only thing
    // left, and it fails closed.
    //
    // Over HTTP, not as a unit call: what this adds is the READER's end
    // of it — bootstrap/app.php renders RuleViolated as
    // back()->withErrors(['rule' => ...]), so the sentence has to survive
    // a 302 and come back on the book page's shared errors prop. One
    // actingAs for the whole method (the SessionGuard rule).
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-cmc-super', 'settings' => []]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be',
        'is_published' => true,
    ]);
    $admin = User::factory()->superAdmin()->create(['full_name' => 'Giuse Quản Trị Toàn Hệ Thống']);
    $page = "/shelves/{$shelf->slug}/books/{$book->slug}";

    $post = test()->actingAs($admin)->from($page)->post($page.'/comments', ['body' => 'Thử quyền']);

    $post->assertRedirect($page);
    expect(Comment::query()->withoutGlobalScopes()->count())->toBe(0);

    test()->get($page)->assertOk()
        ->assertInertia(fn (AssertableInertia $p) => $p
            ->component('shelves/book')
            ->where('errors.rule', __('rules.not_permitted')));
});

it('a signed-in non-member gets 404 on the comment POST, never 403', function () {
    // Spec §5.4: the URL space must not confirm what exists. TWO things
    // produce this 404 and they are independent — the route group's
    // role:reader (EnsureShelfRole abort(404)s on act-as-reader) and
    // StoreCommentRequest::authorize's own abort_unless on the same
    // ability. Step 5's mutation 4 removed the middleware and measured
    // which of them answers; the answer is recorded in routes/web.php
    // beside this route.
    [$shelf, , $book] = cmcFix([], 'dong-thap-cmc-stranger');
    app(TenantContext::class)->actSystemWide();
    $stranger = User::factory()->create(['full_name' => 'Phêrô Người Lạ']);

    test()->actingAs($stranger)
        ->post("/shelves/{$shelf->slug}/books/{$book->slug}/comments", ['body' => 'Chào tủ sách'])
        ->assertNotFound();

    expect(Comment::query()->withoutGlobalScopes()->count())->toBe(0);
});

it('a reader posts the comment over HTTP and the shelf\'s own setting picks the flash', function () {
    [$shelf, $reader, $book] = cmcFix([], 'dong-thap-cmc-http');
    $page = "/shelves/{$shelf->slug}/books/{$book->slug}";

    test()->actingAs($reader)->from($page)->post($page.'/comments', ['body' => 'Cuốn này hay'])
        ->assertRedirect($page)
        ->assertSessionHas('success', __('rules.comment_pending_flash'));

    expect(Comment::query()->sole()->status)->toBe(CommentStatus::Pending);
});

it('the same POST on a shelf that does not moderate flashes the published line instead', function () {
    // The two flash lines are the reason CreateComment RETURNS its status:
    // the controller picks between them from the Action's own result, and
    // a second reading of comments_require_approval in the controller is
    // how a screen and a command start disagreeing about one shelf. Its
    // own it() block, because a failed expect() aborts the whole method
    // and this fact and the one above must be able to fail independently.
    [$shelf, $reader, $book] = cmcFix(['comments_require_approval' => false], 'dong-thap-cmc-http-open');
    $page = "/shelves/{$shelf->slug}/books/{$book->slug}";

    test()->actingAs($reader)->from($page)->post($page.'/comments', ['body' => 'Cuốn này hay'])
        ->assertRedirect($page)
        ->assertSessionHas('success', __('rules.comment_published_flash'));

    expect(Comment::query()->sole()->status)->toBe(CommentStatus::Approved);
});

it('a draft book takes no comment — 404, the same answer an unknown slug gets', function () {
    // The sibling POST's guard, repeated for the same measured reason
    // (App\Http\Controllers\Reader\BorrowRequestController::store): the
    // binding resolves drafts, because the manager route shares the model,
    // and neither CreateComment nor CommentPolicy reads is_published.
    // Without this, {book} being a slug makes the URL guessable and a
    // draft would answer 302 where a nonexistent slug answers 404 — an
    // existence oracle over unpublished titles (spec §5.4). Measured on
    // this route: removing the controller's abort_unless turns this block
    // red with "expected 404, received 302".
    //
    // This block alone would pass on the route not existing at all — it
    // did, at RED, before there was a route. Its non-vacuity partner is
    // the published-book POST above, which reddens in exactly that case;
    // the two are never both green with the route missing.
    [$shelf, $reader, $book] = cmcFix([], 'dong-thap-cmc-draft');
    app(TenantContext::class)->actSystemWide();
    $book->update(['is_published' => false]);

    test()->actingAs($reader)
        ->post("/shelves/{$shelf->slug}/books/{$book->slug}/comments", ['body' => 'Bí mật'])
        ->assertNotFound();

    expect(Comment::query()->withoutGlobalScopes()->count())->toBe(0);
});

it('a body of 2001 characters is a field error, not a 500 from the text column', function () {
    // StoreCommentRequest's max, which is what keeps hostile length off
    // the INSERT. bail + encoding:UTF-8 lead the same ruleset
    // (FreeTextEncodingGuardTest sweeps for the encoding half).
    [$shelf, $reader, $book] = cmcFix([], 'dong-thap-cmc-long');

    test()->actingAs($reader)
        ->post("/shelves/{$shelf->slug}/books/{$book->slug}/comments", ['body' => str_repeat('a', 2001)])
        ->assertSessionHasErrors(['body']);

    expect(Comment::query()->count())->toBe(0);
});

it('invalid UTF-8 in the body is a field error, not an errno 1366 five hundred', function () {
    [$shelf, $reader, $book] = cmcFix([], 'dong-thap-cmc-bytes');

    test()->actingAs($reader)
        ->post("/shelves/{$shelf->slug}/books/{$book->slug}/comments", ['body' => "Hay\xB1\x31\xC3"])
        ->assertSessionHasErrors(['body']);

    expect(Comment::query()->count())->toBe(0);
});

/*
 * The two findings carried out of Task 1's review, both in scope here
 * because this task lands the first write to the table.
 */

it('Comment::author() resolves the users row named by author_id', function () {
    // CARRIED FINDING 1. What is pinnable here is the RELATION'S TARGET,
    // not the spelling of its foreign key: measured in this container,
    // belongsTo(User::class) on a method named author() guesses
    // author_id — Str::snake(<relation name>).'_id', and the relation
    // name comes from the calling METHOD — so the explicit 'author_id'
    // and the implicit form resolve the identical column and NO test can
    // tell them apart. Comment.php's docblock said otherwise and has been
    // corrected. What a test CAN pin is that this relation reaches
    // `users` by the author column: point it at moderated_by, or at a
    // membership, and the reader's comment list renders every author
    // blank — this reddens for both.
    [, $reader, $book] = cmcFix([], 'dong-thap-cmc-author');
    app(CreateComment::class)->execute($reader, $book, 'Con thích cuốn này');

    $comment = Comment::query()->sole();
    expect($comment->author)->toBeInstanceOf(User::class)
        ->and($comment->author->id)->toBe($comment->author_id)
        ->and($comment->author->full_name)->toBe('Têrêsa Bạn Đọc Nhỏ')
        // The id in author_id is a users row and NOT a memberships row —
        // the FK points at users, so nothing in the schema says so.
        ->and(User::query()->whereKey($comment->author_id)->exists())->toBeTrue()
        ->and(Membership::query()->whereKey($comment->author_id)->exists())->toBeFalse();
});

it('Bookshelf::comments() is shelf-local — the relation {comment} will bind through', function () {
    // CARRIED FINDING 2: borrowRequests(), notifications() and loans()
    // each have this block and comments() shipped without one. Run under
    // actSystemWide() precisely so BookshelfScope is OFF and the
    // relation's own FK filter is the only thing separating the two
    // shelves — the layer that relation's docblock says nothing had yet
    // told apart from the global scope.
    [$shelfA, $reader, $book] = cmcFix([], 'dong-thap-cmc-rel-a');
    app(CreateComment::class)->execute($reader, $book, 'Của tủ sách A');

    $comment = Comment::query()->sole();
    app(TenantContext::class)->actSystemWide();
    $shelfB = Bookshelf::factory()->create(['slug' => 'dong-thap-cmc-rel-b', 'settings' => []]);

    expect($shelfA->comments()->pluck('id')->all())->toBe([$comment->id])
        ->and($shelfB->comments()->count())->toBe(0);
});
