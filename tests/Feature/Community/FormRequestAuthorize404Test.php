<?php

use App\Http\Requests\Community\HideCommentRequest;
use App\Http\Requests\Community\RejectCommentRequest;
use App\Http\Requests\Community\StoreAnnouncementRequest;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Task 4 fix round 1, following the pattern
 * tests/Feature/Members/FormRequestAuthorize404Test.php and
 * tests/Feature/Circulation/FormRequestAuthorize404Test.php each use:
 * these two Community Form Requests shipped with only a reading of
 * abort_unless(..., 404) to stand on, the same constraint Task 2
 * (StoreCommentRequest) got wrong once already.
 *
 * UPDATED IN TASK 8, which gave both classes a route
 * (/manage/comments/{comment}/reject and .../hide). The conclusion is
 * unchanged and the reason for it is not: this used to say a failing
 * authorize() was unreachable over HTTP because no route existed, and now
 * a route does. It is still unreachable, because those routes sit inside
 * the manage group's role:manager and EnsureShelfRole answers first —
 * measured in that task by deleting both abort_unless lines and re-running
 * ManagerModerationScreenTest's four reader blocks, which stayed green,
 * then restoring them. So these stay what they were: unit tests of the
 * FormRequest classes directly (no route, no authenticated user, no route
 * parameter bound), with nobody signed in, so every Gate check denies for
 * the least contrived reason. The point is the STATUS CODE that denial
 * produces (404, never Laravel's default 403 from a bare bool
 * authorize()), which is what the backstop is for if the middleware ever
 * comes off.
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

it('StoreAnnouncementRequest::authorize() 404s, not 403s, when denied', function () {
    // Task 9. Added the moment the class landed rather than the day it
    // gets a route: with nobody signed in, act-as-manager denies, and
    // what this pins is the STATUS that denial produces. The two blocks
    // above shipped routeless too and this is the same unit shape — no
    // route, no authenticated user, no route parameter bound.
    $request = new StoreAnnouncementRequest;

    expect(fn () => $request->authorize())
        ->toThrow(NotFoundHttpException::class);
});
