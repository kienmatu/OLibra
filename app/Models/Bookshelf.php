<?php

namespace App\Models;

use App\Enums\BookshelfStatus;
use Database\Factories\BookshelfFactory;
use Illuminate\Database\Eloquent\Casts\AsArrayObject;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Bookshelf extends Model
{
    /** @use HasFactory<BookshelfFactory> */
    use HasFactory, HasUuids, SoftDeletes;

    /**
     * The generated columns — writing any of them is errno 1906. `Book.php`
     * :28 is the precedent: every generated column on the table is listed,
     * so `Bookshelf::create($other->toArray())` and row-replicating seeders
     * can never include one in an INSERT. The three folded columns arrived
     * with 3a's migration and were missed here; no live path writes a
     * bookshelf today, but 3b builds shelf editing.
     */
    protected $guarded = ['slug_active', 'name_folded', 'location_folded', 'address_folded'];

    /** {shelf} binds by slug, and slugs are immutable by trigger. */
    public function getRouteKeyName(): string
    {
        return 'slug';
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => BookshelfStatus::class,
            'settings' => AsArrayObject::class,
            'established_on' => 'date',
        ];
    }

    /** @return HasMany<Membership, $this> */
    public function memberships(): HasMany
    {
        return $this->hasMany(Membership::class);
    }

    /**
     * The same rows as memberships(), under the name the {reader} route
     * parameter needs: scopeBindings() resolves a child binding through
     * the relation guessed from the parameter name (reader -> readers()),
     * so this is the defence-in-depth layer routes/web.php documents for
     * {bookCopy}. BookshelfScope on Membership is what actually guards.
     *
     * @return HasMany<Membership, $this>
     */
    public function readers(): HasMany
    {
        return $this->hasMany(Membership::class);
    }

    /** @return HasMany<BookshelfContact, $this> */
    public function contacts(): HasMany
    {
        return $this->hasMany(BookshelfContact::class);
    }

    /**
     * Task 18's scoped route bindings resolve {book} THROUGH this relation
     * ($shelf->books()->where('slug', …)), which is what makes a foreign
     * shelf's colliding slug a 404 instead of a cross-tenant hit.
     *
     * @return HasMany<Book, $this>
     */
    public function books(): HasMany
    {
        return $this->hasMany(Book::class);
    }

    /** @return HasMany<BookCopy, $this> */
    public function bookCopies(): HasMany
    {
        return $this->hasMany(BookCopy::class);
    }

    /**
     * What scopeBindings() resolves the {loan} route parameter through.
     * BookshelfScope on Loan (App\Models\Concerns\BelongsToBookshelf)
     * independently 404s a foreign shelf's loan id — the two-layer note in
     * routes/web.php.
     *
     * @return HasMany<Loan, $this>
     */
    public function loans(): HasMany
    {
        return $this->hasMany(Loan::class);
    }

    /**
     * What scopeBindings() resolves the {borrowRequest} route parameter
     * through. Its existence is not optional: without this method the child
     * binding has no relation to guess and the route throws instead of
     * resolving, which BorrowRequestPolicyTest saw for real before it
     * existed ("Call to undefined method
     * App\Models\Bookshelf::borrowRequests()").
     *
     * What it does for TENANCY is redundant, and the review measured the
     * redundancy rather than letting this comment guess at it. Two
     * independent layers keep a foreign shelf's request out of a bound
     * shelf's URL space — this relation's own FK filter, and BookshelfScope
     * on BorrowRequest (App\Models\Concerns\BelongsToBookshelf) — and
     * EITHER ALONE IS SUFFICIENT. Dropping scopeBindings() from the route
     * leaves BorrowRequestPolicyTest's 18 green; dropping
     * BelongsToBookshelf from BorrowRequest leaves the same 18 green (the
     * full suite does kill it, 5 failures across TenancyArchitectureTest,
     * ReaderQueriesTest and TenantIsolationTest); dropping BOTH is
     * "Failed asserting that 200 is identical to 404" — a real cross-tenant
     * read. So neither layer is pinned by the binding test, and saying so
     * is the point: BookshelfScope's coverage lives in the tenancy suite,
     * and this relation's own filter is pinned by
     * "Bookshelf::borrowRequests() is shelf-local", which runs under
     * actSystemWide() precisely so the global scope is switched off and the
     * FK filter is the only thing left doing the work.
     *
     * @return HasMany<BorrowRequest, $this>
     */
    public function borrowRequests(): HasMany
    {
        return $this->hasMany(BorrowRequest::class);
    }

    /**
     * The same shape for {notification} (Task 16's bell), with the same
     * two-layer redundancy: Notification carries BelongsToBookshelf like
     * every other scoped model.
     *
     * NAME COLLISION, flagged rather than renamed: notifications() is also
     * the relation Laravel's own Illuminate\Notifications\Notifiable trait
     * defines. Bookshelf does not use that trait and nothing here sends
     * Laravel notifications (this app's notifications are its own table and
     * its own Notifier), so there is no conflict today — but if Bookshelf
     * ever gains Notifiable, one of the two silently wins and the loser is
     * a shelf's bell reading from Laravel's notifications table, or the
     * reverse. Adding the trait to this model means renaming one of them.
     *
     * @return HasMany<Notification, $this>
     */
    public function notifications(): HasMany
    {
        return $this->hasMany(Notification::class);
    }

    /**
     * Feedback.bookshelf_id is nullable and Feedback deliberately does not
     * carry BelongsToBookshelf (see its docblock), so a shelf-scoped read
     * cannot go through a global scope. Routing it through THIS relation
     * instead of a hand-written filter on that column means Phase 2's
     * app/Queries classes need no literal filter — and no exemption in
     * TenancyArchitectureTest's hand-written-filter allowlist — to read a
     * shelf's own feedback: $shelf->feedback()->... already scopes by FK.
     *
     * @return HasMany<Feedback, $this>
     */
    public function feedback(): HasMany
    {
        return $this->hasMany(Feedback::class);
    }

    /**
     * AuditLog carries no BelongsToBookshelf (AuditLogQuery is its own
     * named exemption in TenancyArchitectureTest), so a shelf-scoped read
     * of its own audit rows goes through this relation rather than a
     * hand-written filter naming the bookshelf column — the same reasoning
     * as feedback() above.
     *
     * @return HasMany<AuditLog, $this>
     */
    public function auditLogs(): HasMany
    {
        return $this->hasMany(AuditLog::class);
    }

    /**
     * What scopeBindings() resolves the {comment} route parameter through
     * — the borrowRequests() precedent, same two-layer shape: this
     * relation's own FK filter and BookshelfScope on Comment
     * (App\Models\Concerns\BelongsToBookshelf) are each an independent
     * defence against a foreign shelf's comment id. The task that wrote
     * this had no route bound through {comment} to measure against and
     * said so; TASK 8 ADDED THREE and took the measurement it asked for,
     * on the approve POST with shelf B's comment id under shelf A's URL:
     * 404 with both layers in place, and still 404 with ->scopeBindings()
     * removed from the shelf group, so the global scope alone answers it.
     * The reverse direction was not measured. routes/web.php's {comment}
     * note carries the same result beside the routes it was taken on.
     *
     * @return HasMany<Comment, $this>
     */
    public function comments(): HasMany
    {
        return $this->hasMany(Comment::class);
    }

    /**
     * Shelf news (OPS §4.4). Beside comments() because both are Phase
     * 2b's community tables and both are shelf-owned.
     *
     * The foreign key is guessed rather than spelled, matching comments()
     * above: announcements.bookshelf_id is what Laravel's convention
     * derives from this class, so the two agree by construction. What
     * this relation is FOR is the same as comments()' — a shelf-rooted
     * read that cannot be handed another shelf's id.
     *
     * @return HasMany<Announcement, $this>
     */
    public function announcements(): HasMany
    {
        return $this->hasMany(Announcement::class);
    }

    /**
     * Slice C's donation offers (OPS §4.4), beside announcements() for
     * the same reason that one sits beside comments(): all three are
     * Phase 2b's community tables and all three are shelf-owned.
     *
     * The foreign key is guessed rather than spelled, matching
     * comments() and announcements() above: book_donations.bookshelf_id
     * is what Laravel's convention derives from this class, so the two
     * agree by construction. Note that the DONOR column on that table is
     * not guessable the same way and is spelled out where it is declared
     * (App\Models\BookDonation::donor).
     *
     * What this relation is FOR is those two relations' purpose as well
     * — a shelf-rooted read that cannot be handed another shelf's id —
     * and OfferDonationTest's "Bookshelf::donations() is shelf-local"
     * runs it under actSystemWide(), so BookshelfScope is switched off
     * and this relation's own FK filter is left to do the separating.
     *
     * @return HasMany<BookDonation, $this>
     */
    public function donations(): HasMany
    {
        return $this->hasMany(BookDonation::class);
    }
}
