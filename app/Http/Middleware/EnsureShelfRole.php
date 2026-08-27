<?php

namespace App\Http\Middleware;

use App\Enums\MembershipRole;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use InvalidArgumentException;
use Symfony\Component\HttpFoundation\Response;

/**
 * `role:manager` on a route group = Gate act-as-manager or 404.
 *
 * 404, not 403 — the URL space must not confirm what exists (spec §5.4),
 * and a signed-in non-manager pasting a manager URL sees the same nothing a
 * wrong slug shows (loadPage's rule, spec §7). A guest is redirected to
 * login instead: they have not failed authorisation, they have not
 * authenticated yet.
 */
class EnsureShelfRole
{
    public function handle(Request $request, Closure $next, string $role): Response
    {
        // Validate against the enum rather than interpolating $role
        // straight into the ability name. An unvalidated typo like
        // `role:managerr` would build the ability "act-as-managerr", which
        // Gate never defines — and Gate::before grants true for undefined
        // abilities to a super admin (it runs before Laravel even checks
        // whether the ability exists), so the typo would silently turn the
        // route into a super-admin-only page instead of failing loudly for
        // everyone at boot/request time.
        $required = MembershipRole::tryFrom($role)
            ?? throw new InvalidArgumentException("Unknown shelf role in route middleware: \"{$role}\".");

        if (! $request->user()) {
            return redirect()->guest(route('login'));
        }

        if (! Gate::allows('act-as-'.$required->value)) {
            abort(404);
        }

        return $next($request);
    }
}
