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
 * UpdateBook's ISBN check turned out to share). This command has no such
 * check: `busy` and `whereDoesntHave('loans')` are not racing to avoid
 * colliding with a concurrent writer's un-committed intent — a concurrent
 * loan or copy-state change that lands after this transaction's own read is
 * either serialised by row locks it already implies (an UPDATE to a copy
 * row this transaction is not touching cannot corrupt this one) or is a
 * legitimate interleaving with no "two commits, one impossible state" outcome
 * the way two live books sharing one ISBN would be. There is no unindexed
 * uniqueness invariant here for a stale snapshot to let slip past.
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
