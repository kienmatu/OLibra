<?php

use App\Support\FoldExpression;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // Spec §4.2 option 1, same shape 2026_08_26_000005 froze for
        // books.title_folded: the expression emitted by FoldExpression and
        // frozen as DDL at migrate time. utf8mb4_bin so the engine adds no
        // folding of its own; no NOT NULL — MariaDB's generated-column
        // grammar accepts only STORED/VIRTUAL/UNIQUE/COMMENT after the
        // expression (1064 otherwise, reproduced on 10.11.19 by that
        // migration), and full_name is NOT NULL so the fold never is.
        //
        // TEXT, not VARCHAR(255): Fold::MAP expands ß→ss, æ→ae, œ→oe, ĳ→ij,
        // so the fold of a 255-char VARCHAR name can exceed 255 characters
        // (errno 1406 on insert), and MariaDB's derived max-length for the
        // REPLACE chain exceeds it regardless. books.title_folded is TEXT
        // for the same reason.
        DB::statement(sprintf(
            'ALTER TABLE users ADD COLUMN full_name_folded TEXT
                CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
                GENERATED ALWAYS AS (%s) STORED',
            FoldExpression::sql('`full_name`'),
        ));

        // Access path for the roster; plain, not unique — two children fold
        // alike constantly (that is BR §5.3's whole premise). PREFIX(191):
        // not a workaround for a refusal — an unlengthed index on a TEXT
        // column is accepted on this build with an implicit 768-character
        // prefix (verified on 10.11.19; @@innodb_large_prefix does not even
        // exist here, so there is no errno 1170 to route around). (191) is
        // deliberate anyway: it matches the books_public convention
        // (`title(191)` in raw SQL) and is four times smaller than the
        // 768-character fallback would be.
        DB::statement('ALTER TABLE users ADD INDEX users_full_name_folded_index (full_name_folded(191))');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE users DROP INDEX users_full_name_folded_index');
        DB::statement('ALTER TABLE users DROP COLUMN full_name_folded');
    }
};
