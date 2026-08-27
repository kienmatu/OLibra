<?php

namespace Database\Factories;

use App\Models\Book;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Placeholder — Task 19 fills in the real definition. Exists now only so
 * Larastan's generic HasFactory check on Book resolves.
 *
 * @extends Factory<Book>
 */
class BookFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'title' => fake()->sentence(3),
            'slug' => fake()->unique()->slug(),
        ];
    }
}
