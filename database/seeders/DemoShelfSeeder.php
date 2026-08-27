<?php

namespace Database\Seeders;

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Database\Seeder;

/** The AGENTS.md demo fixtures — local development only, never production. */
class DemoShelfSeeder extends Seeder
{
    public function run(): void
    {
        // TenantContext's own docblock names this the sanctioned way for a
        // seeder to read shelf-scoped models: opt in BY NAME, then name
        // every bookshelf_id explicitly (done throughout below). Without
        // this, any SELECT through Book/Membership/BookCopy — including the
        // idempotency checks this method needs — throws the fail-closed
        // RuntimeException from BookshelfScope, since no request-bound
        // tenant exists in a console context.
        app(TenantContext::class)->actSystemWide();

        $shelf = Bookshelf::query()->firstOrCreate(
            ['slug' => 'dong-thap'],
            ['name' => 'Tủ sách Đồng Tháp', 'location' => 'Nhà xứ Đồng Tháp', 'settings' => []],
        );

        // The shelf above already needed firstOrCreate to survive a plain
        // `db:seed` re-run (outside migrate:fresh); these fixed usernames
        // need the same guard, or a second run throws a duplicate-key error
        // on `quanly` — reproduced before this fix.
        $manager = User::query()->where('username', 'quanly')->first()
            ?? User::factory()->withCredentials('quanly')->create([
                'saint_name' => 'Giuse', 'full_name' => 'Trần Minh',
            ]);
        Membership::query()->firstOrCreate(
            ['bookshelf_id' => $shelf->id, 'user_id' => $manager->id],
            ['role' => 'manager', 'status' => 'active'],
        );

        User::query()->where('username', 'admin')->first()
            ?? User::factory()->superAdmin()->withCredentials('admin')->create([
                'saint_name' => 'Phêrô', 'full_name' => 'Nguyễn Văn Bình',
            ]);

        // $shelf->books() — the hasMany relation — rather than a
        // hand-written filter on the shelf column: TenancyArchitectureTest
        // confines that kind of filtering to BookshelfScope and
        // ResolveTenant only.
        if ($shelf->books()->doesntExist()) {
            Book::factory()->count(4)->create(['bookshelf_id' => $shelf->id])
                ->each(fn (Book $book) => BookCopy::factory()->count(2)->create([
                    'bookshelf_id' => $shelf->id, 'book_id' => $book->id,
                ]));
        }

        // This is the last seeder in the run today, so leaving the
        // system-wide context set would be harmless in practice — but the
        // tenant scope is designed to fail closed, and a seeder appended
        // after this one would silently inherit actSystemWide() rather than
        // tripping BookshelfScope's guard. Clear it explicitly so that
        // property holds regardless of seeder order.
        app(TenantContext::class)->clear();
    }
}
