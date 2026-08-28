<?php

namespace App\Policies;

use App\Models\Loan;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * BR §13.2's circulation abilities, delegating to the act-as gates the way
 * BookPolicy and MembershipPolicy do. renew() deliberately checks role
 * only: ownership folds into RenewLoan's loan_not_active (OPS §4.2 lists
 * no loan_not_found; a policy-level 403 would confirm the loan exists).
 *
 * renew() DOES delegate to 'act-as-reader' — reverted, 2026-08-29 fix
 * round. Task 5 briefly inlined the shared gate's role/ownership/
 * soft-delete checks here, minus its MembershipStatus::Active clause, on
 * the theory that a suspended reader should still be able to renew a loan
 * already in their hands. That theory does not survive contact with the
 * real request path: ResolveTenant (app/Http/Middleware/ResolveTenant.
 * php:65) is the ONLY place a membership is ever resolved into
 * TenantContext, and its query is filtered `->where('status', Active)` —
 * so a suspended reader's TenantContext::membership() is always null, on
 * every route, this one included. The Task 5 change moved the refusal
 * site from this policy (403 via act-as-reader) to RenewLoan::execute's
 * own Gate::authorize call (still a 403, same act-as-reader gate, just
 * reached one level up) — the suspended reader was refused before either
 * version of this method ran. Delivering the "allowed" reading for real
 * would mean changing how EVERY reader route resolves suspension, not
 * just this one; see docs/known-gaps.md. The reference is not authority
 * for the other reading either: requireReader (old_next/src/domain/
 * catalogue/policy.ts:269) never reads status because the reference
 * applies that filter one layer up, in membershipFor
 * (old_next/src/auth/guards.ts:56-65) — "and m.status = 'active'", with
 * the comment "A suspended member is not a reader of this shelf, though
 * their existing loans survive (INV-4)." ResolveTenant's filter is the
 * faithful port of that line.
 */
final class LoanPolicy
{
    public function lend(User $user, Loan $loan): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function receiveReturn(User $user, Loan $loan): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function void(User $user, Loan $loan): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function renew(User $user, Loan $loan): bool
    {
        return Gate::forUser($user)->allows('act-as-reader');
    }
}
