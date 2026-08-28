<?php

namespace App\Policies;

use App\Enums\MembershipRole;
use App\Models\Loan;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Gate;

/**
 * BR §13.2's circulation abilities, delegating to the act-as gates the way
 * BookPolicy and MembershipPolicy do. renew() deliberately checks role
 * only: ownership folds into RenewLoan's loan_not_active (OPS §4.2 lists
 * no loan_not_found; a policy-level 403 would confirm the loan exists).
 *
 * renew() does NOT delegate to 'act-as-reader' (deviation from lend/
 * receiveReturn/void above, and from this method's own shape before Task
 * 5): that gate's $roleGate closure (AppServiceProvider.php) additionally
 * requires MembershipStatus::Active, which is correct for INV-4's
 * new-loan gate but wrong here — the 2026-08-29 product-owner ruling this
 * phase is bound by is that a suspended reader may still renew a loan
 * already in their hands (RenewLoan's own docblock, RenewLoanTest's Q4
 * test), matching the reference's requireReader
 * (old_next/src/domain/catalogue/policy.ts:269), which ranks role only and
 * never reads membership status. Reusing 'act-as-reader' here would have
 * made that ruling unreachable: ResolveTenant only ever binds an ACTIVE
 * membership into TenantContext on the real request path, so a suspended
 * reader calling through 'act-as-reader' is refused before RenewLoan's
 * own logic runs at all. This inlines the same role-rank and
 * ownership/soft-delete checks the shared gate makes, minus the status
 * one, so every OTHER act-as-reader caller is untouched.
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
        if ($user->is_super_admin) {
            return true;
        }

        $membership = app(TenantContext::class)->membership();

        return $membership !== null
            && $membership->user_id === $user->id
            && ! $membership->trashed()
            && $membership->role->atLeast(MembershipRole::Reader);
    }
}
