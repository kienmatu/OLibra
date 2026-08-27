<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('book_copies', function (Blueprint $table) {
            $table->string('id', 36)->charset('ascii')->collation('ascii_bin')->primary();
            $table->string('bookshelf_id', 36)->charset('ascii')->collation('ascii_bin');
            // Composite FK (bookshelf_id, book_id) -> books(bookshelf_id, id)
            // in Task 11.
            $table->string('book_id', 36)->charset('ascii')->collation('ascii_bin');
            $table->string('code', 32)->collation('utf8mb4_bin');   // 'DT-0142'
            $table->string('state', 20)->charset('ascii')->collation('ascii_bin')->default('available');
            $table->string('condition', 20)->charset('ascii')->collation('ascii_bin')->default('perfect');
            $table->text('condition_note')->nullable();
            $table->date('acquired_on')->nullable();
            $table->string('acquired_from')->nullable();
            // Composite FK (bookshelf_id, acquired_from_membership_id) ->
            // memberships(bookshelf_id, id) in Task 11.
            $table->string('acquired_from_membership_id', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->dateTime('retired_at', 6)->nullable();
            $table->text('retired_reason')->nullable();
            $table->dateTime('lost_reported_at', 6)->nullable();
            $table->dateTime('qr_printed_at', 6)->nullable();
            $table->integer('qr_print_count')->default(0);
            $table->dateTime('created_at', 6)->useCurrent();
            $table->dateTime('updated_at', 6)->useCurrent()->useCurrentOnUpdate();
            $table->dateTime('deleted_at', 6)->nullable();

            $table->foreign('bookshelf_id')->references('id')->on('bookshelves')->restrictOnDelete();

            // copies_by_book / copies_by_state, predicates dropped.
            $table->index('book_id', 'copies_by_book');
            $table->index(['bookshelf_id', 'state'], 'copies_by_state');
        });

        DB::statement("
            ALTER TABLE book_copies ADD CONSTRAINT book_copies_state_check
            CHECK (state IN ('available', 'held', 'on_loan', 'lost', 'retired'))
        ");
        DB::statement("
            ALTER TABLE book_copies ADD CONSTRAINT book_copies_condition_check
            CHECK (`condition` IN ('perfect', 'slightly_worn', 'worn', 'torn', 'missing_pages', 'written_on'))
        ");
        DB::statement('
            ALTER TABLE book_copies ADD CONSTRAINT book_copies_retired_has_reason
            CHECK (state <> \'retired\' OR retired_reason IS NOT NULL)
        ');

        // book_copies_code_unique, alive rows only (20260808_09).
        DB::statement('
            ALTER TABLE book_copies ADD COLUMN code_key BINARY(32)
                GENERATED ALWAYS AS (
                    IF(deleted_at IS NULL,
                       UNHEX(SHA2(CONCAT_WS(0x1f, bookshelf_id, CHAR_LENGTH(code), code), 256)),
                       NULL)
                ) STORED
        ');
        DB::statement('ALTER TABLE book_copies ADD CONSTRAINT book_copies_code_unique UNIQUE (code_key)');
    }

    public function down(): void
    {
        Schema::dropIfExists('book_copies');
    }
};
