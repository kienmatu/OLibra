<?php

namespace App\Queries;

use App\Models\AuditLog;
use App\Support\Audit\AuditSentences;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Collator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * OPS §3.3's GetAuditLog (shelf-scoped) — port of get-audit-log.ts.
 *
 * THE one hand-written bookshelf_id filter outside BookshelfScope, and
 * TenancyArchitectureTest names this file for it: AuditLog is exempt from
 * BelongsToBookshelf (nullable bookshelf_id — global rows are Phase 3's
 * cross-shelf browser), so scoping is this class's own where, and the
 * two-shelf-plus-global-row test in AuditLogQueryTest is what stands
 * behind it. A null bound tenant is an error, not an unscoped read.
 *
 * The order is occurred_at desc, id desc, and the second key is load
 * bearing: AddCopies writes one row per copy at one clock instant, so
 * ties are the ordinary case, and limit/offset over a non-total order
 * repeats and skips rows across pages (measured three times in the
 * reference project). audit_log.id is BIGINT AUTO_INCREMENT — it cannot
 * tie, and it descends with the timestamp.
 *
 * users joins carry NO deleted_at filter, unlike every list query in
 * this repo, deliberately: a soft-deleted person's name vanishing from
 * the trail would be the log quietly rewriting itself (INV-12's spirit).
 *
 * Sentences render STORED values only — the title comes from the
 * payload the command froze at write time, never from books.title, so a
 * later UpdateBook cannot restate history. People are the exception by
 * design: an id is a reference, and resolving it to today's name is
 * what lets "who has been touching whose account" be answered at all.
 */
final class AuditLogQuery
{
    private const int PAGE_SIZE = 25;

    private const string TIMEZONE = 'Asia/Ho_Chi_Minh';

    public function __construct(private TenantContext $context) {}

    /**
     * Inputs are the CONTROLLER's to validate (uuid-shaped actor, known
     * group, real Y-m-d civil dates): this class trusts their shape and
     * only decides what they mean.
     *
     * @return array{rows: list<array<string, mixed>>, page: int, pageCount: int, total: int}
     */
    public function run(?string $actorId = null, ?string $group = null, ?string $from = null, ?string $to = null, int $page = 1): array
    {
        $page = max(1, $page);

        $filtered = $this->scoped();
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
                CarbonImmutable::parse($from, self::TIMEZONE)->startOfDay()->utc());
        }
        if ($to !== null) {
            // +1 day with a strict < makes the range inclusive of the whole
            // of the last civil day.
            $filtered->where('audit_log.occurred_at', '<',
                CarbonImmutable::parse($to, self::TIMEZONE)->addDay()->startOfDay()->utc());
        }

        $total = (clone $filtered)->count();

        $rows = $filtered
            ->leftJoin('users as actor_user', 'actor_user.id', '=', 'audit_log.actor_id')
            // The subject, resolved from an id the ROW holds, in order of
            // preference: entity_id first (the thing the entry is about),
            // the payload's borrower second (a loan's entity is the loan;
            // the person is inside it). Nothing else is consulted.
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
            ->select('audit_log.*')
            ->selectRaw('actor_user.full_name as actor_name')
            ->selectRaw('coalesce(subject_user.full_name, member_user.full_name, payload_user.full_name) as subject_name')
            ->orderByDesc('audit_log.occurred_at')
            ->orderByDesc('audit_log.id')
            ->limit(self::PAGE_SIZE)
            ->offset(($page - 1) * self::PAGE_SIZE)
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
            'pageCount' => max(1, (int) ceil($total / self::PAGE_SIZE)),
            'total' => $total,
        ];
    }

    /** @return list<array{userId: string, name: string, entries: int}> */
    public function actors(): array
    {
        $rows = $this->scoped()
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

    /** @return Builder<AuditLog> */
    private function scoped(): Builder
    {
        $bookshelfId = $this->context->bookshelfId();

        if ($bookshelfId === null) {
            throw new RuntimeException(
                'AuditLogQuery needs a bound tenant — a null bound would read every shelf\'s history.'
            );
        }

        // The exempted hand-written filter TenancyArchitectureTest names
        // this file for. Global (null) rows are EXCLUDED by this equality
        // on purpose: they are Phase 3's cross-shelf browser's.
        return AuditLog::query()->where('audit_log.bookshelf_id', $bookshelfId);
    }
}
