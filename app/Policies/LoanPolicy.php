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
