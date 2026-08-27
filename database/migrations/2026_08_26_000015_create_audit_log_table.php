<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('audit_log', function (Blueprint $table) {
            $table->id();                                        // BIGINT auto-increment — the one non-uuid pk
            // Both nullable: a cross-shelf act belongs to no shelf, and a
            // system action has no actor. INV-12's append-only triggers
            // (no UPDATE, no DELETE) and no deleted_at column — Task 12.
            $table->string('bookshelf_id', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->string('actor_id', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->string('action');
            $table->string('entity_type');
            $table->string('entity_id', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->json('before')->nullable();
            $table->json('after')->nullable();
            $table->json('context');
            $table->dateTime('occurred_at', 6)->useCurrent();

            $table->foreign('bookshelf_id')->references('id')->on('bookshelves')->restrictOnDelete();
            $table->foreign('actor_id')->references('id')->on('users')->restrictOnDelete();

            $table->index(['actor_id', 'occurred_at'], 'audit_log_actor');
            $table->index(['bookshelf_id', 'occurred_at'], 'audit_log_shelf');
            $table->index(['entity_type', 'entity_id', 'occurred_at'], 'audit_log_entity');
        });

        DB::statement("ALTER TABLE audit_log ALTER COLUMN context SET DEFAULT '{}'");
        // INV-12's UPDATE/DELETE-refusing triggers arrive in Task 12.
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_log');
    }
};
