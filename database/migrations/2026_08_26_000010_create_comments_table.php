<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('comments', function (Blueprint $table) {
            $table->string('id', 36)->charset('ascii')->collation('ascii_bin')->primary();
            $table->string('bookshelf_id', 36)->charset('ascii')->collation('ascii_bin');
            // Composite FK (cascade) in Task 11.
            $table->string('book_id', 36)->charset('ascii')->collation('ascii_bin');
            $table->string('author_id', 36)->charset('ascii')->collation('ascii_bin');
            $table->text('body');
            $table->string('status', 20)->charset('ascii')->collation('ascii_bin')->default('pending');
            $table->string('moderated_by', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->dateTime('moderated_at', 6)->nullable();
            $table->text('moderation_note')->nullable();
            $table->dateTime('created_at', 6)->useCurrent();
            $table->dateTime('updated_at', 6)->useCurrent();
            $table->dateTime('deleted_at', 6)->nullable();

            $table->foreign('bookshelf_id')->references('id')->on('bookshelves')->restrictOnDelete();
            $table->foreign('author_id')->references('id')->on('users')->restrictOnDelete();
            $table->foreign('moderated_by')->references('id')->on('users')->restrictOnDelete();

            // comments_public was partial on status='approved'; INV-9's
            // enforcement moves wholly to the application read path, the
            // index keeps the access pattern.
            $table->index(['book_id', 'created_at'], 'comments_public');
        });

        DB::statement("
            ALTER TABLE comments ADD CONSTRAINT comments_status_check
            CHECK (status IN ('pending', 'approved', 'rejected', 'hidden'))
        ");
    }

    public function down(): void
    {
        Schema::dropIfExists('comments');
    }
};
