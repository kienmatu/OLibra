<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Category;
use App\Models\Membership;
use App\Models\User;
use Database\Seeders\CategorySeeder;
use Database\Seeders\DatabaseSeeder;
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
    //
    // Task 19 added a living queue and a living bell: one pending request,
    // one approved hold (its copy flipped to held) and the notification
    // that announces it. No new user or membership — both requesters are
    // demo readers already seeded above. The copies stay at eight because
    // the catalogue block now writes AGENTS.md's four titles and eight
    // codes explicitly instead of rolling them: before that, a title the
    // request block names could be absent from a given run and the block
    // would mint a ninth copy for it, which is what made this assertion
    // fail intermittently rather than never.
    expect(DB::table('bookshelves')->count())->toBe(1)
        ->and(DB::table('users')->count())->toBe(7)
        ->and(DB::table('memberships')->count())->toBe(7)
        ->and(DB::table('parish_units')->count())->toBe(5)
        ->and(DB::table('books')->count())->toBe(4)
        ->and(DB::table('book_copies')->count())->toBe(8)
        ->and(DB::table('loans')->count())->toBe(2)
        ->and(DB::table('book_copies')->where('state', 'on_loan')->count())->toBe(2)
        ->and(DB::table('borrow_requests')->count())->toBe(2)
        ->and(DB::table('borrow_requests')->where('status', 'approved')->count())->toBe(1)
        ->and(DB::table('book_copies')->where('state', 'held')->count())->toBe(1)
        ->and(DB::table('notifications')->count())->toBe(1);
});

it('seeds AGENTS.md\'s four titles by name, not by a random draw', function () {
    // The demo request block names two of them (Totto-chan, Đất Rừng
    // Phương Nam) and BookFactory used to pick among the four randomly WITH
    // replacement, so a run could seed the same title twice and leave one
    // out. This is the assertion that stops that regressing — without it
    // the block above only notices through a count that happens to move.
    $this->seed(DemoShelfSeeder::class);

    // Sorted in PHP, byte order, not by the database: MariaDB's own
    // collation puts 'Đất' before 'Hoàng', which is correct Vietnamese and
    // has nothing to do with what this test is asking.
    $titles = DB::table('books')->pluck('title')->all();
    sort($titles);

    expect($titles)->toBe([
        'Dế Mèn Phiêu Lưu Ký', 'Hoàng Tử Bé', 'Totto-chan Bên Cửa Sổ', 'Đất Rừng Phương Nam',
    ]);
});

it('DatabaseSeeder runs DemoShelfSeeder only in local — the gate the deploy relies on', function () {
    // `deploy/post-deploy.sh` runs `artisan db:seed --force` UNCONDITIONALLY
    // on every deploy, and its own comment says that is safe because
    // "DatabaseSeeder gates DemoShelfSeeder behind app()->environment('local')
    // … production only ever gets CategorySeeder". That gate was asserted by
    // nothing: deleting the `if` left the whole suite green while the next
    // deploy would have written a demo shelf, demo readers, demo loans and —
    // since Task 19 — a third account with a working password into the
    // production database. A shipped script's stated safety premise deserves
    // a test on this side of it.
    //
    // The environment is forced to production rather than left at `testing`,
    // which already is not `local`: the point is the deploy's own case, and a
    // test that passes because of the harness's default is testing the
    // harness. The premise is asserted first for the same reason.
    $this->app->detectEnvironment(fn () => 'production');

    // `db:seed --force`, the deploy's own invocation, not $this->seed():
    // db:seed is confirmable, so without --force it prompts in production and
    // the test dies on a ConfirmationQuestion instead of exercising the gate
    // (measured — that is exactly what the first version of this block did).
    $this->artisan('db:seed', ['--class' => DatabaseSeeder::class, '--force' => true]);

    expect(app()->environment())->toBe('production')
        // CategorySeeder still runs — a production install with no categories
        // cannot satisfy the required "Thể loại" field, which is why the
        // deploy calls db:seed at all.
        ->and(DB::table('categories')->count())->toBe(6)
        // …and nothing DemoShelfSeeder writes exists. The shelf is its first
        // row, so it is the one that cannot be reached without running.
        ->and(DB::table('bookshelves')->count())->toBe(0)
        ->and(DB::table('users')->count())->toBe(0)
        ->and(DB::table('borrow_requests')->count())->toBe(0);
});
