<?php

declare(strict_types=1);

namespace App\Enums;

enum DonationStatus: string
{
    case Pending = 'pending';
    case Received = 'received';
    case Declined = 'declined';
}
