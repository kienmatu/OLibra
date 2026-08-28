<?php

use App\Models\Book;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Hash;
use Tests\Support\TenantHarness;

function isolationManager(string $bookshelfId): User
{
    $user = new User([
        'saint_name' => 'Giuse', 'full_name' => 'Trần Minh',
        'father_name' => 'Cha', 'mother_name' => 'Mẹ',
    ]);
    $user->username = 'minh-'.substr($bookshelfId, -6);
    $user->password_hash = Hash::make('mat-khau-123');
    $user->save();

    Membership::query()->withoutGlobalScopes()->create([
        'bookshelf_id' => $bookshelfId, 'user_id' => $user->id,
        'role' => 'manager', 'status' => 'active',
    ]);

    return $user;
}

it('gives a manager of shelf A 404 — not 403 — on shelf B manage urls', function () {
    ['a' => $a, 'b' => $b] = TenantHarness::twoCollidingShelves();
    $manager = isolationManager($a->id);

    $this->actingAs($manager)->get("/shelves/{$a->slug}/manage")->assertOk();

    foreach (['manage', 'manage/books', 'manage/lend', 'manage/settings',
        'manage/readers', 'manage/registrations'] as $path) {
        // 404 so the URL space does not confirm what exists.
        $this->actingAs($manager)->get("/shelves/{$b->slug}/{$path}")->assertNotFound();
    }
});

it('gives a signed-in reader 404 on manage urls of their own shelf', function () {
    ['a' => $a] = TenantHarness::twoCollidingShelves();
    $reader = new User([
        'saint_name' => 'Anna', 'full_name' => 'Phạm Thu Hà',
        'father_name' => 'Cha', 'mother_name' => 'Mẹ',
    ]);
    $reader->username = 'ha';
    $reader->password_hash = Hash::make('mat-khau-123');
    $reader->save();
    Membership::query()->withoutGlobalScopes()->create([
        'bookshelf_id' => $a->id, 'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);

    $this->actingAs($reader)->get("/shelves/{$a->slug}/manage")->assertNotFound();
});

it('redirects a guest from manage urls to login', function () {
    ['a' => $a] = TenantHarness::twoCollidingShelves();

    $this->get("/shelves/{$a->slug}/manage")->assertRedirect('/login');

    // The same redirect must hold for an UNKNOWN slug too — that is the
    // property the manage group's explicit 'auth' middleware exists for.
    // Without 'auth' on the route, bootstrap/app.php's priority list has
    // nothing to reorder ahead of ResolveTenant, so a guest on an unknown
    // slug would 404 straight out of ResolveTenant while a guest on a
    // known slug redirects — an unauthenticated existence oracle over the
    // shelf URL space. Removing 'auth' from the manage group turns this
    // assertion red (404) while every other assertion in this file stays
    // green, which is exactly why it has to be pinned here explicitly.
    $this->get('/shelves/khong-ton-tai/manage')->assertRedirect('/login');
});

it('never binds another shelf\'s book — scoped bindings, proven on a unique slug', function () {
    ['a' => $a, 'b' => $b] = TenantHarness::twoCollidingShelves();
    $readerA = TenantHarness::readerFor($a);
    $readerB = TenantHarness::readerFor($b);

    $context = app(TenantContext::class);
    $context->actSystemWide();
    $only = Book::query()->create([
        'bookshelf_id' => $a->id, 'title' => 'Kính Vạn Hoa', 'slug' => 'kinh-van-hoa',
    ]);
    $context->clear();

    // The slug exists ONLY on shelf A. Through shelf A it renders; through
    // shelf B the request 404s. (Both shelves also hold the colliding
    // 'de-men-phieu-luu-ky'; each resolves to its OWN row, which the
    // TenantIsolation model suite already pins.) Each request acts as that
    // shelf's own reader — PR #57 review follow-up 2 gates books/{book}
    // behind role:reader, so a guest would be redirected before the
    // binding is ever reached, proving nothing about the binding itself.
    //
    // CORRECTED (whole-branch review, PR #60): this does NOT prove
    // routes/web.php's scopeBindings() does anything — it cannot
    // distinguish "the binding resolved via $shelf->books() and found
    // nothing" from "the binding queried Book table-wide and Eloquent's
    // BookshelfScope global scope, bound by the tenant middleware to shelf
    // B for this whole request, filtered shelf A's row out anyway." Removing
    // scopeBindings() from that route group leaves this assertion, and the
    // entire suite, green — verified directly. This test pins the 404
    // outcome, which is real and worth keeping; it is BookshelfScope doing
    // the work, not the parent-relationship binding. See routes/web.php's
    // corrected comment on that route group.
    $this->actingAs($readerA)->get("/shelves/{$a->slug}/books/{$only->slug}")->assertOk();
    $this->actingAs($readerB)->get("/shelves/{$b->slug}/books/{$only->slug}")->assertNotFound();
});

it('gives a non-super-admin 404 on the admin area', function () {
    ['a' => $a] = TenantHarness::twoCollidingShelves();
    $manager = isolationManager($a->id);

    $this->actingAs($manager)->get('/admin/shelves')->assertNotFound();
});

it('lets a super admin into the admin area — the allow path is not just an absence of denial', function () {
    // Only the 404 branch of EnsureSuperAdmin had coverage: a typo in the
    // attribute name (is_super_admin vs is_superadmin, say) would close
    // the admin area to EVERYONE and every test above would stay green,
    // since none of them ever proves anyone gets in.
    $admin = new User([
        'saint_name' => 'Phero', 'full_name' => 'Nguyen Van Admin',
        'father_name' => 'Cha', 'mother_name' => 'Me',
    ]);
    $admin->username = 'admin-'.uniqid();
    $admin->password_hash = Hash::make('mat-khau-123');
    $admin->is_super_admin = true;
    $admin->save();

    $this->actingAs($admin)->get('/admin/shelves')->assertOk();
});

it('redirects a guest from the admin area to login', function () {
    $this->get('/admin/shelves')->assertRedirect('/login');
});
