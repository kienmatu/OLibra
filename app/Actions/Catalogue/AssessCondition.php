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
