<?php

use App\Actions\Community\ApproveComment;
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
use Illuminate\Support\Facades\DB;

/**
 * Shelf + manager + author + one book + one comment in $status, on the
 * rjbFix shape (tests/Feature/Circulation/RejectBorrowRequestTest.php).
 *
 * Grep first: `grep -rn "^function cmaFix" tests/` — top-level helpers
 * are process-global (AGENTS.md).
 *
 * The seeded comment carries a moderation_note ON PURPOSE, and it is not
 * scenery: ApproveComment clears the column, and a fixture that left it
 * null would make block 1's `moderation_note is null` assertion pass on
 * a command that never touched it. Measured — with the note seeded,
 * dropping `'moderation_note' => null` from the update reddens block 1;
 * with the column left null in the fixture, the same deletion leaves it
 * green. No shipped command writes a note onto a PENDING comment today
 * (RejectComment and HideComment are this phase's later tasks and both
 * leave a decided status behind), so this row is a hand-built state
 * rather than one the app can currently reach — which is exactly what
 * makes it the right probe for a clearing rule that has no other witness.
 *
 * @return array{Bookshelf, User, User, Comment}
 */
function cmaFix(string $status = 'pending', string $slug = 'dong-thap-cma'): array
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
        'moderation_note' => 'ghi chú cũ',
    ]);
    app(TenantContext::class)->set($shelf, $mm);
    test()->actingAs($manager);

    return [$shelf, $manager, $author, $comment];
}

it('approving publishes it and records who looked', function () {
    [, $manager, , $comment] = cmaFix();

    $result = app(ApproveComment::class)->execute($manager, $comment);

    $row = $comment->fresh();
    expect($result['commentId'])->toBe($comment->id)
        ->and($row->status)->toBe(CommentStatus::Approved)
        // moderated_by is a users(id) — the same column direction as
        // author_id, and the FK points at users. The manager's MEMBERSHIP
        // id is a uuid too, so it is named and excluded rather than left
        // to the eye.
        ->and($row->moderated_by)->toBe($manager->id)
        ->and($row->moderated_by)->not->toBe(app(TenantContext::class)->membership()?->id)
        ->and($row->moderated_at)->not->toBeNull()
        // Cleared, not left — see the fixture's note on why this row
        // carries one to begin with.
        ->and($row->moderation_note)->toBeNull()
        // Nothing is deleted (BR §11): approving is a status change on a
        // row that survives.
        ->and($row->deleted_at)->toBeNull();
});

it('approving notifies the AUTHOR, and nobody else', function () {
    [, $manager, $author, $comment] = cmaFix('pending', 'dong-thap-cma-notify');

    app(ApproveComment::class)->execute($manager, $comment);

    $note = Notification::query()->sole();
    expect($note->user_id)->toBe($author->id)
        ->and($note->kind)->toBe('comment_approved')
        // DIVERGENCE 10: the reference sends NO payload
        // (comment-moderation.ts's approveComment calls notify with a
        // userId and a kind and nothing else), so the whole bag is
        // asserted rather than a subset — a title appearing here would be
        // a silent product change that toMatchArray could not see.
        ->and($note->payload)->toBe([]);

    // Key-by-key for the one key divergence 10 is actually about, on the
    // CreateCommentTest precedent: array_key_exists says exactly what is
    // being asserted and cannot be read as a negated-matcher subtlety.
    expect(array_key_exists('title', $note->payload))->toBeFalse();

    // BR §15: managers get none, by design. This is the exclusion the
    // block exists for — nothing is seeded to make it true, the manager's
    // own rows are simply counted.
    expect(Notification::query()->where('user_id', $manager->id)->count())->toBe(0);
});

it('a comment already decided cannot be approved again', function () {
    // Its own it(): the throw aborts the whole test METHOD, so a second
    // fact asserted after it could never be shown failing.
    [, $manager, , $comment] = cmaFix('approved', 'dong-thap-cma-decided');

    expect(fn () => app(ApproveComment::class)->execute($manager, $comment))
        ->toThrow(RuleViolated::class, 'comment_not_pending');

    expect(Notification::query()->count())->toBe(0);
});

it('the comment lock is the transaction\'s first statement', function () {
    [, $manager, , $comment] = cmaFix('pending', 'dong-thap-cma-lock');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(ApproveComment::class)->execute($manager, $comment);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect(str_contains($log[0]['query'], 'comments'))->toBeTrue($log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue($log[0]['query']);
});

it('INV-8: comment.approved carries both statuses, and the audit screen renders the phrase', function () {
    [, $manager, , $comment] = cmaFix('pending', 'dong-thap-cma-audit');

    app(ApproveComment::class)->execute($manager, $comment);

    $entry = AuditLog::query()->where('action', 'comment.approved')->sole();
    expect($entry->entity_type)->toBe('comment')
        ->and($entry->entity_id)->toBe($comment->id)
        // AuditRecorder takes actor_id from Auth::id(), never from the
        // $actor parameter, so the fixture's actingAs is load-bearing:
        // without it this row would carry a null actor and the sentence
        // below would read "Hệ thống".
        ->and($entry->actor_id)->toBe($manager->id)
        ->and((array) $entry->before)->toBe(['status' => 'pending'])
        ->and((array) $entry->after)->toBe(['status' => 'approved']);

    // Through the query the audit screen actually calls, so the arm is
    // REACHABLE and not merely present in the map — AuditSentences::
    // phrase() ends in a default arm, so a missing arm is not a build
    // error the way a missing NotificationSentences arm is.
    $rendered = app(AuditLogQuery::class)->run(page: 1);
    $line = collect($rendered['rows'])->firstWhere('action', 'comment.approved');
    expect($line)->not->toBeNull()
        ->and($line['group'])->toBe('community')
        ->and($line['sentence'])->toBe('Maria Quản Lý Kho đã duyệt một bình luận');
});

/*
 * "The notification is written INSIDE the transaction" has NO block in
 * this file, deliberately, and this comment is here so a later reader
 * does not conclude the guarantee is untested. It is tested — by
 * tests/Feature/Architecture/NotificationsAreReaderFacingTest's fourth
 * block, which walks every file under app/ that contains `->notify` and
 * asserts the call's token offset falls inside a DB::transaction
 * closure's brace range. That walk covers ApproveComment automatically
 * from the commit that adds its OPS_SECTION_7 row: the same file's
 * per-writer floor then requires this command to contribute a call site
 * the walk actually saw, so the guard can neither miss the file nor pass
 * on its silence.
 *
 * Measured rather than asserted: moving this command's notify() call to
 * after DB::transaction(...) returns turns that block red naming this
 * file and the line, and nothing else in the suite goes red with it — a
 * behavioural block written here would have stayed green, which is the
 * whole reason the architectural walk exists.
 */
