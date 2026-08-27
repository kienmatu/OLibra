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
                'user' => $request->user()?->only(['id', 'display_name', 'full_name', 'saint_name']),
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
        ];
    }
}
