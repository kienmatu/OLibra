<?php

use App\Support\Catalogue\Availability;

it('walks BR §8\'s ladder: available, on_loan, held, lost, retired, none', function () {
    expect(Availability::derive(1, 2, 1, 1, true))->toBe('available')
        ->and(Availability::derive(0, 2, 1, 1, true))->toBe('on_loan')
        ->and(Availability::derive(0, 0, 1, 1, true))->toBe('held')
        ->and(Availability::derive(0, 0, 0, 1, true))->toBe('lost')
        ->and(Availability::derive(0, 0, 0, 0, true))->toBe('retired');
});

it('M8: zero live copies is none, not retired', function () {
    expect(Availability::derive(0, 0, 0, 0, false))->toBe('none');
});
