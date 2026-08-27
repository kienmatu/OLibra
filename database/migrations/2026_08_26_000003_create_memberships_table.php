<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('memberships', function (Blueprint $table) {
            $table->string('id', 36)->charset('ascii')->collation('ascii_bin')->primary();
            $table->string('bookshelf_id', 36)->charset('ascii')->collation('ascii_bin');
            $table->string('user_id', 36)->charset('ascii')->collation('ascii_bin');
            $table->string('role', 20)->charset('ascii')->collation('ascii_bin')->default('reader');
            $table->string('status', 20)->charset('ascii')->collation('ascii_bin')->default('pending');
            // Parish facts: true of this person HERE, not everywhere.
            // Composite FKs to parish_units arrive in Task 11.
            $table->string('parish_unit_l1_id', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->string('parish_unit_l2_id', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->string('approved_by', 36)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->dateTime('approved_at', 6)->nullable();
            $table->text('rejection_reason')->nullable();
            $table->text('suspension_reason')->nullable();
            $table->text('manager_notes')->nullable();          // private to managers
            $table->dateTime('created_at', 6)->useCurrent();
            $table->dateTime('updated_at', 6)->useCurrent()->useCurrentOnUpdate();
            $table->dateTime('deleted_at', 6)->nullable();

            $table->foreign('bookshelf_id')->references('id')->on('bookshelves')->restrictOnDelete();
            $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete();
            $table->foreign('approved_by')->references('id')->on('users')->restrictOnDelete();

            // The uniqueness guarantee itself lives on the opaque generated
            // member_key below (needed for the soft-delete-aware behaviour),
            // which leaves "is this user a member of this shelf" — asked by
            // ResolveTenant (Task 16) on every request — with only the two
            // single-column FK indexes to work with. A real composite index
            // for that lookup.
            $table->index(['user_id', 'bookshelf_id']);
        });

        DB::statement("
            ALTER TABLE memberships ADD CONSTRAINT memberships_role_check
            CHECK (role IN ('reader', 'manager', 'admin'))
        ");
        DB::statement("
            ALTER TABLE memberships ADD CONSTRAINT memberships_status_check
            CHECK (status IN ('pending', 'active', 'suspended', 'left', 'rejected'))
        ");
        DB::statement("
            ALTER TABLE memberships ADD CONSTRAINT memberships_rejected_has_reason
            CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL)
        ");

        // memberships_one_per_shelf, alive rows only — 20260808_09's shape:
        // a person who left and re-joins must not collide with their own
        // soft-deleted membership. No CHAR_LENGTH prefix: both operands are
        // fixed-length uuids, so the separator cannot be ambiguous.
        DB::statement('
            ALTER TABLE memberships ADD COLUMN member_key BINARY(32)
                GENERATED ALWAYS AS (
                    IF(deleted_at IS NULL,
                       UNHEX(SHA2(CONCAT_WS(0x1f, bookshelf_id, user_id), 256)),
                       NULL)
                ) STORED
        ');
        DB::statement('ALTER TABLE memberships ADD CONSTRAINT memberships_one_per_shelf UNIQUE (member_key)');
    }

    public function down(): void
    {
        Schema::dropIfExists('memberships');
    }
};
