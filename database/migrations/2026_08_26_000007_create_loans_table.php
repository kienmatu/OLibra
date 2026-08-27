<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('loans', function (Blueprint $table) {
            $table->string('id', 36)->charset('ascii')->collation('ascii_bin')->primary();
            $table->string('bookshelf_id', 36)->charset('ascii')->collation('ascii_bin');
            // copy_id, book_id, request_id: composite FKs in Task 11.
            $table->string('copy_id', 36)->charset('ascii')->collation('ascii_bin');
            $table->string('book_id', 36)->charset('ascii')->collation('ascii_bin');
            $table->string('borrower_id', 36)->charset('ascii')->collation('ascii_bin');
            $table->string('request_id', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->string('lent_by', 36)->charset('ascii')->collation('ascii_bin');
            $table->dateTime('lent_at', 6)->useCurrent();
            $table->date('due_on');
            $table->string('status', 20)->charset('ascii')->collation('ascii_bin')->default('active');
            $table->dateTime('returned_at', 6)->nullable();
            $table->string('received_by', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->string('return_condition', 20)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->text('return_note')->nullable();
            $table->text('return_photo_url')->nullable();
            $table->integer('renewals_used')->default(0);
            $table->dateTime('lost_reported_at', 6)->nullable();
            $table->string('lost_reported_by', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->dateTime('voided_at', 6)->nullable();
            $table->string('voided_by', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->text('void_reason')->nullable();
            $table->text('notes')->nullable();
            $table->dateTime('created_at', 6)->useCurrent();
            $table->dateTime('updated_at', 6)->useCurrent()->useCurrentOnUpdate();
            // NO deleted_at. INV-11: a loan is voided, never deleted; the
            // trigger refusing DELETE outright arrives in Task 12.

            $table->foreign('bookshelf_id')->references('id')->on('bookshelves')->restrictOnDelete();
            $table->foreign('borrower_id')->references('id')->on('users')->restrictOnDelete();
            $table->foreign('lent_by')->references('id')->on('users')->restrictOnDelete();
            $table->foreign('received_by')->references('id')->on('users')->restrictOnDelete();
            $table->foreign('lost_reported_by')->references('id')->on('users')->restrictOnDelete();
            $table->foreign('voided_by')->references('id')->on('users')->restrictOnDelete();

            // loans_active_by_shelf / loans_by_borrower, predicates dropped.
            $table->index(['bookshelf_id', 'due_on'], 'loans_active_by_shelf');
            $table->index(['borrower_id', 'lent_at'], 'loans_by_borrower');
        });

        DB::statement("
            ALTER TABLE loans ADD CONSTRAINT loans_status_check
            CHECK (status IN ('active', 'returned', 'lost', 'voided'))
        ");
        DB::statement("
            ALTER TABLE loans ADD CONSTRAINT loans_return_condition_check
            CHECK (return_condition IS NULL OR return_condition IN
                ('perfect', 'slightly_worn', 'worn', 'torn', 'missing_pages', 'written_on'))
        ");
        DB::statement("
            ALTER TABLE loans ADD CONSTRAINT loans_voided_has_reason
            CHECK (status <> 'voided' OR void_reason IS NOT NULL)
        ");
        DB::statement("
            ALTER TABLE loans ADD CONSTRAINT loans_returned_has_condition
            CHECK (status <> 'returned' OR return_condition IS NOT NULL)
        ");

        // INV-1, the invariant that MUST be a constraint: two managers can
        // lend the same copy in the same second from two phones. The
        // single-column-predicate form: copy_id when active, NULL otherwise;
        // NULLs are distinct, so returned/lost/voided loans stop colliding.
        // ascii_bin to match copy_id exactly.
        DB::statement("
            ALTER TABLE loans ADD COLUMN active_copy_id VARCHAR(36)
                CHARACTER SET ascii COLLATE ascii_bin
                GENERATED ALWAYS AS (IF(status = 'active', copy_id, NULL)) STORED
        ");
        DB::statement('ALTER TABLE loans ADD CONSTRAINT loans_one_active_per_copy UNIQUE (active_copy_id)');
    }

    public function down(): void
    {
        Schema::dropIfExists('loans');
    }
};
