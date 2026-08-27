<?php

namespace App\Models;

use App\Enums\CopyCondition;
use App\Enums\LoanStatus;
use App\Models\Concerns\BelongsToBookshelf;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** No SoftDeletes: loans have no deleted_at — they are voided, never deleted. */
class Loan extends Model
{
    use BelongsToBookshelf, HasUuids;

    /** The INV-1 generated column — writing it is errno 1906. */
    protected $guarded = ['active_copy_id'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => LoanStatus::class,
            'return_condition' => CopyCondition::class,
            'lent_at' => 'datetime',
            'due_on' => 'date',
            'returned_at' => 'datetime',
            'lost_reported_at' => 'datetime',
            'voided_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<BookCopy, $this> */
    public function copy(): BelongsTo
    {
        return $this->belongsTo(BookCopy::class, 'copy_id');
    }

    /** @return BelongsTo<User, $this> */
    public function borrower(): BelongsTo
    {
        return $this->belongsTo(User::class, 'borrower_id');
    }
}
