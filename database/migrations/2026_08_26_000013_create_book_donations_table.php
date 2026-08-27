<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('book_donations', function (Blueprint $table) {
            $table->string('id', 36)->charset('ascii')->collation('ascii_bin')->primary();
            $table->string('bookshelf_id', 36)->charset('ascii')->collation('ascii_bin');
            // Composite FK (restrict) in Task 11.
            $table->string('donor_membership_id', 36)->charset('ascii')->collation('ascii_bin');
            $table->text('description');                         // free text; a child does not know an ISBN
            $table->text('photo_url')->nullable();
            $table->integer('estimated_count')->nullable();
            $table->string('status', 20)->charset('ascii')->collation('ascii_bin')->default('pending');
            $table->string('decided_by', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->dateTime('decided_at', 6)->nullable();
            $table->text('decision_note')->nullable();
            $table->dateTime('created_at', 6)->useCurrent();
            $table->dateTime('updated_at', 6)->useCurrent();
            // No deleted_at — matching 0006_community.sql.

            $table->foreign('bookshelf_id')->references('id')->on('bookshelves')->restrictOnDelete();
            $table->foreign('decided_by')->references('id')->on('users')->restrictOnDelete();

            // book_donations_queue, predicate dropped.
            $table->index(['bookshelf_id', 'created_at'], 'book_donations_queue');
        });

        DB::statement("
            ALTER TABLE book_donations ADD CONSTRAINT book_donations_status_check
            CHECK (status IN ('pending', 'received', 'declined'))
        ");
        DB::statement("
            ALTER TABLE book_donations ADD CONSTRAINT book_donations_declined_has_reason
            CHECK (status <> 'declined' OR decision_note IS NOT NULL)
        ");
    }

    public function down(): void
    {
        Schema::dropIfExists('book_donations');
    }
};
