<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('announcements', function (Blueprint $table) {
            $table->string('id', 36)->charset('ascii')->collation('ascii_bin')->primary();
            $table->string('bookshelf_id', 36)->charset('ascii')->collation('ascii_bin');
            $table->string('title');
            $table->string('slug')->collation('utf8mb4_bin');
            $table->text('body');                                // rich
            $table->text('body_text');                           // plain derivation, for excerpts
            $table->boolean('is_pinned')->default(false);
            $table->dateTime('published_at', 6)->nullable();     // null means draft
            $table->dateTime('expires_at', 6)->nullable();
            $table->string('author_id', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->dateTime('created_at', 6)->useCurrent();
            $table->dateTime('updated_at', 6)->useCurrent();
            $table->dateTime('deleted_at', 6)->nullable();

            $table->foreign('bookshelf_id')->references('id')->on('bookshelves')->restrictOnDelete();
            $table->foreign('author_id')->references('id')->on('users')->restrictOnDelete();
        });

        // announcements_bookshelf_id_slug_key, alive rows only.
        DB::statement('
            ALTER TABLE announcements ADD COLUMN slug_key BINARY(32)
                GENERATED ALWAYS AS (
                    IF(deleted_at IS NULL,
                       UNHEX(SHA2(CONCAT_WS(0x1f, bookshelf_id, CHAR_LENGTH(slug), slug), 256)),
                       NULL)
                ) STORED
        ');
        DB::statement('ALTER TABLE announcements ADD CONSTRAINT announcements_bookshelf_id_slug_key UNIQUE (slug_key)');
    }

    public function down(): void
    {
        Schema::dropIfExists('announcements');
    }
};
