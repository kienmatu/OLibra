<?php

declare(strict_types=1);

namespace App\Actions\Admin;

use App\Enums\FeedbackStatus;
use App\Models\Feedback;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use App\Support\ConcurrencyRetry;
use Illuminate\Support\Facades\DB;

/**
 * `→ resolved` — the end of the line for a message. Port of resolveFeedback in
 * old_next/src/domain/community/commands/feedback.ts.
 *
 * A SEPARATE COMMAND FROM MarkFeedbackRead RATHER THAN ONE WITH A STATUS
 * PARAMETER, and the reason is the census rather than taste:
 * AuditActionCensusTest finds every recorded action with a regex hard-coding
 * `->record('…')` and asserts set-equality with AuditSentences::ACTIONS in both
 * directions. A shared command passing the action name in a variable is
 * invisible to that regex, so both of this task's actions would be registered
 * sentences with no writer and the census would be permanently red. The
 * duplication is forty lines and the pin is the whole audit log's honesty.
 *
 * REACHABLE FROM ANY STATUS, unlike its sibling. The screen offers *Đánh dấu đã
 * xử lý* on a `new` message as well as a `read` one, because an administrator
 * who reads a note and rings the sender back has done both things in one act
 * and should not have to press two buttons to say so.
 *
 * NO `feedback.archived` AND NO FOURTH BUTTON (spec D8). OPERATIONS.md lists
 * ArchiveFeedback provisionally with an open question about an inert *Lưu trữ*
 * control, and the reference's own screen records the product owner removing
 * it on 2026-08-09: `feedback_status` has exactly three values and the table
 * has no `deleted_at`, so a fourth status ("the administrator finished with
 * it") and a soft delete ("stop showing it at all") are different products that
 * nothing in the requirements chose between. BR:610 asks for read and resolved.
 * *Đã xử lý* is the end of the line.
 *
 * The shelf on the audit row comes from the MESSAGE, not the caller, and the
 * reference's `auditScopeFor` refusal is deliberately not ported — see
 * MarkFeedbackRead's docblock, which argues both at length.
 */
final class ResolveFeedback
{
    public function __construct(
        private AuditRecorder $audit,
        private Clock $clock,
    ) {}

    public function execute(User $actor, Feedback $message): void
    {
        DB::transaction(function () use ($actor, $message): void {
            // Either `new` or `read` in ordinary use, and the row records
            // which — "resolved straight from the inbox without being opened"
            // and "read yesterday, resolved today" are different histories.
            $before = ['status' => $message->status->value];

            $message->update([
                'status' => FeedbackStatus::Resolved,
                // The handler is OVERWRITTEN, not appended to: the column
                // holds who finished with the message, and that is the person
                // a volunteer asks about it. Who marked it read first is in
                // the audit log, which is where a history belongs.
                'handled_by' => $actor->id,
                'handled_at' => $this->clock->now(),
            ]);

            $recorder = $message->bookshelf_id === null
                ? $this->audit->global()
                : $this->audit->forShelf($message->bookshelf_id);

            $recorder->record(
                'feedback.resolved',
                'feedback',
                $message->id,
                $before,
                ['status' => FeedbackStatus::Resolved->value],
            );
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
