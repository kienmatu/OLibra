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
 * `new → read`, and it is an EXPLICIT ADMINISTRATOR ACT rather than a side
 * effect of opening the message — spec D3, and the point the first draft of
 * that spec got backwards. Port of markFeedbackRead in
 * old_next/src/domain/community/commands/feedback.ts.
 *
 * OPENING A MESSAGE DOES NOT MARK IT READ. The inbox resolves list, detail and
 * unread count in one READ-ONLY pass (App\Queries\Admin\FeedbackInboxQuery);
 * this command runs only from the *Đánh dấu đã đọc* button. The alternative
 * was measured against its own consequences: it would have written a
 * feedback.read audit row every time anybody glanced at anything, which is a
 * log nobody can read for the one event it was meant to record, and it would
 * have made the button on the screen meaningless.
 *
 * AN ADMINISTRATION ACTION, hence this directory rather than
 * app/Actions/Community/ beside SubmitFeedback. The two differ in exactly the
 * way spec D7 describes: submitting is the one write in the catalogue with no
 * floor at all, and handling is super-admin-only. The `/admin` route group's
 * `super-admin` middleware is the whole of the refusal — the same shape every
 * other command in this directory relies on.
 *
 * ── The audit row's shelf comes from the MESSAGE, not the caller (spec D6) ──
 *
 * `feedback.bookshelf_id` is the schema's one nullable tenant column, so this
 * command and its sibling are the only two in the catalogue whose target may
 * belong to a shelf OR to none. AuditRecorder takes the shelf from the bound
 * tenant, and `/admin` binds none, so without naming it here the row would
 * either throw or land wherever the caller happened to be — and the reference
 * records BOTH silent failures shipping once: an administrator resolving Vĩnh
 * Long's message while scoped to Đồng Tháp wrote the sentence into Đồng Tháp's
 * log, where Vĩnh Long's own manager never saw that anything had happened.
 *
 * So: forShelf($message->bookshelf_id) when the message names a shelf,
 * global() when it does not.
 *
 * THE REFERENCE'S `auditScopeFor` REFUSAL IS NOT PORTED, and that is a
 * measurement rather than an omission. It raises `not_permitted` when the
 * CALLER's bound shelf disagrees with the message's — a state that needs a
 * caller with a bound shelf. Every route that reaches this command is in the
 * `/admin` group, which binds no tenant at all, so the disagreement is
 * structurally unreachable here and a check for it would be a branch no test
 * could redden. The guarantee it protects is instead held by the line above:
 * the shelf is read off the row, never off the request.
 *
 * NOTHING IS DELETED AND NOTHING IS EDITED (spec D9). A message a parishioner
 * sent is a record; the only thing that moves is `status`, with `handled_by`
 * and `handled_at` stamped beside it.
 */
final class MarkFeedbackRead
{
    public function __construct(
        private AuditRecorder $audit,
        private Clock $clock,
    ) {}

    public function execute(User $actor, Feedback $message): void
    {
        DB::transaction(function () use ($actor, $message): void {
            // BEFORE the write — the status this message is leaving, which is
            // the half of the payload an investigation actually reads. The
            // screen only offers this button on a `new` message, so `read` is
            // ordinarily what it holds; a hand-posted request from a resolved
            // message is recorded honestly rather than refused, because
            // nothing is lost by it and the row says what happened.
            $before = ['status' => $message->status->value];

            $message->update([
                'status' => FeedbackStatus::Read,
                'handled_by' => $actor->id,
                'handled_at' => $this->clock->now(),
            ]);

            $recorder = $message->bookshelf_id === null
                ? $this->audit->global()
                : $this->audit->forShelf($message->bookshelf_id);

            $recorder->record(
                'feedback.read',
                'feedback',
                $message->id,
                $before,
                ['status' => FeedbackStatus::Read->value],
            );
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
