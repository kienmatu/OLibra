<?php

use App\Http\Requests\Community\HideCommentRequest;
use App\Http\Requests\Community\RejectCommentRequest;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Task 4 fix round 1, following the pattern
 * tests/Feature/Members/FormRequestAuthorize404Test.php and
 * tests/Feature/Circulation/FormRequestAuthorize404Test.php each use:
 * these two Community Form Requests shipped with only a reading of
 * abort_unless(..., 404) to stand on, the same constraint Task 2
 * (StoreCommentRequest) got wrong once already.
 *
 * There is no route to either RejectComment or HideComment yet (a later
 * task's screen), so — exactly as the two files above argue — a
 * FAILING authorize() here is unreachable over HTTP today; these are
 * unit tests of the FormRequest classes directly (no route, no
 * authenticated user, no route parameter bound), with nobody signed in,
 * so every Gate check denies for the least contrived reason. The point
 * is the STATUS CODE that denial produces (404, never Laravel's default
 * 403 from a bare bool authorize()), independent of whether or when a
 * route arrives.
 */
it('RejectCommentRequest::authorize() 404s, not 403s, when denied', function () {
    $request = new RejectCommentRequest;

    expect(fn () => $request->authorize())
        ->toThrow(NotFoundHttpException::class);
});

it('HideCommentRequest::authorize() 404s, not 403s, when denied', function () {
    $request = new HideCommentRequest;

    expect(fn () => $request->authorize())
        ->toThrow(NotFoundHttpException::class);
});
