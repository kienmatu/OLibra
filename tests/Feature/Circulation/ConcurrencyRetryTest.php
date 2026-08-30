<?php

use App\Exceptions\RuleViolated;
use App\Support\ConcurrencyRetry;
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

it('leaves an ordinary SQL failure alone — no refusal is manufactured from a real fault', function () {
    // The mapping is registered against PDOException, so EVERY driver
    // error passes through it. This is the pin that it passes them through
    // rather than swallowing them: a 1062 that no UniqueViolation map
    // claimed is still a server error, not a friendly "try again" hiding a
    // broken constraint.
    Route::middleware('web')->post('/_test/duplicate', function () {
        throw crDuplicate();
    });

    $response = $this->from('/shelves')->post('/_test/duplicate');

    $response->assertStatus(500);
});

it('translates only what the detector calls a concurrency error', function () {
    expect(ConcurrencyRetry::translate(crDeadlock()))->toBeInstanceOf(RuleViolated::class);
});

it('hands back the original exception, the same object, for anything else', function () {
    $original = crDuplicate();

    expect(ConcurrencyRetry::translate($original))->toBe($original);
});
