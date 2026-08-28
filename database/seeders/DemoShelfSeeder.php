<?php

namespace Database\Seeders;

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\ParishUnit;
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

        // Phase 1b: a nested two-level taxonomy so every picker, filter and
        // parish line is exercisable in dev — Giáo họ over Tổ, the two
        // words BR §5.6 names as the only ones a real parish has been seen
        // to use.
        $settings = $shelf->settings;
        if (! isset($settings['parish_taxonomy'])) {
            $settings['parish_taxonomy'] = [
                'levels' => 2, 'nested' => true,
                'level1_label' => 'Giáo họ', 'level2_label' => 'Tổ',
            ];
            $shelf->settings = $settings;
            $shelf->save();
        }

        $units = [];
        foreach (['Giáo họ Thánh Tâm', 'Giáo họ Mân Côi'] as $i => $name) {
            $units[$name] = ParishUnit::query()->firstOrCreate(
                ['bookshelf_id' => $shelf->id, 'level' => 1, 'name' => $name],
                ['sort_order' => $i],
            );
        }
        foreach ([['Tổ 1', 'Giáo họ Thánh Tâm'], ['Tổ 2', 'Giáo họ Thánh Tâm'], ['Tổ 1', 'Giáo họ Mân Côi']] as $i => [$name, $parent]) {
            ParishUnit::query()->firstOrCreate(
                ['bookshelf_id' => $shelf->id, 'level' => 2, 'name' => $name, 'parent_id' => $units[$parent]->id],
                ['sort_order' => $i],
            );
        }

        // Five demo readers (AGENTS.md's fixture people), one pending so the
        // approval queue renders.
        $people = [
            ['Maria', 'Nguyễn Thị Lan', 'active'], ['Giuse', 'Trần Minh', 'active'],
            ['Têrêsa', 'Lê Ngọc Ánh', 'active'], ['Anna', 'Phạm Thu Hà', 'active'],
            ['Phêrô', 'Nguyễn Văn Bình', 'pending'],
        ];
        foreach ($people as [$saint, $name, $status]) {
            $person = User::query()->where('full_name', $name)->first()
                ?? User::factory()->create(['saint_name' => $saint, 'full_name' => $name, 'phone' => '0912345678', 'phone_missing_reason' => null]);
            Membership::query()->firstOrCreate(
                ['bookshelf_id' => $shelf->id, 'user_id' => $person->id],
                ['role' => 'reader', 'status' => $status, 'parish_unit_l1_id' => $units['Giáo họ Thánh Tâm']->id],
            );
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
