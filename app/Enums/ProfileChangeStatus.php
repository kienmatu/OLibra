<?php

declare(strict_types=1);

namespace App\Enums;

enum ProfileChangeStatus: string
{
    case Pending = 'pending';
    case Approved = 'approved';
    case Rejected = 'rejected';
    case Cancelled = 'cancelled';
}
