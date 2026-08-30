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
 *
 * TASK 11 ADDS FOUR ABILITIES RATHER THAN REUSING update(), and this is
 * a judgement, not a rule the plan handed down. CommentPolicy (opened
 * for this) is the precedent and it went the same way: approve(),
 * reject() and hide() are three separate methods with three identical
 * bodies, one per command, none reading the $comment. Following it costs
 * four near-duplicate methods and buys two things a shared update()
 * would not. First, the call site says what it is asking permission for
 * — `authorize('publish', $announcement)` reads as the act it guards,
 * where `authorize('update', …)` inside PublishAnnouncement would make a
 * reader check whether publishing counts as an update. Second, the day
 * one of these four needs a different answer — a shelf that lets an
 * author hide their own notice, say — the ability to change already
 * exists and only its own command moves; with one shared update() the
 * split would have to be invented under time pressure, and the tempting
 * shortcut would be a body that reads the row, which is exactly what
 * the paragraph above forbids.
 *
 * These four take an Announcement and, like update(), do not read it.
 * The row's own state is not a permission question: whether it is
 * already published is PublishAnnouncement's refusal (already_published,
 * with a Vietnamese sentence, rendered as a redirect), and answering it
 * here would turn a denial into an existence oracle and a 403 into a
 * status §5.4 does not want.
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

    public function publish(User $user, Announcement $announcement): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function hide(User $user, Announcement $announcement): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function pin(User $user, Announcement $announcement): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function unpin(User $user, Announcement $announcement): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }
}
