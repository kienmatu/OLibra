<?php

namespace App\Http\Controllers\Reader;

use App\Actions\Notifications\MarkNotificationRead;
use App\Http\Controllers\Controller;
use App\Models\Bookshelf;
use App\Models\Notification;
use App\Models\User;
use App\Queries\MyNotificationsQuery;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §15's bell, as a page: the reader's own notifications newest-first,
 * with the two ways to clear them. Both writes end in back(), which
 * follows the Referer — the same shape every other reader-side POST in
 * this phase uses, so the reader lands wherever they tapped from.
 */
class NotificationController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, MyNotificationsQuery $query): Response
    {
        /** @var User $user */
        $user = $request->user();

        return Inertia::render('shelves/profile/notifications', [
            'mine' => $query->run($user, 50),
        ]);
    }

    public function read(Request $request, Bookshelf $shelf, Notification $notification, MarkNotificationRead $mark): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $mark->one($user, $notification->id);

        return back();
    }

    public function readAll(Request $request, Bookshelf $shelf, MarkNotificationRead $mark): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $mark->all($user);

        return back();
    }
}
