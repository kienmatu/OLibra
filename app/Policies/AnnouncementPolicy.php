<?php

namespace App\Policies;

use App\Models\Announcement;
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
 *
 * update() is Task 10's, and is the first ability here to take an
 * Announcement. It does not read it, which is the rule above arriving
 * where it was expected: the parameter exists because Laravel resolves
 * the policy from the model's class, not because the row has anything to
 * say about who may edit it. What the row IS gets decided by
 * UpdateAnnouncement (a blank title refuses there, with a Vietnamese
 * sentence); what it BELONGS to gets decided by that command's scoped
 * re-read, which turns a foreign shelf's announcement into a 404.
 */
final class AnnouncementPolicy
{
    public function create(User $user): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function update(User $user, Announcement $announcement): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }
}
