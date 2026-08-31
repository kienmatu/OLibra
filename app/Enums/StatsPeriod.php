<?php

namespace App\Enums;

/**
 * OPS §3.3's GetStatistics takes `period` as one of exactly these four
 * (opened: "`bookshelfId`, `period` (`week` | `month` | `year` | `all`)").
 * A backed enum rather than a validated string so an unknown period is a
 * type error at the controller boundary rather than a silent full-history
 * read — the `all` case is the expensive one and must be asked for by name.
 */
enum StatsPeriod: string
{
    case Week = 'week';
    case Month = 'month';
    case Year = 'year';
    case All = 'all';
}
