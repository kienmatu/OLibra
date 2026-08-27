<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('feedback', function (Blueprint $table) {
            $table->string('id', 36)->charset('ascii')->collation('ascii_bin')->primary();
            // NULLABLE — front-door feedback has no shelf. The plain FK stays
            // here (feedback is NOT in the composite-FK list; its shelf link
            // is optional identity, not a tenant-scoped reference chain).
            $table->string('bookshelf_id', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->string('member_id', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->string('guest_name')->nullable();
            $table->string('guest_contact')->nullable();
            $table->string('guest_hash', 64)->nullable();        // rate limiting
            $table->string('subject');
            $table->text('body');
            $table->string('status', 20)->charset('ascii')->collation('ascii_bin')->default('new');
            $table->string('handled_by', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->dateTime('handled_at', 6)->nullable();
            $table->dateTime('created_at', 6)->useCurrent();
            // No updated_at, no deleted_at — matching 0006_community.sql.

            $table->foreign('bookshelf_id')->references('id')->on('bookshelves')->restrictOnDelete();
            $table->foreign('member_id')->references('id')->on('users')->restrictOnDelete();
            $table->foreign('handled_by')->references('id')->on('users')->restrictOnDelete();
        });

        DB::statement("
            ALTER TABLE feedback ADD CONSTRAINT feedback_status_check
            CHECK (status IN ('new', 'read', 'resolved'))
        ");
        // The bookshelf_id-immutable trigger (20260808_10's guarantee)
        // arrives in Task 12 with the other triggers.
    }

    public function down(): void
    {
        Schema::dropIfExists('feedback');
    }
};
