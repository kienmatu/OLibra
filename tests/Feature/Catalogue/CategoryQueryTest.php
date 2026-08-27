<?php

use App\Models\Book;
use App\Models\Category;
use App\Queries\CategoryQuery;
use Tests\Support\TenantHarness;

function catqFixture(): array
{
    ['a' => $a, 'b' => $b] = TenantHarness::twoCollidingShelves();

    $stocked = Category::factory()->create(['name' => 'Truyện thiếu nhi', 'slug' => 'truyen-thieu-nhi', 'sort_order' => 1]);
    $draftOnly = Category::factory()->create(['name' => 'Giáo lý', 'slug' => 'giao-ly', 'sort_order' => 2]);
    $unstocked = Category::factory()->create(['name' => 'Khác', 'slug' => 'khac', 'sort_order' => 6]);
    $foreignOnly = Category::factory()->create(['name' => 'Lịch sử', 'slug' => 'lich-su', 'sort_order' => 5]);

    Book::factory()->for($a)->create(['category_id' => $stocked->id]);
    Book::factory()->for($a)->create(['category_id' => $draftOnly->id, 'is_published' => false]);
    Book::factory()->for($b)->create(['category_id' => $foreignOnly->id]);

    TenantHarness::actAs($a);

    return [$a, $b];
}

it('stockedByShelf lists only categories with a live, published book on THIS shelf', function () {
    catqFixture();

    $slugs = array_column(app(CategoryQuery::class)->stockedByShelf(), 'slug');

    expect($slugs)->toBe(['truyen-thieu-nhi']);
});

it('includeDrafts reaches the category whose only titles are drafts', function () {
    catqFixture();

    $slugs = array_column(app(CategoryQuery::class)->stockedByShelf(includeDrafts: true), 'slug');

    expect($slugs)->toBe(['truyen-thieu-nhi', 'giao-ly']);
});

it('a soft-deleted book stops carrying its category into the filter bar', function () {
    [$a] = catqFixture();

    Book::query()->whereHas('category', fn ($q) => $q->where('slug', 'truyen-thieu-nhi'))
        ->get()->each->delete();

    expect(app(CategoryQuery::class)->stockedByShelf())->toBe([]);
});

it('allOptions lists every live category regardless of stock, in sort order', function () {
    catqFixture();

    $slugs = array_column(app(CategoryQuery::class)->allOptions(), 'slug');

    expect($slugs)->toBe(['truyen-thieu-nhi', 'giao-ly', 'lich-su', 'khac']);
});

it('a soft-deleted category disappears from both lists', function () {
    catqFixture();
    Category::query()->where('slug', 'khac')->get()->each->delete();

    expect(array_column(app(CategoryQuery::class)->allOptions(), 'slug'))->not->toContain('khac');
});

it('sort_order ties break on the folded name, not byte order', function () {
    // Byte order puts 'Đời sống' (Đ = 0xC4 90) after 'Van hoa'; folded
    // order puts d before v. Same defect, same fix, as the catalogue sort.
    Category::factory()->create(['name' => 'Đời sống đức tin', 'slug' => 'doi-song-duc-tin', 'sort_order' => 9]);
    Category::factory()->create(['name' => 'Văn hoá', 'slug' => 'van-hoa', 'sort_order' => 9]);
    ['a' => $a] = TenantHarness::twoCollidingShelves();
    TenantHarness::actAs($a);

    $names = array_column(app(CategoryQuery::class)->allOptions(), 'slug');
    $doi = array_search('doi-song-duc-tin', $names, true);
    $van = array_search('van-hoa', $names, true);

    expect($doi)->toBeLessThan($van);
});
