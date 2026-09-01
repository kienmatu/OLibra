<?php

namespace App\Policies;

use App\Models\ParishUnit;
use App\Models\User;
use Illuminate\Auth\Access\Response;

/**
 * Phase 3b-ii Task 5, spec D5 — BR §5.6's parish units, the rows a reader
 * picks from at registration.
 *
 * **EVERY ABILITY HERE IS THE GLOBAL FLAG AND NOTHING ELSE.** All five of
 * the reference's unit commands open with `requireSuperAdmin` (OPS §4.5),
 * and that is the whole authority question: a shelf's own manager — or its
 * own `admin`, which the kernel's `Role` ranks below `super_admin` — may
 * read the tree and may not touch it. The screen renders the read-only half
 * to them for exactly that reason, and this policy is what makes the
 * rendering a courtesy rather than the guard.
 *
 * **THE SHELF IS NOT ASKED ABOUT HERE.** `ParishUnit` carries
 * `BelongsToBookshelf`, and `manage/units` binds a tenant, so which shelf a
 * unit belongs to is settled by `BookshelfScope` on every query and by
 * `Bookshelf::parishUnits()` under the route group's `scopeBindings()`
 * before any ability runs. An ability that re-asked it would be a third,
 * hand-written copy of the tenant predicate — the thing
 * `ParishContextQuery`'s docblock already refuses for this same table.
 *
 * `Response::denyAsNotFound()` rather than `bool`, and the reason is this
 * route group's own: every Form Request under `manage/` answers a denial
 * with `abort(…, 404)` (see `FormRequestAuthorize404Test`, and
 * `EnsureShelfRole`'s docblock for the rule), because BR §5.4 forbids a
 * refusal that confirms what a URL space holds. A policy underneath that
 * middleware answering 403 would disagree with it about what a
 * non-administrator is allowed to learn. `CategoryPolicy` answers the same
 * way under `EnsureSuperAdmin` for the same reason.
 *
 * FOUR ABILITIES AND NOT ONE, `CategoryPolicy`'s and `AnnouncementPolicy`'s
 * judgement: the call site reads as the act it guards, and the day one of
 * the four needs a different answer the ability to move already exists.
 * None of the four reads its `ParishUnit`. The parameter exists because
 * Laravel resolves the policy from the model's class, not because one unit
 * is more editable than another — and a body that read the row would turn a
 * denial into a statement about that row.
 */
final class ParishUnitPolicy
{
    /**
     * Adding a unit. Takes no `ParishUnit` and cannot: the row does not
     * exist yet, so this one is authorized by class name.
     */
    public function create(User $user): Response
    {
        return $this->onlySuperAdmin($user);
    }

    /** A rename — the display name moves and nothing else does. */
    public function update(User $user, ParishUnit $unit): Response
    {
        return $this->onlySuperAdmin($user);
    }

    /**
     * The soft delete, cascading to live level-2 children. That the
     * cascade happens is `DeleteParishUnit`'s business and deliberately
     * not a permission question: a policy that refused a level-1 unit with
     * children would turn "these four tổ go with it" into a 404 that says
     * nothing.
     */
    public function delete(User $user, ParishUnit $unit): Response
    {
        return $this->onlySuperAdmin($user);
    }

    /**
     * Setting `sort_order` across one sibling group. Authorized by class
     * name like `create()`: the act's subject is a group of rows, and
     * naming one of them as the model would make the permission a
     * statement about whichever unit the caller happened to list first.
     */
    public function reorder(User $user): Response
    {
        return $this->onlySuperAdmin($user);
    }

    private function onlySuperAdmin(User $user): Response
    {
        return $user->is_super_admin ? Response::allow() : Response::denyAsNotFound();
    }
}
