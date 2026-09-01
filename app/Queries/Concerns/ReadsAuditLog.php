<?php

declare(strict_types=1);

namespace App\Queries\Concerns;

use App\Models\AuditLog;
use App\Support\Audit\AuditSentences;
use Carbon\CarbonImmutable;
use Collator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Everything an audit browser does EXCEPT decide which rows it may see —
 * extracted in phase 3c-ii Task 5 (spec D5) when `/admin/audit` became the
 * second reader of this table.
 *
 * WHY THIS EXISTS AT ALL. The two callers — `App\Queries\AuditLogQuery`
 * (one shelf, the manager's log) and `App\Queries\Admin\AuditBrowserQuery`
 * (every shelf plus the installation's own rows) — differed in exactly one
 * private method: the one that produces the starting builder. Everything
 * below it was identical, and the reference argues the case for not
 * copying it: *"A second query would have been a second definition of what
 * an audit entry is … and the two would come to disagree about a sentence
 * the day one of them grew a case."*
 *
 * WHAT IS ACTUALLY SHARED, because an earlier draft of the spec was vague
 * about it. Sentence rendering was ALREADY shared, through the static
 * `AuditSentences::groupOf/sentence/payloadRows`, and never lived here to
 * be moved. What is genuinely one copy now is the JOIN AND SELECT BLOCK:
 * the four `leftJoin`s, two of which carry the `CONVERT(… USING ascii)
 * COLLATE ascii_bin` guard against errno 1267 (this repo's six-times-paid
 * live 500), the four-way `coalesce` that resolves a subject's name, the
 * page size, and the `occurred_at desc, id desc` total order.
 *
 * A TRAIT TAKING THE BUILDER, NOT AN INJECTED SCOPE. The alternative
 * weighed was making `AuditLogQuery`'s scope injectable and reusing that
 * class outright from `/admin`. It was rejected for what it would do to a
 * guard rather than for style: that file carries a `TenancyArchitectureTest`
 * allow-list entry naming it as the ONE hand-written tenant-column filter,
 * and a class whose scope an argument decides is no longer the class that
 * entry describes — the exemption would silently start covering "whatever
 * the caller asked for". Handing a builder in keeps each caller owning its
 * own visibility, in its own file, with its own allow-list entry to
 * justify.
 *
 * NOTHING HERE NAMES THE TENANT COLUMN, which is the property that lets
 * this file stay off that allow-list. Adding a shelf predicate here would
 * quietly move the exemption into shared code.
 *
 * The behaviour below is unchanged from `AuditLogQuery` as it stood at
 * commit 0c5b385; the comments are its own, moved with the code they
 * explain.
 */
trait ReadsAuditLog
{
    private const int AUDIT_PAGE_SIZE = 25;

    private const string AUDIT_TIMEZONE = 'Asia/Ho_Chi_Minh';

    /**
     * One page of the log, from whatever set of rows the caller decided it
     * may see.
     *
     * Inputs are the CONTROLLER's to validate (uuid-shaped actor, known
     * group, real Y-m-d civil dates): this method trusts their shape and
     * only decides what they mean.
     *
     * @param  Builder<AuditLog>  $visible  the caller's own starting builder
     * @return array{rows: list<array<string, mixed>>, page: int, pageCount: int, total: int}
     */
    private function auditPage(Builder $visible, ?string $actorId, ?string $group, ?string $from, ?string $to, int $page): array
    {
        $page = max(1, $page);

        $filtered = $visible;
        if ($actorId !== null) {
            $filtered->where('audit_log.actor_id', $actorId);
        }
        if ($group !== null) {
            // The group becomes the list of actions the one map owns — never
            // a like 'loan.%' pattern, which would be a second, weaker copy
            // of the partition (loan.* and request.* are one family to a
            // volunteer, which no prefix can express).
            $filtered->whereIn('audit_log.action', AuditSentences::actionsInGroup($group));
        }
        if ($from !== null) {
            // The instant the civil day BEGINS in the shelf's timezone,
            // compared in UTC — a bare date comparison files everything
            // after 5pm local under the wrong day (the reference measured
            // exactly seven hours, twice).
            $filtered->where('audit_log.occurred_at', '>=',
                CarbonImmutable::parse($from, self::AUDIT_TIMEZONE)->startOfDay()->utc());
        }
        if ($to !== null) {
            // +1 day with a strict < makes the range inclusive of the whole
            // of the last civil day.
            $filtered->where('audit_log.occurred_at', '<',
                CarbonImmutable::parse($to, self::AUDIT_TIMEZONE)->addDay()->startOfDay()->utc());
        }

        $total = (clone $filtered)->count();

        $rows = $filtered
            ->leftJoin('users as actor_user', 'actor_user.id', '=', 'audit_log.actor_id')
            // The subject, resolved from an id the ROW holds, in order of
            // preference: entity_id first (the thing the entry is about),
            // the payload's borrower second (a loan's entity is the loan;
            // the person is inside it), the payload's userId last (a
            // request's entity is the request). Nothing else is consulted.
            ->leftJoin('users as subject_user', function ($join) {
                $join->on('subject_user.id', '=', 'audit_log.entity_id')
                    ->where('audit_log.entity_type', '=', 'user');
            })
            ->leftJoin('memberships as subject_membership', function ($join) {
                $join->on('subject_membership.id', '=', 'audit_log.entity_id')
                    ->where('audit_log.entity_type', '=', 'membership');
            })
            ->leftJoin('users as member_user', 'member_user.id', '=', 'subject_membership.user_id')
            // A uuid stored inside a JSON payload, written by whatever build
            // was deployed. JSON_UNQUOTE yields utf8mb4; users.id is
            // ascii_bin; comparing them raw is errno 1267 — this repo's
            // six-times-paid live 500. CONVERT ... USING ascii degrades any
            // non-ASCII byte to '?', which matches nothing, and the COLLATE
            // pins the comparison to the column's own collation.
            ->leftJoin('users as payload_user', function ($join) {
                $join->on('payload_user.id', '=', DB::raw(
                    "CONVERT(JSON_UNQUOTE(JSON_EXTRACT(audit_log.after, '$.borrower_id')) USING ascii) COLLATE ascii_bin"
                ));
            })
            // request.* entries store the reader under $.userId — the
            // reference's key, whose subject join reads borrower_id AND
            // userId. 1d ported only borrower_id. That was not because
            // nothing wrote $.userId: Registration::auditAfter has written
            // it since 1b (6c1cc43), so every membership.registered row
            // carries one. Those rows resolve through the membership join
            // TWO positions ahead of this one in the coalesce below, so
            // adding this join changes nothing observable until request.*
            // arrives — inert, but not for the reason an earlier draft of
            // this comment gave.
            //
            // Structurally this is also NOT the reference's shape:
            // get-audit-log.ts:190-199 uses one join with a CASE (take
            // borrower_id, else userId) where this uses two joins and a
            // coalesce. They diverge only when after.borrower_id is a real
            // uuid that resolves to no user while after.userId resolves to
            // one — unreachable here, since users are never hard-deleted
            // and every reference is RESTRICT. Written down so a later
            // reader does not take the two forms for identical.
            //
            // Same CONVERT/COLLATE guard as the join above:
            // JSON_UNQUOTE yields utf8mb4, users.id is ascii_bin, and the
            // raw comparison is errno 1267 — this repo's six-times-paid
            // live 500.
            ->leftJoin('users as payload_subject', function ($join) {
                $join->on('payload_subject.id', '=', DB::raw(
                    "CONVERT(JSON_UNQUOTE(JSON_EXTRACT(audit_log.after, '$.userId')) USING ascii) COLLATE ascii_bin"
                ));
            })
            ->select('audit_log.*')
            ->selectRaw('actor_user.full_name as actor_name')
            ->selectRaw('coalesce(subject_user.full_name, member_user.full_name, payload_user.full_name, payload_subject.full_name) as subject_name')
            ->orderByDesc('audit_log.occurred_at')
            ->orderByDesc('audit_log.id')
            ->limit(self::AUDIT_PAGE_SIZE)
            ->offset(($page - 1) * self::AUDIT_PAGE_SIZE)
            ->get();

        return [
            'rows' => array_values($rows->map(function (AuditLog $row): array {
                $facts = [
                    'actor' => $row->getAttribute('actor_name'),
                    'subject' => $row->getAttribute('subject_name'),
                    'before' => $row->before,
                    'after' => $row->after,
                ];

                return [
                    'id' => (string) $row->id,
                    'action' => $row->action,
                    'entityType' => $row->entity_type,
                    'entityId' => $row->entity_id,
                    'occurredAt' => $row->occurred_at->utc()->toIso8601String(),
                    'group' => AuditSentences::groupOf($row->action),
                    'sentence' => AuditSentences::sentence($row->action, $facts),
                    'expansion' => AuditSentences::payloadRows($row->before, $row->after),
                ];
            })->all()),
            'page' => $page,
            'pageCount' => max(1, (int) ceil($total / self::AUDIT_PAGE_SIZE)),
            'total' => $total,
        ];
    }

    /**
     * Everyone who appears as an actor in the rows the caller may see, with
     * how many entries each has — the `<select>`'s options, and the closed
     * list a controller validates `?actor=` against.
     *
     * @param  Builder<AuditLog>  $visible
     * @return list<array{userId: string, name: string, entries: int}>
     */
    private function auditActors(Builder $visible): array
    {
        $rows = $visible
            ->whereNotNull('audit_log.actor_id')
            ->join('users', 'users.id', '=', 'audit_log.actor_id')
            ->groupBy('users.id', 'users.full_name')
            ->selectRaw('users.id as user_id, users.full_name as name, count(*) as entries')
            ->get();

        // Count desc, then Vietnamese collation on the name (Đặng before
        // Vũ — byte order would file every Đ after z), then id as the
        // stable tiebreak so a <select>'s options never move between
        // renders. In PHP with Collator, the ParishUnits precedent.
        $collator = new Collator('vi');
        $options = $rows->map(fn ($r) => [
            'userId' => (string) $r->getAttribute('user_id'),
            'name' => (string) $r->getAttribute('name'),
            'entries' => (int) $r->getAttribute('entries'),
        ])->all();
        usort($options, fn (array $a, array $b) => ($b['entries'] <=> $a['entries'])
            ?: ($collator->compare($a['name'], $b['name']) ?: 0)
            ?: ($a['userId'] <=> $b['userId']));

        return $options;
    }
}
