<?php

use App\Exceptions\RuleViolated;
use App\Support\ConcurrencyRetry;
use App\Support\DeadlockDetector;
use Illuminate\Contracts\Database\ConcurrencyErrorDetector;
use Illuminate\Database\Connection;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

/**
 * The two halves of divergence 1's fix, pinned where they can be shown
 * failing: that Laravel's $attempts argument really re-runs the callback,
 * and that a run which loses anyway ends as a Vietnamese sentence instead
 * of a 500.
 *
 * The edge itself is NOT reproduced here and this file makes no claim to
 * reproduce it. A real InnoDB 1213 needs two OS processes holding two
 * transactions open across each other's locks; this suite has one process
 * and RefreshDatabase holding an outer transaction. What is exercised
 * instead is everything downstream of the engine's verdict — the retry
 * loop, the detector's decision, and the translation — against the exact
 * exception shape the MariaDB driver raises for errno 1213.
 */

// Grep first: `grep -rn "^function crBuild" tests/` — top-level helpers are
// process-global (AGENTS.md). Built the way the driver builds one, not by
// subclassing: PDOException::$errorInfo is what QueryException copies, and
// QueryException's own message is the previous exception's with the
// connection and SQL appended — which is the string Laravel's
// ConcurrencyErrorDetector actually matches on.
function crBuild(string $sqlstate, int $errno, string $message): QueryException
{
    $pdo = new PDOException($message, 0);
    $pdo->errorInfo = [$sqlstate, $errno, $message];

    return new QueryException('mariadb', 'update book_copies set state = ?', ['available'], $pdo);
}

function crDeadlock(): QueryException
{
    return crBuild('40001', 1213, 'SQLSTATE[40001]: Serialization failure: 1213 Deadlock found when trying to get lock; try restarting transaction');
}

function crDuplicate(): QueryException
{
    return crBuild('23000', 1062, "SQLSTATE[23000]: Integrity constraint violation: 1062 Duplicate entry 'lan' for key 'users_username_key'");
}

function crLockWait(): QueryException
{
    return crBuild('HY000', 1205, 'SQLSTATE[HY000]: General error: 1205 Lock wait timeout exceeded; try restarting transaction');
}

/**
 * A connection of this suite's own, so the retry loop is entered at
 * transaction depth ZERO. It has to be: Laravel's handleTransactionException
 * throws a bare DeadlockException instead of retrying whenever
 * $this->transactions > 1, and RefreshDatabase holds an outer transaction on
 * the DEFAULT connection for every test in this directory — so a retry test
 * written against DB::transaction() would measure the nested branch and
 * conclude, wrongly, that the attempts argument does nothing. Same database,
 * same schema, its own PDO handle and its own transaction counter. The
 * callbacks below write nothing, so nothing is left behind to clean up.
 */
function crProbe(): Connection
{
    config(['database.connections.retry_probe' => config('database.connections.'.config('database.default'))]);

    return DB::connection('retry_probe');
}

afterEach(function () {
    DB::purge('retry_probe');
});

it('re-runs the callback when the concurrency detector matches — the mechanism the fix rests on', function () {
    $runs = 0;

    $result = crProbe()->transaction(function () use (&$runs): string {
        $runs++;
        if ($runs === 1) {
            throw crDeadlock();
        }

        return 'committed';
    }, ConcurrencyRetry::ATTEMPTS);

    expect($runs)->toBe(2)->and($result)->toBe('committed');
});

it('does not re-run the callback for a failure the detector rejects — the detector decides, not a bare catch', function () {
    // The half that makes the retry safe. If the loop retried on any
    // Throwable, a duplicate-key refusal or a bug in a command would be run
    // three times before surfacing, and every audit row and notification
    // written before the failing statement would be attempted three times
    // over. It runs once and the original exception comes straight back.
    // NOT `expect(fn () => …)`: an arrow function captures by VALUE, so a
    // `use (&$runs)` inside one binds a reference to the arrow's own copy
    // and the counter this method reads never moves. Measured — the first
    // version of this test read 0 where the callback had run once.
    $runs = 0;
    $caught = null;

    try {
        crProbe()->transaction(function () use (&$runs): void {
            $runs++;
            throw crDuplicate();
        }, ConcurrencyRetry::ATTEMPTS);
    } catch (Throwable $e) {
        $caught = $e;
    }

    expect($runs)->toBe(1)
        ->and($caught)->toBeInstanceOf(QueryException::class);
});

