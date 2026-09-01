<?php

namespace App\Http\Controllers\Admin;

use App\Actions\Admin\ArchiveCategory;
use App\Actions\Admin\CreateCategory;
use App\Actions\Admin\RenameCategory;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\RenameCategoryRequest;
use App\Http\Requests\Admin\StoreCategoryRequest;
use App\Models\Category;
use App\Models\User;
use App\Queries\Admin\CategoriesListQuery;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

/**
 * `/admin/categories` — the book genres, spec D3. Replaces
 * `ShellController::underConstruction`, and ports the reference's
 * `/quan-tri/the-loai` (whose Vietnamese path segments deliberately do not
 * carry across: `RouteOrderTest` bans them).
 *
 * **THE TAXONOMY IS THE INSTALLATION'S, NOT A PARISH'S.** `Category` carries
 * no `BelongsToBookshelf` and `categories` has no `bookshelf_id` — one set of
 * genres every tủ sách shares (DATABASE.md §4.3) — so this screen names no
 * shelf anywhere, and all three writes audit globally.
 *
 * **THE CROSS-SHELF READ IS A QUERY'S AND THE WRITES ARE ACTIONS'.** The
 * genres themselves need nothing special, but the book counts beside them —
 * and `ArchiveCategory`'s in-use guard — span every shelf, and the `/admin`
 * group binds no tenant. Widening and the audit configurator are both fenced
 * to `app/Queries/Admin/` and `app/Actions/Admin/`. What is left here is
 * what a controller is for: which component renders, which route a redirect
 * lands on, and which sentence flashes.
 *
 * **THREE WRITES, THREE ROUTES, THREE SENTENCES.** A volunteer who has just
 * pressed one of several controls on a list of many rows needs to be told
 * which act landed; one undifferentiated success would say only that
 * something did.
 */
class CategoryController extends Controller
{
    public function index(CategoriesListQuery $categories): Response
    {
        // Redundant with EnsureSuperAdmin today, and kept for the reason
        // ShelfController::index and SettingsController::index keep theirs:
        // the three writes below all authorize, and a list that authorized
        // nothing would be the one screen here whose permission is implicit.
        Gate::authorize('viewAny', Category::class);

        return Inertia::render('admin/categories/index', [
            'categories' => $categories->run(),
        ]);
    }

    /**
     * Add a genre. The slug is not on this request and never will be —
     * `CreateCategory` derives it from the name.
     */
    public function store(StoreCategoryRequest $request, CreateCategory $create): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $create->execute($user, $request->validated()['name']);

        return redirect()
            ->route('admin.categories')
            ->with('success', __('rules.category_created_flash'));
    }

    /**
     * Rename a genre. `{category}` binds implicitly by id — `Category` is
     * not a scoped model, so binding resolves it without a tenant, and its
     * soft delete keeps an archived genre from resolving at all: a rename
     * cannot name one that has been put away.
     */
    public function update(
        RenameCategoryRequest $request,
        Category $category,
        RenameCategory $rename,
    ): RedirectResponse {
        /** @var User $user */
        $user = $request->user();

        $rename->execute($user, $category, $request->validated()['name']);

        return redirect()
            ->route('admin.categories')
            ->with('success', __('rules.category_renamed_flash'));
    }

    /**
     * Put a genre away. Bodiless — the genre named in the URL is the whole
     * request, the shape every other state transition in this application
     * uses — and refused by the command while any live book still carries
     * it (`category_in_use`).
     */
    public function archive(
        Request $request,
        Category $category,
        ArchiveCategory $archive,
    ): RedirectResponse {
        /** @var User $user */
        $user = $request->user();

        $archive->execute($user, $category);

        return redirect()
            ->route('admin.categories')
            ->with('success', __('rules.category_archived_flash'));
    }
}
