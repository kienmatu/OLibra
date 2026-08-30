<?php

namespace App\Models;

use App\Enums\RequestStatus;
use App\Models\Concerns\BelongsToBookshelf;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class BorrowRequest extends Model
{
    use BelongsToBookshelf, HasUuids, SoftDeletes;

    protected $guarded = [];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => RequestStatus::class,
            'requested_at' => 'datetime',
            'decided_at' => 'datetime',
            'hold_expires_at' => 'datetime',
            'cancelled_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<Book, $this> */
    public function book(): BelongsTo
    {
        return $this->belongsTo(Book::class);
    }

    /**
     * Nullable FK by design: a pending request names a TITLE, never a copy
     * (plan ported reading 3) — copy_id is written by the approval that
     * puts one aside, and survives on a cancelled row as the record of what
     * the reader gave up.
     *
     * The explicit 'copy_id' is DOCUMENTATION, not a tested constraint:
     * belongsTo() derives the same key from this method's own name, so
     * deleting the argument changes nothing and no test can tell (measured:
     * 18 green). What the test does discriminate is the key pointing at the
     * WRONG column, which is the mutation that reddens
     * "BorrowRequest::book() resolves, and copy() is null until a copy is
     * put aside".
     *
     * @return BelongsTo<BookCopy, $this>
     */
    public function copy(): BelongsTo
    {
        return $this->belongsTo(BookCopy::class, 'copy_id');
    }
}
