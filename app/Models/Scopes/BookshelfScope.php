<?php

namespace App\Models\Scopes;

use App\Support\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;

/**
 * The ONLY place in the codebase allowed to filter on bookshelf_id — the
 * Architecture suite (Task 15) greps everything else.
 *
 * FAIL CLOSED: a scoped query under an unbound context throws instead of
 * silently returning every shelf's rows. Under RLS, forgetting the tenant
 * returned nothing; a no-op scope would return everything — the exact
 * inversion spec §10 risk 1 warns about, and precisely what happens the day
 * a route group ships without the `tenant` middleware or a job queries a
 * scoped model without opting in. System-wide reads say so by name:
 * TenantContext::actSystemWide().
 *
 * @implements Scope<Model>
 */
class BookshelfScope implements Scope
{
    /**
     * @param  Builder<covariant Model>  $builder
     */
    public function apply(Builder $builder, Model $model): void
    {
        $context = app(TenantContext::class);

        if ($context->isSystemWide()) {
            return;
        }

        $bookshelfId = $context->bookshelfId();

        if ($bookshelfId === null) {
            throw new \RuntimeException(sprintf(
                '%s is shelf-scoped but no tenant is bound. Bind one via the '
                .'tenant middleware, or opt in explicitly with '
                .'TenantContext::actSystemWide() and name bookshelf_id yourself.',
                $model::class,
            ));
        }

        $builder->where($model->getTable().'.bookshelf_id', $bookshelfId);
    }
}
