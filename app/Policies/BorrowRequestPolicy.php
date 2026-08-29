<?php

namespace App\Policies;

use App\Models\BorrowRequest;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * OPS §4.2's callers, delegating to the act-as gates the way LoanPolicy
 * does. Ownership is deliberately NOT here: cancel's "own request only"
 * folds into the Action's not_own_request (both sides users.id), because
 * a policy-level 403 would confirm the request exists.
 *
 * The rule that forbids that is anti-enumeration, spec §5.4 — the
 * MIGRATION DESIGN spec's "The TenantIsolation suite", not
 * BUSINESS-REQUIREMENTS.md, whose own §5.4 is a field list and which
 * `grep -in "enumerat"` does not match at all. This docblock said "BR
 * §5.4" when it landed, inherited from the plan; the coordinator has since
 * corrected the plan and known-gaps at source (d93d4e9) and this is the
 * same correction. It is enforced by
 * App\Http\Middleware\EnsureShelfRole (whose docblock has cited it
 * correctly all along) and swept by
 * tests/Feature/Tenancy/RouteIsolationTest.php.
 *
 * The $request parameter is unused in every method for that same reason,
 * and its absence of use is the rule, not an oversight: the moment one of
 * these bodies reads the row, this policy starts answering questions about
 * a specific request, and a denial becomes an existence oracle. What the
 * row IS gets decided by the Actions (request_not_pending,
 * request_not_held, not_own_request — one code per command, all three
 * cases folded into it) and what it BELONGS to gets decided one layer
 * earlier still, by the binding: Bookshelf::borrowRequests() and
 * BookshelfScope each turn a foreign shelf's request into a 404 before any
 * ability is checked, either one sufficient on its own (measured — see
 * that relation's docblock), and SoftDeletes does the same for an undone
 * row.
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
