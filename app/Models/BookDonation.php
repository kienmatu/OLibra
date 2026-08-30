<?php

namespace App\Models;

use App\Enums\DonationStatus;
use App\Models\Concerns\BelongsToBookshelf;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A reader's offer of books to a shelf (OPS §4.4's OfferDonation), never
 * the provenance of a catalogued copy. DB §4.8 draws that line and
 * old_next/src/domain/community/commands/donations.ts's file docblock
 * quotes it: "`BookDonation` records a reader's offer to give books to
 * the shelf, and a manager's decision on it — it is not the provenance
 * of any physical object." Provenance lives on
 * book_copies.acquired_from / acquired_from_membership_id, written by a
 * different command. MEASURED against information_schema.key_column_usage
 * for this schema: every foreign key touching book_donations is one of
 * its own three — bookshelf_id -> bookshelves, decided_by -> users, and
 * the composite donor key -> memberships — and the query returns no row
 * in which book_donations is the REFERENCED table. So the two tables are
 * joined by a membership id carried by hand, and by nothing the server
 * enforces.
 *
 * NO SoftDeletes, and that is read off the live table rather than
 * assumed: `show create table book_donations` lists ten columns and a
 * created_at/updated_at pair, with the migration recording the same fact
 * in its own comment — "No deleted_at — matching 0006_community.sql".
 * BR §11's undo restores soft-deleted rows; this table keeps its rows.
 */
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

    /**
     * THE DONOR IS A MEMBERSHIP, NOT A USER. donor_membership_id
     * references memberships(id) — `CONSTRAINT
     * book_donations_donor_membership_fk FOREIGN KEY (bookshelf_id,
     * donor_membership_id) REFERENCES memberships (bookshelf_id, id)`,
     * read off the live table — which is the reverse of comments
     * .author_id two tables along, a users(id). Both columns hold
     * 36-char uuid strings, so the target class here is the whole of what
     * says which table the id came from.
     *
     * The foreign key is spelled rather than guessed: Laravel derives
     * Str::snake(<relation name>).'_id' from the calling method, which
     * for donor() is donor_id; the column the live table carries is
     * donor_membership_id.
     *
     * @return BelongsTo<Membership, $this>
     */
    public function donor(): BelongsTo
    {
        return $this->belongsTo(Membership::class, 'donor_membership_id');
    }
}
