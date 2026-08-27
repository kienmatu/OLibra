<?php

declare(strict_types=1);

namespace App\Enums;

enum CopyCondition: string
{
    case Perfect = 'perfect';
    case SlightlyWorn = 'slightly_worn';
    case Worn = 'worn';
    case Torn = 'torn';
    case MissingPages = 'missing_pages';
    case WrittenOn = 'written_on';
}
