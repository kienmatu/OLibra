<?php

namespace App\Support\Circulation;

use App\Models\Bookshelf;

/**
 * BR §5.5's lending numbers, read once per command off the shelf row the
 * tenant middleware already loaded — the port of circulation/settings.ts.
 * One module, not a private coalesce in each command: two copies of
 * "default to 3" is how one later stops matching the settings screen.
 *
 * The defaults are the values nearly every shelf uses: a shelf that has
 * never opened its settings screen stores {} and gets 14/3/1/7/3/3 from
 * here, not from a column.
 */
final readonly class LendingSettings
{
    public function __construct(
        public int $loanDays,
        public int $maxConcurrentLoans,
        public int $maxRenewals,
        public int $renewalDays,
        public int $holdDays,
        public int $dueSoonDays,
    ) {}

    public static function fromShelf(Bookshelf $shelf): self
    {
        $settings = (array) $shelf->settings;

        return new self(
            loanDays: (int) ($settings['loan_days'] ?? 14),
            maxConcurrentLoans: (int) ($settings['max_concurrent_loans'] ?? 3),
            maxRenewals: (int) ($settings['max_renewals'] ?? 1),
            renewalDays: (int) ($settings['renewal_days'] ?? 7),
            // BR §5.5's hold_days — how long a hold stands (default 3).
            holdDays: (int) ($settings['hold_days'] ?? 3),
            // The sweep's per-shelf due-soon window (default 3) — the
            // reference's QA Task 23/24 pair: a setting the nightly job
            // actually obeys, or it is inert.
            dueSoonDays: (int) ($settings['due_soon_days'] ?? 3),
        );
    }
}
