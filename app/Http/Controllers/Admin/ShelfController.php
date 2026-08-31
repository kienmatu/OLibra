<?php

namespace App\Http\Controllers\Admin;

use App\Actions\Admin\CreateBookshelf;
use App\Actions\Admin\UpdateBookshelfProfile;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\StoreBookshelfRequest;
use App\Http\Requests\Admin\UpdateBookshelfProfileRequest;
use App\Models\Bookshelf;
use App\Models\User;
use App\Queries\Admin\AdminOverviewQuery;
use Illuminate\Http\RedirectResponse;
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
 *
 * **The writes are Actions', not this class's either** (spec D0, Task 4).
 * `store` and `update` hand a validated bag to a command in
 * `app/Actions/Admin/` and do nothing else: the audit configurator that
 * lets a tenant-less request write an audit row is fenced to that
 * directory by `WideningArchitectureTest`, so a controller that wrote the
 * row itself could not survive the suite. What is left here is the three
 * things a controller is for — which component renders, which route a
 * redirect lands on, and which sentence flashes.
 *
 * **`edit` builds its prop by hand rather than serialising the model.**
 * `Bookshelf` carries four generated columns, and handing the whole
 * attribute bag to Inertia would put `slug_active` and the three folded
 * columns on the wire — search-fold artefacts a form has no use for, in a
 * prop shape that would silently grow the day a migration adds a fifth.
 * The named list below is also the form's contract: exactly the fields the
 * profile form may edit, plus the slug it renders read-only.
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

    /**
     * The compose screen. Its own component rather than the edit form
     * handed a null row — the shape manage/announcements/form.tsx uses —
     * because the two screens differ by more than a heading here: this one
     * asks for a slug and the edit one refuses to, which is spec D1's whole
     * subject. One component doing both would be one component whose most
     * important field is conditional.
     */
    public function create(): Response
    {
        Gate::authorize('create', Bookshelf::class);

        return Inertia::render('admin/shelves/create');
    }

    public function store(StoreBookshelfRequest $request, CreateBookshelf $create): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $validated = $request->validated();

        $shelf = $create->execute($user, [
            'name' => $validated['name'],
            'slug' => $validated['slug'],
            'location' => $validated['location'] ?? null,
            'address' => $validated['address'] ?? null,
            'description' => $validated['description'] ?? null,
            'established_on' => $validated['established_on'] ?? null,
        ]);

        // Onto the new shelf's own editor, not back to the list: a shelf
        // created here has no lending policy and no contacts yet, and Task
        // 5's forms live on that screen. The flash says so.
        return redirect()
            ->route('admin.shelves.edit', ['bookshelf' => $shelf->slug])
            ->with('success', __('rules.bookshelf_created_flash'));
    }

    public function edit(Bookshelf $bookshelf): Response
    {
        Gate::authorize('update', $bookshelf);

        return Inertia::render('admin/shelves/edit', [
            'shelf' => [
                'id' => $bookshelf->id,
                // Rendered read-only by the form, and read-only for a
                // reason the screen states in words rather than by a
                // disabled input alone (spec D1).
                'slug' => $bookshelf->slug,
                'name' => $bookshelf->name,
                'location' => $bookshelf->location,
                'address' => $bookshelf->address,
                'description' => $bookshelf->description,
                // `yyyy-mm-dd`, which is what `<input type="date">` takes by
                // the HTML spec. The column is a DATE, so there is no
                // instant here and no timezone question of the kind
                // manage/announcements/form.tsx has to answer for an expiry.
                'establishedOn' => $bookshelf->established_on?->toDateString(),
                'status' => $bookshelf->status->value,
            ],
        ]);
    }

    public function update(
        UpdateBookshelfProfileRequest $request,
        Bookshelf $bookshelf,
        UpdateBookshelfProfile $updateProfile,
    ): RedirectResponse {
        /** @var User $user */
        $user = $request->user();
        $validated = $request->validated();

        // FIVE KEYS, READ OUT ONE AT A TIME, and `$validated` is never
        // passed through whole. The Form Request already declines to
        // validate a slug, so a bag built from it cannot carry one — but
        // this is the layer a future field lands in, and a spread here
        // would mean the day somebody adds `status` to the rules is the day
        // a shelf can be archived through the profile form.
        $updateProfile->execute($user, $bookshelf, [
            'name' => $validated['name'],
            'location' => $validated['location'] ?? null,
            'address' => $validated['address'] ?? null,
            'description' => $validated['description'] ?? null,
            'established_on' => $validated['established_on'] ?? null,
        ]);

        return redirect()
            ->route('admin.shelves.edit', ['bookshelf' => $bookshelf->slug])
            ->with('success', __('rules.bookshelf_profile_saved_flash'));
    }
}
