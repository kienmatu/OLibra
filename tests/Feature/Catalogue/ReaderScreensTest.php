<?php

use App\Actions\Catalogue\CreateBook;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\BookshelfContact;
use App\Models\Category;
use App\Models\Membership;
use App\Models\Scopes\BookshelfScope;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia as Assert;

function rdrScreenShelf(): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    BookshelfContact::query()->create([
        'bookshelf_id' => $shelf->id, 'position' => 1, 'name' => 'Anh Ba', 'phone' => '0900000001',
    ]);
    $manager = User::factory()->create();
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create();
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    Category::factory()->create(['name' => 'Truyện thiếu nhi', 'slug' => 'truyen-thieu-nhi']);

    return [$shelf, $manager, $reader];
}

function rdrScreenBook(Bookshelf $shelf, User $manager, array $over = []): Book
{
    $membership = Membership::query()->withoutGlobalScope(BookshelfScope::class)
        ->where('bookshelf_id', $shelf->id)->where('user_id', $manager->id)->firstOrFail();
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($manager);

    $book = app(CreateBook::class)->execute($manager, array_merge([
        'title' => 'Dế Mèn Phiêu Lưu Ký', 'author' => 'Tô Hoài',
        'category_slug' => 'truyen-thieu-nhi', 'copy_count' => 1,
    ], $over));

    app(TenantContext::class)->clear();

    return $book;
}

it('renders the catalogue grid with rows, categories and paging facts', function () {
    [$shelf, $manager, $reader] = rdrScreenShelf();
    rdrScreenBook($shelf, $manager);

    $this->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/catalogue")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('shelves/catalogue')
            ->has('books.rows', 1)
            ->where('books.rows.0.title', 'Dế Mèn Phiêu Lưu Ký')
            ->where('books.rows.0.availability', 'available')
            ->has('categories')
            ->where('filters.scope', 'available'));
});

it('scope, category, sort and page ride the query string', function () {
    [$shelf, $manager, $reader] = rdrScreenShelf();
    $out = rdrScreenBook($shelf, $manager);
    $out->copies->first()->update(['state' => 'on_loan']);

    $this->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/catalogue?scope=all&sort=title")
        ->assertInertia(fn (Assert $page) => $page
            ->has('books.rows', 1)
            ->where('filters.scope', 'all')
            ->where('filters.sort', 'title'));

    $this->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/catalogue")   // default scope hides the all-out title
        ->assertInertia(fn (Assert $page) => $page->has('books.rows', 0));
});

it('a repeated ?category[]= takes its first value rather than 500ing', function () {
    // Fix round, Task 13: CatalogueController passed $request->query('category')
    // straight through, untyped. A repeated key — a mangled or pasted link,
    // not an attack — decodes to an array and CatalogueQuery::run() throws
    // TypeError: Argument #2 ($slug) must be of type string, array given.
    // QueryParam::first() takes the first value, matching old_next's
    // search-params.ts param(): the shelf still renders, filtered by the
    // category the reader named first.
    [$shelf, $manager, $reader] = rdrScreenShelf();
    Category::factory()->create(['name' => 'Khác', 'slug' => 'khac']);
    rdrScreenBook($shelf, $manager, ['title' => 'Dế Mèn Phiêu Lưu Ký', 'category_slug' => 'truyen-thieu-nhi']);
    rdrScreenBook($shelf, $manager, ['title' => 'Khoa Học Kỳ Thú', 'category_slug' => 'khac']);

    $this->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/catalogue?category[]=truyen-thieu-nhi&category[]=khac")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->has('books.rows', 1)
            ->where('books.rows.0.title', 'Dế Mèn Phiêu Lưu Ký')
            ->where('filters.category', 'truyen-thieu-nhi'));
});

