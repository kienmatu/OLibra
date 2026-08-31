<?php

use App\Models\Bookshelf;
use App\Support\TenantContext;

/**
 * Grep first: `grep -rn "^function portalFix" tests/`.
 *
 * RETRACTION (fix round 1): the first version of this fixture used only
 * vowel-diacritic Vietnamese ("Giáo xứ Hòa Bình", "hoa binh") to prove the
 * folded columns matter. That was measured false: `bookshelves.name` /
 * `location` / `address` are `utf8mb4_unicode_ci`, and that collation is
 * ITSELF accent-insensitive for vowel diacritics —
 * `'Giáo xứ Hòa Bình' LIKE '%hoa binh%' COLLATE utf8mb4_unicode_ci` is `1`
 * with no fold column involved at all. A mutation that replaced the folded
 * match with a plain `LIKE` on the source columns left that block green,
 * which is what caught the false premise.
 *
 * What the collation does NOT fold — measured directly, `SELECT 'Đồng
 * Tháp' LIKE '%dong thap%' COLLATE utf8mb4_unicode_ci` → `0` — is the
 * Vietnamese letter đ/Đ (U+0111), which `Fold::MAP` does map to `d`. So
 * this fixture now carries đ in each of the three folded columns
 * (name/location/address), on three DIFFERENT words, so each of the three
 * "finds by X" blocks below is attributable to the ONE column it claims to
 * test rather than to any of the others. `thap` (no đ, name-only) is kept
 * as the honestly-labelled collation case: it passes with or without the
 * migration, and the block that checks it says so.
 */
function portalFix(): void
{
    app(TenantContext::class)->actSystemWide();
    Bookshelf::factory()->create([
        'slug' => 'dong-thap', 'name' => 'Giáo xứ Đồng Tháp',
        'location' => 'Đường Lý Thường Kiệt', 'address' => '12 Đường Nguyễn Huệ', 'settings' => [],
    ]);
    Bookshelf::factory()->create([
        'slug' => 'an-giang', 'name' => 'Giáo xứ An Giang',
        'location' => 'An Giang', 'address' => null, 'settings' => [],
    ]);
}

it('finds a shelf by đ in its name — the letter the collation does not fold, Fold::MAP does', function () {
    // Measured: 'Giáo xứ Đồng Tháp' LIKE '%dong thap%' COLLATE
    // utf8mb4_unicode_ci is 0. Only name_folded (via Fold::MAP's đ→d) finds
    // this. This is the block the migration exists for.
    portalFix();

    $this->get('/shelves?q=dong thap')
        ->assertOk()
        ->assertInertia(fn ($page) => $page->has('shelves', 1)
            ->where('shelves.0.slug', 'dong-thap'));
});

it('finds a shelf by đ in its address', function () {
    // Measured: '12 Đường Nguyễn Huệ' LIKE '%duong nguyen hue%' COLLATE
    // utf8mb4_unicode_ci is 0. Only address_folded finds this.
    portalFix();

    $this->get('/shelves?q=duong nguyen hue')
        ->assertInertia(fn ($page) => $page->has('shelves', 1)
            ->where('shelves.0.slug', 'dong-thap'));
});

it('finds a shelf by đ in its location', function () {
    // Measured: 'Đường Lý Thường Kiệt' LIKE '%duong ly thuong kiet%'
    // COLLATE utf8mb4_unicode_ci is 0. Only location_folded finds this.
    portalFix();

    $this->get('/shelves?q=duong ly thuong kiet')
        ->assertInertia(fn ($page) => $page->has('shelves', 1)
            ->where('shelves.0.slug', 'dong-thap'));
});

it('finds a shelf by plain vowel diacritics — collation already does this, not the fold', function () {
    // Measured: 'Giáo xứ Đồng Tháp' LIKE '%thap%' COLLATE utf8mb4_unicode_ci
    // is already 1 with no đ and no fold column involved. This block would
    // stay green under the Step-5 mutation (a plain LIKE on `name`) — it is
    // NOT evidence the migration does anything; it is evidence the search
    // box works for the common case the collation happens to cover for
    // free.
    portalFix();

    $this->get('/shelves?q=thap')
        ->assertInertia(fn ($page) => $page->has('shelves', 1)
            ->where('shelves.0.slug', 'dong-thap'));
});

it('sends address alongside location, and null where absent', function () {
    portalFix();

    $this->get('/shelves?q=dong thap')
        ->assertInertia(fn ($page) => $page->has('shelves', 1)
            ->where('shelves.0.address', '12 Đường Nguyễn Huệ'));

    $this->get('/shelves?q=an giang')
        ->assertInertia(fn ($page) => $page->has('shelves', 1)
            ->where('shelves.0.address', null));
});

it('an empty query lists every active shelf', function () {
    portalFix();

    $this->get('/shelves?q=')->assertInertia(fn ($page) => $page->has('shelves', 2));
});

it('a query that folds to nothing lists nothing, not everything', function () {
    // BooksListQuery:35-39's guard, carried. `...` is non-empty but folds to
    // '', and an unguarded search would become LIKE '%%' and list every shelf
    // — the failure looks like success, which is why it gets its own block.
    portalFix();

    $this->get('/shelves?q=...')->assertInertia(fn ($page) => $page->has('shelves', 0));
});

it('echoes the SUBMITTED query back as a prop, and only the submitted one', function () {
    // MINOR 5. The page used to seed its input from window.location.search,
    // the only window.location read in resources/js. shelves.index is in the
    // header on every page, so arriving from the header after a search left
    // a stale q in the box beside a list showing everything. Both readings
    // are asserted here: the query is echoed when there is one, and it is
    // EMPTY on the unfiltered listing — that second half is the one the
    // window-reading version got wrong.
    portalFix();

    $this->get('/shelves?q=dong+thap')->assertInertia(fn ($page) => $page->where('q', 'dong thap'));
    $this->get('/shelves')->assertInertia(fn ($page) => $page->where('q', ''));
});

it('the portal does NOT list an archived shelf — the one place it differs from the dashboard', function () {
    // D2 against D9. The portal is public and shows shelves a person can
    // join; the dashboard lists archived ones because it is the only surface
    // that shows a shelf's archived state at all.
    //
    // RETRACTION: this comment used to say the dashboard lists them because
    // "an administrator is their only route to them". FALSE at HEAD —
    // ResolveTenant.php:36 resolves a shelf by slug under the SoftDeletes
    // scope alone, with no status filter, so an ordinary member still gets
    // 200 on an archived shelf. The reference did filter
    // (old_next/src/auth/guards.ts:22); this port does not. Pre-existing
    // from Phase 0/1, recorded in docs/known-gaps.md, Phase 3b's to close.
    // The assertion below is unaffected: the PORTAL's own filter is real.
    portalFix();
    Bookshelf::query()->where('slug', 'dong-thap')->update(['status' => 'archived']);

    $this->get('/shelves')->assertInertia(fn ($page) => $page->has('shelves', 1));
});
