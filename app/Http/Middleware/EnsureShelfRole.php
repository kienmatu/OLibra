<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
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
        if (! $request->user()) {
            return redirect()->guest(route('login'));
        }

        if (! Gate::allows('act-as-'.$role)) {
            abort(404);
        }

        return $next($request);
    }
}
