<?php

use App\Support\FoldExpression;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('books', function (Blueprint $table) {
            $table->string('id', 36)->charset('ascii')->collation('ascii_bin')->primary();
            $table->string('bookshelf_id', 36)->charset('ascii')->collation('ascii_bin');
            $table->string('category_id', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            // Case-mapping character type, deliberately NOT binary/BLOB: the
            // fold expression below runs LOWER() over this column, and
            // LOWER() is a no-op on a true binary type. utf8mb4 (server
            // default collation) keeps LOWER() doing real case-mapping.
            $table->text('title');
            $table->string('slug')->collation('utf8mb4_bin');
            $table->string('author')->nullable();
            $table->string('publisher')->nullable();
            $table->integer('published_year')->nullable();
            $table->string('isbn', 32)->nullable();
            $table->integer('page_count')->nullable();
            $table->text('description')->nullable();
            $table->text('cover_url')->nullable();
            $table->string('language', 8)->default('vi');
            $table->boolean('is_published')->default(true);     // hides drafts from the public
            $table->string('added_by', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->dateTime('created_at', 6)->useCurrent();
            $table->dateTime('updated_at', 6)->useCurrent()->useCurrentOnUpdate();
            $table->dateTime('deleted_at', 6)->nullable();

            $table->foreign('bookshelf_id')->references('id')->on('bookshelves')->restrictOnDelete();
            $table->foreign('category_id')->references('id')->on('categories')->nullOnDelete();
            $table->foreign('added_by')->references('id')->on('users')->restrictOnDelete();
        });

        // The folded search columns — spec §4.2 option 1, the expression
        // emitted by FoldExpression and FROZEN here as DDL. utf8mb4_bin so
        // the engine adds no folding of its own on top of what the
        // expression already did. No NOT NULL: MariaDB's generated-column
        // grammar accepts only STORED/VIRTUAL/UNIQUE/COMMENT after the
        // expression — `STORED NOT NULL` is a 1064 syntax error (reproduced
        // on 10.11.19). Nothing is lost: the expression never yields NULL
        // for a NOT NULL title or a COALESCEd author.
        DB::statement(sprintf(
            'ALTER TABLE books ADD COLUMN title_folded TEXT
                CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
                GENERATED ALWAYS AS (%s) STORED',
            FoldExpression::sql('`title`'),
        ));
        DB::statement(sprintf(
            'ALTER TABLE books ADD COLUMN author_folded TEXT
                CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
                GENERATED ALWAYS AS (%s) STORED',
            FoldExpression::sql("COALESCE(`author`, '')"),
        ));

        // books_bookshelf_id_slug_key, alive rows only (20260808_09).
        DB::statement('
            ALTER TABLE books ADD COLUMN slug_key BINARY(32)
                GENERATED ALWAYS AS (
                    IF(deleted_at IS NULL,
                       UNHEX(SHA2(CONCAT_WS(0x1f, bookshelf_id, CHAR_LENGTH(slug), slug), 256)),
                       NULL)
                ) STORED
        ');
        DB::statement('ALTER TABLE books ADD CONSTRAINT books_bookshelf_id_slug_key UNIQUE (slug_key)');

        // books_public was `(bookshelf_id, title) where is_published and
        // deleted_at is null`; the predicate drops, the access path stays.
        // title is TEXT, so the index needs a prefix length — raw SQL,
        // because Blueprint cannot express one.
        DB::statement('CREATE INDEX books_public ON books (bookshelf_id, title(191))');

        // The two Postgres gin_trgm indexes on the folded columns have no
        // MariaDB equivalent and are deliberately NOT replaced: LIKE
        // '%needle%' cannot use a btree anyway, and DATABASE.md §8 already
        // called a sequential scan at a few hundred books honestly fine.
    }

    public function down(): void
    {
        Schema::dropIfExists('books');
    }
};
