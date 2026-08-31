<?php

use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * Grep first: `grep -rn "^function statScreenFix" tests/`.
 *
 * @return array{Bookshelf, User}
 */
function statScreenFix(string $slug = 'dong-thap-statscreen'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Nguyễn Lan']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);

    return [$shelf, $manager];
}

it('renders the statistics page with the four totals and the two charts', function () {
    [$shelf, $manager] = statScreenFix();

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/statistics")
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/statistics')
            ->has('stats.loans')
            ->has('stats.borrowers')
            ->has('stats.booksAdded')
            ->has('stats.copiesLost')
            ->has('stats.daily')
            ->has('stats.byCategory')
            ->has('stats.topBooks')
            ->has('stats.topReaders')
            ->where('stats.period', 'month'));
});

it('an unknown period falls back to the default rather than erroring', function () {
    [$shelf, $manager] = statScreenFix();

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/statistics?period=fortnight")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->where('stats.period', 'month'));
});

it('a named period reaches the query', function () {
    [$shelf, $manager] = statScreenFix();

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/statistics?period=year")
        ->assertInertia(fn (AssertableInertia $page) => $page->where('stats.period', 'year'));
});

it('a reader cannot reach the statistics screen, and meets 404 rather than 403', function () {
    [$shelf] = statScreenFix();
    $reader = User::factory()->create();
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);

    // 404, not 403: spec §5.4 forbids a refusal that confirms which shelf
    // URLs exist. EnsureShelfRole aborts 404 on the ability check.
    $this->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/manage/statistics")
        ->assertNotFound();
});

it('a guest is redirected to login rather than 404d', function () {
    [$shelf] = statScreenFix();

    $this->get("/shelves/{$shelf->slug}/manage/statistics")->assertRedirect();
});
