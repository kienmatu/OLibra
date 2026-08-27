<?php

namespace App\Http\Middleware;

use App\Enums\MembershipStatus;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\Scopes\BookshelfScope;
use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The ONLY place a membership is resolved (spec §5.3). Runs BEFORE
 * SubstituteBindings — the middleware priority in bootstrap/app.php puts it
 * there — because child bindings ({book} under {shelf}) execute inside
 * SubstituteBindings, and BookshelfScope fails closed: a binding query
 * before the tenant is bound would throw. So this middleware resolves the
 * shelf itself from the raw slug, binds the context, and hands the resolved
 * model back to the route so SubstituteBindings does not re-query it.
 * Populates TenantContext; Gates (Task 17) read from there and nowhere else.
 */
class ResolveTenant
{
    public function __construct(private TenantContext $context) {}

    public function handle(Request $request, Closure $next): Response
    {
        $parameter = $request->route('shelf');

        // Before SubstituteBindings the parameter is the raw slug; resolve
        // it here (soft-deleted shelves excluded by SoftDeletes). 404 for
        // anything unknown — the URL space confirms nothing.
        $shelf = $parameter instanceof Bookshelf
            ? $parameter
            : Bookshelf::query()->where('slug', (string) $parameter)->first();

        if (! $shelf instanceof Bookshelf) {
            abort(404);
        }

        $route = $request->route();

        if ($route !== null) {
            $route->setParameter('shelf', $shelf);
        }

        $membership = null;

        if ($user = $request->user()) {
            // withoutGlobalScope(BookshelfScope) only — not
            // withoutGlobalScopes() with no argument, which strips EVERY
            // global scope including SoftDeletingScope and would resolve a
            // soft-deleted (removed) membership right back into the
            // context. The shelf id is explicit, which is what lets
            // BookshelfScope be skipped by name at all; deleted_at is-null
            // exclusion must still apply — memberships_one_per_shelf is
            // built on IF(deleted_at IS NULL, ...) specifically so a
            // removed member's old row can coexist with a fresh one, and a
            // query that ignores deleted_at would hand a revoked member
            // their old role right back.
            $membership = Membership::query()
                ->withoutGlobalScope(BookshelfScope::class)
                ->where('bookshelf_id', $shelf->id)
                ->where('user_id', $user->id)
                ->where('status', MembershipStatus::Active)
                ->first();
        }

        $this->context->set($shelf, $membership);

        return $next($request);
    }
}
