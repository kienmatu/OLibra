<?php

namespace App\Support\Notifications;

use App\Models\Notification;
use App\Support\Clock;

/**
 * Writes one reader-facing notification, INSIDE the caller's transaction
 * — that last part is the whole design (OPS §7: written by the command
 * named, in the same transaction as the state change it announces). This
 * class opens no transaction and never will: a notification cannot
 * outlive a rolled-back approval, and an approval cannot commit without
 * the notification that tells the child about it.
 *
 * Deliberately NOT an audited action: a notification is a consequence of
 * something a manager did, and the audit record already names that act —
 * a second row per approval saying "the system told somebody" is noise
 * in the one log BR §14 asks to stay readable.
 *
 * bookshelf_id comes from BelongsToBookshelf's create-hook (the bound
 * tenant), never from a parameter — the same single-source-of-scope rule
 * as every other tenant write. $userId is a users(id): the parameter is
 * named so a membership id reads wrong at the call site (the recurring
 * member_id trap).
 */
final class Notifier
{
    public function __construct(private Clock $clock) {}

    /** @param array<string, string> $payload */
    public function notify(string $userId, NotificationKind $kind, array $payload = []): void
    {
        Notification::query()->create([
            'user_id' => $userId,
            'kind' => $kind->value,
            'payload' => $payload,
            'created_at' => $this->clock->now(),
        ]);
    }
}
