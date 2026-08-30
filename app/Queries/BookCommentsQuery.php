<?php

namespace App\Queries;

use App\Enums\CommentStatus;
use App\Models\Book;
use App\Models\Comment;

/**
 * The comments a member sees on a book's page — APPROVED ONLY, and that
 * is INV-9 living in the access path rather than in a caller's filter.
 * Port of get-comments.ts's getBookComments.
 *
 * A pending, rejected or hidden comment is absent for everyone here,
 * INCLUDING ITS OWN AUTHOR. That is the requirement as written; if a
 * reader should see their own comment awaiting moderation, that is a
 * product decision and a DIFFERENT query, not a loosened predicate on
 * this one (the plan's open question 2).
 *
 * Inv09CommentVisibilityTest asserts the exclusion THROUGH this query
 * rather than by reading every row and filtering in PHP, because a test
 * that filtered would pass against a query with no status predicate at
 * all — which is precisely the defect INV-9 exists to prevent.
 *
 * THE BODY IS RETURNED RAW. Comments are plain text rendered escaped (BR
 * §5.4); React escapes by default, and a query that "helpfully" stripped
 * tags would silently rewrite what a child wrote.
 *
 * Tenancy is BookshelfScope's, on Comment itself — no bookshelf_id
 * appears here. Soft-deleted rows are excluded by the model's own scope,
 * which is why deleted_at appears nowhere either; the invariant suite
 * pins both, so removing a trait cannot leave the suite green.
 *
 * The reference JOINS users for the author's name; this eager-loads the
 * relation instead. tests/Feature/Architecture/TenancyArchitectureTest.php
 * records a join() condition naming bookshelf_id as one of two gaps its
 * hand-written-filter grep leaves open on purpose ("a column name held in
 * a variable ... and a join() condition naming the column"), and there is
 * nothing here to gain by writing in the shape that grep cannot see.
 *
 * id desc beside created_at desc: created_at carries no unique
 * constraint, and this project has twice measured what an ordering
 * without a unique tiebreak does across pages. On today's engine the
 * tiebreak is redundant — InnoDB appends the primary key to a secondary
 * index — and it is written down anyway, with the mutation that DOES
 * redden it recorded in the test.
 */
final class BookCommentsQuery
{
    /** @return list<array{id: string, body: string, authorName: string, createdAt: string}> */
    public function run(Book $book): array
    {
        return array_values(Comment::query()
            ->with('author')
            ->where('book_id', $book->id)
            ->where('status', CommentStatus::Approved)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->get()
            ->map(fn (Comment $comment): array => [
                'id' => $comment->id,
                'body' => $comment->body,
                // The two nullsafes here are NOT symmetric, and the
                // asymmetry is measured rather than stylistic: author
                // reaches Larastan as User|null (a belongsTo accessor), so
                // ?-> is required; created_at reaches it as a non-nullable
                // Carbon, where ?-> is a level-8 error (nullsafe.neverNull)
                // and the plain cast is what passes. Written down because
                // the next reader will otherwise "fix" one of the two.
                'authorName' => (string) $comment->author?->full_name,
                'createdAt' => (string) $comment->created_at->toISOString(),
            ])
            ->values()
            ->all());
    }
}
