<?php

namespace App\Support;

use Illuminate\Contracts\Database\ConcurrencyErrorDetector;
use Illuminate\Support\Str;
use PDOException;
use Throwable;

/**
 * This application's answer to "is this failure worth running the whole
 * transaction again?" — deliberately NARROWER than Laravel's own
 * `Illuminate\Database\ConcurrencyErrorDetector`, and bound over it in
 * AppServiceProvider so that ONE object answers the question everywhere.
 *
 * WHY IT IS NARROWER. Laravel's list matches a lock-wait timeout
 * ('Lock wait timeout exceeded; try restarting transaction', errno 1205)
 * alongside the deadlock strings, and `Connection::transaction` consults
 * that same detector to decide whether to re-run the callback. The two
 * failures do not deserve the same treatment:
 *
 *   - A DEADLOCK fails INSTANTLY. InnoDB detects the cycle, kills one
 *     participant, and hands it back a rolled-back transaction in the time
 *     it takes to walk the wait-for graph. Re-running is nearly free, and
 *     the other participant has by then committed, so the re-run usually
 *     succeeds. This is exactly divergence 1's edge.
 *   - A LOCK-WAIT TIMEOUT fails only after the whole timeout is BURNED.
 *     This project's own MariaDB image was measured at
 *     `innodb_lock_wait_timeout = 50` (the engine default), so retrying it
 *     three times would hold a request open for something like 150
 *     seconds — on a shared-hosting target where the PHP or proxy limit
 *     kills it first, and where the honest answer is that a row is wedged
 *     and an operator should be told which one. Retrying it converts a
 *     loud, diagnosable 500 into a long wait and a shrug.
 *
 * So a 1205 is left alone: not retried, not translated, still a 500 with
 * its SQL in the log. Narrowing HERE rather than by directory is
 * deliberate — scoping the rule to the commands currently believed to sit
 * on the cycle is the mistake the property-not-a-list rule exists to
 * prevent. This narrows by ERROR CLASS, which is the axis the difference
 * actually lies on, and because `DetectsConcurrencyErrors` resolves the
 * contract from the container, one binding moves the retry loop and the
 * translation together.
 *
 * WHAT IT MATCHES. SQLSTATE 40001 is the serialization-failure class, and
 * it is where InnoDB puts errno 1213; 1205's SQLSTATE is HY000, so the
 * class check alone already separates them. The message list is the
 * deadlock family only, kept because Laravel raises a bare
 * `DeadlockException` for a nested transaction and that exception carries
 * no errorInfo to read a SQLSTATE off. The SQLite and "record has changed"
 * entries in the framework's list are dropped: this application talks to
 * MariaDB, and a matcher that claims engines it never runs against is a
 * matcher nobody can check.
 *
 * WHAT ELSE THIS BINDING REACHES, because it is bound APPLICATION-WIDE and
 * the transaction retry loop is not its only consumer.
 * `Illuminate\Cache\DatabaseLock` uses the same
 * `DetectsConcurrencyErrors` trait to decide whether a failure against the
 * `cache_locks` table is HARMLESS — someone else already deleted the row —
 * or a real error to propagate. `CACHE_STORE=database` here and
 * `DatabaseStore` is a `LockProvider`, so that is the live path, and
 * `routes/console.php` puts `withoutOverlapping(2)` on the per-minute
 * `queue:work` tick. Read at this commit, the two consumption sites and
 * the direction of the change:
 *
 *   - `DatabaseLock::release()` catches everything and RETURNS TRUE — the
 *     lock counts as released — when the detector matches, otherwise
 *     rethrows. Before this binding a 1205 there was swallowed; now it
 *     propagates.
 *   - `DatabaseLock::pruneExpiredLocks()` swallows a match and rethrows
 *     anything else. Same flip, but it runs only under `acquire()`'s
 *     lottery (`[2, 100]` for this store), not on every acquire.
 *
 * A DEADLOCK on `cache_locks` is still swallowed at both sites — this
 * detector matches 1213 — so the flip is precisely and only about a
 * lock-wait timeout on that one table, which would itself mean something
 * held a `cache_locks` row for the whole timeout while only short
 * single-row statements ever touch it.
 *
 * PRECISION the obvious reading misses, and the reason this paragraph is
 * longer than "release() is affected": the scheduler's TEARDOWN does not
 * go through `release()` at all — `Event::removeMutex` calls
 * `CacheEventMutex::forget`, which calls `forceRelease()`, and that method
 * has no try/catch and consults no detector, so it propagated a 1205
 * before this binding and still does. What puts `release()` on the
 * per-minute path is the SKIP FILTER: `withoutOverlapping` registers
 * `skip(fn () => $this->mutex->exists($this))`, `exists()` calls
 * `$store->lock(...)->get(fn () => true)`, and `Lock::get` releases in a
 * `finally` after acquiring. Someone tracing `forget()` would conclude
 * this binding cannot reach the scheduler; it reaches it through `exists`.
 *
 * WHAT IT COSTS. A scheduled run can now fail where it used to continue.
 * The failure lands after `acquire()` has already written the mutex row,
 * so the row survives with its `withoutOverlapping(2)` expiry and the next
 * ticks are SKIPPED until it lapses — about two minutes of queue left
 * undrained, then self-healing (that two-minute expiry is this project's
 * own deliberate choice over the framework's 24-hour default; see
 * `routes/console.php`). Judged the right trade: a lock-wait timeout on
 * `cache_locks` should be loud. Stated plainly rather than left latent —
 * **no test exercises this path in either direction**, because
 * `phpunit.xml` forces `CACHE_STORE=array` and the array store's lock
 * never touches a database.
 *
 * KNOWN BOUND, because "never" is the word this docblock must not use.
 * `QueryException::formatMessage` inlines BINDINGS into the message it
 * builds, and the message half of this test is a substring match over that
 * string. A row whose own data contains one of the phrases below — a book
 * title, a note — could therefore make an unrelated failure on that row
 * look like a deadlock. Measured, not theorised: a genuine 1062 whose
 * binding value was the literal phrase came back translated. Narrowing the
 * list shrinks the surface; it does not close it. The SQLSTATE branch
 * above is immune, and for this application's data the residue is not
 * worth a bindings-blind matcher that would have to re-implement the
 * driver's formatting to be sure.
 */
final class DeadlockDetector implements ConcurrencyErrorDetector
{
    public function causedByConcurrencyError(Throwable $e): bool
    {
        if ($e instanceof PDOException) {
            if ($e->getCode() === 40001 || $e->getCode() === '40001') {
                return true;
            }
            if (is_array($e->errorInfo) && ($e->errorInfo[0] ?? null) === '40001') {
                return true;
            }
        }

        return Str::contains($e->getMessage(), [
            'Deadlock found when trying to get lock',
            'deadlock detected',
            'WSREP detected deadlock/conflict and aborted the transaction. Try restarting the transaction',
        ]);
    }
}
