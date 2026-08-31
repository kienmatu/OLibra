<?php

namespace App\Queries\Admin;

use App\Models\Bookshelf;
use App\Support\TenantContext;

/**
 * The three contact slots of one shelf, read from the tenant-less `/admin`
 * group so the editor's contacts form can be rendered filled in (spec D3).
 *
 * WHY THIS IS A QUERY AND NOT TWO LINES IN THE CONTROLLER. `BookshelfContact`
 * carries `BelongsToBookshelf`, so `BookshelfScope` throws on it when nothing
 * is bound — and the `/admin` group binds nothing by design (spec D0).
 * Widening is the sanctioned way past that guard and
 * `WideningArchitectureTest` confines it to `app/Queries/Admin/` and
 * `app/Actions/Admin/`; a controller never widens for itself.
 *
 * THE ROWS ARE REACHED THROUGH THE RELATION, never through a hand-written
 * shelf-column predicate. Under a widening the scope adds no predicate at
 * all, so a read spelled without the relation would return every parish's
 * volunteers and their phone numbers; the relation carries its own
 * constraint whatever the widening state. `TenancyArchitectureTest` also
 * confines that hand-written spelling to a four-file allow-list this
 * directory is not on.
 *
 * ALWAYS THREE ENTRIES, one per position, `null` where the shelf has no row.
 * The form has three fixed blocks and a shelf may hold contacts at 1 and 3
 * with nothing at 2 (a retired volunteer frees a position without shifting
 * the others), so a dense list would put the wrong person in the wrong block.
 */
final class ShelfContactsQuery
{
    public function __construct(
        private TenantContext $context,
    ) {}

    /**
     * @return list<array{position: int, name: string, phone: ?string, roleLabel: ?string}|null>
     */
    public function run(Bookshelf $shelf): array
    {
        $rows = $this->context->systemWide(
            fn () => $shelf->contacts()->orderBy('position')->get(),
        );

        $byPosition = $rows->keyBy('position');

        return collect([1, 2, 3])
            ->map(function (int $position) use ($byPosition): ?array {
                $contact = $byPosition->get($position);

                if ($contact === null) {
                    return null;
                }

                return [
                    'position' => $position,
                    'name' => $contact->name,
                    'phone' => $contact->phone,
                    'roleLabel' => $contact->role_label,
                ];
            })
            ->all();
    }
}
