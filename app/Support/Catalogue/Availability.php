<?php

namespace App\Support\Catalogue;

/**
 * The ONE place BR §8's badge ladder is written (M8, fix-report,
 * 2026-08-08-b1-catalogue — previously copy-pasted as a SQL CASE into five
 * queries). Every catalogue query selects the raw counts and calls this.
 *
 * 'none' has no CopyState member on purpose: it means "this title has no
 * live copies at all", which is different on the wire from "every copy is
 * genuinely retired".
 */
final class Availability
{
    /** @return 'available'|'on_loan'|'held'|'lost'|'retired'|'none' */
    public static function derive(int $available, int $onLoan, int $held, int $lost, bool $hasRetired): string
    {
        return match (true) {
            $available > 0 => 'available',
            $onLoan > 0 => 'on_loan',
            $held > 0 => 'held',
            $lost > 0 => 'lost',
            $hasRetired => 'retired',
            default => 'none',
        };
    }
}
