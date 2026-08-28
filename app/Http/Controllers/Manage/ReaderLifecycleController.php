<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Members\MarkMembershipLeft;
use App\Actions\Members\ReactivateMembership;
use App\Actions\Members\SetReaderCredentials;
use App\Actions\Members\SuspendMembership;
use App\Http\Controllers\Controller;
use App\Http\Requests\Members\SetReaderCredentialsRequest;
use App\Http\Requests\Members\SuspendMembershipRequest;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * The reader detail's administrative actions — each one Action, one
 * redirect back to the detail (the reference's backToReader).
 *
 * reactivate/markLeft take a plain Request rather than a dedicated Form
 * Request: neither carries a request body to validate, and each Action
 * calls Gate::forUser($actor)->authorize(...) itself, under its own lock
 * — the same act-as-manager check the route's `role:manager` middleware
 * already applies ahead of every action here (EnsureShelfRole 404s a
 * refusal per BR §5.4; that upstream 404 is what a non-manager or a
 * foreign shelf's manager actually gets, never a 403 from this class).
 */
class ReaderLifecycleController extends Controller
{
    public function setCredentials(SetReaderCredentialsRequest $request, Bookshelf $shelf, Membership $reader, SetReaderCredentials $set): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        /** @var array{username: string, password: string} $validated */
        $validated = $request->validated();

        $set->execute($user, $reader, $validated['username'], $validated['password']);

        return $this->backToReader($shelf, $reader);
    }

    public function suspend(SuspendMembershipRequest $request, Bookshelf $shelf, Membership $reader, SuspendMembership $suspend): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        /** @var array{reason: string} $validated */
        $validated = $request->validated();

        $suspend->execute($user, $reader, $validated['reason']);

        return $this->backToReader($shelf, $reader);
    }

    public function reactivate(Request $request, Bookshelf $shelf, Membership $reader, ReactivateMembership $reactivate): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $reactivate->execute($user, $reader);

        return $this->backToReader($shelf, $reader);
    }

    public function markLeft(Request $request, Bookshelf $shelf, Membership $reader, MarkMembershipLeft $markLeft): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $markLeft->execute($user, $reader);

        return $this->backToReader($shelf, $reader);
    }

    private function backToReader(Bookshelf $shelf, Membership $reader): RedirectResponse
    {
        return redirect()->route('shelves.manage.readers.show', [
            'shelf' => $shelf->slug, 'reader' => $reader->id,
        ]);
    }
}
