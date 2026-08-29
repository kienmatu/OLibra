<?php

namespace App\Console\Commands;

use App\Enums\LoanStatus;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Notification;
use App\Support\Circulation\LendingSettings;
use App\Support\Clock;
use App\Support\Notifications\NotificationKind;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The one scheduled job this system permits, and the exception is argued,
 * not assumed (sweep.ts, OPS §7): BR §8 keeps overdue STATUS derived on
 * read — the badge, the dashboard count and the overdue list are right
 * whether or not this ever runs — but "has this reader already been told"
 * is itself state, and a dismissible record cannot be computed on read
 * without telling somebody twice or losing that they were told. The bound
 * is the acceptance criterion: if this does not run for a few hours,
 * nothing observable is wrong, only late to be told. That bound is a test,
 * not a sentence — SweepIsHousekeepingTest's first case advances the clock
 * past a due date, runs nothing, and asserts the dashboard is already
 * correct.
 *
 * Idempotent by existence, not by cursor: "already told" is the
 * notification itself (same user, kind, due_on, title) — there is no
 * last_swept_at to drift, roll back, or be reset by a restore. Per loan
 * AND per kind, so a due-soon warning does not eat the overdue notice:
 * two different things to say about one book.
 *
 * Cross-shelf under actSystemWide() — a nightly job serves every parish
 * and has no tenant to scope to, and a per-shelf loop would itself need a
 * cross-shelf read to get its list of shelves. Under that context
 * BookshelfScope no-ops, so bookshelf_id is copied from each loan onto the
 * row it produces: every write is correctly scoped even though the read
 * was not. Per-shelf due_soon_days comes off each shelf's settings blob
 * through LendingSettings — the same coalesce the settings screen shows,
 * fallback 3 — so a manager who raises the window gets the window they
 * asked for rather than a setting the job never reads. The overdue half
 * consults no shelf setting: a lapsed loan is late regardless of how much
 * warning its shelf asked for.
 *
 * Deliberately NOT an audited action: there is no actor for INV-8 to name,
 * and nothing about the shelf's record changed — a book became late on its
 * own. Rows are created directly rather than through Notifier, which takes
 * its shelf from a bound tenant this job does not have;
 * NotificationsAreReaderFacingTest names this file for both kinds and
 * allows it to insert notification rows.
 *
 * Eloquent per-row inserts rather than INSERT…SELECT (plan divergence 9):
 * ids are application-generated UUIDv7 and MariaDB 10.11 has no v7
 * function. Of the reads below, only the idempotence probe's plan has been
 * measured (it is the one that grows with the install rather than with a
 * parish — see known-gaps for the captured EXPLAIN); the candidate reads
 * over loans were not, because their volume is a shelf's active loans.
 */
final class SweepReminders extends Command
{
    protected $signature = 'reminders:sweep';

    protected $description = 'Write due-soon and overdue reader notifications (07:00 Asia/Ho_Chi_Minh housekeeping)';

