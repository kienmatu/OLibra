<?php

namespace App\Queries;

use App\Models\Notification;
use App\Models\User;
use App\Support\Notifications\NotificationSentences;

/**
 * OPS §3.2's GetMyNotifications — the bell's page, with BR §15's unread
 * count. The sentence is rendered HERE from the stored payload — not on
 * the page (a screen cannot invent phrasing for an event it did not
 * define) and not stored (a stored sentence freezes every typo forever;
 * re-rendering is how "Dế Mèn" follows a corrected title). The
 * deliberate opposite of the audit browser's stored-values rule.
 *
 * Own rows only, keyed on the session's user id — users has no tenant
 * scope, so the person-scope comes from the caller and the shelf-scope
 * from BookshelfScope. $reader->id is a users(id), never a membership id
 * (the recurring member_id trap notifications.user_id invites).
 *
 * id desc beside created_at desc: the sweep writes many rows in one
 * instant, so the timestamps tie BY CONSTRUCTION and the v7 id is the
 * deterministic mechanism (measured cost of leaving ties unordered, twice
 * in the reference: rows repeating and vanishing across pages). On today's
 * MariaDB the tiebreak is REDUNDANT and written down anyway.
 *
 * The plan below is this statement's own, re-measured against
 * laravel-mariadb-1 over 400 seeded rows spread across two shelves and two
 * users (an earlier version of this docblock quoted a plan captured from a
 * `select id` probe, which is a different query and reported `Using index`;
 * that cannot be true here, since kind, payload and read_at are none of
 * them in notifications_unread):
 *
 *   type: range | key: notifications_unread | rows: 200 | Extra: Using where
 *
 * Re-measured AGAIN, unchanged, after 2026_08_30_000001 added
 * notifications_unread_by_user (user_id, read_at) for the bell's count:
 * the new index joins possible_keys and is NOT chosen, and there is still
 * no `Using filesort`. Checked rather than assumed — a new candidate index
 * can move a plan nobody meant to move, and this one rides the ORDER BY.
 *
 * What matters is what is ABSENT: no `Using filesort`, so the ordering is
 * the index's. InnoDB appends the primary key to a secondary index, so the
 * descending scan already emits descending id within a created_at tie —
 * which is why deleting ->orderByDesc('id') leaves MyNotificationsTest
 * wholly green (measured directly, not inferred from the plan). That is an
 * accident of this index and this engine, not something the query asked
 * for; the line states the intent so a later index change cannot quietly
 * take it away. MyNotificationsTest's tie block records the same
 * measurement and the mutation that DOES redden it.
 */
final class MyNotificationsQuery
{
    /** @return array{rows: list<array{id: string, kind: string, sentence: string, createdAt: string, readAt: ?string}>, unread: int} */
    public function run(User $reader, int $limit = 30): array
    {
        $limit = max(1, min(100, $limit));

        // array_values around the whole thing, and the (string) cast on
        // createdAt, are both level-8 requirements rather than taste —
        // MyLoanHistoryQuery.php writes it the same way. ->values()->all()
        // gives PHPStan array<int, …>, not list<…>, so the declared shape
        // above fails without the wrap; and Carbon::toISOString() is
        // ?string (readAt is legitimately nullable and keeps the
        // nullsafe, createdAt is not and gets the cast).
        $rows = array_values(Notification::query()
            ->where('user_id', $reader->id)
            ->orderByDesc('created_at')->orderByDesc('id')
            ->limit($limit)
            ->get()
            ->map(fn (Notification $n): array => [
                'id' => $n->id,
                'kind' => $n->kind,
                'sentence' => NotificationSentences::sentence($n->kind, (array) $n->payload),
                'createdAt' => (string) $n->created_at->toISOString(),
                'readAt' => $n->read_at?->toISOString(),
            ])->values()->all());

        $unread = Notification::query()
            ->where('user_id', $reader->id)
            ->whereNull('read_at')
            ->count();

        return ['rows' => $rows, 'unread' => $unread];
    }
}
