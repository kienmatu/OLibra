<?php

declare(strict_types=1);

namespace App\Enums;

enum CopyState: string
{
    case Available = 'available';
    case Held = 'held';
    case OnLoan = 'on_loan';
    case Lost = 'lost';
    case Retired = 'retired';
}
