<?php

namespace Database\Factories;

use App\Models\Book;
use App\Models\BookCopy;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\DB;

/** @extends Factory<BookCopy> */
class BookCopyFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            // book_id resolves first (array order — see expandAttributes()),
            // then bookshelf_id is derived from the SAME book, never an
            // independently-resolved Bookshelf::factory(). Two independent
            // factories landed the copy on shelf A while the nested book
            // landed on shelf B, tripping the composite FK
            // (bookshelf_id, book_id) -> books(bookshelf_id, id) every time
            // this factory was called bare.
            // A plain DB::table() read, not Eloquent — Book is shelf-scoped
            // and this factory must work with no TenantContext bound (a
            // bare BookCopy::factory()->create() in a test, or a seeder);
            // Book::find() here would hit BookshelfScope's fail-closed
            // RuntimeException instead of the row.
            'book_id' => Book::factory(),
            'bookshelf_id' => function (array $attributes) {
                $book = DB::table('books')->where('id', $attributes['book_id'])->firstOrFail();

                return $book->bookshelf_id;
            },
            // 'DT-0142' is AGENTS.md's shape; pad a random number.
            'code' => 'DT-'.str_pad((string) $this->faker->unique()->numberBetween(1, 9999), 4, '0', STR_PAD_LEFT),
            'state' => 'available',
            'condition' => 'perfect',
        ];
    }
}
