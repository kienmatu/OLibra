<?php

namespace App\Models;

use App\Enums\ProfileChangeStatus;
use App\Models\Concerns\BelongsToBookshelf;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class ProfileChangeRequest extends Model
{
    use BelongsToBookshelf, HasUuids;

    /** The generated key column — writing it is errno 1906. */
    protected $guarded = ['pending_user_id'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => ProfileChangeStatus::class,
            'proposed_values' => 'array',
            'previous_values' => 'array',
            'requested_at' => 'datetime',
            'decided_at' => 'datetime',
        ];
    }
}
