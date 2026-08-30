<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Task 16's bell count gets an index that can actually serve it.
     *
     * The shared prop runs `count(*) where user_id = ? and read_at is null
     * and bookshelf_id = ?` on every Inertia page render. Measured against
     * laravel-mariadb-1 over 400 rows spread across two shelves, that
     * planned as `type: ALL, key: null, rows: 400` — a FULL TABLE SCAN with
     * both existing indexes listed in possible_keys and both rejected,
     * because `read_at` appeared in neither. BookshelfScope adds an ordinary
     * WHERE clause, not a scan boundary, so `Using where` filtered AFTER the
     * scan had already read every physical row: on this deliberately
     * multi-tenant install (docs/BUSINESS-REQUIREMENTS.md:57 and
     * docs/SDD.md:228 both describe Phase 1 as "one tenant among many", the
     * whole point of the shared cPanel hosting target) every shelf's readers
     * were paying for
     * every other shelf's notification volume, on every page render, growing
     * with the install rather than with the parish.
     *
     * (user_id, read_at) rather than (bookshelf_id, user_id, read_at):
     * bounding the scan to one shelf would have been the smaller fix, and
     * one user's unread rows is a tighter bound than one shelf's rows anyway
     * — a notification is addressed to a person, and the person is who the
     * count is for.
     *
     * notifications_unread (user_id, created_at) STAYS and is not widened:
     * it is what the list query rides to get its ordering without a filesort
     * (`type: range … rows: 200`, no `Using filesort`), and that is a
     * different access path from this one. Both plans are re-measured after
     * this migration and recorded in the Task 16 report — adding a candidate
     * index can move a plan nobody meant to move.
     *
     * One statement, so the two-DDL rollback dance Task 1's migration needs
     * (`2026_08_29_000001`, whose column and constraint could half-land) has
     * no counterpart here: a CREATE INDEX either lands or does not. It is
     * also non-unique, so unlike that migration it cannot fail on existing
     * data.
     */
    public function up(): void
    {
        Schema::table('notifications', function (Blueprint $table) {
            $table->index(['user_id', 'read_at'], 'notifications_unread_by_user');
        });
    }

    public function down(): void
    {
        Schema::table('notifications', function (Blueprint $table) {
            $table->dropIndex('notifications_unread_by_user');
        });
    }
};
