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
 * tenant) — the same single-source-of-scope rule as every other tenant
 * write. $userId is a users(id): the parameter is named so a membership
 * id reads wrong at the call site (the recurring member_id trap).
 *
 * ── The one exception, and it is AuditRecorder's exception exactly ───────
 *
 * Phase 3c-i's decide pair is reachable from the `/admin` route group,
 * which binds NO tenant, and Notification carries BelongsToBookshelf — so
 * the create-hook has no shelf to stamp and throws. AuditRecorder met this
 * first and answered it with a fluent configurator; this is the same
 * answer in the same shape, so the two writes inside one decide
 * transaction name their shelf the same way and from the same source: the
 * request row, never a shelf a caller sent.
 *
 * A configured copy names the shelf on the create instead of leaving it to
 * the hook. While a tenant IS bound (the manager's own queue) that is not
 * a way past isolation: the hook still refuses an explicit shelf that is
 * not the bound one, so a manager naming another parish's shelf throws
 * exactly as a Book::create would.
 *
 * Unlike AuditRecorder's, this configurator needs no fence of its own —
 * WideningArchitectureTest's `(global|forShelf)` pattern is a call-site
 * pattern, so it already confines every call of this method to
 * app/Actions/Admin/ without naming this class.
 */
final class Notifier
{
    private ?string $namedShelfId = null;

    public function __construct(private Clock $clock) {}

    /**
     * A notification written from a request with no tenant bound: the
     * shelf comes off the row the command is deciding.
     */
    public function forShelf(string $bookshelfId): self
    {
        $configured = clone $this;
        $configured->namedShelfId = $bookshelfId;

        return $configured;
    }

    /** @param array<string, string> $payload */
    public function notify(string $userId, NotificationKind $kind, array $payload = []): void
    {
        Notification::query()->create([
            // Absent unless a caller configured one, so the create-hook
            // stamps the bound shelf for every unconfigured writer exactly
            // as before.
            ...($this->namedShelfId === null ? [] : ['bookshelf_id' => $this->namedShelfId]),
            'user_id' => $userId,
            'kind' => $kind->value,
            'payload' => $payload,
            'created_at' => $this->clock->now(),
        ]);
    }
}
