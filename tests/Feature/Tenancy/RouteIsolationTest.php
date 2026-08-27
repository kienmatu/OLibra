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

    foreach (['manage', 'manage/books', 'manage/lend', 'manage/settings'] as $path) {
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
});

it('never binds another shelf\'s book — scoped bindings, proven on a unique slug', function () {
    ['a' => $a, 'b' => $b] = TenantHarness::twoCollidingShelves();

    $context = app(TenantContext::class);
    $context->actSystemWide();
    $only = Book::query()->create([
        'bookshelf_id' => $a->id, 'title' => 'Kính Vạn Hoa', 'slug' => 'kinh-van-hoa',
    ]);
    $context->clear();

    // The slug exists ONLY on shelf A. Through shelf A it renders; through
    // shelf B the binding resolves via $shelf->books() and finds nothing —
    // 404, not a cross-tenant hit. (Both shelves also hold the colliding
    // 'de-men-phieu-luu-ky'; each resolves to its OWN row, which the
    // TenantIsolation model suite already pins.)
    $this->get("/shelves/{$a->slug}/books/{$only->slug}")->assertOk();
    $this->get("/shelves/{$b->slug}/books/{$only->slug}")->assertNotFound();
});

it('gives a non-super-admin 404 on the admin area', function () {
    ['a' => $a] = TenantHarness::twoCollidingShelves();
    $manager = isolationManager($a->id);

    $this->actingAs($manager)->get('/admin/shelves')->assertNotFound();
});
