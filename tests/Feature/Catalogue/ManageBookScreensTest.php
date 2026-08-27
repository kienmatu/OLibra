<?php

use App\Actions\Catalogue\AssessCondition;
use App\Actions\Catalogue\CreateBook;
use App\Enums\CopyCondition;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\Category;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\Scopes\BookshelfScope;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia as Assert;

function scrManager(): array
{
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap', 'settings' => []]);
    $user = User::factory()->create();
    Membership::factory()->for($shelf)->create([
        'user_id' => $user->id, 'role' => 'manager', 'status' => 'active',
    ]);
    Category::factory()->create(['name' => 'Truyện thiếu nhi', 'slug' => 'truyen-thieu-nhi']);

    return [$shelf, $user];
}

function scrBook(Bookshelf $shelf, User $user, array $over = []): Book
{
    $membership = Membership::query()->withoutGlobalScope(BookshelfScope::class)
        ->where('bookshelf_id', $shelf->id)->where('user_id', $user->id)->firstOrFail();
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($user);

    $book = app(CreateBook::class)->execute($user, array_merge([
        'title' => 'Dế Mèn Phiêu Lưu Ký', 'author' => 'Tô Hoài',
        'category_slug' => 'truyen-thieu-nhi', 'copy_count' => 2,
    ], $over));

    app(TenantContext::class)->clear();

    return $book;
}

it('renders the index with rows, categories and the lost-count chip', function () {
    [$shelf, $user] = scrManager();
    scrBook($shelf, $user);

    $this->actingAs($user)
        ->get("/shelves/{$shelf->slug}/manage/books")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/books/index')
            ->has('books.rows', 1)
            ->where('books.rows.0.title', 'Dế Mèn Phiêu Lưu Ký')
            ->where('books.rows.0.codes', 'DT-0001 – DT-0002')
            ->has('categories')
            ->where('lostCount', 0));
});

it('a repeated ?category[]= takes its first value rather than 500ing', function () {
    // Fix round, Task 13's finding: this porting gap pre-dates Task 13 —
    // BookController::index read $request->query('category') the same
    // untyped way Reader\CatalogueController did, so it carried the
    // identical 500 (CatalogueQuery/BooksListQuery's Argument #2 ($slug)
    // must be of type string, array given) for a repeated query key.
    // QueryParam::first() takes the first value, matching old_next's
    // search-params.ts param().
    [$shelf, $user] = scrManager();
    Category::factory()->create(['name' => 'Khác', 'slug' => 'khac']);
    scrBook($shelf, $user, ['title' => 'Dế Mèn Phiêu Lưu Ký', 'category_slug' => 'truyen-thieu-nhi']);
    scrBook($shelf, $user, ['title' => 'Khoa Học Kỳ Thú', 'category_slug' => 'khac']);

    $this->actingAs($user)
        ->get("/shelves/{$shelf->slug}/manage/books?category[]=truyen-thieu-nhi&category[]=khac")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->has('books.rows', 1)
            ->where('books.rows.0.title', 'Dế Mèn Phiêu Lưu Ký')
            ->where('filters.category', 'truyen-thieu-nhi'));
});

it('a repeated ?q[]= takes its first value rather than 500ing', function () {
    // Same porting gap as the category test above: 'q' => $request->query('q')
    // read raw. Here it does not throw — BooksListQuery casts to (string)
    // itself, so an array degrades to "Array" rather than 500ing — but that
    // is exactly the accidental degrade the fix round calls out: it silently
    // searches for the literal word "Array" instead of the reader's first
    // typed term. QueryParam::first() makes the first value the one that
    // actually took effect.
    [$shelf, $user] = scrManager();
    scrBook($shelf, $user, ['title' => 'Dế Mèn Phiêu Lưu Ký']);
    scrBook($shelf, $user, ['title' => 'Khoa Học Kỳ Thú']);

    $this->actingAs($user)
        ->get("/shelves/{$shelf->slug}/manage/books?q[]=de+men&q[]=khoa+hoc")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->has('books.rows', 1)
            ->where('books.rows.0.title', 'Dế Mèn Phiêu Lưu Ký')
            ->where('filters.q', 'de men'));
});

it('the create screen carries every category as an option', function () {
    [$shelf, $user] = scrManager();

    $this->actingAs($user)
        ->get("/shelves/{$shelf->slug}/manage/books/create")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/books/create')
            ->where('categories.0.slug', 'truyen-thieu-nhi'));
});