it('turns a spent deadlock into the Vietnamese refusal rather than a 500', function () {
    // The residual, end to end through the real handler: bootstrap/app.php
    // maps the driver's exception to a RuleViolated and the existing
    // RuleViolated hook renders it as the redirect back with the sentence.
    // This is what a manager sees when three attempts have all lost.
    Route::middleware('web')->post('/_test/deadlock', function () {
        throw crDeadlock();
    });

    $response = $this->from('/shelves')->post('/_test/deadlock');

    $response->assertRedirect('/shelves');
    $response->assertSessionHasErrors(['rule' => 'Có thao tác khác đang xử lý cùng lúc, vui lòng thử lại.']);
});

it('leaves an ordinary SQL failure as a 500 — the detector is what decides', function () {
    // The mapping is registered against PDOException, so EVERY driver
    // error passes through it. This is the pin that it passes them through
    // rather than swallowing them: a 1062 that no UniqueViolation map
    // claimed is still a server error with its statement in the log.
    //
    // The title says what is measured and not more. An earlier version
    // claimed "no refusal is manufactured from a real fault", which is
    // falsifiable: QueryException::formatMessage inlines BINDINGS into the
    // message, and the detector's message half is a substring match over
    // it, so a row whose own data spells a deadlock phrase can still be
    // translated. DeadlockDetector's docblock carries that bound and the
    // measurement behind it.
    Route::middleware('web')->post('/_test/duplicate', function () {
        throw crDuplicate();
    });

    $response = $this->from('/shelves')->post('/_test/duplicate');

    $response->assertStatus(500);
});

it('translates a deadlock, and carries the driver exception with it', function () {
    // The chain is the whole point of passing $previous. A mapped exception
    // captures its trace where it is CONSTRUCTED — inside the exception
    // handler — so without this the log would name the RuleViolated code
    // and nothing else: not the SQL, and not the Action whose transaction
    // lost. Monolog's LineFormatter walks getPrevious(), so both come back.
    $original = crDeadlock();
    $translated = ConcurrencyRetry::translate($original);

    expect($translated)->toBeInstanceOf(RuleViolated::class)
        ->and($translated->getPrevious())->toBe($original);
});

it('hands back the original exception, the same object, for anything else', function () {
    $original = crDuplicate();

    expect(ConcurrencyRetry::translate($original))->toBe($original);
});

it('does not retry a lock-wait timeout — a burned 50-second wait is not worth three of', function () {
    // 1205, not 1213. Laravel's own ConcurrencyErrorDetector matches
    // 'Lock wait timeout exceeded; try restarting transaction' alongside
    // the deadlock strings, and Connection::transaction consults the same
    // detector — so leaving the framework's detector in place would have
    // meant retrying a failure that only arrives after the whole timeout is
    // spent. This project's MariaDB was measured at
    // innodb_lock_wait_timeout = 50, so three attempts would bind a wedged
    // row at roughly 150 seconds of held request. AppServiceProvider binds
    // App\Support\DeadlockDetector over the contract to prevent exactly
    // that; this is the pin that the binding reaches the RETRY LOOP and not
    // merely the translation.
    $runs = 0;
    $caught = null;

    try {
        crProbe()->transaction(function () use (&$runs): void {
            $runs++;
            throw crLockWait();
        }, ConcurrencyRetry::ATTEMPTS);
    } catch (Throwable $e) {
        $caught = $e;
    }

    expect($runs)->toBe(1)
        ->and($caught)->toBeInstanceOf(QueryException::class);
});

it('does not translate a lock-wait timeout either — it stays a loud 500', function () {
    // The other half of the same binding, and it must be able to fail
    // separately: a lock-wait timeout that was left un-retried but still
    // dressed as "vui lòng thử lại" would be the worst of both — no retry
    // for the caller, no SQL for the operator.
    Route::middleware('web')->post('/_test/lock-wait', function () {
        throw crLockWait();
    });

    expect($this->from('/shelves')->post('/_test/lock-wait')->status())->toBe(500);
});

it('binds this application\'s own detector over the framework\'s', function () {
    // The resolution path the two tests above depend on, asserted directly
    // rather than inferred from their behaviour: Laravel's
    // DetectsConcurrencyErrors trait resolves this CONTRACT from the
    // container and falls back to its own class only when nothing is
    // bound, so this binding is what makes the retry loop and the
    // translation ask one question instead of two.
    expect(app(ConcurrencyErrorDetector::class))->toBeInstanceOf(DeadlockDetector::class);
});
