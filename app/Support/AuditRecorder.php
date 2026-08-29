<?php

namespace App\Support;

use App\Models\AuditLog;
use App\Support\Audit\AuditSecrets;
use Illuminate\Support\Facades\Auth;
use RuntimeException;

/**
 * INV-8's pen: one row per state transition, written by the command inside
 * its own DB::transaction — the caller owns the transaction, this class
 * only writes the row, so "audit and change commit or roll back together"
 * (OPS §1) is the transaction's property, not this class's.
 *
 * Shelf and actor come from the bound context, never from parameters — a
 * command cannot audit itself onto another shelf or as another user. No
 * tenant bound is an error, not a null shelf: a shelf-scoped command's
 * audit row with a null bookshelf_id would vanish from that shelf's own
 * audit screen (global rows are the cross-shelf admin acts of Phase 3).
 */
final class AuditRecorder
{
    public function __construct(
        private TenantContext $context,
        private Clock $clock,
    ) {}

    /**
     * @param  array<string, mixed>|null  $before
     * @param  array<string, mixed>|null  $after
     */
    public function record(string $action, string $entityType, ?string $entityId, ?array $before, ?array $after): void
    {
        AuditSecrets::assertNoSecrets($before, $after);

        $bookshelfId = $this->context->bookshelfId();

        if ($bookshelfId === null) {
            throw new RuntimeException(
                'AuditRecorder needs a bound tenant. Bind one via the tenant middleware '
                .'(or TenantHarness::actAs() in tests) before running a shelf-scoped command.',
            );
        }

        AuditLog::query()->create([
            'bookshelf_id' => $bookshelfId,
            'actor_id' => Auth::id(),
            'action' => $action,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'before' => $before,
            'after' => $after,
            'context' => [],
            'occurred_at' => $this->clock->now(),
        ]);
    }
}
