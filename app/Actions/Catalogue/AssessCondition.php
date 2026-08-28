<?php

namespace App\Actions\Catalogue;

use App\Enums\CopyCondition;
use App\Models\BookCopy;
use App\Models\ConditionAssessment;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Records a manager's judgement of a copy's physical state at a point in
 * time — port of assess-condition.ts. loan_id is null here; 1c's
 * ReceiveReturn writes the loan-carrying assessments. Consults no
 * transition table and moves no copy: a condition is not a state (BR §9 —
 * "`lost` is deliberately absent, because it is a copy *state*"). It does
 * update book_copies.condition, because that column is the current
 * judgement while condition_assessments is the history — and BR §11 lists
 * assessments among the never-deleted, which is why the history is a
 * table and not a column.
 *
 * REVISED (review finding): this consults no transition table, but it
 * shares the exact same stale-instance hole as the other three: $copy is
 * the route-bound instance, read outside this transaction. Left alone, a
 * concurrent assessment (or, worse, a concurrent RetireCopy/ReportCopyLost
 * landing on this same copy) between the request loading $copy and this
 * transaction opening would make the `before` audit entry lie about what
 * the copy's condition actually was, and this transaction's `update()`
 * would win the race blind, silently discarding whatever the concurrent
 * writer set. Re-reads with `lockForUpdate` as the FIRST statement — same
 * choice as RetireCopy, for the same REPEATABLE READ reason: a plain
 * `refresh()` would only fix the pre-transaction staleness and leave the
 * gap open between the read and this transaction's own `UPDATE` open to a
 * concurrent writer; a locking read reads the current committed row and
 * holds it for the rest of the transaction.
 */
final class AssessCondition
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    public function execute(User $actor, BookCopy $copy, CopyCondition $condition, ?string $note = null, ?string $photoUrl = null): ConditionAssessment
    {
        Gate::forUser($actor)->authorize('assessCondition', $copy);

        return DB::transaction(function () use ($actor, $copy, $condition, $note, $photoUrl): ConditionAssessment {
            // FIRST statement, before the `before` snapshot is taken — see
            // the class docblock.
            $copy = BookCopy::query()->lockForUpdate()->findOrFail($copy->id);

            $before = ['condition' => $copy->condition->value, 'conditionNote' => $copy->condition_note];

            $assessment = ConditionAssessment::query()->create([
                'copy_id' => $copy->id,
                'loan_id' => null,
                'assessed_by' => $actor->id,
                'condition' => $condition,
                'note' => $note,
                'photo_url' => $photoUrl,
                'assessed_at' => $this->clock->now(),
            ]);

            $copy->update(['condition' => $condition, 'condition_note' => $note]);

            $this->audit->record('copy.condition_assessed', 'copy', $copy->id, $before, [
                'condition' => $condition->value,
                'conditionNote' => $note,
            ]);

            return $assessment;
        });
    }
}
