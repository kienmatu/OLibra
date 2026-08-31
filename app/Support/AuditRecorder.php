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
 *
 * Phase 3b-i adds the exception that proves the rule. The `/admin` route
 * group binds no tenant — it is cross-shelf by nature — so administration
 * commands need a way to say which shelf a row belongs to, or that it
 * belongs to none. That way is the fluent configurator below: `global()`
 * and `forShelf($id)` each return a configured copy, and only a configured
 * copy may write without a bound tenant.
 *
 * WHY A CONFIGURATOR AND NOT A recordGlobal() SIBLING. The shape is forced,
 * not stylistic. AuditActionCensusTest finds every recorded action with a
 * regex hard-coding `->record(` and asserts set-equality with
 * AuditSentences::ACTIONS in BOTH directions. A differently named write
 * method is invisible to that regex, so every administration action would be
 * a registered sentence with no writer and the census would be permanently
 * red. Configuring the recorder and then calling the same `record()` keeps
 * the literal `->record('...')` at every call site, and leaves that pin
 * working untouched.
 *
 * `record()` itself is NOT weakened: an unconfigured recorder — which is
 * every shelf-scoped command in the app, since the container hands out the
 * unconfigured singleton — still throws on a null tenant.
 *
 * The configurator is fenced to `app/Actions/Admin/` by
 * WideningArchitectureTest, for the same reason `systemWide()` is.
 */
final class AuditRecorder
{
    /**
     * Has a caller named the shelf explicitly? Distinct from the id being
     * null, because "explicitly no shelf" (a global admin act) and "nobody
     * said" (the throw below) are different states.
     */
    private bool $shelfNamed = false;

    private ?string $namedShelfId = null;

    public function __construct(
        private TenantContext $context,
        private Clock $clock,
    ) {}

    /**
     * A cross-shelf administration act: the row carries a null bookshelf_id
     * and appears on no single shelf's audit screen.
     */
    public function global(): self
    {
        $configured = clone $this;
        $configured->shelfNamed = true;
        $configured->namedShelfId = null;

        return $configured;
    }

    /**
     * An administration act against one shelf, written from a request that
     * has no tenant bound.
     */
    public function forShelf(string $bookshelfId): self
    {
        $configured = clone $this;
        $configured->shelfNamed = true;
        $configured->namedShelfId = $bookshelfId;

        return $configured;
    }

    /**
     * @param  array<string, mixed>|null  $before
     * @param  array<string, mixed>|null  $after
     */
    public function record(string $action, string $entityType, ?string $entityId, ?array $before, ?array $after): void
    {
        AuditSecrets::assertNoSecrets($before, $after);

        if ($this->shelfNamed) {
            $bookshelfId = $this->namedShelfId;
        } else {
            $bookshelfId = $this->context->bookshelfId();

            if ($bookshelfId === null) {
                throw new RuntimeException(
                    'AuditRecorder needs a bound tenant. Bind one via the tenant middleware '
                    .'(or TenantHarness::actAs() in tests) before running a shelf-scoped command. '
                    .'A cross-shelf administration command in app/Actions/Admin/ names its shelf '
                    .'instead, with forShelf($id) or global().',
                );
            }
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
