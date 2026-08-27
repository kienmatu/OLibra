<?php

namespace App\Models;

use App\Enums\FeedbackStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * Deliberately NOT BelongsToBookshelf: bookshelf_id is nullable — front-door
 * feedback belongs to no shelf, and the scope would wrongly hide those rows
 * from every shelf context. Shelf-scoped reads of feedback are written
 * explicitly in app/Queries classes (Phase 2). The Task 15 architecture test
 * pins this exemption by name.
 */
class Feedback extends Model
{
    use HasUuids;

    protected $table = 'feedback';

    public const UPDATED_AT = null;   // the table has created_at only

    protected $guarded = [];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => FeedbackStatus::class,
            'handled_at' => 'datetime',
        ];
    }
}
