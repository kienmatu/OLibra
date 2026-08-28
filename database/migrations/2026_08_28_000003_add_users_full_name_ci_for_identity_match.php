<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Task 6 fix round, CRITICAL finding 1 + IMPORTANT finding 4.
     *
     * `Registration::findExistingPerson()`'s no-username identity match
     * compared `LOWER(full_name) = LOWER(?)` under `full_name`'s own
     * collation — `utf8mb4_unicode_ci`, table default, which is
     * ACCENT-INSENSITIVE on this build (confirmed:
     * `SELECT LOWER('Nguyễn Thị Lan')=LOWER('Nguyen Thi Lan')` → 1). Two
     * children whose names differ only by a diacritic, sharing a date of
     * birth and the family's phone, folded onto the SAME `users` row, and
     * the second child's registration attempt then hit `already_registered_
     * here` on the walk-back — a false refusal, since it was never really
     * their membership.
     *
     * `full_name_folded` (2026_08_28_000001) is NOT the fix: that column
     * DELIBERATELY strips accents for fuzzy search/dedup surfacing (BR
     * §5.3's similar-name warning) — using it here would keep the exact
     * bug this migration closes, just moved one column over.
     *
     * The fix mirrors `username_active`'s own shape (this table's existing,
     * working answer to "case-insensitive but not accent-insensitive"): a
     * STORED generated column under an explicit deterministic collation
     * (`utf8mb4_bin`), computed with `LOWER()` so lookups stay
     * case-insensitive — but because the column's COLLATION is `_bin`, the
     * subsequent `=` is byte-exact, so accented and unaccented forms of the
     * same letters no longer compare equal. Verified live on 10.11.19: a
     * generated column with this exact shape, seeded with 'Nguyễn Thị Lan'
     * and 'Nguyen Thi Lan', produces two distinct `full_name_ci` values,
     * and a query WHERE `full_name_ci = LOWER(?)` matches exactly one of
     * them for either spelling of the query string; matching against an
     * upper-cased query string still hits (case-insensitivity is intact).
     *
     * The composite index (full_name_ci, date_of_birth, phone) also closes
     * finding 4: the identity read was a full scan of `users` on every
     * guest registration (no index on `date_of_birth` or `phone` at all,
     * and the old `LOWER(full_name)` predicate was a function-wrapped,
     * non-sargable scan even before that). `Registration::findExistingPerson`
     * is updated in the same commit to query `full_name_ci` directly (no
     * function wrapping the column in the WHERE clause) and to drop the
     * `whereDate()` wrapper on `date_of_birth` — that column is already a
     * DATE, not a DATETIME, so `whereDate()` was compiling a needless,
     * index-defeating `date(date_of_birth) = ?` around a column that was
     * already exactly a date. `EXPLAIN` before/after is in the fix report.
     *
     * No prefix length on the index: unlike `full_name_folded` (TEXT, needs
     * a prefix), `full_name_ci` is VARCHAR(255) and this build's 16 KB
     * InnoDB page size accepts the full three-column key without an
     * "index prefix too long" refusal (verified live).
     */
    public function up(): void
    {
        DB::statement('
            ALTER TABLE users ADD COLUMN full_name_ci VARCHAR(255)
                CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
                GENERATED ALWAYS AS (LOWER(full_name)) STORED
        ');
        DB::statement('
            ALTER TABLE users ADD INDEX users_full_name_ci_dob_phone_index
                (full_name_ci, date_of_birth, phone)
        ');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE users DROP INDEX users_full_name_ci_dob_phone_index');
        DB::statement('ALTER TABLE users DROP COLUMN full_name_ci');
    }
};
