<?php

namespace App\Models\Concerns;

use App\Models\Bookshelf;
use App\Models\Scopes\BookshelfScope;
use App\Support\TenantContext;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Every shelf-scoped model carries this — spec §5.2's routine layer. The
 * global scope reads the bound shelf; the creating hook fills bookshelf_id
 * in when the attribute is left null, so a plain ::create() under a bound
 * context does not need to name its own shelf. bookshelf_id remains
 * mass-assignable on every one of these models, so a caller that passes it
 * explicitly — Book::create(['bookshelf_id' => $otherShelf->id, ...]) —
 * still writes to a foreign shelf; this trait only fills gaps, it does not
 * validate what is already there. Closing that write-side hole is Task 17's
 * job. The structural layer (composite FKs, Task 11) survives a bug in
 * this one.
 */
trait BelongsToBookshelf
{
    public static function bootBelongsToBookshelf(): void
    {
        static::addGlobalScope(new BookshelfScope);

        static::creating(function (Model $model): void {
            if ($model->getAttribute('bookshelf_id') !== null) {
                return;
            }

            $context = app(TenantContext::class);

            if ($context->isSystemWide()) {
                return;
            }

            $bookshelfId = $context->bookshelfId();

            if ($bookshelfId === null) {
                throw new \RuntimeException(sprintf(
                    '%s is shelf-scoped but no tenant is bound to stamp bookshelf_id. Bind one via '
                    .'the tenant middleware, or opt in explicitly with '
                    .'TenantContext::actSystemWide() and name bookshelf_id yourself.',
                    $model::class,
                ));
            }

            $model->setAttribute('bookshelf_id', $bookshelfId);
        });
    }

    /** @return BelongsTo<Bookshelf, $this> */
    public function bookshelf(): BelongsTo
    {
        return $this->belongsTo(Bookshelf::class);
    }
}
