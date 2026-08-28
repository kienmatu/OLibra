<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Members\ApproveMembership;
use App\Actions\Members\RejectMembership;
use App\Http\Controllers\Controller;
use App\Http\Requests\Members\RejectMembershipRequest;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Queries\PendingRegistrationsQuery;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

class RegistrationQueueController extends Controller
{
    public function index(Bookshelf $shelf, PendingRegistrationsQuery $queue): Response
    {
        Gate::authorize('viewAny', Membership::class);

        return Inertia::render('manage/registrations/index', [
            'applications' => $queue->run(),
        ]);
    }

    public function approve(Request $request, Bookshelf $shelf, Membership $reader, ApproveMembership $approve): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $approve->execute($user, $reader);

        return redirect()->route('shelves.manage.registrations', ['shelf' => $shelf->slug]);
    }

    public function reject(RejectMembershipRequest $request, Bookshelf $shelf, Membership $reader, RejectMembership $rejectAction): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        /** @var array{reason: string} $validated */
        $validated = $request->validated();

        $rejectAction->execute($user, $reader, $validated['reason']);

        return redirect()->route('shelves.manage.registrations', ['shelf' => $shelf->slug]);
    }
}
