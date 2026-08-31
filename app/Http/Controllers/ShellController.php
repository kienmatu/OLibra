<?php

namespace App\Http\Controllers;

use App\Enums\BookshelfStatus;
use App\Models\Bookshelf;
use App\Support\Fold;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class ShellController extends Controller
{
    public function home(): Response
    {
        return Inertia::render('home');
    }

    /**
     * BR §16.1: the search box is the portal's only job, for Vietnamese
     * parish names. Folded against name/location/address the same way
     * BooksListQuery folds title/author, guard included (BooksListQuery.php
     * :35-39) — a query that is non-empty but folds to '' (e.g. "...")
     * would otherwise degenerate to LIKE '%%' and match every shelf.
     *
     * RETRACTION (fix round 1): this method's first version was written to
     * make LIKE "diacritic-safe" — that framing was false. `bookshelves`'
     * columns are `utf8mb4_unicode_ci`, and that collation already folds
     * vowel diacritics on its own (`'Hòa Bình' LIKE '%hoa binh%'` is `1`
     * with no fold column involved). What it does NOT fold is the
     * Vietnamese letter đ/Đ (U+0111) — measured `'Đồng Tháp' LIKE '%dong
     * thap%' COLLATE utf8mb4_unicode_ci` → `0` — which `Fold::MAP` does map
     * to `d`. The folded columns exist for đ, and for whatever else
     * `Fold::MAP` expands (ß, æ, œ, ĳ) that this collation would also miss;
     * they are not needed for a plain accented vowel.
     * tests/Feature/Shell/PortalSearchTest.php's fixture and its own
     * retraction comment carry the measurements this claim rests on.
     *
     * D2: filtered to active shelves, unlike the admin dashboard (D9),
     * which lists archived ones too because it is the only surface showing a
     * shelf's archived state. NOT because an archived shelf is unreachable
     * otherwise: `ResolveTenant.php:36` resolves by slug under SoftDeletes
     * alone, with no status filter, so an ordinary member still gets 200 on
     * an archived shelf — a pre-existing Phase 0/1 gap, recorded in
     * `docs/known-gaps.md` and owned by 3b. This filter is what keeps an
     * archived shelf off the PUBLIC list, and that much is real.
     */
    public function shelves(Request $request): Response
    {
        $q = trim((string) $request->query('q', ''));
        $folded = Fold::fold($q);

        $shelves = ($q !== '' && $folded === '')
            ? collect()
            : Bookshelf::query()
                ->where('status', BookshelfStatus::Active)
                ->when($folded !== '', fn (Builder $b) => $b->where(fn (Builder $w) => $w
                    ->where('name_folded', 'like', '%'.$folded.'%')
                    ->orWhere('location_folded', 'like', '%'.$folded.'%')
                    ->orWhere('address_folded', 'like', '%'.$folded.'%')))
                ->orderBy('name')
                ->get(['id', 'slug', 'name', 'location', 'address']);

        return Inertia::render('shelves/index', [
            // The submitted query, echoed back as a prop — the house pattern
            // (shelves/search.tsx:11,17; manage/books/index.tsx:26,34). The
            // page used to read it from window.location.search instead, the
            // only window.location read in resources/js, and that drifted:
            // shelves.index is in the header on every page, so arriving from
            // the header after a search left a stale q in the box beside a
            // list showing everything.
            'q' => $q,
            'shelves' => $shelves->map(fn (Bookshelf $shelf) => [
                'slug' => $shelf->slug, 'name' => $shelf->name,
                'location' => $shelf->location, 'address' => $shelf->address,
            ]),
        ]);
    }

    public function shelfHome(): Response
    {
        return Inertia::render('shelves/show');
    }

    /**
     * Every route of the §6 map that Phase 1-3 will fill renders this one
     * page until its real screen lands. The route NAMES are final today; the
     * pages are not — that asymmetry is the whole point of the skeleton.
     */
    public function underConstruction(): Response
    {
        return Inertia::render('under-construction');
    }
}
