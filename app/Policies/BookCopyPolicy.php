<?php

namespace App\Policies;

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * The copy verbs of BR §13.2 — create copy, retire copy, report copy lost,
 * mark copy found, assess condition — all manager's. addCopies takes the
 * Book because the new copies do not exist yet; the rest take the copy
 * they act on. Same delegation shape as BookPolicy, same reason.
 */
class BookCopyPolicy
{
    public function addCopies(User $user, Book $book): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function assessCondition(User $user, BookCopy $copy): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function retire(User $user, BookCopy $copy): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function reportLost(User $user, BookCopy $copy): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function markFound(User $user, BookCopy $copy): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }
}
