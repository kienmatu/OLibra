<?php

use App\Models\Book;
use App\Models\Bookshelf;
use App\Support\TenantContext;

function tenancyShelf(string $slug): Bookshelf
{
    return Bookshelf::query()->create([
        'slug' => $slug, 'name' => 'Tủ sách '.$slug, 'settings' => [],
    ]);
}

it('is one instance per request lifecycle', function () {
    $a = app(TenantContext::class);
    $b = app(TenantContext::class);

    expect($a)->toBe($b);
});

it('scopes every read to the bound shelf', function () {
    $dongThap = tenancyShelf('dong-thap');
    $canTho = tenancyShelf('can-tho');

    // Deliberately colliding data: same slug on both shelves.
    Book::query()->create(['bookshelf_id' => $dongThap->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men']);
    Book::query()->create(['bookshelf_id' => $canTho->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men']);

    app(TenantContext::class)->set($dongThap, null);

    expect(Book::query()->count())->toBe(1)
        ->and(Book::query()->sole()->bookshelf_id)->toBe($dongThap->id);
});

it('stamps bookshelf_id on create so nothing writes it by hand', function () {
    $shelf = tenancyShelf('dong-thap');
    app(TenantContext::class)->set($shelf, null);

    $book = Book::query()->create(['title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be']);

    expect($book->bookshelf_id)->toBe($shelf->id);
});

it('refuses a scoped query when no tenant is bound — fail closed, not open', function () {
    tenancyShelf('dong-thap');

    // Under RLS this returned zero rows; a silent no-op here would return
    // EVERY shelf's rows the day a route group forgets its middleware.
    expect(fn () => Book::query()->count())->toThrow(
        RuntimeException::class,
        'App\Models\Book is shelf-scoped but no tenant is bound. Bind one via the tenant '
        .'middleware, or opt in explicitly with TenantContext::actSystemWide() and name '
        .'bookshelf_id yourself.',
    );
});

it('reads everything only after an explicit system-wide opt-in', function () {
    $a = tenancyShelf('dong-thap');
    $b = tenancyShelf('can-tho');
    Book::query()->create(['bookshelf_id' => $a->id, 'title' => 'A', 'slug' => 'a']);
    Book::query()->create(['bookshelf_id' => $b->id, 'title' => 'B', 'slug' => 'b']);

    app(TenantContext::class)->actSystemWide();

    expect(Book::query()->count())->toBe(2);
});

it('binds bookshelves by slug for routes', function () {
    expect((new Bookshelf)->getRouteKeyName())->toBe('slug');
});
