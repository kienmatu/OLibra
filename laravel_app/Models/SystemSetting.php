<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** The single-row table. Read with SystemSetting::sole(); never created. */
class SystemSetting extends Model
{
    public $timestamps = false;   // changed_at is domain-written, not conventional

    public $incrementing = false;

    protected $guarded = [];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['changed_at' => 'datetime'];
    }
}
