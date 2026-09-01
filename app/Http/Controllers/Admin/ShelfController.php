<?php

namespace App\Http\Controllers\Admin;

use App\Actions\Admin\ArchiveBookshelf;
use App\Actions\Admin\CreateBookshelf;
use App\Actions\Admin\UnarchiveBookshelf;
use App\Actions\Admin\UpdateBookshelfContacts;
use App\Actions\Admin\UpdateBookshelfPolicy;
use App\Actions\Admin\UpdateBookshelfProfile;
use App\Actions\Admin\UpdateParishTaxonomy;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\StoreBookshelfRequest;
use App\Http\Requests\Admin\UpdateBookshelfContactsRequest;
use App\Http\Requests\Admin\UpdateBookshelfPolicyRequest;
use App\Http\Requests\Admin\UpdateBookshelfProfileRequest;
use App\Http\Requests\Admin\UpdateParishTaxonomyRequest;
use App\Models\Bookshelf;
use App\Models\User;
use App\Queries\Admin\AdminOverviewQuery;
use App\Queries\Admin\ShelfContactsQuery;
use App\Support\Circulation\LendingSettings;
use App\Support\Community\CommentSettings;
use App\Support\Members\ParishTaxonomy;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.4's Bookshelves screen — the list every later administration act
 * starts from. Replaces `ShellController::underConstruction` on
 * `/admin/shelves`; Tasks 4-6 added create, edit and archive beside it.
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

    public function edit(Bookshelf $bookshelf, ShelfContactsQuery $contacts): Response
    {
        Gate::authorize('update', $bookshelf);

        // The policy prop is read through the two classes that actually
        // consume these settings, not off the raw bag: `settings` is
        // schemaless and a shelf that has never opened this screen stores
        // `{}`, so the form has to be filled in from the same fallbacks the
        // lending commands and the comment gate apply. Reading the bag
        // directly here is how an editor comes to show 0 where the
        // application behaves as 14.
        $lending = LendingSettings::fromShelf($bookshelf);
        $comments = CommentSettings::fromShelf($bookshelf);
        // Same reasoning one layer over: `parish_taxonomy` is absent from a
        // shelf that has never been configured, and this class applies the
        // per-field fallbacks registration and the unit screens already
        // behave as — one level, "Tổ", not nested (spec D5).
        $taxonomy = ParishTaxonomy::fromSettings(((array) $bookshelf->settings)['parish_taxonomy'] ?? null);

        return Inertia::render('admin/shelves/edit', [
            // The eight settings spec D2 fixes the form at, under their
            // storage keys — `comments_enabled`, never BR §5.5's
            // `allow_comments`; see UpdateBookshelfPolicy.
            'policy' => [
                'loan_days' => $lending->loanDays,
                'max_concurrent_loans' => $lending->maxConcurrentLoans,
                'max_renewals' => $lending->maxRenewals,
                'renewal_days' => $lending->renewalDays,
                'hold_days' => $lending->holdDays,
                'due_soon_days' => $lending->dueSoonDays,
                'comments_enabled' => $comments->commentsEnabled,
                'comments_require_approval' => $comments->commentsRequireApproval,
            ],
            // Always three entries, `null` for an empty slot — the form has
            // three fixed blocks and positions do not shift.
            'contacts' => $contacts->run($bookshelf),
            // BR §5.6's shape, under its storage keys — snake_case because
            // the form posts them back unchanged into
            // `settings->parish_taxonomy`. The UNITS are not here and no
            // list of them ships: they are edited on the shelf's own
            // manage/units screen, which binds a tenant (spec D5).
            'taxonomy' => [
                'levels' => $taxonomy->levels,
                'nested' => $taxonomy->nested,
                'level1_label' => $taxonomy->level1Label,
                'level2_label' => $taxonomy->level2Label,
            ],
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

    /**
     * The policy section's own submit (spec D2). It shares no route, no Form
     * Request and no flash with the profile: a page carrying several
     * independently-submittable forms cannot say which one saved if they all
     * redirect to the same undifferentiated success.
     */
    public function updatePolicy(
        UpdateBookshelfPolicyRequest $request,
        Bookshelf $bookshelf,
        UpdateBookshelfPolicy $updatePolicy,
    ): RedirectResponse {
        /** @var User $user */
        $user = $request->user();
        $validated = $request->validated();

        // Eight keys, read out one at a time — the profile path's reasoning,
        // and here it also guarantees the shape the command's merge writes.
        // A spread would mean the day a ninth rule is added is the day an
        // unaudited key lands in the settings bag.
        $updatePolicy->execute($user, $bookshelf, [
            'loan_days' => $validated['loan_days'],
            'max_concurrent_loans' => $validated['max_concurrent_loans'],
            'max_renewals' => $validated['max_renewals'],
            'renewal_days' => $validated['renewal_days'],
            'hold_days' => $validated['hold_days'],
            'due_soon_days' => $validated['due_soon_days'],
            'comments_enabled' => $validated['comments_enabled'],
            'comments_require_approval' => $validated['comments_require_approval'],
        ]);

        return redirect()
            ->route('admin.shelves.edit', ['bookshelf' => $bookshelf->slug])
            ->with('success', __('rules.bookshelf_policy_saved_flash'));
    }

    /**
     * The contacts section's own submit (spec D2, D3). All three blocks are
     * posted every time and the command replaces the set; a block whose name
     * is blank becomes no row rather than an empty one.
     */
    public function updateContacts(
        UpdateBookshelfContactsRequest $request,
        Bookshelf $bookshelf,
        UpdateBookshelfContacts $updateContacts,
    ): RedirectResponse {
        /** @var User $user */
        $user = $request->user();
        $validated = $request->validated();

        $updateContacts->execute($user, $bookshelf, [
            1 => [
                'name' => $validated['contact_1_name'],
                'phone' => $validated['contact_1_phone'] ?? null,
                'role_label' => $validated['contact_1_role_label'] ?? null,
            ],
            2 => [
                'name' => $validated['contact_2_name'] ?? null,
                'phone' => $validated['contact_2_phone'] ?? null,
                'role_label' => $validated['contact_2_role_label'] ?? null,
            ],
            3 => [
                'name' => $validated['contact_3_name'] ?? null,
                'phone' => $validated['contact_3_phone'] ?? null,
                'role_label' => $validated['contact_3_role_label'] ?? null,
            ],
        ]);

        return redirect()
            ->route('admin.shelves.edit', ['bookshelf' => $bookshelf->slug])
            ->with('success', __('rules.bookshelf_contacts_saved_flash'));
    }

    /**
     * The parish-taxonomy section's own submit (spec D5) — BR §5.6's
     * *Phân chia giáo xứ*. The SHAPE of the subdivision: how many levels,
     * what each is called, whether the smaller nests inside the bigger.
     *
     * THE UNITS THEMSELVES ARE NOT EDITED HERE and no list of them ships
     * with the product. They live on the shelf's own manage/units screen,
     * which binds a tenant; ParishUnit is shelf-scoped and this group is
     * not.
     */
    public function updateTaxonomy(
        UpdateParishTaxonomyRequest $request,
        Bookshelf $bookshelf,
        UpdateParishTaxonomy $updateTaxonomy,
    ): RedirectResponse {
        /** @var User $user */
        $user = $request->user();
        $validated = $request->validated();

        // Four keys, read out one at a time — the other three submits'
        // reasoning, and here it also guarantees the shape the command's
        // merge writes into a bag it shares with eleven other keys.
        $updateTaxonomy->execute($user, $bookshelf, [
            'levels' => $validated['levels'],
            'nested' => $validated['nested'],
            'level1_label' => $validated['level1_label'],
            'level2_label' => $validated['level2_label'],
        ]);

        return redirect()
            ->route('admin.shelves.edit', ['bookshelf' => $bookshelf->slug])
            ->with('success', __('rules.bookshelf_taxonomy_saved_flash'));
    }

    /**
     * Spec D4. The two lifecycle controls, and unlike the three save
     * methods above they take no Form Request: the request carries no
     * fields at all, only the shelf in the URL, so there is nothing to
     * validate and a Request class here would be an empty rules() array
     * pretending otherwise.
     *
     * BACK TO THE LIST, not to the editor. The other three submits are made
     * on the editor and return to it; these two are pressed on the list and
     * change how the row they were pressed on reads, which is the thing the
     * volunteer wants to see.
     *
     * NO STATUS CHECK HERE AND NONE IN THE COMMAND. Archiving an
     * already-archived shelf is refused by `BookshelfPolicy::archive()`, as
     * a 404 rather than a 403 (spec D9) so that a second click tells the
     * caller nothing the first did not.
     */
    public function archive(Request $request, Bookshelf $bookshelf, ArchiveBookshelf $archive): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $archive->execute($user, $bookshelf);

        return redirect()
            ->route('admin.shelves')
            ->with('success', __('rules.bookshelf_archived_flash'));
    }

    public function unarchive(Request $request, Bookshelf $bookshelf, UnarchiveBookshelf $unarchive): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $unarchive->execute($user, $bookshelf);

        return redirect()
            ->route('admin.shelves')
            ->with('success', __('rules.bookshelf_unarchived_flash'));
    }
}
