<?php

namespace App\Models;

use App\Models\Concerns\BelongsToBookshelf;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Announcement extends Model
{
    use BelongsToBookshelf, HasUuids, SoftDeletes;

    /** The generated key column — writing it is errno 1906. */
    protected $guarded = ['slug_key'];

    /**
     * announcements.author_id names users(id) — read off the live table's
     * own FK, `announcements_author_id_foreign ... REFERENCES users (id)`.
     * The key is spelled rather than guessed, Comment::author()'s reason:
     * an implicit guess follows this method's NAME, so a rename would
     * silently repoint the column.
     *
     * Nullable in the schema (`author_id ... DEFAULT NULL`), so the
     * relation can legitimately resolve to null.
     *
     * @return BelongsTo<User, $this>
     */
    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id');
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'is_pinned' => 'boolean',
            'published_at' => 'datetime',
            'expires_at' => 'datetime',
        ];
    }
}
