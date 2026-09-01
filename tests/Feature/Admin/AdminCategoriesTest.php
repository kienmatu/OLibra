<?php

use App\Models\AuditLog;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\Category;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * Phase 3b-ii Task 3: `/admin/categories` — the book genres, one taxonomy
 * every tủ sách in the installation shares.
 *
 * THREE RULES CARRY THIS FILE, and each has a test that fails when the rule
 * is removed rather than merely one that passes while it holds:
 *
 * 1. **Archiving is refused while live books still carry the genre.** The
 *    schema cannot enforce it — `ON DELETE SET NULL` fires on a hard delete
 *    and this is a soft one — so `ArchiveCategory`'s own check is the only
 *    thing there. WATCHED FAILING: with the `category_in_use` guard dropped
 *    from that command, the refusal test reddens on the missing session
 *    error and on the row having been archived anyway; restored by a
 *    targeted edit, green.
 * 2. **The check spans every shelf.** The `/admin` group binds no tenant, so
 *    the in-use test puts its book on a shelf the request is not bound to —
 *    a guard narrowed to one shelf would report a genre unused while another
 *    parish's whole collection sat on it.
 * 3. **A rename never moves the slug**, because moving it would silently
 *    repoint every book already catalogued under the old handle.
 *
 * THE /admin GROUP BINDS NO TENANT, so the fixture widens before touching a
 * model — load-bearing here rather than defensive, because `Book` carries
 * `BelongsToBookshelf` and this file creates one.
 *
 * Grep first: `grep -rn "^function adminCategoriesFix" tests/`.
 */
function adminCategoriesFix(): User
{
    app(TenantContext::class)->actSystemWide();

    return User::factory()->create(['is_super_admin' => true]);
}

it('lists the live genres with the book count the archive guard reads', function () {
    $admin = adminCategoriesFix();

    $withBooks = Category::factory()->create(['name' => 'Truyện tranh', 'sort_order' => 1]);
    $empty = Category::factory()->create(['name' => 'Sách giáo lý', 'sort_order' => 2]);
    $archived = Category::factory()->create(['name' => 'Đã cất đi', 'sort_order' => 3]);
    $archived->delete();

    $shelf = Bookshelf::factory()->create(['slug' => 'shelf-categories', 'settings' => []]);
    Book::factory()->for($shelf)->create(['category_id' => $withBooks->id]);
    // A book in the bin does not count: a genre whose only reference is a
    // deleted book is not in use by anything a reader can still see, and the
    // command's guard reads the same predicate.
    Book::factory()->for($shelf)->create(['category_id' => $withBooks->id])->delete();

    $this->actingAs($admin)
        ->get('/admin/categories')
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('admin/categories/index')
            // Two, not three — the archived one is gone from the list, and
            // there is no un-archive control anywhere to bring it back.
            ->has('categories', 2)
            ->where('categories.0.name', 'Truyện tranh')
            ->where('categories.0.bookCount', 1)
            ->where('categories.1.name', 'Sách giáo lý')
            ->where('categories.1.bookCount', 0)
        );

});

it('creates a genre with a slug folded from the name, and audits it globally', function () {
    $admin = adminCategoriesFix();

    $this->actingAs($admin)
        ->post('/admin/categories', ['name' => 'Truyện tranh thiếu nhi'])
        ->assertRedirect('/admin/categories')
        ->assertSessionHas('success', __('rules.category_created_flash'));

    $category = Category::query()->sole();

    // Folded and hyphenated — đ is a letter in its own right, not a d with
    // a diacritic, which is exactly the case Fold's own table exists for.
    expect($category->name)->toBe('Truyện tranh thiếu nhi')
        ->and($category->slug)->toBe('truyen-tranh-thieu-nhi')
        // First row in the table, so it sorts first; the next one sorts
        // after it rather than fighting it for the same place.
        ->and($category->sort_order)->toBe(1);

    $row = AuditLog::query()->where('action', 'category.created')->sole();

    // NO SHELF. categories has no bookshelf_id, so there is no shelf whose
    // own log this act could belong on — the recorder's cross-shelf arm,
    // which is why the command lives in app/Actions/Admin.
    expect($row->bookshelf_id)->toBeNull()
        ->and($row->entity_type)->toBe('category')
        ->and($row->entity_id)->toBe($category->id)
        ->and($row->after['slug'])->toBe('truyen-tranh-thieu-nhi');
});

it('refuses a second genre whose derived slug is taken, archived ones included', function () {
    $admin = adminCategoriesFix();

    $first = Category::factory()->create(['name' => 'Truyện tranh', 'slug' => 'truyen-tranh']);
    $first->delete();

    // categories.slug is unique with NO soft-delete partition, so the
    // archived row still holds the handle. A check that ignored it would
    // send a 1062 to the driver where a Vietnamese sentence belongs.
    $this->actingAs($admin)
        ->post('/admin/categories', ['name' => 'truyện tranh'])
        ->assertSessionHasErrors(['rule' => __('rules.duplicate_category')]);

    expect(Category::query()->withTrashed()->count())->toBe(1);
});

