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
 * mass-assignable on every one of these models, so the creating and
 * updating hooks below also VALIDATE an explicitly-named bookshelf_id
 * against the bound context: while a shelf is bound, naming any other
 * shelf's id — on create or by moving an existing row via update — throws,
 * closing the write-side hole a caller could otherwise use to write into a
 * foreign shelf (e.g. Book::create(['bookshelf_id' => $otherShelf->id,
 * ...]) from a manager of a different shelf). This validation only applies
 * while a shelf is bound; console commands, seeders and tests that run with
 * no tenant bound (or that opted into TenantContext::actSystemWide()) are
 * still trusted to name bookshelf_id themselves, exactly as the "unset"
 * and "system-wide" states already document. The structural layer
 * (composite FKs, Task 11) survives a bug in this one either way.
 */
trait BelongsToBookshelf
{
    public static function bootBelongsToBookshelf(): void
    {
        static::addGlobalScope(new BookshelfScope);

        static::creating(function (Model $model): void {
            $context = app(TenantContext::class);
            $explicit = $model->getAttribute('bookshelf_id');

            if ($context->isSystemWide()) {
                return;
            }

            $bookshelfId = $context->bookshelfId();

            if ($bookshelfId === null) {
                if ($explicit !== null) {
                    // No tenant bound, but the caller named a shelf
                    // themselves — the same trust console commands, seeders
                    // and test harnesses already rely on.
                    return;
                }

                throw new \RuntimeException(sprintf(
                    '%s is shelf-scoped but no tenant is bound to stamp bookshelf_id. Bind one via '
                    .'the tenant middleware, or opt in explicitly with '
                    .'TenantContext::actSystemWide() and name bookshelf_id yourself.',
                    $model::class,
                ));
            }

            if ($explicit !== null && $explicit !== $bookshelfId) {
                throw new \RuntimeException(sprintf(
                    '%s cannot be created for bookshelf_id %s while bound to shelf %s.',
                    $model::class,
                    $explicit,
                    $bookshelfId,
                ));
            }

            $model->setAttribute('bookshelf_id', $bookshelfId);
        });

        static::updating(function (Model $model): void {
            if (! $model->isDirty('bookshelf_id')) {
                return;
            }

            $context = app(TenantContext::class);

            if ($context->isSystemWide()) {
                return;
            }

            $bookshelfId = $context->bookshelfId();

            if ($bookshelfId === null) {
                // No tenant bound: trusted the same way an unbound create is.
                return;
            }

            $new = $model->getAttribute('bookshelf_id');

            if ($new !== $bookshelfId) {
                throw new \RuntimeException(sprintf(
                    '%s cannot be moved to bookshelf_id %s while bound to shelf %s.',
                    $model::class,
                    $new,
                    $bookshelfId,
                ));
            }
        });
    }

    /** @return BelongsTo<Bookshelf, $this> */
    public function bookshelf(): BelongsTo
    {
        return $this->belongsTo(Bookshelf::class);
    }
}
