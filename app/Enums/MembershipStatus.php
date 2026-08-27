<?php

declare(strict_types=1);

namespace App\Enums;

enum MembershipStatus: string
{
    case Pending = 'pending';
    case Active = 'active';
    case Suspended = 'suspended';
    case Left = 'left';
    case Rejected = 'rejected';
}