it('refuses a name that folds to nothing at all', function () {
    $admin = adminCategoriesFix();

    // Fold maps everything outside [a-z0-9] to a space, so a name made only
    // of punctuation would insert a row with an unusable handle.
    $this->actingAs($admin)
        ->post('/admin/categories', ['name' => '!!!'])
        ->assertSessionHasErrors(['rule' => __('rules.validation_failed')]);

    expect(Category::query()->withTrashed()->count())->toBe(0);
});

it('renames a genre and leaves its slug exactly where it was', function () {
    $admin = adminCategoriesFix();

    $category = Category::factory()->create(['name' => 'Truyện tranh', 'slug' => 'truyen-tranh']);

    $this->actingAs($admin)
        ->patch("/admin/categories/{$category->id}", ['name' => 'Truyện thiếu nhi'])
        ->assertRedirect('/admin/categories')
        ->assertSessionHas('success', __('rules.category_renamed_flash'));

    $category->refresh();

    // THE ASSERTION THIS TEST EXISTS FOR. A rename that also moved the slug
    // would silently repoint every book already catalogued under the old
    // handle — the hazard 3b-i records for a tủ sách's slug.
    expect($category->name)->toBe('Truyện thiếu nhi')
        ->and($category->slug)->toBe('truyen-tranh');

    $row = AuditLog::query()->where('action', 'category.renamed')->sole();

    expect($row->bookshelf_id)->toBeNull()
        ->and($row->before['name'])->toBe('Truyện tranh')
        ->and($row->after['name'])->toBe('Truyện thiếu nhi');
});

it('refuses to archive a genre while a book on any shelf still carries it', function () {
    $admin = adminCategoriesFix();

    $category = Category::factory()->create(['name' => 'Truyện tranh']);
    $shelf = Bookshelf::factory()->create(['slug' => 'shelf-in-use', 'settings' => []]);
    Book::factory()->for($shelf)->create(['category_id' => $category->id]);

    $this->actingAs($admin)
        ->post("/admin/categories/{$category->id}/archive")
        ->assertSessionHasErrors(['rule' => __('rules.category_in_use')]);

    // Not archived, and the book kept its label. `ON DELETE SET NULL` never
    // fires on a soft delete, so without the guard this book would keep a
    // genre no screen will ever offer again.
    // Read back through the default scope, which is what every screen and
    // picker reads through: `fresh()` would answer with the row even after
    // a soft delete, so it cannot tell the two states apart.
    expect(Category::query()->find($category->id))->not->toBeNull();
});

it('archives an empty genre, and it leaves the picker', function () {
    $admin = adminCategoriesFix();

    $category = Category::factory()->create(['name' => 'Sách giáo lý']);
    // A book already in the bin does not hold the genre open.
    $shelf = Bookshelf::factory()->create(['slug' => 'shelf-archivable', 'settings' => []]);
    Book::factory()->for($shelf)->create(['category_id' => $category->id])->delete();

    $this->actingAs($admin)
        ->post("/admin/categories/{$category->id}/archive")
        ->assertRedirect('/admin/categories')
        ->assertSessionHas('success', __('rules.category_archived_flash'));

    // Gone from the default scope, still on the table — a soft delete, so
    // every book that ever carried the genre keeps it.
    expect(Category::query()->find($category->id))->toBeNull()
        ->and(Category::query()->withTrashed()->count())->toBe(1);

    // Gone from the screen, which is what "leaves the picker" means for
    // every list that reads live categories.
    $this->actingAs($admin)
        ->get('/admin/categories')
        ->assertInertia(fn (AssertableInertia $page) => $page->has('categories', 0));

    $row = AuditLog::query()->where('action', 'category.archived')->sole();

    expect($row->bookshelf_id)->toBeNull()
        ->and($row->before['name'])->toBe('Sách giáo lý');
});

it('refuses every one of the four routes to somebody who is not a super admin', function () {
    app(TenantContext::class)->actSystemWide();
    $reader = User::factory()->create();
    $category = Category::factory()->create();

    // 404 and not 403, the whole /admin group's shape on BR §5.4's
    // anti-enumeration rule — CategoryPolicy answers denyAsNotFound() so it
    // cannot disagree with the middleware above it.
    $this->actingAs($reader)->get('/admin/categories')->assertNotFound();
    $this->actingAs($reader)->post('/admin/categories', ['name' => 'X'])->assertNotFound();
    $this->actingAs($reader)->patch("/admin/categories/{$category->id}", ['name' => 'X'])->assertNotFound();
    $this->actingAs($reader)->post("/admin/categories/{$category->id}/archive")->assertNotFound();

    expect(Category::query()->count())->toBe(1);
});
