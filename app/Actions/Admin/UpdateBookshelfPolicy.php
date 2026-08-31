<?php

namespace App\Actions\Admin;

use App\Models\Bookshelf;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\ConcurrencyRetry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * OPS §4.5's shelf lifecycle, third command: how lending behaves on one
 * shelf. Port of the reference's `updateBookshelfPolicyAction` half of
 * `updateBookshelfSettings` (old_next/src/app/quan-tri/admin-actions.ts:256).
 *
 * A SEPARATE COMMAND FROM THE PROFILE (spec D2), and the reference's own
 * docstring carries the reason: this submit "never sends profile — that is
 * the whole point of the split, not an incidental omission", because a shelf
 * with no contact on file must still be able to change how long a book may
 * be borrowed. The converse holds too: a number out of range here must not
 * block correcting an address.
 *
 * THE EIGHT KEYS ARE MERGED INTO `settings`, NOT WRITTEN OVER IT. That
 * column is a schemaless bag several unrelated features read — the two
 * public-display settings BR §5.5 names, and 3b-ii's `parish_taxonomy` — so
 * assigning a fresh eight-key array would delete every one of them the first
 * time somebody saved a loan period. The merge below writes exactly these
 * eight and leaves the rest, which is what the reference's `||` does.
 *
 * THE COMMENT KEY IS `comments_enabled`. App\Support\Community\CommentSettings
 * carries a long warning about the other spelling and its reader coalesces
 * this one to true; a command writing BR §5.5's `allow_comments` would
 * report success, store a key nothing reads, and leave commenting exactly as
 * it was. The other six names come from
 * App\Support\Circulation\LendingSettings, which is what actually reads them.
 *
 * THE AUDIT ROW IS `bookshelf.updated`, the same action the profile command
 * writes, which is why that action's sentence names the shelf rather than
 * the field that moved. Both bags carry only this command's own eight keys,
 * so a reader of the log sees which numbers changed without the rest of the
 * settings bag being copied into every row.
 *
 * NO WIDENING IS NEEDED and none is taken: `Bookshelf` carries no shelf
 * scope, so the row is reachable from the tenant-less `/admin` group as it
 * stands. The recorder is the only fail-closed guard in this path and the
 * configurator is the sanctioned way past it (spec D0). The transaction is
 * here so the change and its audit row commit together (OPS §1), and it
 * retries because every write transaction in this codebase does.
 */
final class UpdateBookshelfPolicy
{
    /**
     * The storage keys, in the order the editor shows them. Written once:
     * the read side, the merge and the two audit bags all walk this list, so
     * a ninth setting cannot arrive in the form and be missed by the log.
     *
     * @var list<string>
     */
    public const KEYS = [
        'loan_days',
        'max_concurrent_loans',
        'max_renewals',
        'renewal_days',
        'hold_days',
        'due_soon_days',
        'comments_enabled',
        'comments_require_approval',
    ];

    public function __construct(
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array{loan_days: int, max_concurrent_loans: int, max_renewals: int, renewal_days: int, hold_days: int, due_soon_days: int, comments_enabled: bool, comments_require_approval: bool}  $policy
     */
    public function execute(User $actor, Bookshelf $shelf, array $policy): void
    {
        Gate::forUser($actor)->authorize('update', $shelf);

        DB::transaction(function () use ($shelf, $policy): void {
            $settings = (array) $shelf->settings;

            $before = [];
            $after = [];

            foreach (self::KEYS as $key) {
                // Absent means "this shelf has never had a policy of its
                // own", which is a different fact from any stored value, so
                // the `before` bag says null rather than repeating the
                // fallback the reading classes apply.
                $before[$key] = $settings[$key] ?? null;
                $after[$key] = $policy[$key];
                $settings[$key] = $policy[$key];
            }

            $shelf->update(['settings' => $settings]);

            $this->audit->forShelf($shelf->id)->record('bookshelf.updated', 'bookshelf', $shelf->id, $before, $after);
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
