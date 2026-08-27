<?php

namespace Database\Factories;

use App\Models\Book;
use App\Models\Bookshelf;
use App\Support\Fold;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/** @extends Factory<Book> */
class BookFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        // AGENTS.md's shared fixtures, so screens line up with design work.
        $titles = [
            ['Dế Mèn Phiêu Lưu Ký', 'Tô Hoài'],
            ['Hoàng Tử Bé', 'Antoine de Saint-Exupéry'],
            ['Totto-chan Bên Cửa Sổ', 'Kuroyanagi Tetsuko'],
            ['Đất Rừng Phương Nam', 'Đoàn Giỏi'],
        ];
        [$title, $author] = $this->faker->randomElement($titles);

        // The slug is the folded title hyphenated — the same derivation
        // slugifyTitle uses in src/domain/catalogue/policy.ts — plus a
        // suffix so factories never trip books_bookshelf_id_slug_key.
        $slug = str_replace(' ', '-', Fold::fold($title)).'-'.Str::lower(Str::random(4));

        return [
            'bookshelf_id' => Bookshelf::factory(),
            'title' => $title,
            'slug' => $slug,
            'author' => $author,
            'language' => 'vi',
            'is_published' => true,
        ];
    }
}
