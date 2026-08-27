<?php

namespace App\Http\Middleware;

use App\Enums\MembershipStatus;
use App\Models\Bookshelf;
use App\Models\Membership;
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
            // withoutGlobalScopes: the context is not populated yet, and this
            // one query IS the population step. The shelf id is explicit.
            $membership = Membership::query()
                ->withoutGlobalScopes()
                ->where('bookshelf_id', $shelf->id)
                ->where('user_id', $user->id)
                ->where('status', MembershipStatus::Active)
                ->first();
        }

        $this->context->set($shelf, $membership);

        return $next($request);
    }
}