it('search renders results for the folded term', function () {
    [$shelf, $manager, $reader] = rdrScreenShelf();
    rdrScreenBook($shelf, $manager, ['title' => 'Tìm Kiếm Kho Báu']);

    $this->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/search?q=tim+kiem+kho+bau")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('shelves/search')
            ->has('results', 1)
            ->where('results.0.title', 'Tìm Kiếm Kho Báu')
            ->where('q', 'tim kiem kho bau'));
});

it('a repeated ?q[]= takes its first value rather than 500ing', function () {
    // Fix round, Task 13: SearchController's trim((string) $request->query('q'))
    // threw ErrorException: Array to string conversion the moment $q arrived
    // as an array. QueryParam::first() resolves it to the first term, so a
    // mangled or pasted `?q=a&q=b` link searches on the term the reader
    // actually typed first, rather than 500ing on the second one being there
    // at all.
    [$shelf, $manager, $reader] = rdrScreenShelf();
    rdrScreenBook($shelf, $manager, ['title' => 'Tìm Kiếm Kho Báu']);
    rdrScreenBook($shelf, $manager, ['title' => 'Khoa Học Kỳ Thú']);

    $this->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/search?q[]=tim+kiem+kho+bau&q[]=khoa+hoc")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('q', 'tim kiem kho bau')
            ->has('results', 1)
            ->where('results.0.title', 'Tìm Kiếm Kho Báu'));
});

it('an empty search suggests recently added available titles — BR §16.1\'s empty state', function () {
    [$shelf, $manager, $reader] = rdrScreenShelf();
    rdrScreenBook($shelf, $manager);

    $this->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/search")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('shelves/search')
            ->has('results', 0)
            ->has('suggestions', 1)
            ->where('suggestions.0.title', 'Dế Mèn Phiêu Lưu Ký'));
});

it('book detail renders for a reader, with the contact line', function () {
    [$shelf, $manager, $reader] = rdrScreenShelf();
    $book = rdrScreenBook($shelf, $manager);

    $this->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/books/{$book->slug}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('shelves/book')
            ->where('detail.title', 'Dế Mèn Phiêu Lưu Ký')
            ->where('detail.availability', 'available')
            ->where('firstContact.name', 'Anh Ba')
            ->where('firstContact.phone', '0900000001'));
});

it('a manager sees the same page without the contact line — they are the person named', function () {
    [$shelf, $manager] = rdrScreenShelf();
    $book = rdrScreenBook($shelf, $manager);

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/books/{$book->slug}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('firstContact', null));
});

it('a draft book 404s on the reader detail page', function () {
    [$shelf, $manager, $reader] = rdrScreenShelf();
    $draft = rdrScreenBook($shelf, $manager, ['title' => 'Bản Nháp', 'is_published' => false]);

    $this->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/books/{$draft->slug}")
        ->assertNotFound();
});

// A separate test, not a fourth assertion appended to the one below:
// rdrScreenBook() calls actingAs($manager) to seed the book (CreateBook's
// policy needs an authenticated actor), and SessionGuard caches that
// resolved user for the rest of the test METHOD — a guest assertion tacked
// on afterwards would silently re-test the manager, not a guest, and pass
// for the wrong reason. tests/Feature/Tenancy/RouteIsolationTest.php and
// ManageBookScreensTest's "a guest gets a login redirect on a manager
// write" test (tests/Feature/Catalogue/ManageBookScreensTest.php:241) use
// this same one-test-per-guard-state shape for the identical reason.
it('a guest is redirected to login', function () {
    [$shelf] = rdrScreenShelf();

    $this->get("/shelves/{$shelf->slug}/catalogue")->assertRedirect('/login');
});

it('a non-member gets 404 on the catalogue and search', function () {
    [$shelf, $manager] = rdrScreenShelf();
    rdrScreenBook($shelf, $manager);

    $stranger = User::factory()->create();   // signed in somewhere, member nowhere
    $this->actingAs($stranger)->get("/shelves/{$shelf->slug}/catalogue")->assertNotFound();
    $this->actingAs($stranger)->get("/shelves/{$shelf->slug}/search")->assertNotFound();
});
