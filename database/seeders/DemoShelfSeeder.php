<?php

namespace Database\Seeders;

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use Illuminate\Database\Seeder;

/** The AGENTS.md demo fixtures — local development only, never production. */
class DemoShelfSeeder extends Seeder
{
    public function run(): void
    {
        $shelf = Bookshelf::query()->firstOrCreate(
            ['slug' => 'dong-thap'],
            ['name' => 'Tủ sách Đồng Tháp', 'location' => 'Nhà xứ Đồng Tháp', 'settings' => []],
        );

        $manager = User::factory()->withCredentials('quanly')->create([
            'saint_name' => 'Giuse', 'full_name' => 'Trần Minh',
        ]);
        Membership::factory()->manager()->create([
            'bookshelf_id' => $shelf->id, 'user_id' => $manager->id,
        ]);

        User::factory()->superAdmin()->withCredentials('admin')->create([
            'saint_name' => 'Phêrô', 'full_name' => 'Nguyễn Văn Bình',
        ]);

        Book::factory()->count(4)->create(['bookshelf_id' => $shelf->id])
            ->each(fn (Book $book) => BookCopy::factory()->count(2)->create([
                'bookshelf_id' => $shelf->id, 'book_id' => $book->id,
            ]));
    }
}
