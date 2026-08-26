<?php

it('never runs tests against the development database', function () {
    expect(config('database.default'))->toBe('mariadb')
        ->and(config('database.connections.mariadb.database'))->toBe('olibra_testing');
});

it('runs with the testing environment so csrf is bypassed', function () {
    expect(app()->environment())->toBe('testing')
        ->and(app()->runningUnitTests())->toBeTrue();
});

it('does not depend on redis or a daemon', function () {
    expect(config('cache.default'))->toBe('array')
        ->and(config('session.driver'))->toBe('array')
        ->and(config('queue.default'))->toBe('sync');
});

it('stores time as utc and speaks vietnamese', function () {
    expect(config('app.timezone'))->toBe('UTC')
        ->and(config('app.locale'))->toBe('vi');
});
