<?php

use App\Actions\Community\ApproveComment;
use App\Actions\Community\HideComment;
use App\Actions\Community\RejectComment;
use App\Enums\CommentStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\Comment;
use App\Models\Membership;
use App\Models\Notification;
use App\Models\User;
use App\Queries\AuditLogQuery;
use App\Support\TenantContext;
use Illuminate\Auth\Access\AuthorizationException;

/**
 * Shelf + manager + author + one book + one comment in $status, on the
 * cmaFix shape (tests/Feature/Community/ApproveCommentTest.php) under a
 * different name — a second file may not redeclare a top-level helper
 * (AGENTS.md).
 *
 * Grep first: `grep -rn "^function cmdFix" tests/`.
 *
 * @return array{Bookshelf, User, User, Comment}
 */
function cmdFix(string $status = 'pending', string $slug = 'dong-thap-cmd'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $mm = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $author = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $author->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men',
        'is_published' => true,
    ]);
    $comment = Comment::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'author_id' => $author->id,
        'body' => 'Con thích chú Dế Mèn', 'status' => $status,
    ]);
    app(TenantContext::class)->set($shelf, $mm);
    test()->actingAs($manager);

    return [$shelf, $manager, $author, $comment];
}

it('rejecting is terminal, keeps the row, and stores the reason', function () {
    [, $manager, , $comment] = cmdFix('pending', 'dong-thap-cmd-reject');

    $result = app(RejectComment::class)->execute($manager, $comment, 'Chưa phù hợp');

    $row = $comment->fresh();
    expect($result['commentId'])->toBe($comment->id)
        ->and($row->status)->toBe(CommentStatus::Rejected)
        ->and($row->moderation_note)->toBe('Chưa phù hợp')
        ->and($row->moderated_by)->toBe($manager->id)
        ->and($row->moderated_at)->not->toBeNull()
        // Nothing is deleted (BR §11): rejecting is a status change on a
        // row that survives.
        ->and($row->deleted_at)->toBeNull();
});

it('rejecting notifies nobody — the reason is on the row', function () {
    // FIX ROUND: this block used to open with two assertions that cannot
    // fail (a just-created factory row is never null; a column this same
    // fixture just wrote is never null) — real non-vacuity has to come
    // from something that CAN fail, not from restating the fixture.
    //
    // The positive control: approving a SECOND, separate pending comment
    // on the same shelf/author writes one real Notification row —
    // proving notifications work at all on this fixture shape, so a
    // regression that silently broke Notifier entirely (rather than one
    // that wrongly added a call to RejectComment) would fail HERE, on the
    // control, rather than leaving this block green for the wrong
    // reason. Only then is the excluded action taken, and the count
    // asserted unchanged — the exclusion is real because the thing it
    // excludes is shown working one call earlier.
    [$shelf, $manager, $author, $comment] = cmdFix('pending', 'dong-thap-cmd-reject-notify');
    $approved = Comment::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $comment->book_id, 'author_id' => $author->id,
        'body' => 'Một bình luận khác sẽ được duyệt', 'status' => 'pending',
    ]);
    app(ApproveComment::class)->execute($manager, $approved);
    expect(Notification::query()->count())->toBe(1);

    app(RejectComment::class)->execute($manager, $comment, 'Chưa phù hợp');

    expect(Notification::query()->count())->toBe(1);
});

it('rejecting requires a reason, and whitespace is not one', function () {
    [, $manager, , $comment] = cmdFix('pending', 'dong-thap-cmd-reject-blank');

    expect(fn () => app(RejectComment::class)->execute($manager, $comment, '   '))
        ->toThrow(RuleViolated::class, 'reject_reason_required');

    expect($comment->fresh()->status)->toBe(CommentStatus::Pending);
});

