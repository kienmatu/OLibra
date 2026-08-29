<?php

namespace App\Http\Middleware;

use App\Support\TenantContext;
use Illuminate\Http\Request;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    /** @var string */
    protected $rootView = 'app';

    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    /** @return array<string, mixed> */
    public function share(Request $request): array
    {
        $context = app(TenantContext::class);
        $shelf = $context->bookshelf();

        return [
            ...parent::share($request),
            'auth' => [
                // is_super_admin is included: a super admin passes role:
                // gates on a shelf they hold no membership of (the gate is
                // unconditional in AppServiceProvider), so TenantContext's
                // membership() is null and 'role' below is null for them
                // too. Without this flag, shared props cannot express
                // "this user can see manage/admin nav" for the one person
                // guaranteed access to it — a client that hides
                // role-conditional UI on `role === null` would hide it
                // from super admins as well as guests.
                'user' => $request->user()?->only([
                    'id', 'display_name', 'full_name', 'saint_name', 'is_super_admin',
                ]),
            ],
            // Only the bound shelf, only presentation fields. §5.4: no
            // Inertia prop may carry a foreign bookshelf_id — this is the
            // single place shelf data enters shared props.
            'shelf' => $shelf === null ? null : [
                'id' => $shelf->id,
                'slug' => $shelf->slug,
                'name' => $shelf->name,
            ],
            'role' => $context->membership()?->role?->value,
            'flash' => [
                'success' => fn () => $request->session()->get('success'),
            ],
        ];
    }
}
