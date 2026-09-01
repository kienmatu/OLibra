<?php

declare(strict_types=1);

namespace App\Queries\Admin;

use App\Enums\FeedbackStatus;
use App\Models\Bookshelf;
use App\Models\Feedback;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;

/**
 * BR §16.1's administrator inbox — OPS §3.4's `GetFeedbackInbox`,
 * `GetFeedbackDetail` and the unread count, ported from
 * old_next/src/domain/admin/queries/get-feedback-inbox.ts.
 *
 * THIS CLOSES A HOLE RATHER THAN ADDING A FEATURE, and the reference says it
 * best: submitFeedback has been the one write in the system open to a caller
 * with no session, and nothing could read what it wrote. Task 1 gave this port
 * the writer; until this file there was still no reader.
 *
 * CROSS-SHELF BY NATURE, which is why it lives under app/Queries/Admin/ — the
 * inbox is one list spanning every parish PLUS the site-wide messages, and
 * `feedback.bookshelf_id` is the schema's one nullable tenant column. It
 * widens nothing all the same: Feedback is deliberately NOT BelongsToBookshelf
 * (that model's own docblock argues it), so there is no BookshelfScope to step
 * around and no TenantContext::systemWide() in this file. Bookshelf and User,
 * the two it resolves names through, are unscoped models.
 *
 * NO SHELF FILTER, DELIBERATELY. The reference's query takes an optional
 * shelf id its page never passes; adding it here would mean naming the tenant
 * column in a hand-written predicate, which TenancyArchitectureTest bans
 * outright — and that test READS RAW SOURCE, so this paragraph deliberately
 * describes the shape rather than spelling it, the trap its own docblock
 * records. The exemption would have to be bought for a filter no screen
 * offers. BR §16.1 asks for one list across the installation, and that is
 * what the three status chips filter.
 *
 * SUPER-ADMIN ONLY (spec D3), ruled by the product owner on 2026-09-01 and
 * matching the reference, which gates every feedback read on
 * `requireSuperAdmin`. There is no Gate call in this class for the same reason
 * no other `/admin` index has one: the route group's `super-admin` middleware
 * is the whole of the refusal, and the badge's caller asks for the flag before
 * it calls. `Bookshelf::feedback()` — this port's shelf-scoped relation, built
 * in Phase 2 for a manager-level inbox that the ruling says will not exist —
 * therefore becomes unused, and is kept rather than deleted (known-gaps.md).
 *
 * ONE READ FOR ALL THREE PANES. run() resolves the list, the open message and
 * the unread count inside a single DB::transaction, which is the reference's
 * own reason for its shape: "Two calls would have been two transactions, and
 * the second could see a message the first did not — a list and a detail pane
 * disagreeing about what is unread."
 *
 * `guest_contact` IS IN THE DETAIL AND NOT IN THE LIST, and `guest_hash` in
 * neither. The reference's reason is the screen rather than the store: a list
 * is scanned, often over somebody's shoulder on a shared parish device, and
 * the number is only needed at the moment the administrator decides to reply.
 * The hash is the rate-limit key, of no use to a person, and AuditSecrets
 * would refuse it in a payload for the same reason.
 */
final class FeedbackInboxQuery
{
    /**
     * A `?status=` value narrowed to the enum, or null.
     *
     * AN UNRECOGNISED VALUE MEANS "NO FILTER", NEVER "a filter that matches
     * nothing" — the reference's own line, and it names the cost: "an empty
     * inbox that reads as 'no messages' is the shape of a bug this project has
     * already shipped twice." A caller typing ?status=NEW, or ?status=
     * constructor, sees every message rather than a screen telling them the
     * parish has never written.
     *
     * FeedbackStatus::tryFrom does the narrowing, so the closed set is the
     * enum's and cannot drift from the column's check constraint.
     */
    public static function filterFrom(?string $value): ?FeedbackStatus
    {
        return $value === null ? null : FeedbackStatus::tryFrom($value);
    }

