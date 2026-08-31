<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Bookshelf;
use App\Queries\Admin\AdminOverviewQuery;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.4's Bookshelves screen — the list every later administration act
 * starts from. Replaces `ShellController::underConstruction` on
 * `/admin/shelves`; Tasks 4-6 add create, edit and archive beside it.
 *
 * **The cross-shelf read is `AdminOverviewQuery`'s, not this class's.**
 * The `/admin` group binds no tenant, so a scoped model read from here
 * would throw in `BookshelfScope`; widening is confined to
 * `app/Queries/Admin/` and `app/Actions/Admin/` by
 * `WideningArchitectureTest`, and a controller never widens for itself.
 * That query already carries every column this list needs, computed live,
 * so this screen shares the dashboard's row rather than growing a second
 * shelf listing that could quietly disagree with it about which shelves
 * exist.
 */
class ShelfController extends Controller
{
    public function index(AdminOverviewQuery $overview): Response
    {
        // Redundant with EnsureSuperAdmin today, and kept anyway: the
        // policy is what the per-shelf routes of Tasks 4-6 authorize
        // against, and a list that authorized nothing would be the one
        // screen in the group whose permission was implicit.
        Gate::authorize('viewAny', Bookshelf::class);

        return Inertia::render('admin/shelves/index', [
            'shelves' => $overview->run(),
        ]);
    }
}
