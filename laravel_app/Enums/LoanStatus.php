<?php

declare(strict_types=1);

namespace App\Enums;

enum LoanStatus: string
{
    case Active = 'active';
    case Returned = 'returned';
    case Lost = 'lost';
    case Voided = 'voided';
}
