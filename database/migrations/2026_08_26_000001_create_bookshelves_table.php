<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('bookshelves', function (Blueprint $table) {
            $table->string('id', 36)->charset('ascii')->collation('ascii_bin')->primary();
            $table->string('slug')->collation('utf8mb4_bin');
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('location')->nullable();
            $table->string('address')->nullable();
            $table->text('cover_url')->nullable();
            $table->string('timezone', 64)->default('Asia/Ho_Chi_Minh');
            $table->string('locale', 8)->default('vi');
            $table->string('status', 20)->charset('ascii')->collation('ascii_bin')->default('active');
            $table->json('settings');                            // LONGTEXT + json_valid CHECK on MariaDB
            $table->date('established_on')->nullable();
            $table->string('created_by', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->dateTime('created_at', 6)->useCurrent();
            $table->dateTime('updated_at', 6)->useCurrent();
            $table->dateTime('deleted_at', 6)->nullable();

            $table->foreign('created_by')->references('id')->on('users')->restrictOnDelete();
        });

        DB::statement("
            ALTER TABLE bookshelves ADD CONSTRAINT bookshelves_status_check
            CHECK (status IN ('active', 'archived'))
        ");
        // MariaDB accepts a literal DEFAULT on TEXT since 10.2; Laravel's
        // json() has no ->default() portability, so set it raw.
        DB::statement("ALTER TABLE bookshelves ALTER COLUMN settings SET DEFAULT '{}'");

        // bookshelves_slug_unique: unique on slug where deleted_at is null.
        // Soft deletion exists to undo mistakes (BR §11); a plain unique
        // would make every undone shelf a landmine holding its slug forever.
        DB::statement('
            ALTER TABLE bookshelves ADD COLUMN slug_active VARCHAR(255)
                CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
                GENERATED ALWAYS AS (IF(deleted_at IS NULL, slug, NULL)) STORED
        ');
        DB::statement('ALTER TABLE bookshelves ADD CONSTRAINT bookshelves_slug_unique UNIQUE (slug_active)');
    }

    public function down(): void
    {
        Schema::dropIfExists('bookshelves');
    }
};
