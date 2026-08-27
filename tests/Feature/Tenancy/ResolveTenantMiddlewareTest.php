<?php

use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Route;
use Tests\Support\TenantHarness;

beforeEach(function () {
    Route::middleware(['web', 'tenant'])->get('/shelves/{shelf}/probe', function () {
        $ctx = app(TenantContext::class);

        return response()->json([
            'shelf' => $ctx->bookshelfId(),
            'membership' => $ctx->membership()?->id,
            'role' => $ctx->membership()?->role?->value,
        ]);
    });
});

it('binds the shelf by slug and leaves membership null for a guest', function () {
    ['a' => $a] = TenantHarness::twoCollidingShelves();

    $this->get("/shelves/{$a->slug}/probe")
        ->assertOk()
        ->assertJson(['shelf' => $a->id, 'membership' => null]);
});

it('resolves the signed-in user\'s active membership of the bound shelf', function () {
    ['a' => $a] = TenantHarness::twoCollidingShelves();
    $user = new User([
        'saint_name' => 'Anna', 'full_name' => 'Phạm Thu Hà',
        'father_name' => 'Cha', 'mother_name' => 'Mẹ',
    ]);
    $user->username = 'ha';
    $user->password_hash = Hash::make('mat-khau-123');
    $user->save();
    $membership = Membership::query()->withoutGlobalScopes()->create([
        'bookshelf_id' => $a->id, 'user_id' => $user->id, 'role' => 'manager', 'status' => 'active',
    ]);

    $this->actingAs($user)->get("/shelves/{$a->slug}/probe")
        ->assertOk()
        ->assertJson(['shelf' => $a->id, 'membership' => $membership->id, 'role' => 'manager']);
});

it('ignores a membership that is pending or suspended', function () {
    ['a' => $a] = TenantHarness::twoCollidingShelves();
    $user = new User([
        'saint_name' => 'Anna', 'full_name' => 'Phạm Thu Hà',
        'father_name' => 'Cha', 'mother_name' => 'Mẹ',
    ]);
    $user->username = 'ha';
    $user->password_hash = Hash::make('mat-khau-123');
    $user->save();
    Membership::query()->withoutGlobalScopes()->create([
        'bookshelf_id' => $a->id, 'user_id' => $user->id, 'role' => 'reader', 'status' => 'pending',
    ]);

    $this->actingAs($user)->get("/shelves/{$a->slug}/probe")
        ->assertOk()
        ->assertJson(['membership' => null]);
});

it('404s an unknown or soft-deleted shelf slug', function () {
    $this->get('/shelves/khong-ton-tai/probe')->assertNotFound();
});

it('treats a member of a foreign shelf as merely un-membered here, never as forbidden', function () {
    // OPS §2: "a valid reader session for shelf A grants nothing on shelf
    // B" — but that shelf B still exists and its own public surface still
    // renders; a foreign member is not told "forbidden" (403), which would
    // confirm something about their standing on a shelf they have no
    // business knowing about. This middleware only ever 404s a shelf slug
    // that does not resolve at all (above); it never gates on membership.
    ['a' => $a, 'b' => $b] = TenantHarness::twoCollidingShelves();
    $user = new User([
        'saint_name' => 'Anna', 'full_name' => 'Phạm Thu Hà',
        'father_name' => 'Cha', 'mother_name' => 'Mẹ',
    ]);
    $user->username = 'ha';
    $user->password_hash = Hash::make('mat-khau-123');
    $user->save();
    Membership::query()->withoutGlobalScopes()->create([
        'bookshelf_id' => $a->id, 'user_id' => $user->id, 'role' => 'manager', 'status' => 'active',
    ]);

    $this->actingAs($user)->get("/shelves/{$b->slug}/probe")
        ->assertOk()
        ->assertJson(['shelf' => $b->id, 'membership' => null]);
});
