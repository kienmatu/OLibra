<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * BIGINT identity pk (no HasUuids), append-only by trigger. NOT
 * BelongsToBookshelf: bookshelf_id is nullable — cross-shelf administrative
 * acts land here with no shelf, and the scope would hide them everywhere.
 * The Task 15 architecture test pins this exemption by name.
 */
class AuditLog extends Model
{
    protected $table = 'audit_log';

    public $timestamps = false;   // occurred_at only, database-defaulted

    protected $guarded = [];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'before' => 'array',
            'after' => 'array',
            'context' => 'array',
            'occurred_at' => 'datetime',
        ];
    }
}
