<?php

namespace App\Models;

use App\Enums\CopyCondition;
use App\Models\Concerns\BelongsToBookshelf;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class ConditionAssessment extends Model
{
    use BelongsToBookshelf, HasUuids;

    /** The table has assessed_at only — no created_at/updated_at pair. */
    public $timestamps = false;

    protected $guarded = [];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'condition' => CopyCondition::class,
            'assessed_at' => 'datetime',
        ];
    }
}
