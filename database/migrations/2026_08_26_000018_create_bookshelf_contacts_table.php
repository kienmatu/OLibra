<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('bookshelf_contacts', function (Blueprint $table) {
            $table->string('id', 36)->charset('ascii')->collation('ascii_bin')->primary();
            $table->string('bookshelf_id', 36)->charset('ascii')->collation('ascii_bin');
            // 1..3: one mandatory contact, two optional — the product decision
            // is in the schema, not a form (20260812_01).
            $table->unsignedTinyInteger('position');
            $table->string('name');
            $table->string('phone', 32)->nullable();
            $table->string('role_label')->nullable();
            $table->dateTime('created_at', 6)->useCurrent();
            $table->dateTime('updated_at', 6)->useCurrent()->useCurrentOnUpdate();
            $table->dateTime('deleted_at', 6)->nullable();

            $table->foreign('bookshelf_id')->references('id')->on('bookshelves')->restrictOnDelete();

            // bookshelf_contacts_by_shelf, predicate dropped: the postgres
            // index was partial (where deleted_at is null); MariaDB has no
            // partial index, so the soft-delete filter runs as a WHERE
            // clause against this plain covering index.
            $table->index('bookshelf_id', 'bookshelf_contacts_by_shelf');
        });

        DB::statement('
            ALTER TABLE bookshelf_contacts ADD CONSTRAINT bookshelf_contacts_position_check
            CHECK (position BETWEEN 1 AND 3)
        ');

        // bookshelf_contacts_position, alive rows only: a retired contact
        // must not block the position it used to hold.
        DB::statement('
            ALTER TABLE bookshelf_contacts ADD COLUMN position_key BINARY(32)
                GENERATED ALWAYS AS (
                    IF(deleted_at IS NULL,
                       UNHEX(SHA2(CONCAT_WS(0x1f, bookshelf_id, position), 256)),
                       NULL)
                ) STORED
        ');
        DB::statement('ALTER TABLE bookshelf_contacts ADD CONSTRAINT bookshelf_contacts_position UNIQUE (position_key)');
    }

    public function down(): void
    {
        Schema::dropIfExists('bookshelf_contacts');
    }
};
