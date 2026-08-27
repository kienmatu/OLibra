<?php

namespace App\Support\Catalogue;

use App\Exceptions\RuleViolated;

/**
 * QA remediation Task 19's rule, ported: a copy is attributed to a member's
 * profile OR to a typed name, never both meaning different things on one
 * row. Both blank is the ordinary case (a purchased book has no donor) and
 * must keep working — this only fires when BOTH are non-blank. Shared by
 * CreateBook and AddCopies so the one rule reads identically in both.
 */
final class Donor
{
    public static function assertSingle(?string $donorMembershipId, ?string $donorName): void
    {
        $blank = fn (?string $v): bool => $v === null || trim($v) === '';

        if (! $blank($donorMembershipId) && ! $blank($donorName)) {
            throw new RuleViolated('donor_ambiguous');
        }
    }
}
