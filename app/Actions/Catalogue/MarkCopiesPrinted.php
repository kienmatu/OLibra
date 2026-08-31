<?php

namespace App\Actions\Catalogue;

use App\Exceptions\RuleViolated;
use App\Models\BookCopy;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use App\Support\ConcurrencyRetry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Stamps a batch of copies as printed — OPS §4.1's MarkCopiesPrinted, the
 * only WRITE in the QR label slice. The route that will call this (Task 10)
 * builds the PDF bytes first, so this command is bookkeeping about a
 * document that already exists, not the thing that produces it.
 *
 * INCREMENTS, does not set: `qr_print_count` exists precisely so a reprint
 * — after a sticker falls off — stays distinguishable from a first print,
 * which a single boolean or a timestamp read as one cannot do (OPS §4.1).
 *
 * ONE audit entry for the whole batch, not one per copy: "a print run is
 * one volunteer at one printer in one moment, and four hundred rows saying
 * so would bury the log §14 exists to keep readable" (OPS §4.1). §5.4's
 * "the record affected is singular per entry" is about copies coming into
 * existence separately (AddCopies); this is the opposite shape, so the
 * entry names the count in $after and passes null as AuditRecorder::
 * record()'s $entityId — there is no single entity this batch is about.
 *
 * copy_selection_empty refuses an EMPTY INPUT array and nothing else
 * (design doc D7). A non-empty selection that scopes down to zero rows —
 * every id belongs to another shelf — is not a target that was missed: it
 * is a fact about a PDF that already exists, so it succeeds with a count
 * of zero. Tenancy is BookshelfScope's: the query below carries no
 * `bookshelf_id` predicate, which is what makes a foreign id disappear
 * from the WHERE IN rather than throw.
 */
final class MarkCopiesPrinted
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  list<string>  $copyIds
     * @return array{count: int}
     */
    public function execute(User $actor, array $copyIds): array
    {
        Gate::forUser($actor)->authorize('act-as-manager');

        if ($copyIds === []) {
            throw new RuleViolated('copy_selection_empty');
        }

        return DB::transaction(function () use ($copyIds): array {
            $now = $this->clock->now();

            // The scope (BookshelfScope, via BelongsToBookshelf) is what
            // makes another shelf's ids expand to nothing here rather than
            // throw — the tenancy contract this command relies on for D7's
            // "scopes down to zero, succeeds with zero" behaviour.
            $count = BookCopy::query()
                ->whereIn('id', $copyIds)
                ->update([
                    'qr_print_count' => DB::raw('qr_print_count + 1'),
                    'qr_printed_at' => $now,
                ]);

            $this->audit->record('copy.qr_printed', 'copy', null, null, [
                'count' => $count,
            ]);

            return ['count' => $count];
        }, ConcurrencyRetry::ATTEMPTS);
    }
}
