<?php

namespace App\Models;

use App\Models\Concerns\BelongsToBookshelf;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Announcement extends Model
{
    use BelongsToBookshelf, HasUuids, SoftDeletes;

    /** The generated key column — writing it is errno 1906. */
    protected $guarded = ['slug_key'];

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
