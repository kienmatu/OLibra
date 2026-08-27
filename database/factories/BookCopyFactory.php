<?php

namespace Database\Factories;

use App\Models\BookCopy;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Placeholder — Task 19 fills in the real definition. Exists now only so
 * Larastan's generic HasFactory check on BookCopy resolves.
 *
 * @extends Factory<BookCopy>
 */
class BookCopyFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'code' => fake()->unique()->bothify('??-####'),
        ];
    }
}
