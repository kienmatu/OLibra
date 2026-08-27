<?php

namespace Database\Factories;

use App\Models\Category;
use App\Support\Fold;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/** @extends Factory<Category> */
class CategoryFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        $name = 'Thể loại '.Str::lower(Str::random(6));

        return [
            'name' => $name,
            'slug' => str_replace(' ', '-', Fold::fold($name)),
            'sort_order' => 0,
        ];
    }
}
