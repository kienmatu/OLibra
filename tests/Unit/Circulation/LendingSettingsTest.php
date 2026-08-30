<?php

use App\Models\Bookshelf;
use App\Support\Circulation\LendingSettings;

it('BR §5.5 defaults: 14 / 3 / 1 / 7 off an empty settings blob', function () {
    $shelf = new Bookshelf(['settings' => []]);
    $s = LendingSettings::fromShelf($shelf);

    expect($s->loanDays)->toBe(14)
        ->and($s->maxConcurrentLoans)->toBe(3)
        ->and($s->maxRenewals)->toBe(1)
        ->and($s->renewalDays)->toBe(7);
});

it('a shelf overrides only what it stores', function () {
    $shelf = new Bookshelf(['settings' => ['loan_days' => 21, 'max_renewals' => 2]]);
    $s = LendingSettings::fromShelf($shelf);

    expect($s->loanDays)->toBe(21)
        ->and($s->maxConcurrentLoans)->toBe(3)
        ->and($s->maxRenewals)->toBe(2)
        ->and($s->renewalDays)->toBe(7);
});

it('hold_days and due_soon_days default to 3 and read from the blob', function () {
    $bare = LendingSettings::fromShelf(new Bookshelf(['settings' => []]));
    $set = LendingSettings::fromShelf(new Bookshelf([
        'settings' => ['hold_days' => 5, 'due_soon_days' => 7],
    ]));

    expect($bare->holdDays)->toBe(3)
        ->and($bare->dueSoonDays)->toBe(3)
        ->and($set->holdDays)->toBe(5)
        ->and($set->dueSoonDays)->toBe(7);
});
