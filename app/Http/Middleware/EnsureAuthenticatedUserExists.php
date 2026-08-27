<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * CRITICAL 1 (src/auth/session.ts), the Laravel form of it: a session row
 * surviving its owner does not mean the owner may still act. User's
 * getAuthPasswordName()/SoftDeletes docblock claims the guard's own
 * retrieveById already handles this — true for a brand-new PHP-FPM process,
 * where user() has never been called and so must hit the provider. It is
 * NOT true once Illuminate\Auth\SessionGuard has already cached $this->user
 * for the lifetime of the process: the guard returns that cached instance
 * on every later call without re-querying, so a user soft-deleted mid-
 * process (mid Pest test today; a long-lived Octane worker tomorrow, the
 * exact hazard TenantContext's own docstring names) stays "authenticated"
 * according to the guard even though the row backing the session's user id
 * no longer resolves.
 *
 * This middleware runs a fresh existence check by id — not by trusting the
 * guard's cached model's own attributes, which are just as stale as the
 * cache itself — on every web request, and signs out in substance
 * (invalidate + regenerate the CSRF token, not just guard::logout(), so an
 * old session cannot be replayed) the moment it disagrees with the database.
 */
class EnsureAuthenticatedUserExists
{
    public function handle(Request $request, Closure $next): Response
    {
        $id = Auth::guard('web')->id();

        if ($id !== null && ! User::query()->whereKey($id)->exists()) {
            Auth::guard('web')->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        return $next($request);
    }
}
