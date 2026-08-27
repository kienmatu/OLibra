<?php

use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Route;
use Tests\Support\TenantHarness;

beforeEach(function () {
    // Route::has, not an unconditional Route::get: Pest loads every test
    // file into a single process, and this route was found to survive
    // (and pollute) every test file registered after this one's — a fresh
    // Illuminate\Routing\Router is not created per test the way the rest of
    // the container is. Registering it once, idempotently, keeps this
    // file's own tests working without adding a route the router keeps
    // forever regardless of which test asked for it.
    if (! Route::has('tenancy-test.probe')) {
        Route::middleware(['web', 'tenant'])->get('/shelves/{shelf}/probe', function () {
            $ctx = app(TenantContext::class);

            return response()->json([
                'shelf' => $ctx->bookshelfId(),
                'membership' => $ctx->membership()?->id,
                'role' => $ctx->membership()?->role?->value,
            ]);
        })->name('tenancy-test.probe');
    }
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

it('ignores a membership that was soft-deleted, even though its status column still reads active', function () {
    // CRITICAL, found in review: withoutGlobalScopes() (no argument) strips
    // EVERY global scope, not just BookshelfScope — including
    // SoftDeletingScope. memberships_one_per_shelf is built on
    // IF(deleted_at IS NULL, ...) precisely so a removed member's old row
    // can coexist with a fresh one without colliding; a query that ignores
    // deleted_at hands a removed member their old role right back the very
    // next request. The fix scopes the exemption to
    // withoutGlobalScope(BookshelfScope::class) alone.
    ['a' => $a] = TenantHarness::twoCollidingShelves();
    $user = new User([
        'saint_name' => 'Anna', 'full_name' => 'Phạm Thu Hà',
        'father_name' => 'Cha', 'mother_name' => 'Mẹ',
    ]);
    $user->username = 'ha';
    $user->password_hash = Hash::make('mat-khau-123');
    $user->save();
    $membership = Membership::query()->withoutGlobalScopes()->create([
        'bookshelf_id' => $a->id, 'user_id' => $user->id, 'role' => 'admin', 'status' => 'active',
    ]);
    $membership->delete();

    $this->actingAs($user)->get("/shelves/{$a->slug}/probe")
        ->assertOk()
        ->assertJson(['membership' => null]);
});

it('404s an unknown shelf slug', function () {
    $this->get('/shelves/khong-ton-tai/probe')->assertNotFound();
});

it('404s a soft-deleted shelf slug', function () {
    ['a' => $a] = TenantHarness::twoCollidingShelves();
    Bookshelf::query()->whereKey($a->id)->delete();

    $this->get("/shelves/{$a->slug}/probe")->assertNotFound();
});

it('treats a member of a foreign shelf as merely un-membered here, never as forbidden', function () {
    // OPS §2: "a valid reader session for shelf A grants nothing on shelf
    // B" — but that shelf B still exists and its own public surface still
    // renders; a foreign member is not told "forbidden" (403), which would
    // confirm something about their standing on a shelf they have no
    // business knowing about. This middleware only ever 404s a shelf slug
    // that does not resolve at all (above); it never gates on membership.
    // NOTE: this probe route has no authorization gate at all (Task 17's
    // Gates and Task 18's real routes don't exist yet), so the strongest
    // thing this test can show is "200 with membership: null" rather than
    // literally "404 instead of 403" for a resource under a foreign shelf —
    // that stronger property is deferred to Tasks 17/18, which is where an
    // actual protected resource and an actual 403-shaped authorization
    // check first exist to compare against.
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
