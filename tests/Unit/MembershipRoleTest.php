<?php

use App\Enums\MembershipRole;

it('ranks admin over manager over reader', function () {
    expect(MembershipRole::Reader->rank())->toBe(1)
        ->and(MembershipRole::Manager->rank())->toBe(2)
        ->and(MembershipRole::Admin->rank())->toBe(3);
});

it('lets every role act as itself and everything below it', function () {
    expect(MembershipRole::Admin->atLeast(MembershipRole::Reader))->toBeTrue()
        ->and(MembershipRole::Admin->atLeast(MembershipRole::Manager))->toBeTrue()
        ->and(MembershipRole::Admin->atLeast(MembershipRole::Admin))->toBeTrue()
        ->and(MembershipRole::Manager->atLeast(MembershipRole::Reader))->toBeTrue()
        ->and(MembershipRole::Manager->atLeast(MembershipRole::Manager))->toBeTrue()
        ->and(MembershipRole::Manager->atLeast(MembershipRole::Admin))->toBeFalse()
        ->and(MembershipRole::Reader->atLeast(MembershipRole::Reader))->toBeTrue()
        ->and(MembershipRole::Reader->atLeast(MembershipRole::Manager))->toBeFalse()
        ->and(MembershipRole::Reader->atLeast(MembershipRole::Admin))->toBeFalse();
});
