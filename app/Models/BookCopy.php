<?php

namespace App\Models;

use App\Enums\CopyCondition;
use App\Enums\CopyState;
use App\Models\Concerns\BelongsToBookshelf;
use Database\Factories\BookCopyFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class BookCopy extends Model
{
    /** @use HasFactory<BookCopyFactory> */
    use BelongsToBookshelf, HasFactory, HasUuids, SoftDeletes;

    /** The generated key column — writing it is errno 1906. */
    protected $guarded = ['code_key'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'state' => CopyState::class,
            'condition' => CopyCondition::class,
            'acquired_on' => 'date',
            'retired_at' => 'datetime',
            'lost_reported_at' => 'datetime',
            'qr_printed_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<Book, $this> */
    public function book(): BelongsTo
    {
        return $this->belongsTo(Book::class);
    }

    /**
     * Loan carries BelongsToBookshelf, so under the bound tenant this
     * relation subquery is scoped as well as FK-tied.
     *
     * @return HasMany<Loan, $this>
     */
    public function loans(): HasMany
    {
        return $this->hasMany(Loan::class, 'copy_id');
    }
}
