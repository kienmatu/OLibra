<?php

namespace App\Queries;

use App\Models\AuditLog;
use App\Queries\Concerns\ReadsAuditLog;
use App\Support\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use RuntimeException;

/**
 * OPS §3.3's GetAuditLog (shelf-scoped) — port of get-audit-log.ts.
 *
 * ~~THE one hand-written bookshelf_id filter outside BookshelfScope~~ —
 * RETRACTED 2026-09-01 (phase 3c-ii, Task 5). There are now TWO: this one,
 * and app/Queries/Admin/AuditBrowserQuery.php, which needs its own because
 * "site-wide only" is a predicate no relation can express. Each carries its
 * own allow-list entry. The rest of this docblock was rewritten then and
 * points at the new class correctly; this opening absolute was left standing
 * and is the sentence that went stale. It remains true that this is the one
 * such filter for the SHELF-scoped read, and
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
 *
 * ONLY THE SCOPE LIVES HERE NOW. Phase 3c-ii Task 5 (spec D5) built the
 * cross-shelf browser this file's own comments kept promising, and the
 * joins, the ordering, the page size, the four filters and the actor
 * options moved to App\Queries\Concerns\ReadsAuditLog so the two readers
 * cannot come to disagree about what an audit entry is. What is left in
 * this class is the one thing that was ever different: which rows a
 * manager may see. The behaviour is unchanged — every paragraph above
 * still describes what happens, in the file the trait was cut from.
 */
final class AuditLogQuery
{
    use ReadsAuditLog;

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
        return $this->auditPage($this->scoped(), $actorId, $group, $from, $to, $page);
    }

    /** @return list<array{userId: string, name: string, entries: int}> */
    public function actors(): array
    {
        return $this->auditActors($this->scoped());
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
        // on purpose: they are Phase 3's cross-shelf browser's, and phase
        // 3c-ii built it — App\Queries\Admin\AuditBrowserQuery, which
        // carries its own allow-list entry for its own predicate.
        return AuditLog::query()->where('audit_log.bookshelf_id', $bookshelfId);
    }
}
