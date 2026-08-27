<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('system_settings', function (Blueprint $table) {
            // Postgres: id boolean primary key default true check (id).
            // MariaDB has no boolean-pk idiom; TINYINT + CHECK (id = 1) keeps
            // the property — a second row under id=1 is a clean duplicate-key
            // error, and a row under any other id is refused by the CHECK.
            $table->unsignedTinyInteger('id')->default(1)->primary();
            $table->string('contact_name')->nullable();
            $table->string('contact_phone', 32)->nullable();
            $table->string('contact_hours')->nullable();
            $table->integer('default_loan_days')->default(14);
            $table->integer('default_max_concurrent_loans')->default(3);
            $table->integer('default_hold_days')->default(3);
            $table->integer('default_max_renewals')->default(1);
            $table->integer('default_renewal_days')->default(7);
            $table->integer('default_due_soon_days')->default(3);
            // changed_by/changed_at, NOT updated_by/updated_at — the name is
            // the point: this timestamp is domain-meaningful ("when did an
            // administrator last change these") and is written explicitly,
            // never by convention. 20260810_01 carries the full argument.
            $table->string('changed_by', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->dateTime('changed_at', 6)->useCurrent();

            $table->foreign('changed_by')->references('id')->on('users')->restrictOnDelete();
        });

        DB::statement('ALTER TABLE system_settings ADD CONSTRAINT system_settings_single_row CHECK (id = 1)');

        // The row itself, so every read is a SELECT rather than an upsert.
        DB::table('system_settings')->insert(['id' => 1]);
    }

    public function down(): void
    {
        Schema::dropIfExists('system_settings');
    }
};
