<?php

namespace App\Models;

use App\Enums\DonationStatus;
use App\Models\Concerns\BelongsToBookshelf;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class BookDonation extends Model
{
    use BelongsToBookshelf, HasUuids;

    protected $guarded = [];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => DonationStatus::class,
            'decided_at' => 'datetime',
        ];
    }
}
