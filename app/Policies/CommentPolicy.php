<?php

namespace App\Policies;

use App\Models\Comment;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * OPS §4.4's callers, delegating to the act-as gates the way
 * BorrowRequestPolicy does. Ownership and status are deliberately NOT
 * here — a comment_not_pending or comment_not_approved refusal folds into
 * the Action, because a policy-level 403 would confirm the row exists.
 *
 * The $comment parameter is unused in every method for that same reason,
 * and its absence of use is the rule, not an oversight: the moment one of
 * these bodies reads the row, this policy starts answering questions about
 * a specific comment, and a denial becomes an existence oracle. What the
 * row IS gets decided by the Actions and what it BELONGS to gets decided
 * one layer earlier still, by the binding: Bookshelf::comments() and
 * BookshelfScope on Comment each turn a foreign shelf's comment into a 404
 * before any ability is checked.
 */
final class CommentPolicy
{
    public function create(User $user): bool
    {
        return Gate::forUser($user)->allows('act-as-reader');
    }

    public function approve(User $user, Comment $comment): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function reject(User $user, Comment $comment): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function hide(User $user, Comment $comment): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }
}
