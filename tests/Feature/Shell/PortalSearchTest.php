<?php

use App\Models\Bookshelf;
use App\Support\TenantContext;

/** Grep first: `grep -rn "^function portalFix" tests/`. */
function portalFix(): void
{
    app(TenantContext::class)->actSystemWide();
    Bookshelf::factory()->create([
        'slug' => 'hoa-binh', 'name' => 'Giáo xứ Hòa Bình',
        'location' => 'Đồng Tháp', 'address' => '12 Nguyễn Huệ', 'settings' => [],
    ]);
    Bookshelf::factory()->create([
        'slug' => 'an-giang', 'name' => 'Giáo xứ An Giang',
        'location' => 'An Giang', 'address' => null, 'settings' => [],
    ]);
}

it('finds a shelf by unaccented name — the case the box exists for', function () {
    portalFix();

    $this->get('/shelves?q=hoa binh')
        ->assertOk()
        ->assertInertia(fn ($page) => $page->has('shelves', 1)
            ->where('shelves.0.slug', 'hoa-binh'));
});

it('finds a shelf by its address', function () {
    portalFix();

    $this->get('/shelves?q=nguyen hue')
        ->assertInertia(fn ($page) => $page->has('shelves', 1)
            ->where('shelves.0.slug', 'hoa-binh'));
});

it('finds a shelf by location', function () {
    portalFix();

    $this->get('/shelves?q=dong thap')
        ->assertInertia(fn ($page) => $page->has('shelves', 1));
});

it('sends address alongside location, and null where absent', function () {
    portalFix();

    $this->get('/shelves')
        ->assertInertia(fn ($page) => $page->has('shelves', 2)
            ->where('shelves.1.address', '12 Nguyễn Huệ')
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

it('the portal does NOT list an archived shelf — the one place it differs from the dashboard', function () {
    // D2 against D9. The dashboard lists archived shelves because an
    // administrator is their only route to them; the portal is public and
    // shows shelves a person can join.
    portalFix();
    Bookshelf::query()->where('slug', 'hoa-binh')->update(['status' => 'archived']);

    $this->get('/shelves')->assertInertia(fn ($page) => $page->has('shelves', 1));
});