it('storing a book redirects to its detail page and writes the audit row', function () {
    [$shelf, $user] = scrManager();

    $response = $this->actingAs($user)->post("/shelves/{$shelf->slug}/manage/books", [
        'title' => 'Hoàng Tử Bé', 'author' => 'Antoine de Saint-Exupéry',
        'category_slug' => 'truyen-thieu-nhi', 'copy_count' => 1,
    ]);

    $response->assertRedirect("/shelves/{$shelf->slug}/manage/books/hoang-tu-be");
    expect(AuditLog::query()->where('action', 'book.created')->count())->toBe(1);
});

it('a validation failure returns field errors, not a 500', function () {
    [$shelf, $user] = scrManager();

    $this->actingAs($user)
        ->from("/shelves/{$shelf->slug}/manage/books/create")
        ->post("/shelves/{$shelf->slug}/manage/books", ['title' => '', 'copy_count' => 0])
        ->assertRedirect("/shelves/{$shelf->slug}/manage/books/create")
        ->assertSessionHasErrors(['title', 'author', 'category_slug', 'copy_count']);
});

it('the detail page shows copies with actions and real history rows', function () {
    [$shelf, $user] = scrManager();
    $book = scrBook($shelf, $user);
    $copy = $book->copies->first();
    // One assessment and one closed loan, so the history assertions guard
    // the mapping (assessorName, copyCode) rather than passing on two
    // empty arrays that would survive the queries being deleted.
    $membership = Membership::query()->withoutGlobalScope(BookshelfScope::class)
        ->where('bookshelf_id', $shelf->id)->where('user_id', $user->id)->firstOrFail();
    app(TenantContext::class)->set($shelf, $membership);
    $this->actingAs($user);
    app(AssessCondition::class)
        ->execute($user, $copy, CopyCondition::Worn, 'gáy lỏng');
    Loan::query()->create([
        'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $user->id, 'lent_by' => $user->id,
        'due_on' => '2026-08-01', 'status' => 'returned',
        'return_condition' => 'perfect', 'returned_at' => now(),
    ]);
    app(TenantContext::class)->clear();

    $this->actingAs($user)
        ->get("/shelves/{$shelf->slug}/manage/books/{$book->slug}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/books/show')
            ->where('detail.book.title', 'Dế Mèn Phiêu Lưu Ký')
            ->has('detail.copies', 2)
            ->has('detail.conditionHistory', 1)
            ->where('detail.conditionHistory.0.copyCode', 'DT-0001')
            ->where('detail.conditionHistory.0.condition', 'worn')
            ->has('detail.loanHistory', 1)
            ->where('detail.loanHistory.0.copyCode', 'DT-0001')
            ->where('detail.loanHistory.0.returnCondition', 'perfect'));
});

it('the edit page pre-fills the form and update round-trips', function () {
    [$shelf, $user] = scrManager();
    $book = scrBook($shelf, $user);

    $this->actingAs($user)
        ->get("/shelves/{$shelf->slug}/manage/books/{$book->slug}/edit")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/books/edit')
            ->where('book.categorySlug', 'truyen-thieu-nhi'));

    $this->actingAs($user)
        ->patch("/shelves/{$shelf->slug}/manage/books/{$book->slug}", ['title' => 'Dế Mèn (tái bản)'])
        ->assertRedirect("/shelves/{$shelf->slug}/manage/books/{$book->slug}");

    expect($book->fresh()->title)->toBe('Dế Mèn (tái bản)');
});

it('adding copies from the detail page continues the sequence', function () {
    [$shelf, $user] = scrManager();
    $book = scrBook($shelf, $user);

    $this->actingAs($user)
        ->post("/shelves/{$shelf->slug}/manage/books/{$book->slug}/copies", ['count' => 1])
        ->assertRedirect("/shelves/{$shelf->slug}/manage/books/{$book->slug}");

    expect($book->copies()->withoutGlobalScopes([BookshelfScope::class])->count())->toBe(3);
});

it('the per-copy commands round-trip: assess, report lost, found, retire', function () {
    [$shelf, $user] = scrManager();
    $book = scrBook($shelf, $user);
    $copy = $book->copies->first();
    $base = "/shelves/{$shelf->slug}/manage";

    // assertSessionHasNoErrors on every step: a RuleViolated refusal ALSO
    // redirects back, so a bare assertRedirect would pass on failure and
    // the final state check would catch it only by luck.
    $this->actingAs($user)->post("{$base}/copies/{$copy->id}/assess", ['condition' => 'torn'])
        ->assertRedirect()->assertSessionHasNoErrors();
    $copy->update(['state' => 'on_loan']);
    $this->actingAs($user)->post("{$base}/copies/{$copy->id}/report-lost", [])
        ->assertRedirect()->assertSessionHasNoErrors();
    $this->actingAs($user)->post("{$base}/copies/{$copy->id}/mark-found", [])
        ->assertRedirect()->assertSessionHasNoErrors();
    $this->actingAs($user)->post("{$base}/copies/{$copy->id}/retire", ['reason' => 'cũ nát'])
        ->assertRedirect()->assertSessionHasNoErrors();

    $fresh = $copy->withoutRelations()->fresh();
    expect($fresh->state->value)->toBe('retired')
        ->and($fresh->condition->value)->toBe('torn');
});

