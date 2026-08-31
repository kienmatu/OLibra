<?php

namespace App\Actions\Admin;

use App\Models\Bookshelf;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\ConcurrencyRetry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * OPS §4.5's shelf lifecycle, second command: what the shelf *is* — its
 * name, where it is, how to find it, when it opened. Port of the reference's
 * `updateBookshelfProfileAction` half of `updateBookshelfSettings`
 * (old_next/src/app/quan-tri/admin-actions.ts:225).
 *
 * PROFILE AND LENDING POLICY ARE TWO COMMANDS, not one (spec D2), and the
 * reference's own docstring carries the reason: a shelf with no contacts on
 * file must still be able to change how long a book may be borrowed, and a
 * typo in `loan_days` must not block correcting an address. Task 5 adds the
 * policy command and the contacts beside this one; both write
 * `bookshelf.updated`, which is why the sentence for that action names the
 * shelf rather than the field that moved.
 *
 * THE SLUG IS NOT A PARAMETER — spec D1, and this is the enforcement layer
 * the spec calls defence in depth. The list below is written out field by
 * field precisely so that a request bag cannot smuggle one in:
 * `Bookshelf::$guarded` names only the four generated columns, so `slug` and
 * `status` are both mass-assignable and handing `$request->all()` to
 * update() would let a hand-crafted POST move a shelf's public address.
 *
 * WHAT WOULD HAPPEN IF IT DID is the interesting half, and it is why the
 * test for this is written the way it is. A trigger
 * (database/migrations/2026_08_26_000020_add_immutability_triggers.php:33-37)
 * raises SQLSTATE 45000 on an UPDATE that changes the column, so the
 * database would refuse it — as a QueryException, i.e. a 500 to a
 * volunteer, from a request the application should have ignored in silence.
 * A green immutability test here therefore asserts BOTH that the stored slug
 * is unchanged AND that nothing threw; a QueryException is that test
 * failing, not passing. Eloquent writes only dirty attributes, so a command
 * that never sets the column never trips the trigger.
 *
 * NO WIDENING IS NEEDED and none is taken. `Bookshelf` is not a scoped
 * model, so the row is reachable from the tenant-less `/admin` group as it
 * stands; the recorder is the only fail-closed guard in this path, and the
 * configurator is the sanctioned way past it (spec D0). The transaction is
 * here so the change and its audit row commit together (OPS §1), and it
 * retries because every write transaction in this codebase does.
 */
final class UpdateBookshelfProfile
{
    public function __construct(
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array{name: string, location: ?string, address: ?string, description: ?string, established_on: ?string}  $profile
     */
    public function execute(User $actor, Bookshelf $shelf, array $profile): void
    {
        Gate::forUser($actor)->authorize('update', $shelf);

        DB::transaction(function () use ($shelf, $profile): void {
            $before = [
                'name' => $shelf->name,
                'location' => $shelf->location,
                'address' => $shelf->address,
                'description' => $shelf->description,
                'established_on' => $shelf->established_on?->toDateString(),
            ];

            // Five keys, named one at a time. No spread, no array_merge with
            // an incoming bag, no `slug` — see the class docblock.
            $shelf->update([
                'name' => $profile['name'],
                'location' => $profile['location'],
                'address' => $profile['address'],
                'description' => $profile['description'],
                'established_on' => $profile['established_on'],
            ]);

            $after = [
                'name' => $shelf->name,
                'location' => $shelf->location,
                'address' => $shelf->address,
                'description' => $shelf->description,
                'established_on' => $shelf->established_on?->toDateString(),
            ];

            $this->audit->forShelf($shelf->id)->record('bookshelf.updated', 'bookshelf', $shelf->id, $before, $after);
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
