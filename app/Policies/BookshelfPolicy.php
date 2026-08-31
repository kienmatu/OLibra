<?php

namespace App\Policies;

use App\Enums\BookshelfStatus;
use App\Models\Bookshelf;
use App\Models\User;
use Illuminate\Auth\Access\Response;

/**
 * Spec D9. The eight policies that came before this one all cover
 * per-shelf resources and all delegate to the `act-as-*` gates. This one
 * cannot: administration is not tenant-scoped, there is no membership to
 * read, and its gate is the global `users.is_super_admin` flag.
 *
 * **Two things here are new to this directory, both on purpose.**
 *
 * 1. Every method returns `Illuminate\Auth\Access\Response`, not `bool`.
 *    The eight existing policies return `bool`, which `Gate::authorize()`
 *    renders as **403**; `EnsureSuperAdmin` (`:20`) refuses the whole
 *    `/admin` group with **404**, on BR §5.4's anti-enumeration rule. A
 *    policy that answered 403 underneath a middleware that answers 404
 *    would tell an attacker, by status code alone, that the row they named
 *    exists and merely refused them. `Response::denyAsNotFound()` carries
 *    the 404 with the denial, so a refusal here is indistinguishable from a
 *    row that is not there. `MembershipPolicy`'s docblock already flags
 *    this exact 403-vs-404 mismatch as an open hazard; this is the shape
 *    that answers it.
 *
 * 2. It reads `is_super_admin` directly rather than going through a gate.
 *    `AppServiceProvider`'s `Gate::before` grants a super admin every
 *    ability whose name starts with `act-as-` and **nothing else**, so it
 *    does not reach this policy and cannot be leaned on here.
 *
 * The state checks below are the object-level half — the questions the
 * middleware structurally cannot answer, because it never sees the row.
 * `EnsureSuperAdmin` says whether the caller may be in the admin area at
 * all; only a policy can say whether *this* shelf may be archived. Both
 * halves refuse alike, so neither leaks the other's existence.
 */
class BookshelfPolicy
{
    public function viewAny(User $user): Response
    {
        return $this->asSuperAdmin($user);
    }

    public function view(User $user, Bookshelf $bookshelf): Response
    {
        return $this->asSuperAdmin($user);
    }

    public function create(User $user): Response
    {
        return $this->asSuperAdmin($user);
    }

    /** Profile, lending policy and contacts (Tasks 4 and 5) all land here. */
    public function update(User $user, Bookshelf $bookshelf): Response
    {
        return $this->asSuperAdmin($user);
    }

    /**
     * Spec D9's own worked example of an object-level question. Archiving
     * a shelf that is already archived is a no-op that would still write
     * an audit row saying it happened, so it is refused — and refused as a
     * 404, exactly like an unknown slug, so repeating the request tells the
     * caller nothing about the shelf's state.
     */
    public function archive(User $user, Bookshelf $bookshelf): Response
    {
        $allowed = $this->asSuperAdmin($user);

        if ($allowed->denied()) {
            return $allowed;
        }

        return $bookshelf->status === BookshelfStatus::Active
            ? Response::allow()
            : Response::denyAsNotFound();
    }

    /** The mirror of archive(): only an archived shelf can be restored. */
    public function unarchive(User $user, Bookshelf $bookshelf): Response
    {
        $allowed = $this->asSuperAdmin($user);

        if ($allowed->denied()) {
            return $allowed;
        }

        return $bookshelf->status === BookshelfStatus::Archived
            ? Response::allow()
            : Response::denyAsNotFound();
    }

    /**
     * Task 7, spec D7. A grant may only be made on a shelf that is running.
     * `AssignManager` itself reads no status — it checks that the shelf and
     * the person exist and nothing else — so appointing somebody to an
     * archived shelf would silently mint a membership nobody can ever
     * exercise, through a redirect that looks exactly like every other
     * success. The reference's own picker excludes archived shelves for
     * this reason; here the rule is stated once, where a hand-posted form
     * meets it too.
     */
    public function assignManager(User $user, Bookshelf $bookshelf): Response
    {
        $allowed = $this->asSuperAdmin($user);

        if ($allowed->denied()) {
            return $allowed;
        }

        return $bookshelf->status === BookshelfStatus::Active
            ? Response::allow()
            : Response::denyAsNotFound();
    }

    /**
     * NOT the mirror of assignManager(), and the asymmetry is deliberate: an
     * archived shelf's managers must stay revocable. The manager list exists
     * so a super administrator can see and undo what is already there, which
     * is a different question from where a NEW grant may go — and a shelf
     * archived while somebody still held its keys is precisely when taking
     * them back matters.
     *
     * The state rule that a reader has nothing to revoke lives in
     * `RevokeManager` rather than here, as a named refusal with its own
     * Vietnamese sentence. This screen lists the person by name one line
     * above the control, so the anti-enumeration argument that makes
     * archive() a 404 has nothing to protect here — a 404 would only be a
     * blank answer about somebody the caller is already looking at.
     */
    public function revokeManager(User $user, Bookshelf $bookshelf): Response
    {
        return $this->asSuperAdmin($user);
    }

    private function asSuperAdmin(User $user): Response
    {
        return $user->is_super_admin ? Response::allow() : Response::denyAsNotFound();
    }
}
