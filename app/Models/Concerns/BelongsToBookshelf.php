<?php

namespace App\Models\Concerns;

use App\Models\Bookshelf;
use App\Models\Scopes\BookshelfScope;
use App\Support\TenantContext;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Every shelf-scoped model carries this — spec §5.2's routine layer. The
 * global scope reads the bound shelf; the creating hook stamps bookshelf_id
 * so no controller or action ever writes it by hand. The structural layer
 * (composite FKs, Task 11) survives a bug in this one.
 */
trait BelongsToBookshelf
{
    public static function bootBelongsToBookshelf(): void
    {
        static::addGlobalScope(new BookshelfScope);

        static::creating(function (Model $model): void {
            if ($model->getAttribute('bookshelf_id') === null) {
                $model->setAttribute('bookshelf_id', app(TenantContext::class)->bookshelfId());
            }
        });
    }

    /** @return BelongsTo<Bookshelf, $this> */
    public function bookshelf(): BelongsTo
    {
        return $this->belongsTo(Bookshelf::class);
    }
}
