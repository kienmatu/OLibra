<?php

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
    // The exclusion is real: the row it would notify about exists, and
    // the author exists, so this block seeds the thing it excludes.
    [, $manager, $author, $comment] = cmdFix('pending', 'dong-thap-cmd-reject-notify');
    expect($author)->not->toBeNull();
    expect($comment->author_id)->not->toBeNull();

    app(RejectComment::class)->execute($manager, $comment, 'Chưa phù hợp');

    expect(Notification::query()->count())->toBe(0);
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
