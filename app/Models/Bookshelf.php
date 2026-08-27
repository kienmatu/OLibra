<?php

namespace App\Models;

use App\Enums\BookshelfStatus;
use Database\Factories\BookshelfFactory;
use Illuminate\Database\Eloquent\Casts\AsArrayObject;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Bookshelf extends Model
{
    /** @use HasFactory<BookshelfFactory> */
    use HasFactory, HasUuids, SoftDeletes;

    /** The generated key column — writing it is errno 1906. */
    protected $guarded = ['slug_active'];

    /** {shelf} binds by slug, and slugs are immutable by trigger. */
    public function getRouteKeyName(): string
    {
        return 'slug';
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => BookshelfStatus::class,
            'settings' => AsArrayObject::class,
            'established_on' => 'date',
        ];
    }

    /** @return HasMany<Membership, $this> */
    public function memberships(): HasMany
    {
        return $this->hasMany(Membership::class);
    }

    /** @return HasMany<BookshelfContact, $this> */
    public function contacts(): HasMany
    {
        return $this->hasMany(BookshelfContact::class);
    }

    /**
     * Task 18's scoped route bindings resolve {book} THROUGH this relation
     * ($shelf->books()->where('slug', …)), which is what makes a foreign
     * shelf's colliding slug a 404 instead of a cross-tenant hit.
     *
     * @return HasMany<Book, $this>
     */
    public function books(): HasMany
    {
        return $this->hasMany(Book::class);
    }

    /** @return HasMany<BookCopy, $this> */
    public function bookCopies(): HasMany
    {
        return $this->hasMany(BookCopy::class);
    }

    /**
     * Feedback.bookshelf_id is nullable and Feedback deliberately does not
     * carry BelongsToBookshelf (see its docblock), so a shelf-scoped read
     * cannot go through a global scope. Routing it through THIS relation
     * instead of a hand-written filter on that column means Phase 2's
     * app/Queries classes need no literal filter — and no exemption in
     * TenancyArchitectureTest's hand-written-filter allowlist — to read a
     * shelf's own feedback: $shelf->feedback()->... already scopes by FK.
     *
     * @return HasMany<Feedback, $this>
     */
    public function feedback(): HasMany
    {
        return $this->hasMany(Feedback::class);
    }
}
