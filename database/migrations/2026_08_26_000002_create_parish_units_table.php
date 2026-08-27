<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('parish_units', function (Blueprint $table) {
            $table->string('id', 36)->charset('ascii')->collation('ascii_bin')->primary();
            $table->string('bookshelf_id', 36)->charset('ascii')->collation('ascii_bin');
            $table->unsignedTinyInteger('level');
            // Composite FK (bookshelf_id, parent_id) → parish_units arrives in
            // Task 11; the column is bare until then.
            $table->string('parent_id', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->string('name');
            $table->integer('sort_order')->default(0);
            $table->dateTime('created_at', 6)->useCurrent();
            $table->dateTime('updated_at', 6)->useCurrent();
            $table->dateTime('deleted_at', 6)->nullable();

            $table->foreign('bookshelf_id')->references('id')->on('bookshelves')->restrictOnDelete();
        });

        DB::statement('ALTER TABLE parish_units ADD CONSTRAINT parish_units_level_check CHECK (level IN (1, 2))');
        DB::statement('
            ALTER TABLE parish_units ADD CONSTRAINT parish_units_l1_has_no_parent
            CHECK (level = 2 OR parent_id IS NULL)
        ');

        // parish_units_name_unique_in_scope — the multi-column predicate form:
        // collapse (bookshelf_id, level, parent_id, name) to a SHA-256 key,
        // NULL when soft-deleted. IFNULL(parent_id, '') recovers Postgres's
        // NULLS NOT DISTINCT: every level-1 unit shares a null parent, and
        // without it a null parent is a wildcard letting duplicate level-1
        // names through (20260808_03's recorded bug class). The comparison is
        // binary because SHA2 hashes BYTES — collation never enters into it —
        // so 'Tổ 1' and 'To 1' hash apart regardless of the name column's
        // collation. CHAR_LENGTH(name) prefixes the one variable-length
        // operand so a literal 0x1f inside a name cannot collide with the
        // separator. Verified end to end on 10.11.19: soft-deleting 'Tổ 1'
        // frees the name, a second live 'Tổ 1' is 1062, 'To 1' inserts fine.
        DB::statement("
            ALTER TABLE parish_units ADD COLUMN name_scope_key BINARY(32)
                GENERATED ALWAYS AS (
                    IF(deleted_at IS NULL,
                       UNHEX(SHA2(CONCAT_WS(0x1f, bookshelf_id, level, IFNULL(parent_id, ''), CHAR_LENGTH(name), name), 256)),
                       NULL)
                ) STORED
        ");
        DB::statement('ALTER TABLE parish_units ADD CONSTRAINT parish_units_name_unique_in_scope UNIQUE (name_scope_key)');
    }

    public function down(): void
    {
        Schema::dropIfExists('parish_units');
    }
};