it('hiding takes an optional reason where rejecting requires one', function () {
    [, $manager, , $comment] = cmdFix('approved', 'dong-thap-cmd-hide');

    $result = app(HideComment::class)->execute($manager, $comment);

    $row = $comment->fresh();
    expect($result['commentId'])->toBe($comment->id)
        ->and($row->status)->toBe(CommentStatus::Hidden)
        ->and($row->moderation_note)->toBeNull()
        ->and($row->moderated_by)->toBe($manager->id)
        ->and($row->moderated_at)->not->toBeNull()
        ->and($row->deleted_at)->toBeNull();
});

it('hiding with a reason stores it', function () {
    [, $manager, , $comment] = cmdFix('approved', 'dong-thap-cmd-hide-reason');

    app(HideComment::class)->execute($manager, $comment, 'Nội dung không phù hợp');

    expect($comment->fresh()->moderation_note)->toBe('Nội dung không phù hợp');
});

it('only an approved comment can be hidden', function () {
    [, $manager, , $comment] = cmdFix('pending', 'dong-thap-cmd-hide-pending');

    expect(fn () => app(HideComment::class)->execute($manager, $comment))
        ->toThrow(RuleViolated::class, 'comment_not_approved');

    expect($comment->fresh()->status)->toBe(CommentStatus::Pending);
});

it('a decided comment cannot be decided again', function () {
    [, $manager, , $comment] = cmdFix('approved', 'dong-thap-cmd-redecide');

    expect(fn () => app(RejectComment::class)->execute($manager, $comment, 'muộn'))
        ->toThrow(RuleViolated::class, 'comment_not_pending');

    expect($comment->fresh()->status)->toBe(CommentStatus::Approved);
});

it('INV-8: comment.rejected and comment.hidden carry the reason, and the audit screen renders it', function () {
    [, $managerA, , $rejected] = cmdFix('pending', 'dong-thap-cmd-audit-reject');
    app(RejectComment::class)->execute($managerA, $rejected, 'Lạc đề');

    $rejectedEntry = AuditLog::query()->where('action', 'comment.rejected')->sole();
    expect($rejectedEntry->entity_type)->toBe('comment')
        ->and($rejectedEntry->entity_id)->toBe($rejected->id)
        ->and($rejectedEntry->actor_id)->toBe($managerA->id)
        ->and((array) $rejectedEntry->before)->toBe(['status' => 'pending'])
        ->and((array) $rejectedEntry->after)->toBe(['status' => 'rejected', 'reason' => 'Lạc đề']);

    $rejectedRendered = app(AuditLogQuery::class)->run(page: 1);
    $rejectedLine = collect($rejectedRendered['rows'])->firstWhere('action', 'comment.rejected');
    expect($rejectedLine)->not->toBeNull()
        ->and($rejectedLine['group'])->toBe('community')
        ->and($rejectedLine['sentence'])->toBe('Maria Quản Lý Kho đã từ chối một bình luận vì Lạc đề');

    [, $managerB, , $hidden] = cmdFix('approved', 'dong-thap-cmd-audit-hide');
    app(HideComment::class)->execute($managerB, $hidden, 'Nội dung không phù hợp');

    $hiddenEntry = AuditLog::query()->where('action', 'comment.hidden')->sole();
    expect((array) $hiddenEntry->before)->toBe(['status' => 'approved'])
        ->and((array) $hiddenEntry->after)->toBe(['status' => 'hidden', 'reason' => 'Nội dung không phù hợp']);

    $hiddenRendered = app(AuditLogQuery::class)->run(page: 1);
    $hiddenLine = collect($hiddenRendered['rows'])->firstWhere('action', 'comment.hidden');
    expect($hiddenLine)->not->toBeNull()
        ->and($hiddenLine['group'])->toBe('community')
        ->and($hiddenLine['sentence'])->toBe('Maria Quản Lý Kho đã ẩn một bình luận vì Nội dung không phù hợp');
});

