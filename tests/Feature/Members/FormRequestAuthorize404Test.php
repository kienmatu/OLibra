<?php

use App\Http\Requests\Members\RegisterReaderOnBehalfRequest;
use App\Http\Requests\Members\RejectMembershipRequest;
use App\Http\Requests\Members\SetReaderCredentialsRequest;
use App\Http\Requests\Members\SuspendMembershipRequest;
use App\Http\Requests\Members\UpdateReaderProfileRequest;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Fix round, Minor #4 (the review's "six authorize() methods would 403 if
 * ever reached"): every manage route is `role:manager`-gated
 * (EnsureShelfRole 404s a non-manager before any of these run), so a
 * FAILING authorize() here is unreachable over HTTP today — these are unit
 * tests of the FormRequest classes directly, exercising the branch that
 * middleware ordering currently makes dead code, not a route.
 *
 * Before the fix, each of these returned `false` from Gate::allows(),
 * which Laravel's default FormRequest::failedAuthorization() renders as
 * 403 — breaking BR §5.4's anti-enumeration rule (EnsureShelfRole's own
 * docblock names the exact hazard: `Gate::authorize()`/a bare bool 403s,
 * `abort(404)` does not) the moment routing changes and this branch stops
 * being dead. `abort_unless(..., 404)` makes the failure 404 explicitly,
 * independent of routing.
 *
 * No route or authenticated manager is wired for any of these: with no
 * user signed in and no route parameter bound, every Gate check here
 * denies for the least contrived reason (a Policy method typed
 * `User $user` never matches a guest), which is exactly the "authorize()
 * fails" branch under test — the point is the STATUS CODE that failure
 * produces, not which business rule triggered it.
 */
it('RegisterReaderOnBehalfRequest::authorize() 404s, not 403s, when denied', function () {
    $request = new RegisterReaderOnBehalfRequest;

    expect(fn () => $request->authorize())
        ->toThrow(NotFoundHttpException::class);
});

it('RejectMembershipRequest::authorize() 404s, not 403s, when denied', function () {
    $request = new RejectMembershipRequest;

    expect(fn () => $request->authorize())
        ->toThrow(NotFoundHttpException::class);
});

it('SetReaderCredentialsRequest::authorize() 404s, not 403s, when denied', function () {
    $request = new SetReaderCredentialsRequest;

    expect(fn () => $request->authorize())
        ->toThrow(NotFoundHttpException::class);
});

it('SuspendMembershipRequest::authorize() 404s, not 403s, when denied', function () {
    $request = new SuspendMembershipRequest;

    expect(fn () => $request->authorize())
        ->toThrow(NotFoundHttpException::class);
});

it('UpdateReaderProfileRequest::authorize() 404s, not 403s, when denied', function () {
    $request = new UpdateReaderProfileRequest;

    expect(fn () => $request->authorize())
        ->toThrow(NotFoundHttpException::class);
});
