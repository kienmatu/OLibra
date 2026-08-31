<?php

namespace App\Http\Controllers\Reader;

use App\Actions\Community\CreateComment;
use App\Enums\CommentStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\Community\StoreCommentRequest;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\User;
use Illuminate\Http\RedirectResponse;

/**
 * OPS §4.4's CreateComment — "A reader comments on a book (§16.1)".
 *
 * RETRACTED: an earlier draft called this BR §7.5's "viết bình luận".
 * Twice wrong: §7.5 is the Membership machine (Comment is §7.6), and the
 * phrase "bình luận" does not occur in BR at all — it is the built UI's
 * word, carried by copy.ts.
 *
 * No RuleViolated is caught here — whichever
 * of CreateComment's codes a reader meets, bootstrap/app.php renders it
 * once, for the whole app, as back()->withErrors(['rule' => ...]), which
 * the book page reads off the shared errors prop. The Action's own
 * docblock is where the codes and their reasons live; repeating a list
 * of them here would be a second copy to go stale.
 */
class CommentController extends Controller
{
    public function store(StoreCommentRequest $request, Bookshelf $shelf, Book $book, CreateComment $create): RedirectResponse
    {
        // The draft-book guard is NOT here. It lives in
        // StoreCommentRequest::authorize(), ahead of the rules, because a
        // Form Request runs before this body and a guard here is one
        // layer too late — a draft slug with an invalid body would answer
        // 302 with a field error while a nonexistent slug answered 404.
        // CreateCommentTest pins both shapes at 404.

        /** @var User $user */
        $user = $request->user();
        $result = $create->execute($user, $book, (string) $request->validated('body'));

        // The flash comes from the Action's OWN result, never from a
        // second reading of the shelf setting here: two readings of one
        // setting is how a screen and a command start disagreeing.
        return back()->with('success', $result['status'] === CommentStatus::Pending
            ? __('rules.comment_pending_flash')
            : __('rules.comment_published_flash'));
    }
}
