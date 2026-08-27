<?php

namespace App\Policies;

use App\Models\Book;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * BR §13.2's catalogue permission set, split along its own lines: "view any
 * book, view a book" are reader verbs; create/update/delete are manager's.
 * Every method delegates to the Task 17 act-as gates — the ONE place role,
 * membership status and shelf-binding combine (and the place Gate::before
 * grants super admins) — so this policy can never disagree with the
 * middleware about who a manager is. The $book parameter carries no shelf
 * re-check on purpose: under a bound tenant, BookshelfScope means a
 * foreign shelf's book cannot have been resolved at all.
 */
class BookPolicy
{
    public function viewAny(User $user): bool
    {
        return Gate::forUser($user)->allows('act-as-reader');
    }

    public function view(User $user, Book $book): bool
    {
        return Gate::forUser($user)->allows('act-as-reader');
    }

    public function create(User $user): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function update(User $user, Book $book): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function delete(User $user, Book $book): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    /** The manager-facing detail/edit read — a floor above view(). */
    public function manage(User $user, Book $book): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }
}
