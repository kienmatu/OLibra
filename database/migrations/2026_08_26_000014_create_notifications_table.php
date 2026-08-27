<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('notifications', function (Blueprint $table) {
            $table->string('id', 36)->charset('ascii')->collation('ascii_bin')->primary();
            $table->string('bookshelf_id', 36)->charset('ascii')->collation('ascii_bin');
            $table->string('user_id', 36)->charset('ascii')->collation('ascii_bin');
            $table->string('kind');
            $table->json('payload');                             // LONGTEXT + json_valid CHECK on MariaDB
            $table->dateTime('read_at', 6)->nullable();
            $table->dateTime('created_at', 6)->useCurrent();

            $table->foreign('bookshelf_id')->references('id')->on('bookshelves')->restrictOnDelete();
            $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete();

            // notifications_unread, predicate dropped: the postgres index
            // was partial (where read_at is null), MariaDB has no partial
            // index, so this is the plain covering index for the same
            // access path — the unread filter runs as a WHERE clause.
            $table->index(['user_id', 'created_at'], 'notifications_unread');
        });

        // MariaDB accepts a literal DEFAULT on TEXT since 10.2; Laravel's
        // json() has no ->default() portability, so set it raw.
        DB::statement("ALTER TABLE notifications ALTER COLUMN payload SET DEFAULT '{}'");
    }

    public function down(): void
    {
        Schema::dropIfExists('notifications');
    }
};