it('a business-rule refusal comes back as the rule error, translated', function () {
    [$shelf, $user] = scrManager();
    $book = scrBook($shelf, $user);
    $copy = $book->copies->first();

    $this->actingAs($user)
        ->from("/shelves/{$shelf->slug}/manage/books/{$book->slug}")
        ->post("/shelves/{$shelf->slug}/manage/copies/{$copy->id}/report-lost", [])
        ->assertRedirect("/shelves/{$shelf->slug}/manage/books/{$book->slug}")
        ->assertSessionHasErrors(['rule' => __('rules.copy_not_on_loan')]);
});

it('the lost screen lists lost copies', function () {
    [$shelf, $user] = scrManager();
    $book = scrBook($shelf, $user);
    $book->copies->first()->withoutRelations()->update(['state' => 'lost']);

    $this->actingAs($user)
        ->get("/shelves/{$shelf->slug}/manage/books/lost")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/books/lost')
            ->has('copies', 1)
            ->where('copies.0.code', 'DT-0001'));
});

it('a reader gets 404 on every manager screen and write', function () {
    [$shelf, $manager] = scrManager();
    $book = scrBook($shelf, $manager);
    $reader = User::factory()->create();
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);

    $urls = [
        ['get', "/shelves/{$shelf->slug}/manage/books"],
        ['get', "/shelves/{$shelf->slug}/manage/books/create"],
        ['get', "/shelves/{$shelf->slug}/manage/books/lost"],
        ['get', "/shelves/{$shelf->slug}/manage/books/{$book->slug}"],
        ['post', "/shelves/{$shelf->slug}/manage/books"],
    ];

    foreach ($urls as [$method, $url]) {
        $this->actingAs($reader)->{$method}($url)->assertNotFound();   // 404, never 403 — the URL space confirms nothing
    }
});

// Deliberately its own test, not appended to the one above: actingAs() sets
// the auth guard's cached user for the rest of THAT test method (SessionGuard
// caches $this->user and never re-derives it from the request), so a bare
// $this->post(...) run after actingAs($reader) in the same test would still
// be authenticated as the reader — it would hit role:manager's 404, not a
// login redirect, and the assertion would either be proving the wrong thing
// or (as first written, appended to the reader-404 test above) simply fail.
// tests/Feature/Tenancy/RouteIsolationTest.php's guest-redirect checks
// already use this same one-test-per-guard-state shape for the identical
// reason.
it('a guest gets a login redirect on a manager write', function () {
    [$shelf] = scrManager();

    $this->post("/shelves/{$shelf->slug}/manage/books")->assertRedirect('/login');
});

it('another shelf\'s book slug and copy id are 404 through the scoped bindings', function () {
    [$shelf, $user] = scrManager();
    // A title unique to shelf A: TenantHarness's shelves both carry
    // de-men-phieu-luu-ky by design, so probing with THAT slug would prove
    // nothing (shelf B's manager would legitimately see shelf B's own
    // colliding book). chi-co-o-dong-thap exists on shelf A alone, so the
    // foreign GET's 404 is unambiguous.
    $book = scrBook($shelf, $user, ['title' => 'Chỉ Có Ở Đồng Tháp']);
    $copy = $book->copies->first();

    // A plain factory shelf, NOT TenantHarness::twoCollidingShelves():
    // the harness creates slug dong-thap, which scrManager() already
    // claimed — bookshelves_slug_unique (1062) would kill the test in
    // setup, before it asserted anything.
    $foreign = Bookshelf::factory()->create(['settings' => []]);
    $foreignManager = User::factory()->create();
    Membership::factory()->for($foreign)->create([
        'user_id' => $foreignManager->id, 'role' => 'manager', 'status' => 'active',
    ]);

    $this->actingAs($foreignManager)
        ->get("/shelves/{$foreign->slug}/manage/books/{$book->slug}")
        ->assertNotFound();
    $this->actingAs($foreignManager)
        ->post("/shelves/{$foreign->slug}/manage/copies/{$copy->id}/assess", ['condition' => 'worn'])
        ->assertNotFound();
});
