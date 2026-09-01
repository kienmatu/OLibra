<?php

namespace App\Policies;

use App\Models\User;
use Illuminate\Auth\Access\Response;

/**
 * Phase 3b-ii Task 1, spec D1. One ability, for the installation's own
 * single row — the administration's contact block and the defaults a newly
 * created shelf starts with.
 *
 * IT NAMES NO SHELF, so it can live on neither `BookshelfPolicy` (whose
 * every ability takes the shelf being administered) nor `MembershipPolicy`
 * (whose every method reads a membership under a bound tenant the `/admin`
 * group does not have). `system_settings` is the installation, the same way
 * `users.is_super_admin` is a person — and both of this phase's writers
 * audit globally for the identical reason.
 *
 * AUTHORIZED BY CLASS NAME, NOT BY INSTANCE. Both callers check permission
 * before they read the row, so there is no model to pass; a policy method
 * taking only the user is what Laravel's class-name authorization calls.
 *
 * `Response` and `denyAsNotFound()` rather than `bool` — `BookshelfPolicy`'s
 * docblock carries the argument in full: `EnsureSuperAdmin` refuses the
 * whole `/admin` group with a 404 on BR §5.4's anti-enumeration rule, and a
 * policy underneath it answering 403 would disagree with the middleware
 * above it about what a non-administrator is allowed to learn.
 *
 * REDUNDANT WITH THE MIDDLEWARE TODAY, and kept for the reason
 * `ShelfController::index` keeps its `viewAny` check: the commands are
 * callable from anywhere (a console command, a later screen), and a write
 * whose only guard is a route's middleware is a write with no guard of its
 * own.
 */
class SystemSettingPolicy
{
    public function update(User $user): Response
    {
        return $user->is_super_admin ? Response::allow() : Response::denyAsNotFound();
    }
}
