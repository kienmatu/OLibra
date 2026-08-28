<?php

namespace App\Queries;

use App\Models\ParishUnit;
use App\Support\Members\ParishTaxonomy;
use App\Support\TenantContext;
use RuntimeException;

/**
 * The bound shelf's taxonomy and its units — the Laravel form of
 * parish-context.ts's loadParishContext. Every unit travels, soft-deleted
 * ones included: validateSelection and describeSelection need the deleted
 * ones (history, not error), and filtering to what a picker may OFFER is
 * ParishUnits::options's job, at the call site.
 *
 * The reference's hard-won `where id` lesson (a permissive public-read
 * policy turned its unqualified bookshelves select into "whichever shelf
 * the planner returned first") has no analogue here: TenantContext hands
 * back the one bound Bookshelf model, and ParishUnit carries
 * BookshelfScope.
 *
 * **The access-level decision OPS §3.2 left open (docs/OPERATIONS.md:71,75).**
 * OPS lists GetParishUnits under the reader-gated query set, but names
 * RegisterMembership (§4.3) — a guest-callable command whose form renders
 * this same picker before the caller holds any membership at all — as a
 * caller that must somehow still reach it. Rather than resolve that by
 * baking a role check into this class (which would then have to special-case
 * "except when called from registration", the exact kind of accidental gate
 * this task was told to avoid), this query is deliberately **tenant-scoped,
 * not role-scoped**: run() requires only a bound Bookshelf
 * (TenantContext::bookshelf()), the same precondition ResolveTenant
 * establishes for an authenticated reader route and for the unauthenticated
 * /register/{shelf} screen alike (both resolve a shelf by slug before
 * anything else runs). Which callers may reach this query at all is
 * therefore the HTTP layer's decision, made once per route via middleware —
 * `role:reader` on the reader-area routes that read a shelf's picker for an
 * existing member, no such gate on the guest registration route Task 13
 * builds. What this exposes to an unauthenticated caller: the shelf's
 * taxonomy labels and its full unit list (id, level, parent, name,
 * sort order, soft-delete marker) for the ONE shelf already named in the
 * URL — never another shelf's units, and never anything about a person
 * (no membership, no name, no phone). A parish's internal division names are
 * not sensitive on their own; OPS's own reasoning for the reader gate is
 * "a stranger has no business enumerating a parish's divisions" absent
 * already knowing which shelf — which a guest hitting /register/{shelf}
 * necessarily does. Recorded here, not invented silently, because neither
 * source document decided it.
 */
final class ParishContextQuery
{
    public function __construct(private TenantContext $context) {}

    /** @return array{taxonomy: ParishTaxonomy, units: list<array{id: string, level: int, parentId: ?string, name: string, sortOrder: int, deletedAt: ?string}>} */
    public function run(): array
    {
        $shelf = $this->context->bookshelf();

        if ($shelf === null) {
            throw new RuntimeException('ParishContextQuery needs a bound tenant.');
        }

        $taxonomy = ParishTaxonomy::fromSettings($shelf->settings['parish_taxonomy'] ?? null);

        $units = array_values(ParishUnit::query()->withTrashed()
            ->orderBy('level')->orderBy('sort_order')->orderBy('name')
            ->get()
            ->map(fn (ParishUnit $u): array => [
                'id' => $u->id,
                'level' => (int) $u->level,
                'parentId' => $u->parent_id,
                'name' => $u->name,
                'sortOrder' => (int) $u->sort_order,
                'deletedAt' => $u->deleted_at?->toIso8601String(),
            ])
            ->all());

        return ['taxonomy' => $taxonomy, 'units' => $units];
    }
}
