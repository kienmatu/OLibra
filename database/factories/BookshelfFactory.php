<?php

namespace Database\Factories;

use App\Models\Bookshelf;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/** @extends Factory<Bookshelf> */
class BookshelfFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        $suffix = Str::lower(Str::random(6));

        return [
            'slug' => "tu-sach-{$suffix}",
            'name' => "Tủ sách {$suffix}",
            'location' => 'Nhà xứ',
            'timezone' => 'Asia/Ho_Chi_Minh',
            'locale' => 'vi',
            'status' => 'active',
            'settings' => [],
        ];
    }
}
