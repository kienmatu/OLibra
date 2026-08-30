<?php

namespace App\Actions\Catalogue;

use App\Enums\CopyState;
use App\Exceptions\RuleViolated;
use App\Models\Book;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Soft-deletes a title and the copies that may follow it. Port of
 * delete-book.ts, Q7 decision included: implemented now, unexposed until a
 * confirmation flow is designed — leaving it unwritten means the next
 * person re-derives the copy-retention rule with no test to check them.
 *
 * `copy_has_history` is a RETENTION RULE, not a throw: the book goes, the
 * copies with no loan row go with it (BR §11: "Only a book's copies follow
 * it when the book itself goes"), and the ones with history — returned and
 * voided loans included, INV-11 makes loans the permanent record — stay
 * exactly where they are. Retirement (BR §2, §11) is a different, later
 * command (Task 9): a real-world event with a required reason, not this
 * soft-delete's undo-a-mistake path. The counts are returned and audited so
 * a screen can say what happened rather than implying a clean sweep. No
 * `copy_has_history` error code exists, because nothing would ever throw it.
 *
 * No shelf lock, and this is NOT the same reasoning UpdateBook used to give
 * (that reasoning was wrong — see UpdateBook's docblock for the correction).
 * The lock exists to close check-then-write races against a column with no
 * unique index, under REPEATABLE READ, where an early stale snapshot lets
 * two concurrent transactions each honestly see "no clash" (the exact shape
 * AllocateCopyCodes' docblock documents for copy codes, ISBN and slug, and
 * UpdateBook's ISBN check turned out to share). This command's OWN checks
 * (`busy`, `whereDoesntHave('loans')`) do not race a concurrent writer's
 * un-committed intent — true as far as it goes.
 *
 * CORRECTED (whole-branch review, PR #62, finding 4): the paragraph used to
 * end there, concluding "no unindexed uniqueness invariant here for a stale
 * snapshot to let slip past" — i.e. no lock needed, full stop. That was
 * true when this class shipped (1a, no circulation yet) and is FALSE today:
 * Phase 1c's `LendCopy` gives this transaction's REPEATABLE READ snapshot
 * exactly the race its own reasoning said didn't exist. `whereDoesntHave
 * ('loans')` above is read from this transaction's snapshot, pinned at its
 * first statement (the `$busy` check); a `LendCopy` that inserts a new
 * loan against one of this book's copies and commits AFTER that snapshot
 * was pinned but BEFORE this transaction reaches its own `deletable`
 * fetch is invisible to `whereDoesntHave('loans')` — the copy reads as
 * having no loans, and gets soft-deleted anyway, with a freshly-committed
 * ACTIVE loan now pointing at it. `ReceiveReturn.php:109` and
 * `VoidLoan.php:56` both resolve that copy with a plain
 * `BookCopy::query()->lockForUpdate()->findOrFail(...)` — no
 * `withTrashed()` — so once this race lands, that loan can never be
 * returned or voided; it is not merely "an unusual state", it is a
 * transition with no ROUTE OUT.
 *
 * NOT FIXED HERE — recorded (docs/known-gaps.md, "Phase 1c — Circulation")
 * instead, for two reasons: (1) `DeleteBook` is unrouted (Q7 above) — zero
 * live exposure until a confirmation flow ships it, so there is no
 * regression to ship urgently; (2) the honest fix is a real design choice,
 * not a one-line patch — either give this command a first-statement lock
 * over the book's own copies (the `AllocateCopyCodes` shape, which would
 * also need deciding what a blocked concurrent `LendCopy` on one of those
 * copies should see), or teach `ReceiveReturn`/`VoidLoan` to resolve a
 * soft-deleted copy with `withTrashed()` (a broader semantic change: can a
 * manager return or void a loan whose book no longer exists? almost
 * certainly yes, but that is Phase 2/a dedicated task's call, not this fix
 * round's). Whichever the next author picks, they now have a docblock that
 * names the real race instead of one that argues it away.
 */
final class DeleteBook
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    /** @return array{copiesDeleted: int, copiesRetained: int} */
    public function execute(User $actor, Book $book): array
    {
        Gate::forUser($actor)->authorize('delete', $book);

        return DB::transaction(function () use ($book): array {
            $busy = $book->copies()
                ->whereIn('state', [CopyState::OnLoan, CopyState::Held])
                ->exists();

            if ($busy) {
                throw new RuleViolated('has_active_loans');
            }

            // One instant for every row this command touches (M6) — the
            // injected clock, never a per-row now().
            $deletedAt = $this->clock->now();

            $deletable = $book->copies()
                ->whereDoesntHave('loans')
                ->get();

            foreach ($deletable as $copy) {
                $copy->deleted_at = $deletedAt;
                $copy->save();
            }

            $retained = $book->copies()->count();

            $book->deleted_at = $deletedAt;
            $book->save();

            $result = ['copiesDeleted' => $deletable->count(), 'copiesRetained' => $retained];

            $this->audit->record('book.deleted', 'book', $book->id,
                ['title' => $book->title, 'deletedAt' => null],
                [
                    'deletedAt' => $deletedAt->toIso8601String(),
                    'copiesDeleted' => $result['copiesDeleted'],
                    'copiesRetained' => $result['copiesRetained'],
                ],
            );

            return $result;
        });
    }
}
