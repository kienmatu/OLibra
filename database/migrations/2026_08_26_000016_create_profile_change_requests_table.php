<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('profile_change_requests', function (Blueprint $table) {
            $table->string('id', 36)->charset('ascii')->collation('ascii_bin')->primary();
            $table->string('user_id', 36)->charset('ascii')->collation('ascii_bin');
            $table->string('bookshelf_id', 36)->charset('ascii')->collation('ascii_bin');
            $table->json('proposed_values');
            $table->json('previous_values');
            $table->string('status', 20)->charset('ascii')->collation('ascii_bin')->default('pending');
            $table->dateTime('requested_at', 6)->useCurrent();
            $table->string('decided_by', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->dateTime('decided_at', 6)->nullable();
            $table->text('rejection_reason')->nullable();
            $table->dateTime('created_at', 6)->useCurrent();
            $table->dateTime('updated_at', 6)->useCurrent();

            $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete();
            $table->foreign('bookshelf_id')->references('id')->on('bookshelves')->restrictOnDelete();
            $table->foreign('decided_by')->references('id')->on('users')->restrictOnDelete();
        });

        DB::statement("
            ALTER TABLE profile_change_requests ADD CONSTRAINT profile_change_requests_status_check
            CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))
        ");
        DB::statement('
            ALTER TABLE profile_change_requests ADD CONSTRAINT profile_change_requests_rejected_has_reason
            CHECK (status <> \'rejected\' OR rejection_reason IS NOT NULL)
        ');

        // INV-13: at most one pending request per person. NULL whenever
        // status is anything but pending — approved, rejected AND
        // cancelled all free the slot, because the predicate is the
        // positive case (pending) rather than an enumerated negative one.
        DB::statement("
            ALTER TABLE profile_change_requests ADD COLUMN pending_user_id VARCHAR(36)
                CHARACTER SET ascii COLLATE ascii_bin
                GENERATED ALWAYS AS (IF(status = 'pending', user_id, NULL)) STORED
        ");
        DB::statement('
            ALTER TABLE profile_change_requests
            ADD CONSTRAINT profile_change_requests_one_pending UNIQUE (pending_user_id)
        ');
    }

    public function down(): void
    {
        Schema::dropIfExists('profile_change_requests');
    }
};
