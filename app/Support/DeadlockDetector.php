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
