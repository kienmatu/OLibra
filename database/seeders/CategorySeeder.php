<?php

namespace Database\Seeders;

use App\Models\Category;
use Illuminate\Database\Seeder;

/**
 * The six default categories, verbatim from
 * src/db/migrations/20260810_02_seed_default_categories.sql — a fresh
 * install had no categories and no way to make one, so the required
 * "Thể loại" field on "Thêm sách mới" could never be satisfied.
 *
 * categories.slug's unique index is plain, not the soft-delete-aware
 * generated-column form the other ten uniques use (Category is global,
 * not shelf-scoped, and predates that pattern). A naive
 * firstOrCreate(['slug' => ...]) would look only among alive rows and then
 * try to INSERT into a slug a soft-deleted row still occupies, raising a
 * duplicate-key error instead of being idempotent. Querying withTrashed()
 * first avoids that collision; a soft-deleted default category is left
 * deleted rather than silently resurrected — a manager who removed one
 * meant to remove it.
 */
class CategorySeeder extends Seeder
{
    public function run(): void
    {
        $rows = [
            ['name' => 'Truyện thiếu nhi', 'slug' => 'truyen-thieu-nhi', 'sort_order' => 1],
            ['name' => 'Giáo lý', 'slug' => 'giao-ly', 'sort_order' => 2],
            ['name' => 'Kỹ năng sống', 'slug' => 'ky-nang-song', 'sort_order' => 3],
            ['name' => 'Sách tham khảo', 'slug' => 'sach-tham-khao', 'sort_order' => 4],
            ['name' => 'Lịch sử', 'slug' => 'lich-su', 'sort_order' => 5],
            ['name' => 'Khác', 'slug' => 'khac', 'sort_order' => 6],
        ];

        foreach ($rows as $row) {
            $exists = Category::withTrashed()->where('slug', $row['slug'])->exists();

            if (! $exists) {
                Category::create($row);
            }
        }
    }
}
