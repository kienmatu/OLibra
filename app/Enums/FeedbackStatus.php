<?php

declare(strict_types=1);

namespace App\Enums;

enum FeedbackStatus: string
{
    case New = 'new';
    case Read = 'read';
    case Resolved = 'resolved';
}
