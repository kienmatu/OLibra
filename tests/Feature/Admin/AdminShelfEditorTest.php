<?php

use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * Task 4: `/admin/shelves/create` and `/admin/shelves/{bookshelf}/edit` — the
 * first two routes in this application that write a bookshelf. Every shelf
 * before them got there by seeder or by hand.
 *
 * THE FILE'S CENTRE IS THE SLUG BLOCK, and it is worth saying up front what
 * that block is and is not testing, because a green run means two different
 * things depending on which. Spec D1 fixes a shelf's slug at creation, and
 * three separate layers hold it:
 *
 *   1. UpdateBookshelfProfileRequest declines to validate a `slug` field, so
 *      one posted by hand never enters `validated()`.
 *   2. App\Actions\Admin\UpdateBookshelfProfile writes five named fields and
 *      never that one.
 *   3. A trigger (2026_08_26_000020_add_immutability_triggers.php:33-37)
 *      raises SQLSTATE 45000 on an UPDATE that changes the column.
 *
 * The third is a BACKSTOP AND NOT THE SUBJECT. If it ever fires from this
 * path, a volunteer got a 500 from a request the application should have
 * dropped in silence — so the test asserts both that the stored slug is
 * unchanged AND that nothing was thrown, and it runs under
 * withoutExceptionHandling() so a QueryException surfaces as a FAILURE
 * rather than being rendered as a 500 and quietly passing a status
 * assertion. Eloquent writes only dirty attributes, so a command that never
 * sets the column never trips the trigger.
 *
 * Watched failing before it was accepted: `slug` added to the request's
 * rules and to the command's update bag reddens it with exactly the
 * QueryException that failure mode names, not with a changed-slug
 * assertion.
 *
 * THE /admin GROUP BINDS NO TENANT, which is why the fixture widens
 * TenantContext before touching a model at all: BookshelfScope throws on any
 * scoped model with nothing bound. `Bookshelf` itself is not scoped, but the
 * suite's other admin fixtures widen for the same reason and doing it here
 * keeps a later addition (a membership, a contact) from being the first
 * thing to discover it.
 *
 * THE ROUTE PARAMETER IS {bookshelf}, NOT {shelf}, and routes/web.php
 * carries the reason: RouteOrderTest requires the tenant middleware on
 * every route naming {shelf}, and the /admin group binds no tenant on
 * purpose. The block below that walks all four routes as a reader is what
 * would notice if a later task quietly renamed one back.
 *
 * Grep first: `grep -rn "^function adminShelfEditorFix" tests/`.
 */
function adminShelfEditorFix(): User
{
    app(TenantContext::class)->actSystemWide();

    return User::factory()->create(['is_super_admin' => true]);
}

it('creates a shelf and writes bookshelf.created naming it', function () {
    $admin = adminShelfEditorFix();

    $this->actingAs($admin)
        ->post('/admin/shelves', [
            'name' => 'Tủ sách Đồng Tháp',
            'slug' => 'dong-thap-task4',
            'location' => 'Nhà xứ',
            'address' => '12 Nguyễn Huệ',
            'description' => 'Tủ sách của giáo xứ.',
            'established_on' => '2020-03-01',
        ])
        ->assertRedirect('/admin/shelves/dong-thap-task4/edit');

    $shelf = Bookshelf::query()->where('slug', 'dong-thap-task4')->sole();

    expect($shelf->name)->toBe('Tủ sách Đồng Tháp')
        ->and($shelf->location)->toBe('Nhà xứ')
        ->and($shelf->address)->toBe('12 Nguyễn Huệ')
        ->and($shelf->description)->toBe('Tủ sách của giáo xứ.')
        ->and($shelf->established_on?->toDateString())->toBe('2020-03-01')
        ->and($shelf->created_by)->toBe($admin->id);

    // The audit row NAMES THE SHELF rather than being global — spec §5.8,
    // which diverges from the reference (whose entry sets `global: true`).
    // A shelf's own log that begins at its second act would read as though
    // the shelf sprang into being unauthored.
    $row = AuditLog::query()->where('action', 'bookshelf.created')->sole();

    expect($row->bookshelf_id)->toBe($shelf->id)
        ->and($row->entity_id)->toBe($shelf->id)
        ->and($row->actor_id)->toBe($admin->id)
        ->and($row->after['name'])->toBe('Tủ sách Đồng Tháp')
        ->and($row->after['slug'])->toBe('dong-thap-task4');
});

