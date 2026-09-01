<?php

namespace App\Policies;

use App\Models\User;
use Illuminate\Auth\Access\Response;

/**
 * Task 7, spec D5. One ability, because there is one thing in this
 * application that is done TO a person rather than to a membership: the
 * global grant.
 *
 * It cannot live on `MembershipPolicy`. A super administrator holds no
 * membership anywhere by nature — `users.is_super_admin` is a column on the
 * person — and every method of that policy delegates to the `act-as-*`
 * gates, which read a membership under a bound tenant. The `/admin` group
 * binds none.
 *
 * It cannot live on `BookshelfPolicy` either: this act names no shelf, which
 * is the same reason its audit row carries none.
 *
 * `Response`, not `bool`, and `denyAsNotFound()` — `BookshelfPolicy`'s
 * docblock carries the reasoning in full. In short: `EnsureSuperAdmin`
 * refuses the whole `/admin` group with 404 on BR §5.4's anti-enumeration
 * rule, and a policy underneath it answering 403 would tell an attacker by
 * status code alone that the person they named exists.
 *
 * **There is no `demoteSuperAdmin` ability, and there must not be one**
 * until the requirements say what happens when the last administrator
 * removes their own grant (spec D5).
 */
class UserPolicy
{
    public function promoteSuperAdmin(User $user, User $target): Response
    {
        return $user->is_super_admin ? Response::allow() : Response::denyAsNotFound();
    }
}
