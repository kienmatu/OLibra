<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('condition_assessments', function (Blueprint $table) {
            $table->string('id', 36)->charset('ascii')->collation('ascii_bin')->primary();
            $table->string('bookshelf_id', 36)->charset('ascii')->collation('ascii_bin');
            // copy_id, loan_id: composite FKs in Task 11.
            $table->string('copy_id', 36)->charset('ascii')->collation('ascii_bin');
            $table->string('loan_id', 36)->charset('ascii')->collation('ascii_bin')->nullable();  // null if assessed outside a return
            $table->string('assessed_by', 36)->charset('ascii')->collation('ascii_bin');
            $table->string('condition', 20)->charset('ascii')->collation('ascii_bin');
            $table->text('note')->nullable();
            $table->text('photo_url')->nullable();
            $table->dateTime('assessed_at', 6)->useCurrent();

            $table->foreign('bookshelf_id')->references('id')->on('bookshelves')->restrictOnDelete();
            $table->foreign('assessed_by')->references('id')->on('users')->restrictOnDelete();
        });

        DB::statement("
            ALTER TABLE condition_assessments ADD CONSTRAINT condition_assessments_condition_check
            CHECK (`condition` IN ('perfect', 'slightly_worn', 'worn', 'torn', 'missing_pages', 'written_on'))
        ");
    }

    public function down(): void
    {
        Schema::dropIfExists('condition_assessments');
    }
};