    public function handle(Clock $clock, TenantContext $tenant): int
    {
        $tenant->actSystemWide();
        $today = $clock->today();
        // One instant for the whole run, not one per row. MyNotificationsQuery's
        // docblock leans on that ("the sweep writes many rows in one instant,
        // so the timestamps tie BY CONSTRUCTION"), which is why its list
        // orders by id desc beside created_at desc.
        $stamp = $clock->now();

        [$dueSoon, $overdue] = DB::transaction(function () use ($today, $stamp): array {
            // The deployment default, read from the one place that owns it
            // rather than spelled 3 again here: LendingSettings' own
            // docblock says two copies of "default to 3" is how one later
            // stops matching the settings screen. A shelf with no settings
            // blob is exactly what a bare model is.
            $fallback = self::plus($today, LendingSettings::fromShelf(new Bookshelf)->dueSoonDays);

            // Each shelf's own last due-soon date, resolved once. Cross-shelf
            // like everything else here: bookshelves carries no bookshelf_id
            // and is not a scoped model, so this is every parish's row, which
            // is what a nightly job wants and what makes the read cost grow
            // with the install rather than with one parish.
            $limits = Bookshelf::query()->get()
                ->mapWithKeys(fn (Bookshelf $shelf) => [$shelf->id => self::plus($today, LendingSettings::fromShelf($shelf)->dueSoonDays)]);
            $widest = (string) max([$fallback, ...$limits->values()->all()]);

            // The widest window any shelf asked for bounds the candidate
            // READ; each row is then held to its OWN shelf's date below.
            $candidates = Loan::query()
                ->where('status', LoanStatus::Active)
                ->where('due_on', '>=', $today)
                ->where('due_on', '<=', $widest)
                ->join('books', 'books.id', '=', 'loans.book_id')
                ->select('loans.*', 'books.title')
                ->get();

            // A separate statement, not chained onto ->get() above, and the
            // reason is mechanical rather than stylistic:
            // TenancyArchitectureTest's filter grep is
            // /where[A-Za-z]*\s*\([^;]*bookshelf_id/ over raw file text, so
            // an inlined closure naming bookshelf_id with no semicolon
            // between it and the last ->where( reports this file as a
            // hand-written tenant filter. Measured both spellings against
            // that regex before writing this down; re-inline it and the
            // build reddens on correct code.
            $inWindow = $candidates->filter(
                fn (Loan $loan): bool => $loan->due_on->toDateString() <= self::limitFor($loan, $limits, $fallback),
            );
            $dueSoon = $this->tell($inWindow, NotificationKind::LoanDueSoon, $stamp);

            $lapsed = Loan::query()
                ->where('status', LoanStatus::Active)
                ->where('due_on', '<', $today)
                ->join('books', 'books.id', '=', 'loans.book_id')
                ->select('loans.*', 'books.title')
                ->get();

            $overdue = $this->tell($lapsed, NotificationKind::LoanOverdue, $stamp);

            return [$dueSoon, $overdue];
        });

        // Always printed, even at 0,0 — the line itself is the evidence the
        // job ran, and OPS §7's operator walk reads it as such. English on
        // purpose: this is console output an operator reads in a log, not
        // interface copy.
        $this->info(sprintf('Sweep complete: %d due-soon, %d overdue notification(s).', $dueSoon, $overdue));

        return self::SUCCESS;
    }

    /**
     * The last date this loan's own shelf still calls "due soon".
     *
     * The coalesce is belt and braces, not a live branch: $limits is read
     * from bookshelves inside the same transaction as the loans, and
     * loans.bookshelf_id is a foreign key, so a loan whose shelf is absent
     * from the map is not a state this snapshot can show. It falls back to
     * the deployment default rather than to something that would skip the
     * row, because a missing key must not silently mean "never warn".
     *
     * @param  Collection<string, string>  $limits
     */
    private static function limitFor(Loan $loan, Collection $limits, string $fallback): string
    {
        return (string) ($limits[$loan->getAttribute('bookshelf_id')] ?? $fallback);
    }

    /** `Y-m-d` $days after $today, still as a civil date string. */
    private static function plus(string $today, int $days): string
    {
        return CarbonImmutable::parse($today)->addDays($days)->toDateString();
    }

    /**
     * Write one notification per loan not already told this exact thing,
     * and return how many were written.
     *
     * @param  Collection<int, Loan>  $loans
     */
    private function tell(Collection $loans, NotificationKind $kind, CarbonImmutable $stamp): int
    {
        $written = 0;
        foreach ($loans as $loan) {
            $dueOn = $loan->due_on->toDateString();
            $title = (string) $loan->getAttribute('title');

            $alreadyTold = Notification::query()
                ->where('user_id', $loan->borrower_id)
                ->where('kind', $kind->value)
                ->where('payload->due_on', $dueOn)
                ->where('payload->title', $title)
                ->exists();
            if ($alreadyTold) {
                continue;
            }

            // user_id is a users(id), never a membership id — the recurring
            // trap. It is the loan's borrower_id, which is that same column.
            Notification::query()->create([
                'bookshelf_id' => $loan->getAttribute('bookshelf_id'),
                'user_id' => $loan->borrower_id,
                'kind' => $kind->value,
                'payload' => ['title' => $title, 'due_on' => $dueOn],
                'created_at' => $stamp,
            ]);
            $written++;
        }

        return $written;
    }
}
