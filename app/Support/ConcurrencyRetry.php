<?php

namespace App\Support;

use App\Exceptions\RuleViolated;
use Illuminate\Container\Container;
use Illuminate\Contracts\Database\ConcurrencyErrorDetector as ConcurrencyErrorDetectorContract;
use Illuminate\Database\ConcurrencyErrorDetector;
use Throwable;

/**
 * The two halves of surviving a lock-order cycle: how many times a write
 * transaction is re-run, and what the caller is told when the last run
 * loses too.
 *
 * WHY THIS EXISTS. Phase 2a's divergence 1 is an AB–BA edge over
 * (a copy row, a request row) that cannot be ordered away inside one
 * transaction: the commands that assign or collect a hold take the copy
 * first and the request second, while `CancelOwnRequest` — when its
 * route-bound snapshot named no copy because an approval committed in the
 * gap — locks the request first and takes the copy's row lock second,
 * through its guarded `UPDATE ... WHERE state = 'held'`. InnoDB answers
 * such a cycle by killing one transaction with errno 1213. Nothing in this
 * system translated that, so it reached the manager as a server error.
 * The edge is not removed by anything here; what is removed is the crash.
 *
 * HOW THE RE-RUN WORKS, and it is the framework's, not ours:
 * `Connection::transaction($callback, $attempts)` runs the callback inside
 * a `for` loop, and its `handleTransactionException` returns (rather than
 * rethrowing) — after rolling the whole transaction back — exactly when
 * the concurrency detector matches AND attempts remain. A deadlocked
 * transaction has persisted nothing, so the re-run starts from the
 * committed state, re-takes its locks and re-reads its rows.
 *
 * ATTEMPTS = 3, because InnoDB resolves a cycle by killing exactly ONE
 * participant while the other commits, so a re-run can only lose again if
 * a fresh contender arrives inside the same milliseconds — which two
 * further runs make progressively less likely without letting a genuinely
 * wedged row hold a request open. No frequency is claimed for this edge
 * and none has been measured; the count is chosen for the shape of the
 * failure, not from a rate.
 *
 * THE RESIDUAL. When the attempts are spent, Laravel rethrows the original
 * exception, which is a 500. `translate()` turns it into the same shape
 * every other refusal in this system has — a RuleViolated whose code is a
 * `lang/vi/rules.php` key, which `bootstrap/app.php` renders as a redirect
 * back carrying the Vietnamese sentence.
 *
 * The DECISION FUNCTION is borrowed from `UniqueViolation`, and only that:
 * where that class matches errno 1062 by constraint name, this one asks
 * the container for the `ConcurrencyErrorDetector` contract — the SAME
 * object `Connection::transaction` consulted when it decided whether to
 * re-run — so the retry and the translation cannot disagree about what a
 * concurrency error is. `App\Support\DeadlockDetector` is what
 * AppServiceProvider binds there, and its docblock carries both the reason
 * a lock-wait timeout is excluded and the bound on what message matching
 * can be fooled by. What is NOT shared with `UniqueViolation` is
 * PLACEMENT: that class is called at the throw site, inside the Action's
 * own catch, and rethrows what it does not recognise; this one runs in the
 * global exception handler, is handed every driver exception in the
 * application, and RETURNS what it does not recognise for the handler to
 * go on with. There is no bare catch on either path — the detector decides.
 *
 * WHAT THIS COSTS, said out loud: the map that calls this runs inside the
 * exception handler, which maps before it reports as well as before it
 * renders, so the log line names this RuleViolated rather than the driver
 * exception. That is why the original is passed as `$previous` — an
 * exception captures its trace where it is CONSTRUCTED, so without the
 * chain the log would lose not only the SQL but the throwing Action's
 * frames, the trace beginning here inside the handler. Monolog's
 * LineFormatter walks the chain, so both come back.
 */
final class ConcurrencyRetry
{
    /** Passed as Connection::transaction's $attempts — see the class docblock. */
    public const ATTEMPTS = 3;

    /**
     * The RuleViolated a spent retry becomes, or the original exception
     * untouched when the detector says this was never a concurrency error.
     */
    public static function translate(Throwable $e): Throwable
    {
        return self::causedByConcurrencyError($e)
            ? new RuleViolated('busy_try_again', $e)
            : $e;
    }

    public static function causedByConcurrencyError(Throwable $e): bool
    {
        $container = Container::getInstance();

        $detector = $container->bound(ConcurrencyErrorDetectorContract::class)
            ? $container[ConcurrencyErrorDetectorContract::class]
            : new ConcurrencyErrorDetector;

        return $detector->causedByConcurrencyError($e);
    }
}