    /**
     * The whole screen in one read — spec D3.
     *
     * $selectedId is the `?message=` from the URL. An id naming no row falls
     * back to the top of the list rather than answering 404, which is the
     * reference's behaviour and the right one: the id is in a URL a volunteer
     * may have edited or kept from a message somebody else has since handled,
     * and the top of the list is the unread message they came for anyway.
     *
     * @return array{messages: list<array{feedbackId: string, senderName: string, accountName: string|null, subject: string, status: string, isUnread: bool, submittedAt: string, shelfName: string|null}>, open: array{feedbackId: string, senderName: string, accountName: string|null, subject: string, status: string, isUnread: bool, submittedAt: string, shelfName: string|null, body: string, senderContact: string|null, handledAt: string|null, handledByName: string|null}|null, unread: int}
     */
    public function run(?FeedbackStatus $status, ?string $selectedId): array
    {
        return DB::transaction(function () use ($status, $selectedId): array {
            $rows = $this->inbox($status);

            $chosen = null;

            if ($selectedId !== null) {
                $chosen = Feedback::query()->whereKey($selectedId)->first();
            }

            // The top of the list, and NOT rows->first() re-fetched: the row
            // is already in hand from the same transaction, so the fallback
            // cannot open a message the list above does not show.
            $chosen ??= $rows->first();

            // ONE lookup for every name on the page rather than one per row.
            // The maps are built from the list AND the open message together,
            // because a `?message=` may name a row the current filter hides.
            $names = $this->names(array_values(
                $chosen === null ? $rows->all() : array_merge($rows->all(), [$chosen]),
            ));

            return [
                'messages' => array_values(array_map(
                    fn (Feedback $row): array => $this->listRow($row, $names),
                    $rows->all(),
                )),
                'open' => $chosen === null ? null : $this->detailRow($chosen, $names),
                'unread' => $this->countUnread(),
            ];
        });
    }

    /**
     * BR §16.1's unread count, for the admin shell's badge.
     *
     * THE PREDICATE IS SHARED WITH THE LIST — `status = new` is what
     * `isUnread` reads below and what the *Mới* chip filters on, expressed
     * once through FeedbackStatus::New. Phase 3a had to fix predicate drift
     * once already (commit 8e81c82), so a badge counting one thing while the
     * screen shows another is a defect this project has met.
     */
    public function countUnread(): int
    {
        return Feedback::query()->where('status', FeedbackStatus::New)->count();
    }

    /**
     * The row an `/admin` handling decision names.
     *
     * A missing row is a ModelNotFoundException and therefore a 404 — the
     * shape ManagerProfileChangeQueueQuery::find() already uses, and what
     * implicit binding would produce. No widening: Feedback carries no scope.
     */
    public function find(string $id): Feedback
    {
        $row = Feedback::query()->whereKey($id)->first();

        if ($row === null) {
            throw new ModelNotFoundException()->setModel(Feedback::class, [$id]);
        }

        return $row;
    }

    /**
     * UNREAD FIRST, THEN NEWEST — the reference's ordering, and its reason:
     * a queue drains rather than piling up, and a message is answered while
     * it is fresh. `id` breaks the tie so a page rendered twice in the same
     * microsecond does not reorder itself.
     *
     * @return Collection<int, Feedback>
     */
    private function inbox(?FeedbackStatus $status): Collection
    {
        $query = Feedback::query()
            ->orderByRaw('case when status = ? then 0 else 1 end', [FeedbackStatus::New->value])
            ->orderByDesc('created_at')
            ->orderByDesc('id');

        if ($status !== null) {
            $query->where('status', $status);
        }

        return $query->get();
    }

