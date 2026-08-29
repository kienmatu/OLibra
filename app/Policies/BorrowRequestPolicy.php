<?php

namespace App\Policies;

use App\Models\BorrowRequest;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * OPS §4.2's callers, delegating to the act-as gates the way LoanPolicy
 * does. Ownership is deliberately NOT here: cancel's "own request only"
 * folds into the Action's not_own_request (both sides users.id), because
 * a policy-level 403 would confirm the request exists — BR §5.4.
 *
 * The $request parameter is unused in every method for that same reason,
 * and its absence of use is the rule, not an oversight: the moment one of
 * these bodies reads the row, this policy starts answering questions about
 * a specific request, and a denial becomes an existence oracle. What the
 * row IS gets decided by the Actions (request_not_pending,
 * request_not_held, not_own_request — one code per command, all three
 * cases folded into it) and what it BELONGS to gets decided one layer
 * earlier still, by the binding: Bookshelf::borrowRequests() plus
 * BookshelfScope turn a foreign shelf's request, and a soft-deleted one,
 * into a 404 before any ability is checked.
 */
final class BorrowRequestPolicy
{
    public function create(User $user): bool
    {
        return Gate::forUser($user)->allows('act-as-reader');
    }

    public function cancel(User $user, BorrowRequest $request): bool
    {
        return Gate::forUser($user)->allows('act-as-reader');
    }

    public function approve(User $user, BorrowRequest $request): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function reject(User $user, BorrowRequest $request): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }

    public function handover(User $user, BorrowRequest $request): bool
    {
        return Gate::forUser($user)->allows('act-as-manager');
    }
}
