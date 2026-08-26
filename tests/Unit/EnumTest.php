<?php

declare(strict_types=1);

use App\Enums\BookshelfStatus;
use App\Enums\CommentStatus;
use App\Enums\CopyCondition;
use App\Enums\CopyState;
use App\Enums\DonationStatus;
use App\Enums\FeedbackStatus;
use App\Enums\LoanStatus;
use App\Enums\MembershipRole;
use App\Enums\MembershipStatus;
use App\Enums\ProfileChangeStatus;
use App\Enums\RequestStatus;
use BackedEnum;

/** @param class-string<BackedEnum> $enum */
function enumValues(string $enum): array
{
    return array_map(fn (BackedEnum $case) => $case->value, $enum::cases());
}

// Each list is the Postgres `create type ... as enum` label list, verbatim
// and in order, from src/db/migrations/. Order matters: Task 6-10 CHECK
// constraints and Task 13's DbGuarantees copy these strings.
it('carries the exact label sets the postgres schema defined', function () {
    expect(enumValues(BookshelfStatus::class))->toBe(['active', 'archived'])
        ->and(enumValues(MembershipRole::class))->toBe(['reader', 'manager', 'admin'])
        ->and(enumValues(MembershipStatus::class))->toBe(['pending', 'active', 'suspended', 'left', 'rejected'])
        ->and(enumValues(CopyState::class))->toBe(['available', 'held', 'on_loan', 'lost', 'retired'])
        ->and(enumValues(CopyCondition::class))->toBe(['perfect', 'slightly_worn', 'worn', 'torn', 'missing_pages', 'written_on'])
        ->and(enumValues(LoanStatus::class))->toBe(['active', 'returned', 'lost', 'voided'])
        ->and(enumValues(RequestStatus::class))->toBe(['pending', 'approved', 'rejected', 'fulfilled', 'expired', 'cancelled'])
        ->and(enumValues(CommentStatus::class))->toBe(['pending', 'approved', 'rejected', 'hidden'])
        ->and(enumValues(FeedbackStatus::class))->toBe(['new', 'read', 'resolved'])
        ->and(enumValues(DonationStatus::class))->toBe(['pending', 'received', 'declined'])
        ->and(enumValues(ProfileChangeStatus::class))->toBe(['pending', 'approved', 'rejected', 'cancelled']);
});

it('fits every label in the varchar(20) the schema allots', function () {
    foreach ([
        BookshelfStatus::class, MembershipRole::class, MembershipStatus::class,
        CopyState::class, CopyCondition::class, LoanStatus::class,
        RequestStatus::class, CommentStatus::class, FeedbackStatus::class,
        DonationStatus::class, ProfileChangeStatus::class,
    ] as $enum) {
        foreach (enumValues($enum) as $value) {
            expect(strlen($value))->toBeLessThanOrEqual(20);
        }
    }
});
