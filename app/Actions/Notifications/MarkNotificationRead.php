<?php

namespace App\Actions\Notifications;

use App\Models\Notification;
use App\Models\User;
use App\Support\Clock;

/**
 * A reader dismisses one notification, or all of them — OPS §4.6.
 *
 * NEITHER writes an audit entry, and that is a decision, not an
 * omission (the reference's three-part argument): the audit map is the
 * type, so notification.read would need a Vietnamese sentence for an
 * event that is not a business fact about the shelf; one row per bell
 * tap buries every real entry under the most frequent and least
 * meaningful action in the system; and nothing is recoverable from it —
 * read_at is a fact about one person's inbox, visible only to them.
 * MyNotificationsTest pins the absence by name.
 *
 * Keyed on user_id — a users(id), never a membership id — so somebody
 * else's id, and a double-tap, update zero rows silently: both are
 * ordinary outcomes, not errors. Query-builder updates (no model event
 * ceremony; the table has no updated_at).
 */
final class MarkNotificationRead
{
    public function __construct(private Clock $clock) {}

    public function one(User $reader, string $notificationId): void
    {
        Notification::query()
            ->whereKey($notificationId)
            ->where('user_id', $reader->id)
            ->whereNull('read_at')
            ->update(['read_at' => $this->clock->now()]);
    }

    /** @return int how many were marked */
    public function all(User $reader): int
    {
        return Notification::query()
            ->where('user_id', $reader->id)
            ->whereNull('read_at')
            ->update(['read_at' => $this->clock->now()]);
    }
}
