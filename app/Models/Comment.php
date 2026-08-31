<?php

namespace App\Models;

use App\Enums\CommentStatus;
use App\Models\Concerns\BelongsToBookshelf;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Comment extends Model
{
    use BelongsToBookshelf, HasUuids, SoftDeletes;

    protected $guarded = [];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => CommentStatus::class,
            'moderated_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<Book, $this> */
    public function book(): BelongsTo
    {
        return $this->belongsTo(Book::class);
    }

    /**
     * author_id is a users(id) — the borrower()/Loan.php precedent.
     *
     * CORRECTED IN TASK 2, and the correction is the point: this docblock
     * used to say "Eloquent's convention would derive user_id from the
     * method name". It does not. BelongsTo's default foreign key is
     * Str::snake(<the CALLING METHOD's name>).'_'.<owner key>, so a
     * method named author() guesses author_id — the identical column.
     * Measured in this container against a subclass declaring
     * belongsTo(User::class) with no key: both spellings report
     * author_id, which is also why Task 1's review found this line
     * "pinned by nothing". It is not pinnable, because there is nothing
     * to tell apart.
     *
     * What the explicit key IS worth is that the column stops depending
     * on the method's name: rename this method and the implicit guess
     * silently follows the new name. What IS pinnable, and is pinned, is
     * the relation's TARGET — CreateCommentTest asserts author() reaches
     * the users row named by author_id and that the id there is not a
     * memberships id. A wrong key makes the reader's comment list render
     * every author as blank.
     *
     * @return BelongsTo<User, $this>
     */
    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id');
    }
}
