<?php

namespace App\Policies;

use App\Models\Membership;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * BR §13.2's Members permission set: "view any, view one, approve, reject,
 * suspend, create, register on behalf, set or change credentials". Every
 * verb is a manager's; the two reader-side member verbs (propose a change,
 * approve/reject one) are Phase 3's and arrive with their own abilities.
 *
 * Like BookPolicy, every method delegates to the act-as gates — the ONE
 * place role, status and shelf-binding combine — and the $membership
 * parameter carries no shelf re-check: under a bound tenant BookshelfScope
 * means a foreign shelf's membership cannot have been resolved at all.
 *
 * The §9 subject-role refinement (a manager/admin SUBJECT may only be
 * corrected by a super admin) is deliberately NOT here: it needs the
 * subject's current role read under the command's own lock, so it lives in
 * UpdateReaderProfile (Task 10), exactly where the reference kept it.
 */
class MembershipPolicy
{
    public function viewAny(User $user): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function view(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    /** Register on behalf / manager-register — both create a membership. */
    public function create(User $user): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function approve(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function reject(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function suspend(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function reactivate(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function markLeft(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function setCredentials(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    /** UpdateReaderProfile's floor — the subject-role rule is the Action's. */
    public function correct(User $user, Membership $membership): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }
}
