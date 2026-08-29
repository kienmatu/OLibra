<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Category;
use App\Models\Membership;
use App\Models\User;
use Database\Seeders\CategorySeeder;
use Database\Seeders\DemoShelfSeeder;
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

it('persists every factory called bare — no ->for(), no explicit ids', function () {
    // BookCopyFactory previously resolved bookshelf_id and book_id from two
    // INDEPENDENT nested Bookshelf::factory()/Book::factory() calls, so a
    // bare BookCopy::factory()->create() landed the copy on one shelf while
    // its book landed on another — tripping the composite FK
    // (bookshelf_id, book_id) -> books(bookshelf_id, id) every time. Only
    // SeederTest's other test and DemoShelfSeeder exercised it, and both
    // always named the shelf/book explicitly, so the defect went unnoticed.
    // This proves every factory also stands on its own.
    $bookshelf = Bookshelf::factory()->create();
    $user = User::factory()->create();
    $category = Category::factory()->create();
    $membership = Membership::factory()->create();
    $book = Book::factory()->create();
    $copy = BookCopy::factory()->create();

    expect($bookshelf->wasRecentlyCreated)->toBeTrue()
        ->and($user->wasRecentlyCreated)->toBeTrue()
        ->and($category->wasRecentlyCreated)->toBeTrue()
        ->and($membership->wasRecentlyCreated)->toBeTrue()
        ->and($book->wasRecentlyCreated)->toBeTrue()
        ->and($copy->wasRecentlyCreated)->toBeTrue()
        // The defect this test exists to catch: the copy's bookshelf_id
        // must be the SAME shelf as its own book's bookshelf_id.
        ->and($copy->bookshelf_id)->toBe(DB::table('books')->where('id', $copy->book_id)->value('bookshelf_id'));
});

it('leaves a soft-deleted default category deleted on re-seed instead of colliding on its slug', function () {
    // categories.slug is a plain unique index, not one of the ten
    // soft-delete-aware generated-column uniques — re-running the naive
    // firstOrCreate(['slug' => ...]) after a soft-delete throws
    // UniqueConstraintViolationException because it looks only among alive
    // rows and then tries to INSERT into a slug a trashed row still holds.
    $this->seed(CategorySeeder::class);

    Category::query()->where('slug', 'khac')->firstOrFail()->delete();

    $this->seed(CategorySeeder::class);

    expect(Category::query()->where('slug', 'khac')->exists())->toBeFalse()
        ->and(Category::withTrashed()->where('slug', 'khac')->exists())->toBeTrue()
        ->and(DB::table('categories')->count())->toBe(6);
});

it('runs DemoShelfSeeder twice without error and without duplicating rows', function () {
    $this->seed(DemoShelfSeeder::class);
    $this->seed(DemoShelfSeeder::class);

    // Phase 1b added five demo readers (AGENTS.md's fixture people), two of
    // which — Giuse Trần Minh and Phêrô Nguyễn Văn Bình — deliberately
    // reuse the manager and super-admin fixtures already created above by
    // full_name, per AGENTS.md's "use the same fixtures everywhere" —
    // rather than minting two more accounts. So only three of the five
    // (Maria, Têrêsa, Anna) are genuinely new users: 2 (manager, admin) + 3.
    // Memberships: the manager's own (1) plus one new reader membership per
    // demo person whose (bookshelf, user) pair didn't already have a row —
    // Maria, Têrêsa, Anna, and the super-admin (reused by name, but with no
    // prior membership on this shelf) becomes a fourth, pending: 1 + 4.
    //
    // Task 14 added a living shelf: two NEW, distinctly-named borrowers
    // (Vũ Thị Đang Mượn, Bùi Văn Trễ Hạn — never reusing a full_name minted
    // above, the seeder's own name-reuse trap) each with their own active
    // reader membership, plus one active and one overdue loan against two
    // of the eight seeded copies. +2 users, +2 memberships, +2 loans.
    expect(DB::table('bookshelves')->count())->toBe(1)
        ->and(DB::table('users')->count())->toBe(7)
        ->and(DB::table('memberships')->count())->toBe(7)
        ->and(DB::table('parish_units')->count())->toBe(5)
        ->and(DB::table('books')->count())->toBe(4)
        ->and(DB::table('book_copies')->count())->toBe(8)
        ->and(DB::table('loans')->count())->toBe(2)
        ->and(DB::table('book_copies')->where('state', 'on_loan')->count())->toBe(2);
});
