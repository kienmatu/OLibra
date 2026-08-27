<?php

namespace App\Queries;

use App\Models\Book;

/**
 * What the edit form needs to pre-fill, and nothing else — port of
 * get-book-for-edit.ts, whose docstring explains why neither single-book
 * read can serve a form: the manager detail carries the category NAME
 * (display) where UpdateBook's category_slug input needs the SLUG a
 * <select> posts back, and the reader detail filters is_published — which
 * would make a title uneditable for exactly the time it is being
 * prepared. No counts, no availability, no cover: only what <BookFields>
 * renders and UpdateBook round-trips.
 */
final class BookForEditQuery
{
    /** @return array<string, mixed> */
    public function run(Book $book): array
    {
        $book->loadMissing('category:id,slug');

        return [
            'bookId' => $book->id,
            'slug' => $book->slug,
            'title' => $book->title,
            'author' => $book->author,
            'categorySlug' => $book->category?->slug,
            'publisher' => $book->publisher,
            'publishedYear' => $book->published_year,
            'pageCount' => $book->page_count,
            'isbn' => $book->isbn,
            'description' => $book->description,
            'isPublished' => $book->is_published,
        ];
    }
}
