<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Members\CreateParishUnit;
use App\Actions\Members\DeleteParishUnit;
use App\Actions\Members\RenameParishUnit;
use App\Actions\Members\ReorderParishUnits;
use App\Http\Controllers\Controller;
use App\Http\Requests\Members\RenameParishUnitRequest;
use App\Http\Requests\Members\ReorderParishUnitsRequest;
use App\Http\Requests\Members\StoreParishUnitRequest;
use App\Models\Bookshelf;
use App\Models\ParishUnit;
use App\Models\User;
use App\Queries\ParishContextQuery;
use App\Support\Members\ParishUnits;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * `shelves/{shelf}/manage/units` — BR §5.6's parish units, the rows a
 * reader picks from at registration. Phase 3b-ii Task 5, spec D5 and D6;
 * replaces `ShellController::underConstruction`, and ports the reference's
 * `quan-ly/co-cau` (whose Vietnamese path segments deliberately do not
 * carry across — `RouteOrderTest` bans them).
 *
 * **WHY THIS SCREEN IS HERE AND NOT IN `/admin`, WHICH THE SPEC REVERSED
 * TWICE.** `ParishUnit` uses `BelongsToBookshelf` and `BookshelfScope`
 * fails closed; this route group binds a tenant, so every read and write
 * below resolves through the ordinary scoped path and nothing here needs
 * `systemWide()`. On the `/admin` shelf editor — which binds no tenant by
 * design — unit CRUD would force the widening on every one of them, the
 * capability `WideningArchitectureTest` fences precisely so that it stays
 * rare. It is also where the reference puts the screen. BR §600 lists the
 * unit lists under the admin Bookshelves screen: we diverge on LOCATION
 * and match on AUTHORITY, and the divergence is recorded rather than left
 * to be discovered.
 *
 * **THE SHAPE IS NOT EDITED HERE.** How many levels a parish uses, what it
 * calls them and whether the smaller sits inside the bigger is a property
 * of the shelf, stored in `bookshelves.settings`, and `UpdateParishTaxonomy`
 * owns it on the admin shelf editor (Task 4). This screen shows the shape as
 * text — because it decides which half of the tree renders — and offers no
 * control that changes it.
 *
 * **`canEdit` IS THE WHOLE AUTHORIZATION STORY OF THE RENDERING.** All four
 * writes are super-admin-only (OPS §4.5, `ParishUnitPolicy`), while the
 * route's `role:manager` lets a shelf's own manager read it — and
 * `Gate::before` grants a super admin every `act-as-*` ability, which is how
 * a super admin reaches a `role:manager` route at all. So a manager gets the
 * same values as read-only text and no control the server would refuse. The
 * reference shipped this screen with the forms visible to everyone and
 * corrected it before merge; its docstring says so, and this repo has now
 * produced the same defect three times. The prop is a courtesy either way:
 * every write re-checks for itself, in the Form Request and again in the
 * command.
 *
 * **EVERY WRITE REDIRECTS BACK TO THIS SCREEN WITH ITS OWN SENTENCE.** Four
 * controls on a tree of many rows; one undifferentiated success would say
 * only that something happened.
 */
class UnitController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, ParishContextQuery $parish): Response
    {
        $context = $parish->run();
        $taxonomy = $context['taxonomy'];

        /** @var ?User $viewer */
        $viewer = $request->user();

        // Through ParishUnits::options() rather than a fresh orderBy, so the
        // tree renders in exactly the order the registration picker offers —
        // sort_order first, then the VIETNAMESE-collated name, never a
        // number parsed out of "Tổ 10". It also drops the soft-deleted rows
        // ParishContextQuery deliberately carries (they exist for
        // describeSelection's benefit, not for a picker's and not for this
        // screen's).
        $level1 = array_map(self::row(...), ParishUnits::options($context['units'], 1));
        $level2 = array_map(self::row(...), ParishUnits::options($context['units'], 2));

        return Inertia::render('manage/units', [
            'taxonomy' => [
                'levels' => $taxonomy->levels,
                'nested' => $taxonomy->nested,
                'level1Label' => $taxonomy->level1Label,
                'level2Label' => $taxonomy->level2Label,
            ],
            'level1' => $level1,
            'level2' => $level2,
            'canEdit' => (bool) $viewer?->is_super_admin,
        ]);
    }

    /**
     * Add a unit. `parent_id` is absent on a level-1 form and on a flat
     * shelf's level-2 form; whether it is REQUIRED is the command's
     * question, because the answer depends on the shelf's taxonomy.
     */
    public function store(StoreParishUnitRequest $request, Bookshelf $shelf, CreateParishUnit $create): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $data = $request->validated();

        $create->execute($user, (int) $data['level'], $data['parent_id'] ?? null, (string) $data['name']);

        return $this->back($shelf, 'parish_unit_created_flash');
    }

    /**
     * Rename a unit. `{parishUnit}` binds through `Bookshelf::parishUnits()`
     * under the group's `scopeBindings()` and through `BookshelfScope`, with
     * `SoftDeletes` in force — so another shelf's unit and a retired one are
     * both a 404 before this method runs.
     */
    public function rename(
        RenameParishUnitRequest $request,
        Bookshelf $shelf,
        ParishUnit $parishUnit,
        RenameParishUnit $rename,
    ): RedirectResponse {
        /** @var User $user */
        $user = $request->user();

        $rename->execute($user, $parishUnit, (string) $request->validated()['name']);

        return $this->back($shelf, 'parish_unit_renamed_flash');
    }

    /**
     * Retire a unit and, for a level-1 one, its live level-2 children.
     * Bodiless — the unit named in the URL is the whole request, the shape
     * every other state transition in this application uses — and POST
     * rather than DELETE, matching a file that declares no DELETE route
     * anywhere.
     */
    public function destroy(
        Request $request,
        Bookshelf $shelf,
        ParishUnit $parishUnit,
        DeleteParishUnit $delete,
    ): RedirectResponse {
        /** @var User $user */
        $user = $request->user();

        $delete->execute($user, $parishUnit);

        return $this->back($shelf, 'parish_unit_deleted_flash');
    }

    /**
     * Set the order of one sibling group. The whole group travels in its new
     * order; the screen builds it by grouping level-2 units on their REAL
     * `parent_id` rather than on the flat display list, which is the half of
     * that rule the component owns (`ReorderParishUnits` has the other).
     */
    public function reorder(
        ReorderParishUnitsRequest $request,
        Bookshelf $shelf,
        ReorderParishUnits $reorder,
    ): RedirectResponse {
        /** @var User $user */
        $user = $request->user();

        /** @var list<string> $ids */
        $ids = array_values(array_map(strval(...), $request->validated()['unit_ids']));

        $reorder->execute($user, $ids);

        return $this->back($shelf, 'parish_unit_reordered_flash');
    }

    private function back(Bookshelf $shelf, string $key): RedirectResponse
    {
        return redirect()
            ->route('shelves.manage.units', ['shelf' => $shelf->slug])
            ->with('success', __('rules.'.$key));
    }

    /**
     * One row as the screen needs it. `sortOrder` and `deletedAt` are
     * deliberately dropped: the order is already expressed by the array's
     * position, and a number on the page would invite a component to sort
     * by it a second time and disagree with the Vietnamese collation the
     * server used.
     *
     * @param  array{id: string, level: int, parentId: ?string, name: string, sortOrder: int, deletedAt: ?string}  $unit
     * @return array{id: string, parentId: ?string, name: string}
     */
    private static function row(array $unit): array
    {
        return ['id' => $unit['id'], 'parentId' => $unit['parentId'], 'name' => $unit['name']];
    }
}