it('a reasonless hide writes no reason row at all — an absent key, not a stored null', function () {
    // Mutation check 2: writing 'reason' => null instead of omitting the
    // key would still leave payloadRows' em-dash/"null" columns absent
    // (both bags lack the key either way, since a stored null and an
    // omitted key render the SAME em-dash before-column) — the observable
    // difference is a `reason` row appearing AT ALL, on the after side.
    [, $manager, , $comment] = cmdFix('approved', 'dong-thap-cmd-hide-no-reason-row');

    app(HideComment::class)->execute($manager, $comment);

    $entry = AuditLog::query()->where('action', 'comment.hidden')->sole();
    expect(array_key_exists('reason', (array) $entry->after))->toBeFalse();
});

it('a reader cannot reject — this command\'s own gate call, with no route to hide behind', function () {
    // FIX ROUND: ApproveCommentTest's own block ("this command's own gate
    // call, with no route to hide behind") documents that deleting its
    // Gate::forUser($actor)->authorize() line reddens only that one
    // block. That guarantee was never ported to this file — every other
    // block in this file acts as the manager, CommentPolicy's 'reject'
    // and 'hide' abilities have no coverage anywhere else in the suite,
    // CommunityArchitectureTest pins retry/clock/audit only, and there is
    // no route yet to exercise the gate over HTTP either. This block
    // closes that gap for RejectComment; the next one closes it for
    // HideComment.
    //
    // Its own inline fixture rather than cmdFix, and the reason is the
    // gate's shape, not tidiness: act-as-manager reads the membership
    // TenantContext holds and first checks it belongs to the $user it was
    // handed. Calling cmdFix (which binds the MANAGER's membership) and
    // passing the author would therefore fail on that identity guard and
    // never reach the ROLE comparison — green for the wrong reason, and
    // still green if the policy asked for act-as-reader. Binding the
    // reader's OWN membership is what puts the role check in the path.
    // One actingAs in this method either way, per the SessionGuard rule
    // in docs/known-gaps.md.
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-cmd-reject-reader', 'settings' => []]);
    $author = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    $rm = Membership::factory()->for($shelf)->create([
        'user_id' => $author->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be',
        'is_published' => true,
    ]);
    $comment = Comment::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'author_id' => $author->id,
        'body' => 'Con tự từ chối bình luận của con', 'status' => 'pending',
    ]);
    app(TenantContext::class)->set($shelf, $rm);
    test()->actingAs($author);

    expect(fn () => app(RejectComment::class)->execute($author, $comment, 'Không phù hợp'))
        ->toThrow(AuthorizationException::class);

    // Nothing moved, and nobody was told. Over HTTP this refusal becomes
    // a 404 rather than a 403 (spec §5.4) — there is no route to this
    // command yet, so that half belongs to a later task's screen, not
    // here.
    expect($comment->fresh()->status)->toBe(CommentStatus::Pending)
        ->and(Notification::query()->count())->toBe(0)
        ->and(AuditLog::query()->where('action', 'comment.rejected')->count())->toBe(0);
});

it('a reader cannot hide — this command\'s own gate call, with no route to hide behind', function () {
    // ApproveCommentTest's guarantee, ported a second time — see the
    // sibling block above for why both were missing until this fix
    // round. Same inline-fixture reasoning: the reader's OWN membership
    // is bound so act-as-manager's role comparison is what denies, not
    // the identity guard ahead of it.
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-cmd-hide-reader', 'settings' => []]);
    $author = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    $rm = Membership::factory()->for($shelf)->create([
        'user_id' => $author->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be-2',
        'is_published' => true,
    ]);
    $comment = Comment::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'author_id' => $author->id,
        'body' => 'Con tự ẩn bình luận của con', 'status' => 'approved',
    ]);
    app(TenantContext::class)->set($shelf, $rm);
    test()->actingAs($author);

    expect(fn () => app(HideComment::class)->execute($author, $comment))
        ->toThrow(AuthorizationException::class);

    expect($comment->fresh()->status)->toBe(CommentStatus::Approved)
        ->and(Notification::query()->count())->toBe(0)
        ->and(AuditLog::query()->where('action', 'comment.hidden')->count())->toBe(0);
});
