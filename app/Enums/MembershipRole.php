<?php

declare(strict_types=1);

namespace App\Enums;

enum MembershipRole: string
{
    case Reader = 'reader';
    case Manager = 'manager';
    case Admin = 'admin';
}
