<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use Database\Seeders\CategorySeeder;
use Illuminate\Support\Facades\DB;

it('seeds the six default categories, verbatim from 20260810_02', function () {
    $this->seed(CategorySeeder::class);

    $rows = DB::table('categories')->orderBy('sort_order')->get(['name', 'slug', 'sort_order']);

    expect($rows->map(fn ($row) => [$row->name, $row->slug, $row->sort_order])->all())->toBe([
        ['Truyện thiếu nhi', 'truyen-thieu-nhi', 1],
        ['Giáo lý', 'giao-ly', 2],
        ['Kỹ năng sống', 'ky-nang-song', 3],
        ['Sách tham khảo', 'sach-tham-khao', 4],
        ['Lịch sử', 'lich-su', 5],
        ['Khác', 'khac', 6],
    ]);
});

it('is idempotent — a fresh install had no categories and no way to make one', function () {
    $this->seed(CategorySeeder::class);
    $this->seed(CategorySeeder::class);

    expect(DB::table('categories')->count())->toBe(6);
});

it('builds valid rows from every factory', function () {
    $shelf = Bookshelf::factory()->create();
    $user = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->for($user)->create();
    $book = Book::factory()->for($shelf)->create();
    $copy = BookCopy::factory()->for($shelf)->for($book, 'book')->create();

    expect($shelf->refresh()->slug)->not->toBe('')
        ->and($user->refresh()->saint_name)->not->toBe('')
        ->and($membership->refresh()->bookshelf_id)->toBe($shelf->id)
        ->and($book->refresh()->title_folded)->not->toBe('')
        ->and($copy->refresh()->code)->toStartWith('DT-');
});

it('gives factory users no credentials by default — most readers never sign in', function () {
    $user = User::factory()->create();

    expect($user->username)->toBeNull()
        ->and($user->password_hash)->toBeNull();
});
