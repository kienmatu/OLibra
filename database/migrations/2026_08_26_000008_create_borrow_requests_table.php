<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('borrow_requests', function (Blueprint $table) {
            $table->string('id', 36)->charset('ascii')->collation('ascii_bin')->primary();
            $table->string('bookshelf_id', 36)->charset('ascii')->collation('ascii_bin');
            // book_id, copy_id, fulfilled_loan_id: composite FKs in Task 11.
            $table->string('book_id', 36)->charset('ascii')->collation('ascii_bin');
            $table->string('copy_id', 36)->charset('ascii')->collation('ascii_bin')->nullable();   // assigned on approval
            $table->string('member_id', 36)->charset('ascii')->collation('ascii_bin');
            $table->string('status', 20)->charset('ascii')->collation('ascii_bin')->default('pending');
            $table->dateTime('requested_at', 6)->useCurrent();   // the queue ordering key
            $table->string('decided_by', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->dateTime('decided_at', 6)->nullable();
            $table->text('decision_note')->nullable();
            $table->dateTime('hold_expires_at', 6)->nullable();
            $table->string('fulfilled_loan_id', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->dateTime('cancelled_at', 6)->nullable();
            $table->dateTime('created_at', 6)->useCurrent();
            $table->dateTime('updated_at', 6)->useCurrent();
            $table->dateTime('deleted_at', 6)->nullable();

            $table->foreign('bookshelf_id')->references('id')->on('bookshelves')->restrictOnDelete();
            $table->foreign('member_id')->references('id')->on('users')->restrictOnDelete();
            $table->foreign('decided_by')->references('id')->on('users')->restrictOnDelete();

            // requests_queue / requests_holds, predicates dropped.
            $table->index(['book_id', 'requested_at'], 'requests_queue');
            $table->index('hold_expires_at', 'requests_holds');
        });

        DB::statement("
            ALTER TABLE borrow_requests ADD CONSTRAINT borrow_requests_status_check
            CHECK (status IN ('pending', 'approved', 'rejected', 'fulfilled', 'expired', 'cancelled'))
        ");
    }

    public function down(): void
    {
        Schema::dropIfExists('borrow_requests');
    }
};
