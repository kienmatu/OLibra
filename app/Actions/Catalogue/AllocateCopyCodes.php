<?php

namespace App\Actions\Catalogue;

use App\Models\BookCopy;
use App\Support\Catalogue\CopyCodes;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Reserves the next $count copy codes on the bound shelf, in order — the
 * port of old_next/src/domain/catalogue/copy-codes.ts.
 *
 * MUST run inside the caller's DB::transaction, AS ITS FIRST STATEMENT —
 * no read may precede this call. The SELECT ... FOR UPDATE on the shelf's
 * own bookshelves row is what serialises CreateBook and AddCopies per
 * shelf (the reference used pg_advisory_xact_lock; MariaDB's GET_LOCK is
 * connection-scoped and would leak on a thrown exception, an InnoDB row
 * lock releases on commit or rollback with nothing to remember). The
 * first-statement requirement is MariaDB-specific and non-negotiable:
 * InnoDB's REPEATABLE READ pins the transaction's read view at its first
 * consistent read, so a lock acquired after any earlier SELECT still
 * reads the pinned, stale snapshot — reproduced live on 10.11 during this
 * plan's review (duplicate code, silently-missed ISBN clash, missed
 * slug). Postgres's READ COMMITTED refreshed per statement, which is why
 * the reference could afford reads before its lock and this port cannot.
 * The second transaction waits at the lock, then — its view established
 * under the lock — reads a max that already includes the first one's
 * codes. Keyed on the shelf row, so two parishes never queue behind each
 * other. book_copies_code_unique (errno 1062) stays the guarantee; this
 * lock only stops the guarantee being experienced as an error message
 * (BR §2: "must fail cleanly and see a plain message").
 *
 * The scan deliberately does not filter deleted_at, even though the unique
 * index does: a soft-deleted DT-0215 is a code already printed on a label
 * stuck to a physical book (BR §5.4), and handing it out again is worse
 * than a gap in the sequence. withTrashed() removes ONLY the soft-delete
 * scope; BookshelfScope still applies, which is what keeps the scan on
 * this shelf without a hand-written filter.
 *
 * $count <= 0 returns [] rather than touching the database: PHP's
 * range(1, $count) is *descending* (not empty) when $count < 1 — range(1,
 * 0) is [1, 0] and range(1, -1) is [1, 0, -1] — unlike the reference's
 * Array.from({length: count}), which is [] for count <= 0. Ported without
 * this guard, execute(0) would silently mint 'DT-0000' and execute(-1)
 * would mint a malformed 'DT-00-1' too, with no unique index to object
 * (found in review, since a request-supplied count that skips a min:1
 * rule would reach here from Task 8's AddCopies).
 *
 * Also refuses to run when no transaction is open (DB::transactionLevel()
 * === 0): outside a transaction the FOR UPDATE below autocommits and its
 * row lock releases before the MAX scan runs, so the class would provide
 * no serialisation at all while looking like it does. This is the one
 * misuse this class can detect at runtime; the stronger one — the lock
 * present but not the first statement — cannot be detected here and rests
 * on the contract above plus AllocateCopyCodesTest's index-0 assertion.
 */
final class AllocateCopyCodes
{
    public function __construct(private TenantContext $context) {}

    /** @return list<string> */
    public function execute(int $count): array
    {
        if ($count < 1) {
            return [];
        }

        if (DB::transactionLevel() === 0) {
            throw new RuntimeException('AllocateCopyCodes must run inside a transaction.');
        }

        $bookshelfId = $this->context->bookshelfId()
            ?? throw new RuntimeException('AllocateCopyCodes needs a bound tenant.');

        // The per-shelf serialisation point. DB::table (not the Bookshelf
        // model) so no global scope machinery runs mid-transaction; the id
        // is the bound tenant's own, so this is not a tenant filter the
        // architecture suite needs to know about.
        $shelf = DB::table('bookshelves')
            ->where('id', $bookshelfId)
            ->lockForUpdate()
            ->first(['slug', 'settings']);

        if ($shelf === null) {
            throw new RuntimeException('Bound shelf vanished mid-transaction.');
        }

        $settings = $shelf->settings === null ? null : json_decode($shelf->settings, true);
        $prefix = CopyCodes::prefix($shelf->slug, is_array($settings) ? $settings : null);

        // REGEXP_SUBSTR(code, '[0-9]+$') returns '' (not NULL — NULL only
        // for NULL input) for a code that does not end in digits;
        // CAST('' AS UNSIGNED) is 0, which never wins MAX against a real
        // sequence, so hand-imported codes leave the sequence intact.
        // CAST AS UNSIGNED because REGEXP_SUBSTR returns text. MariaDB's
        // default LIKE escape is backslash — CopyCodes::escapeLike's
        // contract.
        $last = (int) BookCopy::query()
            ->withTrashed()
            ->where('code', 'like', CopyCodes::escapeLike($prefix).'-%')
            ->selectRaw("MAX(CAST(REGEXP_SUBSTR(code, '[0-9]+$') AS UNSIGNED)) AS last")
            ->value('last');

        return array_map(
            fn (int $i): string => CopyCodes::format($prefix, $last + $i),
            range(1, $count),
        );
    }
}