it('refuses a slug already taken by a living shelf', function () {
    $admin = adminShelfEditorFix();
    Bookshelf::factory()->create(['slug' => 'da-co-roi', 'settings' => []]);

    $this->actingAs($admin)
        ->post('/admin/shelves', [
            'name' => 'Tủ sách trùng đường dẫn',
            'slug' => 'da-co-roi',
        ])
        ->assertSessionHasErrors('slug');

    expect(Bookshelf::query()->where('slug', 'da-co-roi')->count())->toBe(1);
});

it('saves the profile and writes bookshelf.updated', function () {
    $admin = adminShelfEditorFix();
    $shelf = Bookshelf::factory()->create([
        'slug' => 'sua-ho-so',
        'name' => 'Tên cũ',
        'settings' => [],
    ]);

    $this->actingAs($admin)
        ->patch('/admin/shelves/sua-ho-so', [
            'name' => 'Tên mới',
            'location' => 'Nhà thờ',
            'address' => null,
            'description' => null,
            'established_on' => null,
        ])
        ->assertRedirect('/admin/shelves/sua-ho-so/edit');

    expect($shelf->fresh()->name)->toBe('Tên mới');

    $row = AuditLog::query()->where('action', 'bookshelf.updated')->sole();

    expect($row->bookshelf_id)->toBe($shelf->id)
        ->and($row->before['name'])->toBe('Tên cũ')
        ->and($row->after['name'])->toBe('Tên mới');
});

it('drops a slug posted to the update path, and does not let the trigger be what refuses it', function () {
    // withoutExceptionHandling() is the whole point: with the handler on, a
    // QueryException from the immutability trigger is rendered as a 500 and
    // a status-only assertion would pass on the failure this test exists to
    // distinguish. See the file docblock.
    $this->withoutExceptionHandling();

    $admin = adminShelfEditorFix();
    $shelf = Bookshelf::factory()->create([
        'slug' => 'duong-dan-co-dinh',
        'name' => 'Tên cũ',
        'settings' => [],
    ]);

    $this->actingAs($admin)
        ->patch('/admin/shelves/duong-dan-co-dinh', [
            'name' => 'Tên mới',
            'slug' => 'duong-dan-moi',
            'location' => null,
            'address' => null,
            'description' => null,
            'established_on' => null,
        ])
        ->assertRedirect('/admin/shelves/duong-dan-co-dinh/edit');

    // The slug is untouched AND the save went through: the request was
    // dropped in silence, which is what "the application layer holds it"
    // means. A shelf whose name did not change either would mean the
    // request was refused wholesale, which is not the behaviour spec D1
    // asks for.
    expect($shelf->fresh()->slug)->toBe('duong-dan-co-dinh')
        ->and($shelf->fresh()->name)->toBe('Tên mới')
        ->and(Bookshelf::query()->where('slug', 'duong-dan-moi')->exists())->toBeFalse();
});

it('renders the create and edit screens with the shapes their forms need', function () {
    $admin = adminShelfEditorFix();
    Bookshelf::factory()->create([
        'slug' => 'man-hinh-sua',
        'name' => 'Tủ sách màn hình',
        'settings' => [],
    ]);

    $this->actingAs($admin)
        ->get('/admin/shelves/create')
        ->assertInertia(fn (AssertableInertia $page) => $page->component('admin/shelves/create'));

    $this->actingAs($admin)
        ->get('/admin/shelves/man-hinh-sua/edit')
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('admin/shelves/edit')
            ->where('shelf.slug', 'man-hinh-sua')
            ->where('shelf.name', 'Tủ sách màn hình')
            ->where('shelf.status', 'active')
            ->has('shelf.location')
            ->has('shelf.address')
            ->has('shelf.description')
            ->has('shelf.establishedOn')
            ->has('shelf.id'));
});

it('404s a signed-in reader on every route this task adds', function () {
    adminShelfEditorFix();
    $shelf = Bookshelf::factory()->create(['slug' => 'khong-phai-cua-ban', 'settings' => []]);
    $reader = User::factory()->create(['is_super_admin' => false]);

    // EnsureSuperAdmin answers first here and this passes with the policy
    // deleted — BookshelfPolicyTest is where the object-level refusal is
    // pinned, for the reason its docblock gives. What this block is for is
    // the ROUTES: four new entries in the admin group, each of which had to
    // be put inside it by hand.
    $this->actingAs($reader)->get('/admin/shelves/create')->assertNotFound();
    $this->actingAs($reader)->post('/admin/shelves', ['name' => 'x', 'slug' => 'x'])->assertNotFound();
    $this->actingAs($reader)->get("/admin/shelves/{$shelf->slug}/edit")->assertNotFound();
    $this->actingAs($reader)->patch("/admin/shelves/{$shelf->slug}", ['name' => 'x'])->assertNotFound();
});
