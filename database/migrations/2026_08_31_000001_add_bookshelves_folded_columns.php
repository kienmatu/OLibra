<?php

use App\Support\FoldExpression;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Phase 3a, Task 5. BR §16.1 makes the public portal's search box the
     * page's only job, for Vietnamese parish names — but `bookshelves` had
     * no folded column (verified against the live table), so a naive LIKE
     * finds nothing when a parent types "hoa binh" looking for the exact
     * shelf the box exists to find: *Giáo xứ Hòa Bình*.
     *
     * Same shape as 2026_08_28_000001 (users.full_name_folded) and the
     * books.title_folded/author_folded pair it followed: TEXT, not
     * VARCHAR — Fold::MAP expands ß→ss, æ→ae, œ→oe, ĳ→ij, so a fold can
     * exceed its source's length and a VARCHAR(255) fold of a 255-char
     * name raises errno 1406 on insert. No NOT NULL — MariaDB's
     * generated-column grammar accepts only STORED/VIRTUAL/UNIQUE/COMMENT
     * after the expression.
     *
     * `location` and `address` are both nullable, so both are wrapped in
     * COALESCE(..., '') — the precedent 2026_08_28_000002_fix_fold_expression
     * _capital_sharp_s.php:66 set for `books.author_folded` (also
     * nullable), while the bare form stays reserved for NOT NULL sources
     * like `full_name` and `title`. `name` is NOT NULL on `bookshelves`, so
     * it stays bare.
     *
     * This migration adds no Fold::MAP entry — it renders the SAME
     * expression FoldExpression::sql() already emits, over three new
     * columns. It does not re-open the store≠search cascade hazard that
     * 2026_08_28_000002's docblock documents; that hazard is only live
     * when Fold::MAP itself changes.
     */
    public function up(): void
    {
        DB::statement(sprintf(
            'ALTER TABLE bookshelves ADD COLUMN name_folded TEXT
                CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
                GENERATED ALWAYS AS (%s) STORED',
            FoldExpression::sql('`name`'),
        ));
        DB::statement('ALTER TABLE bookshelves ADD INDEX bookshelves_name_folded_index (name_folded(191))');

        DB::statement(sprintf(
            'ALTER TABLE bookshelves ADD COLUMN location_folded TEXT
                CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
                GENERATED ALWAYS AS (%s) STORED',
            FoldExpression::sql("COALESCE(`location`, '')"),
        ));
        DB::statement('ALTER TABLE bookshelves ADD INDEX bookshelves_location_folded_index (location_folded(191))');

        DB::statement(sprintf(
            'ALTER TABLE bookshelves ADD COLUMN address_folded TEXT
                CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
                GENERATED ALWAYS AS (%s) STORED',
            FoldExpression::sql("COALESCE(`address`, '')"),
        ));
        DB::statement('ALTER TABLE bookshelves ADD INDEX bookshelves_address_folded_index (address_folded(191))');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE bookshelves DROP INDEX bookshelves_address_folded_index');
        DB::statement('ALTER TABLE bookshelves DROP COLUMN address_folded');

        DB::statement('ALTER TABLE bookshelves DROP INDEX bookshelves_location_folded_index');
        DB::statement('ALTER TABLE bookshelves DROP COLUMN location_folded');

        DB::statement('ALTER TABLE bookshelves DROP INDEX bookshelves_name_folded_index');
        DB::statement('ALTER TABLE bookshelves DROP COLUMN name_folded');
    }
};
