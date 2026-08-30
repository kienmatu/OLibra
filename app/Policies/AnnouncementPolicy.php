<?php

namespace App\Policies;

use App\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * OPS §4.4's announcement commands, delegating to the act-as gates the
 * way CommentPolicy does.
 *
 * create() takes no Announcement, and cannot: the row does not exist
 * yet. Later abilities in this family (publish, pin, hide) will take one,
 * and CommentPolicy's rule applies to them in advance — a policy body
 * that reads the row starts answering questions about a specific
 * announcement, and a denial becomes an existence oracle. Shelf ownership
 * is decided one layer earlier still, by BookshelfScope on the model.
 */
final class AnnouncementPolicy
{
    public function create(User $user): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }
}