    /**
     * The list row. NO `senderContact` and NO `guest_hash` — see the class
     * docblock; the contact number is the detail pane's alone.
     *
     * @param  array{people: array<string, string>, shelves: array<string, string>}  $names
     * @return array{feedbackId: string, senderName: string, accountName: string|null, subject: string, status: string, isUnread: bool, submittedAt: string, shelfName: string|null}
     */
    private function listRow(Feedback $row, array $names): array
    {
        return [
            'feedbackId' => (string) $row->id,
            // WHAT THE SENDER TYPED, ALWAYS — feedback.guest_name, even when
            // they were signed in. The reference records the live incident
            // from the other reading (`member_name ?? guest_name`): a reader
            // who typed "Chị Hạnh" displayed as "Quản trị viên", their
            // account's own label, and the administrator rang the wrong
            // person. SubmitFeedback requires this non-blank on every write,
            // so the fallback below covers a historical row and nothing an
            // ordinary submission produces.
            'senderName' => (string) ($row->guest_name ?? ''),
            // THE ACCOUNT, AS ITS OWN FACT and never as a substitute for the
            // line above — the other half of that same fix, kept visible so
            // a manager who did mean to speak as their own account is not
            // hidden by it.
            'accountName' => $row->member_id === null ? null : ($names['people'][(string) $row->member_id] ?? null),
            'subject' => (string) $row->subject,
            'status' => $this->statusValue($row),
            'isUnread' => $this->statusValue($row) === FeedbackStatus::New->value,
            'submittedAt' => (string) $row->created_at->toISOString(),
            // NULL IS "Toàn hệ thống", and the screen renders that word
            // rather than a blank — a site-wide message with no shelf name
            // beside it reads as a message whose parish nobody recorded.
            'shelfName' => $row->bookshelf_id === null ? null : ($names['shelves'][(string) $row->bookshelf_id] ?? null),
        ];
    }

    /**
     * @param  array{people: array<string, string>, shelves: array<string, string>}  $names
     * @return array{feedbackId: string, senderName: string, accountName: string|null, subject: string, status: string, isUnread: bool, submittedAt: string, shelfName: string|null, body: string, senderContact: string|null, handledAt: string|null, handledByName: string|null}
     */
    private function detailRow(Feedback $row, array $names): array
    {
        return array_merge($this->listRow($row, $names), [
            'body' => (string) $row->body,
            // THE ONE PLACE THE NUMBER APPEARS. The application sends no
            // email at all, so this is how anybody answers a parishioner.
            'senderContact' => $row->guest_contact === null ? null : (string) $row->guest_contact,
            'handledAt' => $row->handled_at?->toISOString(),
            'handledByName' => $row->handled_by === null ? null : ($names['people'][(string) $row->handled_by] ?? null),
        ]);
    }

    /**
     * Every account and shelf name the page needs, in two queries.
     *
     * ARCHIVED SHELVES RESOLVE. A parish whose shelf was archived last month
     * still sent the message, and Bookshelf archives by `status` rather than
     * by deleted_at (ArchiveBookshelf's own docblock argues why), so an
     * ordinary whereIn reaches it.
     *
     * @param  list<Feedback>  $rows
     * @return array{people: array<string, string>, shelves: array<string, string>}
     */
    private function names(array $rows): array
    {
        $peopleIds = [];
        $shelfIds = [];

        foreach ($rows as $row) {
            if ($row->member_id !== null) {
                $peopleIds[(string) $row->member_id] = true;
            }
            if ($row->handled_by !== null) {
                $peopleIds[(string) $row->handled_by] = true;
            }
            if ($row->bookshelf_id !== null) {
                $shelfIds[(string) $row->bookshelf_id] = true;
            }
        }

        $people = [];
        if ($peopleIds !== []) {
            foreach (User::query()->findMany(array_keys($peopleIds)) as $person) {
                $people[(string) $person->id] = (string) $person->full_name;
            }
        }

        $shelves = [];
        if ($shelfIds !== []) {
            foreach (Bookshelf::query()->findMany(array_keys($shelfIds)) as $shelf) {
                $shelves[(string) $shelf->id] = (string) $shelf->name;
            }
        }

        return ['people' => $people, 'shelves' => $shelves];
    }

    private function statusValue(Feedback $row): string
    {
        return $row->status->value;
    }
}
