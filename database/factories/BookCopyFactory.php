<?php

namespace Database\Factories;

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<BookCopy> */
class BookCopyFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'bookshelf_id' => Bookshelf::factory(),
            'book_id' => Book::factory(),
            // 'DT-0142' is AGENTS.md's shape; pad a random number.
            'code' => 'DT-'.str_pad((string) $this->faker->unique()->numberBetween(1, 9999), 4, '0', STR_PAD_LEFT),
            'state' => 'available',
            'condition' => 'perfect',
        ];
    }
}
