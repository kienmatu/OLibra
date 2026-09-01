<?php

namespace App\Policies;

use App\Models\Category;
use App\Models\User;
use Illuminate\Auth\Access\Response;

/**
 * Phase 3b-ii Task 3, spec D3. The book genres — one taxonomy every tủ sách
 * in the installation shares, which is the whole reason this policy names no
 * shelf and takes no membership.
 *
 * `Category` carries no `BelongsToBookshelf` and `categories` has no
 * `bookshelf_id` (DATABASE.md §4.3: global reference data rather than tenant
 * data), so an ability asking "may this person edit this genre on that
 * shelf" would be asking a question the table cannot answer. The subject is
 * the installation, the same way `system_settings` is — which is also why
 * all three writers audit globally.
 *
 * FOUR ABILITIES AND NOT ONE, because the screen offers three separate
 * controls and a list: a single `manage` would make the list's permission
 * and the archive's permission the same statement, and the day one of them
 * moves (a manager who may browse the taxonomy but not edit it) there would
 * be nothing to move.
 *
 * `Response` and `denyAsNotFound()` rather than `bool` — the argument is
 * `BookshelfPolicy`'s and `SystemSettingPolicy`'s: `EnsureSuperAdmin`
 * refuses the whole `/admin` group with a 404 on BR §5.4's anti-enumeration
 * rule, and a policy underneath it answering 403 would disagree with the
 * middleware above it about what a non-administrator is allowed to learn.
 *
 * REDUNDANT WITH THAT MIDDLEWARE TODAY, and kept for the reason
 * `SystemSettingPolicy` states: the three commands are callable from
 * anywhere — a console command, a later screen — and a write whose only
 * guard is a route's middleware is a write with no guard of its own.
 */
class CategoryPolicy
{
    public function viewAny(User $user): Response
    {
        return $this->onlySuperAdmin($user);
    }

    public function create(User $user): Response
    {
        return $this->onlySuperAdmin($user);
    }

    /**
     * A rename. The genre is passed and deliberately unread: nothing about
     * one genre makes it more or less editable than another, and an ability
     * that ignored the model would have to be authorized by class name,
     * which is a different call at every site.
     */
    public function update(User $user, Category $category): Response
    {
        return $this->onlySuperAdmin($user);
    }

    /**
     * The soft delete. Whether the genre still has books on it is NOT
     * decided here: that is `category_in_use`, a business refusal with a
     * Vietnamese sentence a volunteer can act on, and a policy answering it
     * would turn "move these books first" into a 404 that says nothing.
     */
    public function archive(User $user, Category $category): Response
    {
        return $this->onlySuperAdmin($user);
    }

    private function onlySuperAdmin(User $user): Response
    {
        return $user->is_super_admin ? Response::allow() : Response::denyAsNotFound();
    }
}
