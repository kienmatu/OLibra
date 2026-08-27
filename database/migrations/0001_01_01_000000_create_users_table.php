<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->string('id', 36)->charset('ascii')->collation('ascii_bin')->primary();
            // utf8mb4_bin so equality is byte equality: 'đăng' and 'dang' are
            // different usernames. Case-insensitivity is provided by the
            // generated LOWER() key below, not by a _ci collation that would
            // also, wrongly, make it accent-insensitive.
            $table->string('username')->nullable()->collation('utf8mb4_bin');
            $table->text('password_hash')->nullable();
            $table->string('saint_name');                       // tên thánh — NOT NULL since 20260812_01
            $table->string('full_name');
            $table->date('date_of_birth')->nullable();
            $table->string('father_name');
            $table->string('mother_name');
            $table->string('phone', 32)->nullable();
            $table->text('phone_missing_reason')->nullable();   // why a phone is on file as missing
            $table->string('email')->nullable();
            $table->string('display_name')->nullable();
            $table->string('locale', 8)->default('vi');
            $table->text('avatar_object')->nullable();          // storage key; avatar_url is history
            $table->boolean('is_super_admin')->default(false);
            $table->dateTime('created_at', 6)->useCurrent();
            $table->dateTime('updated_at', 6)->useCurrent();
            $table->dateTime('deleted_at', 6)->nullable();
        });

        // INV-14: most readers are children who never sign in — a person may
        // have neither username nor password, but never only one of the two.
        DB::statement('
            ALTER TABLE users ADD CONSTRAINT users_credentials_paired
            CHECK ((username IS NULL) = (password_hash IS NULL))
        ');

        // users_username_key, the generated-column form of the partial unique
        // index `on users (lower(username)) where deleted_at is null and
        // username is not null`. NULL when the predicate is false; MariaDB
        // treats NULLs as distinct in a unique index, so soft-deleted rows
        // and credential-less readers never collide.
        DB::statement('
            ALTER TABLE users ADD COLUMN username_active VARCHAR(255)
                CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
                GENERATED ALWAYS AS (
                    IF(deleted_at IS NULL AND username IS NOT NULL, LOWER(username), NULL)
                ) STORED
        ');
        DB::statement('ALTER TABLE users ADD CONSTRAINT users_username_key UNIQUE (username_active)');

        // Laravel's own session table shape — but rows are keyed on
        // sha256(session id) by the hashed-database driver (Task 16), so the
        // old design's hashed-at-rest property survives: a database dump is
        // never a stack of usable sessions. Decision recorded in Task 16's
        // preamble.
        Schema::create('sessions', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('user_id', 36)->charset('ascii')->collation('ascii_bin')->nullable()->index();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->longText('payload');
            $table->integer('last_activity')->index();

            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
        });

        // No password_reset_tokens table: v1 has no outbound email and no
        // self-service reset — a manager sets credentials (BR §2).
    }

    public function down(): void
    {
        Schema::dropIfExists('sessions');
        Schema::dropIfExists('users');
    }
};
