<?php

namespace App\Models;

use App\Enums\FeedbackStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * Deliberately NOT BelongsToBookshelf: bookshelf_id is nullable — front-door
 * feedback belongs to no shelf, and the scope would wrongly hide those rows
 * from every shelf context. Shelf-scoped reads of feedback go through
 * Bookshelf::feedback() ($shelf->feedback()->...), an ordinary Eloquent
 * relation keyed on the same FK — not a hand-written filter on that
 * column — so Phase 2's queries need no exemption from
 * TenancyArchitectureTest's hand-written-filter allowlist. The Task 15
 * architecture test pins this model's trait exemption by name.
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
