<?php

use App\Http\Requests\Circulation\ApproveBorrowRequestRequest;
use App\Http\Requests\Circulation\LendCopyRequest;
use App\Http\Requests\Circulation\QuickLendRegisterReaderRequest;
use App\Http\Requests\Circulation\ReceiveReturnRequest;
use App\Http\Requests\Circulation\RejectBorrowRequestRequest;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Task 10 review, Minor #2, carried into Task 11 and widened by Task 14:
 * every manage route the Form Requests in this file back is `role:manager`-gated (EnsureShelfRole 404s a
 * non-manager before any of these run), so today a FAILING authorize() here
 * is unreachable over HTTP — removing the abort_unless(..., 404) from BOTH
 * LendCopyRequest and QuickLendRegisterReaderRequest and running the whole
 * Circulation suite left all 137 tests green (verified, and restored). The
 * guards are defence in depth against a future middleware-ordering change,
 * not something QuickLendScreensTest's reader-404 matrix actually exercises
 * — that test only proves the ROUTE 404s, which the role middleware alone
 * already guarantees.
 *
 * These are unit tests of the FormRequest classes directly (no route, no
 * authenticated user, no route parameter bound), following the exact
 * pattern tests/Feature/Members/FormRequestAuthorize404Test.php already
 * established for the five Members requests: with nobody signed in, every
 * Gate check here denies for the least contrived reason, which is exactly
 * the "authorize() fails" branch this pins — the point is the STATUS CODE
 * that failure produces (404, never Laravel's default 403), independent of
 * whether routing ever changes.
 */
it('LendCopyRequest::authorize() 404s, not 403s, when denied', function () {
    $request = new LendCopyRequest;

    expect(fn () => $request->authorize())
        ->toThrow(NotFoundHttpException::class);
});

it('QuickLendRegisterReaderRequest::authorize() 404s, not 403s, when denied', function () {
    $request = new QuickLendRegisterReaderRequest;

    expect(fn () => $request->authorize())
        ->toThrow(NotFoundHttpException::class);
});

it('ReceiveReturnRequest::authorize() 404s, not 403s, when denied', function () {
    $request = new ReceiveReturnRequest;

    expect(fn () => $request->authorize())
        ->toThrow(NotFoundHttpException::class);
});

// Task 14's two, and the same argument applies to them: the manage group's
// role:manager 404s a non-manager before either class is constructed —
// measured for that task by deleting both abort_unless lines and re-running
// ManagerQueueScreenTest's reader block, which stayed green, then restoring
// them. These pin the STATUS the branch produces if it ever is reached.
it('ApproveBorrowRequestRequest::authorize() 404s, not 403s, when denied', function () {
    $request = new ApproveBorrowRequestRequest;

    expect(fn () => $request->authorize())
        ->toThrow(NotFoundHttpException::class);
});

it('RejectBorrowRequestRequest::authorize() 404s, not 403s, when denied', function () {
    $request = new RejectBorrowRequestRequest;

    expect(fn () => $request->authorize())
        ->toThrow(NotFoundHttpException::class);
});
