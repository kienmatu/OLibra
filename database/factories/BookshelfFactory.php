<?php

namespace Database\Factories;

use App\Models\Bookshelf;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Placeholder — Task 19 fills in the real definition. Exists now only so
 * Book::factory() etc. and Larastan's generic HasFactory check resolve.
 *
 * @extends Factory<Bookshelf>
 */
class BookshelfFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'slug' => fake()->unique()->slug(),
            'name' => fake()->company(),
            'settings' => [],
        ];
    }
}
