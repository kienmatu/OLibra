<?php

namespace App\Http\Controllers\Reader;

use App\Enums\MembershipRole;
use App\Http\Controllers\Controller;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Queries\BookDetailQuery;
use App\Support\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

class BookController extends Controller
{
    public function show(Request $request, Bookshelf $shelf, Book $book, BookDetailQuery $detail, TenantContext $context): Response
    {
        Gate::authorize('view', $book);

        // The binding resolves drafts (the manager route shares the model);
        // the READER page must not show one (BR §16.1's page filters
        // is_published). 404, not 403 — hidden means absent.
        abort_unless($book->is_published, 404);

        // BR §16.1 (narrowed 2026-08-12): the contact line is shown to
        // readers only — a manager reading this page is the person being
        // named. Role from the bound membership; a memberless super admin
        // counts as manager-or-above here for the same reason.
        $role = $context->membership()?->role;
        $isManagerOrAbove = ($role !== null && $role->atLeast(MembershipRole::Manager))
            || $context->membership() === null;   // memberless viewer who passed role:reader = super admin
        $firstContact = null;

        if (! $isManagerOrAbove) {
            $contact = $shelf->contacts()->where('position', 1)->first();

            if ($contact !== null && $contact->phone !== null) {
                $firstContact = ['name' => $contact->name, 'phone' => $contact->phone];
            }
        }

        // The viewer is passed explicitly (not read from Auth inside the
        // query) so myRequest is scoped to whoever is reading. This route
        // is in the `auth` group, so $request->user() is non-null here;
        // the query's parameter is nullable for callers that have no
        // viewer at all.
        return Inertia::render('shelves/book', [
            'detail' => $detail->run($book, $request->user()),
            'firstContact' => $firstContact,
        ]);
    }
}
