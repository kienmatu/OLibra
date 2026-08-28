<?php

use App\Support\FoldExpression;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Fold::MAP grew a new entry -- 'ẞ' (U+1E9E, capital sharp S) -- after a
     * store≠search bug was found in the two generated columns FoldExpression
     * already shipped: books.title_folded/author_folded (Phase 1a,
     * 2026_08_26_000005) and users.full_name_folded (Phase 1b,
     * 2026_08_28_000001).
     *
     * The bug: mb_strtolower('ẞ') is 'ß' (PHP's fold pipeline reaches
     * Fold::MAP's existing 'ß' => 'ss' entry after lowering), but MariaDB's
     * LOWER('ẞ') is 'ẞ' UNCHANGED on this build (confirmed on 10.11.19 via
     * `SELECT LOWER('ẞ') = 'ẞ'` -- true), so the SQL side never produced
     * 'ß' to REPLACE and fell through to REGEXP_REPLACE's space bucket
     * instead. 'ẞigmund Groß' folded to 'ssigmund gross' in PHP but
     * 'igmund gross' in the database: the leading letter of the name
     * silently vanished from the folded/search column, permanently hiding
     * that row from a search for the correct fold.
     *
     * A full-BMP sweep (every code point where mb_strtolower and MariaDB's
     * LOWER() disagree, run through the ACTUAL fold pipeline, not just
     * LOWER() in isolation) found this is the ONLY such disagreement that
     * changes fold output on this Fold::MAP. MariaDB's LOWER() is missing
     * roughly 480 other case mappings scattered across Latin Extended-B/C/D,
     * Greek, and Cyrillic (including three more inside the Latin Extended
     * Additional block itself: U+1EFA/1EFC/1EFE, obscure Middle Welsh
     * letters), but none of those are Fold::MAP targets, so both halves
     * already fall through to the same unmapped-to-space bucket identically
     * -- only a LOWER() disagreement on a character that is ALSO a MAP key
     * (today, only ß/ẞ) can turn into a real mismatch.
     *
     * FoldExpression::sql() is called here (not frozen inline the way the
     * original migrations froze it) because the whole point is to pick up
     * Fold::MAP's new entry -- the two must go on agreeing, and this
     * migration IS the thing that makes existing databases agree again.
     *
     * ALTER TABLE ... MODIFY COLUMN on a STORED generated column forces a
     * full table rebuild that recomputes the expression for every existing
     * row -- verified against populated `users` and `books` tables (a row
     * with full_name 'ẞigmund Groß' went from full_name_folded
     * 'igmund gross' to 'ssigmund gross' after this exact statement, with
     * no data loss and no separate UPDATE pass needed). The three indexes
     * that touch these columns -- users_full_name_folded_index, books_public
     * (on title, not title_folded), and books_bookshelf_id_slug_key -- were
     * all confirmed to survive the MODIFY unchanged via SHOW INDEX.
     */
    public function up(): void
    {
        DB::statement(sprintf(
            'ALTER TABLE books MODIFY COLUMN title_folded TEXT
                CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
                GENERATED ALWAYS AS (%s) STORED',
            FoldExpression::sql('`title`'),
        ));

        DB::statement(sprintf(
            'ALTER TABLE books MODIFY COLUMN author_folded TEXT
                CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
                GENERATED ALWAYS AS (%s) STORED',
            FoldExpression::sql("COALESCE(`author`, '')"),
        ));

        DB::statement(sprintf(
            'ALTER TABLE users MODIFY COLUMN full_name_folded TEXT
                CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
                GENERATED ALWAYS AS (%s) STORED',
            FoldExpression::sql('`full_name`'),
        ));
    }

    /**
     * The pre-fix expressions, frozen here as literal SQL -- NOT computed
     * from FoldExpression::sql(), because Fold::MAP has moved on and calling
     * it here would render the NEW (fixed) expression, making this rollback
     * a no-op instead of an actual revert. Byte-for-byte what
     * 2026_08_26_000005 and 2026_08_28_000001 originally froze (missing only
     * the 'ẞ' => 'ss' entry this migration's up() adds), captured by running
     * FoldExpression::sql() against a checked-out copy of Fold.php from
     * before this fix -- not retyped by hand, to rule out a transcription
     * error in a 3 KB generated string.
     */
    public function down(): void
    {
        DB::statement(sprintf(
            'ALTER TABLE books MODIFY COLUMN title_folded TEXT
                CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
                GENERATED ALWAYS AS (%s) STORED',
            'TRIM(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(`title`), \'i̇\', \'i\'), \'à\', \'a\'), \'á\', \'a\'), \'ả\', \'a\'), \'ã\', \'a\'), \'ạ\', \'a\'), \'ă\', \'a\'), \'ằ\', \'a\'), \'ắ\', \'a\'), \'ẳ\', \'a\'), \'ẵ\', \'a\'), \'ặ\', \'a\'), \'â\', \'a\'), \'ầ\', \'a\'), \'ấ\', \'a\'), \'ẩ\', \'a\'), \'ẫ\', \'a\'), \'ậ\', \'a\'), \'è\', \'e\'), \'é\', \'e\'), \'ẻ\', \'e\'), \'ẽ\', \'e\'), \'ẹ\', \'e\'), \'ê\', \'e\'), \'ề\', \'e\'), \'ế\', \'e\'), \'ể\', \'e\'), \'ễ\', \'e\'), \'ệ\', \'e\'), \'ì\', \'i\'), \'í\', \'i\'), \'ỉ\', \'i\'), \'ĩ\', \'i\'), \'ị\', \'i\'), \'ò\', \'o\'), \'ó\', \'o\'), \'ỏ\', \'o\'), \'õ\', \'o\'), \'ọ\', \'o\'), \'ô\', \'o\'), \'ồ\', \'o\'), \'ố\', \'o\'), \'ổ\', \'o\'), \'ỗ\', \'o\'), \'ộ\', \'o\'), \'ơ\', \'o\'), \'ờ\', \'o\'), \'ớ\', \'o\'), \'ở\', \'o\'), \'ỡ\', \'o\'), \'ợ\', \'o\'), \'ù\', \'u\'), \'ú\', \'u\'), \'ủ\', \'u\'), \'ũ\', \'u\'), \'ụ\', \'u\'), \'ư\', \'u\'), \'ừ\', \'u\'), \'ứ\', \'u\'), \'ử\', \'u\'), \'ữ\', \'u\'), \'ự\', \'u\'), \'ỳ\', \'y\'), \'ý\', \'y\'), \'ỷ\', \'y\'), \'ỹ\', \'y\'), \'ỵ\', \'y\'), \'đ\', \'d\'), \'ä\', \'a\'), \'å\', \'a\'), \'æ\', \'ae\'), \'ç\', \'c\'), \'ë\', \'e\'), \'î\', \'i\'), \'ï\', \'i\'), \'ð\', \'d\'), \'ñ\', \'n\'), \'ö\', \'o\'), \'ø\', \'o\'), \'û\', \'u\'), \'ü\', \'u\'), \'ÿ\', \'y\'), \'þ\', \'th\'), \'ß\', \'ss\'), \'ā\', \'a\'), \'ą\', \'a\'), \'ć\', \'c\'), \'ĉ\', \'c\'), \'ċ\', \'c\'), \'č\', \'c\'), \'ď\', \'d\'), \'ē\', \'e\'), \'ĕ\', \'e\'), \'ė\', \'e\'), \'ę\', \'e\'), \'ě\', \'e\'), \'ĝ\', \'g\'), \'ğ\', \'g\'), \'ġ\', \'g\'), \'ģ\', \'g\'), \'ĥ\', \'h\'), \'ħ\', \'h\'), \'ī\', \'i\'), \'ĭ\', \'i\'), \'į\', \'i\'), \'ı\', \'i\'), \'ĳ\', \'ij\'), \'ĵ\', \'j\'), \'ķ\', \'k\'), \'ĺ\', \'l\'), \'ļ\', \'l\'), \'ľ\', \'l\'), \'ŀ\', \'l\'), \'ł\', \'l\'), \'ń\', \'n\'), \'ņ\', \'n\'), \'ň\', \'n\'), \'ŉ\', \'n\'), \'ŋ\', \'n\'), \'ō\', \'o\'), \'ŏ\', \'o\'), \'ő\', \'o\'), \'œ\', \'oe\'), \'ŕ\', \'r\'), \'ŗ\', \'r\'), \'ř\', \'r\'), \'ś\', \'s\'), \'ŝ\', \'s\'), \'ş\', \'s\'), \'š\', \'s\'), \'ſ\', \'s\'), \'ţ\', \'t\'), \'ť\', \'t\'), \'ŧ\', \'t\'), \'ū\', \'u\'), \'ŭ\', \'u\'), \'ů\', \'u\'), \'ű\', \'u\'), \'ų\', \'u\'), \'ŵ\', \'w\'), \'ŷ\', \'y\'), \'ź\', \'z\'), \'ż\', \'z\'), \'ž\', \'z\'), \'[^a-z0-9]+\', \' \'))',
        ));

        DB::statement(sprintf(
            'ALTER TABLE books MODIFY COLUMN author_folded TEXT
                CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
                GENERATED ALWAYS AS (%s) STORED',
            'TRIM(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(COALESCE(`author`, \'\')), \'i̇\', \'i\'), \'à\', \'a\'), \'á\', \'a\'), \'ả\', \'a\'), \'ã\', \'a\'), \'ạ\', \'a\'), \'ă\', \'a\'), \'ằ\', \'a\'), \'ắ\', \'a\'), \'ẳ\', \'a\'), \'ẵ\', \'a\'), \'ặ\', \'a\'), \'â\', \'a\'), \'ầ\', \'a\'), \'ấ\', \'a\'), \'ẩ\', \'a\'), \'ẫ\', \'a\'), \'ậ\', \'a\'), \'è\', \'e\'), \'é\', \'e\'), \'ẻ\', \'e\'), \'ẽ\', \'e\'), \'ẹ\', \'e\'), \'ê\', \'e\'), \'ề\', \'e\'), \'ế\', \'e\'), \'ể\', \'e\'), \'ễ\', \'e\'), \'ệ\', \'e\'), \'ì\', \'i\'), \'í\', \'i\'), \'ỉ\', \'i\'), \'ĩ\', \'i\'), \'ị\', \'i\'), \'ò\', \'o\'), \'ó\', \'o\'), \'ỏ\', \'o\'), \'õ\', \'o\'), \'ọ\', \'o\'), \'ô\', \'o\'), \'ồ\', \'o\'), \'ố\', \'o\'), \'ổ\', \'o\'), \'ỗ\', \'o\'), \'ộ\', \'o\'), \'ơ\', \'o\'), \'ờ\', \'o\'), \'ớ\', \'o\'), \'ở\', \'o\'), \'ỡ\', \'o\'), \'ợ\', \'o\'), \'ù\', \'u\'), \'ú\', \'u\'), \'ủ\', \'u\'), \'ũ\', \'u\'), \'ụ\', \'u\'), \'ư\', \'u\'), \'ừ\', \'u\'), \'ứ\', \'u\'), \'ử\', \'u\'), \'ữ\', \'u\'), \'ự\', \'u\'), \'ỳ\', \'y\'), \'ý\', \'y\'), \'ỷ\', \'y\'), \'ỹ\', \'y\'), \'ỵ\', \'y\'), \'đ\', \'d\'), \'ä\', \'a\'), \'å\', \'a\'), \'æ\', \'ae\'), \'ç\', \'c\'), \'ë\', \'e\'), \'î\', \'i\'), \'ï\', \'i\'), \'ð\', \'d\'), \'ñ\', \'n\'), \'ö\', \'o\'), \'ø\', \'o\'), \'û\', \'u\'), \'ü\', \'u\'), \'ÿ\', \'y\'), \'þ\', \'th\'), \'ß\', \'ss\'), \'ā\', \'a\'), \'ą\', \'a\'), \'ć\', \'c\'), \'ĉ\', \'c\'), \'ċ\', \'c\'), \'č\', \'c\'), \'ď\', \'d\'), \'ē\', \'e\'), \'ĕ\', \'e\'), \'ė\', \'e\'), \'ę\', \'e\'), \'ě\', \'e\'), \'ĝ\', \'g\'), \'ğ\', \'g\'), \'ġ\', \'g\'), \'ģ\', \'g\'), \'ĥ\', \'h\'), \'ħ\', \'h\'), \'ī\', \'i\'), \'ĭ\', \'i\'), \'į\', \'i\'), \'ı\', \'i\'), \'ĳ\', \'ij\'), \'ĵ\', \'j\'), \'ķ\', \'k\'), \'ĺ\', \'l\'), \'ļ\', \'l\'), \'ľ\', \'l\'), \'ŀ\', \'l\'), \'ł\', \'l\'), \'ń\', \'n\'), \'ņ\', \'n\'), \'ň\', \'n\'), \'ŉ\', \'n\'), \'ŋ\', \'n\'), \'ō\', \'o\'), \'ŏ\', \'o\'), \'ő\', \'o\'), \'œ\', \'oe\'), \'ŕ\', \'r\'), \'ŗ\', \'r\'), \'ř\', \'r\'), \'ś\', \'s\'), \'ŝ\', \'s\'), \'ş\', \'s\'), \'š\', \'s\'), \'ſ\', \'s\'), \'ţ\', \'t\'), \'ť\', \'t\'), \'ŧ\', \'t\'), \'ū\', \'u\'), \'ŭ\', \'u\'), \'ů\', \'u\'), \'ű\', \'u\'), \'ų\', \'u\'), \'ŵ\', \'w\'), \'ŷ\', \'y\'), \'ź\', \'z\'), \'ż\', \'z\'), \'ž\', \'z\'), \'[^a-z0-9]+\', \' \'))',
        ));

        DB::statement(sprintf(
            'ALTER TABLE users MODIFY COLUMN full_name_folded TEXT
                CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
                GENERATED ALWAYS AS (%s) STORED',
            'TRIM(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(`full_name`), \'i̇\', \'i\'), \'à\', \'a\'), \'á\', \'a\'), \'ả\', \'a\'), \'ã\', \'a\'), \'ạ\', \'a\'), \'ă\', \'a\'), \'ằ\', \'a\'), \'ắ\', \'a\'), \'ẳ\', \'a\'), \'ẵ\', \'a\'), \'ặ\', \'a\'), \'â\', \'a\'), \'ầ\', \'a\'), \'ấ\', \'a\'), \'ẩ\', \'a\'), \'ẫ\', \'a\'), \'ậ\', \'a\'), \'è\', \'e\'), \'é\', \'e\'), \'ẻ\', \'e\'), \'ẽ\', \'e\'), \'ẹ\', \'e\'), \'ê\', \'e\'), \'ề\', \'e\'), \'ế\', \'e\'), \'ể\', \'e\'), \'ễ\', \'e\'), \'ệ\', \'e\'), \'ì\', \'i\'), \'í\', \'i\'), \'ỉ\', \'i\'), \'ĩ\', \'i\'), \'ị\', \'i\'), \'ò\', \'o\'), \'ó\', \'o\'), \'ỏ\', \'o\'), \'õ\', \'o\'), \'ọ\', \'o\'), \'ô\', \'o\'), \'ồ\', \'o\'), \'ố\', \'o\'), \'ổ\', \'o\'), \'ỗ\', \'o\'), \'ộ\', \'o\'), \'ơ\', \'o\'), \'ờ\', \'o\'), \'ớ\', \'o\'), \'ở\', \'o\'), \'ỡ\', \'o\'), \'ợ\', \'o\'), \'ù\', \'u\'), \'ú\', \'u\'), \'ủ\', \'u\'), \'ũ\', \'u\'), \'ụ\', \'u\'), \'ư\', \'u\'), \'ừ\', \'u\'), \'ứ\', \'u\'), \'ử\', \'u\'), \'ữ\', \'u\'), \'ự\', \'u\'), \'ỳ\', \'y\'), \'ý\', \'y\'), \'ỷ\', \'y\'), \'ỹ\', \'y\'), \'ỵ\', \'y\'), \'đ\', \'d\'), \'ä\', \'a\'), \'å\', \'a\'), \'æ\', \'ae\'), \'ç\', \'c\'), \'ë\', \'e\'), \'î\', \'i\'), \'ï\', \'i\'), \'ð\', \'d\'), \'ñ\', \'n\'), \'ö\', \'o\'), \'ø\', \'o\'), \'û\', \'u\'), \'ü\', \'u\'), \'ÿ\', \'y\'), \'þ\', \'th\'), \'ß\', \'ss\'), \'ā\', \'a\'), \'ą\', \'a\'), \'ć\', \'c\'), \'ĉ\', \'c\'), \'ċ\', \'c\'), \'č\', \'c\'), \'ď\', \'d\'), \'ē\', \'e\'), \'ĕ\', \'e\'), \'ė\', \'e\'), \'ę\', \'e\'), \'ě\', \'e\'), \'ĝ\', \'g\'), \'ğ\', \'g\'), \'ġ\', \'g\'), \'ģ\', \'g\'), \'ĥ\', \'h\'), \'ħ\', \'h\'), \'ī\', \'i\'), \'ĭ\', \'i\'), \'į\', \'i\'), \'ı\', \'i\'), \'ĳ\', \'ij\'), \'ĵ\', \'j\'), \'ķ\', \'k\'), \'ĺ\', \'l\'), \'ļ\', \'l\'), \'ľ\', \'l\'), \'ŀ\', \'l\'), \'ł\', \'l\'), \'ń\', \'n\'), \'ņ\', \'n\'), \'ň\', \'n\'), \'ŉ\', \'n\'), \'ŋ\', \'n\'), \'ō\', \'o\'), \'ŏ\', \'o\'), \'ő\', \'o\'), \'œ\', \'oe\'), \'ŕ\', \'r\'), \'ŗ\', \'r\'), \'ř\', \'r\'), \'ś\', \'s\'), \'ŝ\', \'s\'), \'ş\', \'s\'), \'š\', \'s\'), \'ſ\', \'s\'), \'ţ\', \'t\'), \'ť\', \'t\'), \'ŧ\', \'t\'), \'ū\', \'u\'), \'ŭ\', \'u\'), \'ů\', \'u\'), \'ű\', \'u\'), \'ų\', \'u\'), \'ŵ\', \'w\'), \'ŷ\', \'y\'), \'ź\', \'z\'), \'ż\', \'z\'), \'ž\', \'z\'), \'[^a-z0-9]+\', \' \'))',
        ));
    }
};
