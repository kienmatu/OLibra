<?php

use Illuminate\Support\Facades\DB;

it('never runs tests against the development database', function () {
    // Asserts the LIVE connection, not just the config array: config/database.php
    // also sets 'url' => env('DB_URL'), and ConfigurationUrlParser::parseConfiguration()
    // merges a DB_URL's database/host/user OVER the array above at connect time.
    // A stray DB_URL would leave config('database.connections.mariadb.database')
    // reporting 'olibra_testing' correctly while the real connection went
    // somewhere else entirely — the exact silent-destruction mode this guard
    // exists to catch.
    expect(config('database.default'))->toBe('mariadb')
        ->and(config('database.connections.mariadb.database'))->toBe('olibra_testing')
        ->and(DB::connection()->getDatabaseName())->toBe('olibra_testing');
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
