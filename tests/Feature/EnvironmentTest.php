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

it('defaults the session driver to hashed-database, never the plaintext database driver, when SESSION_DRIVER is unset', function () {
    // This suite always runs with SESSION_DRIVER=array (phpunit.xml, and
    // the assertion above) — that test can never see config/session.php's
    // own fallback. Found in review: that fallback was still 'database',
    // so a host with a missing SESSION_DRIVER env var would silently
    // restore the exact plaintext-session-id leak Task 16 exists to close.
    // Reads config/session.php's own default directly, with every layer
    // PHPUnit's <env>/<server> blocks populate (env(), $_ENV, $_SERVER —
    // see phpunit.xml's own comment on why all three matter) cleared for
    // SESSION_DRIVER specifically, then restored.
    $original = [
        'getenv' => getenv('SESSION_DRIVER'),
        'ENV' => $_ENV['SESSION_DRIVER'] ?? null,
        'SERVER' => $_SERVER['SESSION_DRIVER'] ?? null,
    ];

    putenv('SESSION_DRIVER');
    unset($_ENV['SESSION_DRIVER'], $_SERVER['SESSION_DRIVER']);

    try {
        $sessionConfig = require config_path('session.php');

        expect($sessionConfig['driver'])->toBe('hashed-database');
    } finally {
        if ($original['getenv'] !== false) {
            putenv("SESSION_DRIVER={$original['getenv']}");
        }
        if ($original['ENV'] !== null) {
            $_ENV['SESSION_DRIVER'] = $original['ENV'];
        }
        if ($original['SERVER'] !== null) {
            $_SERVER['SESSION_DRIVER'] = $original['SERVER'];
        }
    }
});
